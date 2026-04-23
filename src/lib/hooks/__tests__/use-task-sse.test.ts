import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTaskSSE } from '../use-task-sse';
import { createAuthenticatedSSEAsync } from '@/lib/api/sse-client';

type MockES = {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
};

let currentEventSource: MockES | null = null;

vi.mock('@/lib/api', () => {
  class MockTaskAPI {
    getSSEUrl(_workspaceId: string, _projectId: string, taskId: string) {
      return `http://localhost:20000/api/v1/tasks/${taskId}/events`;
    }
  }
  return {
    API_BASE: 'http://localhost:20000/api/v1',
    TaskAPI: MockTaskAPI,
    getApiClient: () => ({
      getToken: () => 'jwt-token',
    }),
  };
});

vi.mock('@/lib/api/sse-client', () => ({
  createAuthenticatedSSEAsync: vi.fn(async (_path: string, _ticket: string) => {
    currentEventSource = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onerror: null,
      close: vi.fn(),
    };
    return currentEventSource;
  }),
}));

describe('useTaskSSE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentEventSource = null;
    vi.stubGlobal('EventSource', {
      CLOSED: 2,
    } as unknown as typeof EventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('emits debug events for connect/open/message', async () => {
    const onDebug = vi.fn();
    const onMessage = vi.fn();
    const onTraceEvent = vi.fn();

    renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_1', {
        onDebug,
        onMessage,
        onTraceEvent,
      }),
    );

    await waitFor(() => {
      expect(currentEventSource).not.toBeNull();
    });

    act(() => {
      currentEventSource?.onopen?.();
    });

    act(() => {
      currentEventSource?.onmessage?.({
        data: JSON.stringify({
          type: 'message',
          data: {
            id: 'msg_1',
            task_id: 'task_1',
            role: 'agent',
            content: 'hello',
            created_at: new Date().toISOString(),
          },
        }),
        lastEventId: 'evt-1',
      } as unknown as MessageEvent);
    });

    expect(onMessage).toHaveBeenCalled();
    expect(onDebug).toHaveBeenCalledWith(expect.objectContaining({ phase: 'connect_start' }));
    expect(onDebug).toHaveBeenCalledWith(expect.objectContaining({ phase: 'open' }));
    expect(onDebug).toHaveBeenCalledWith(expect.objectContaining({ phase: 'message', summary: 'type=message' }));

    act(() => {
      currentEventSource?.onmessage?.({
        data: JSON.stringify({
          type: 'trace_event',
          data: {
            id: 'trace_1',
            task_id: 'task_1',
            message_id: 'msg_1',
            run_id: 'run_1',
            seq: 1,
            at: new Date().toISOString(),
            category: 'progress',
            phase: 'start',
            status: 'running',
            name: 'codex.exec',
            summary: 'Starting Codex execution',
          },
        }),
      } as unknown as MessageEvent);
    });

    expect(onTraceEvent).toHaveBeenCalledWith(expect.objectContaining({
      id: 'trace_1',
      category: 'progress',
      name: 'codex.exec',
    }));
  });

  it('emits reconnect debug events on sse error and retries', async () => {
    const onDebug = vi.fn();

    renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_2', {
        onDebug,
        reconnectInterval: 10,
        maxReconnectAttempts: 2,
      }),
    );

    await waitFor(() => {
      expect(currentEventSource).not.toBeNull();
    });

    act(() => {
      if (currentEventSource) currentEventSource.readyState = 2;
      currentEventSource?.onerror?.({} as Event);
    });

    expect(onDebug).toHaveBeenCalledWith(expect.objectContaining({ phase: 'sse_error' }));
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'reconnect_scheduled', summary: 'attempt=1/2' }),
    );

    const first = currentEventSource;
    await waitFor(() => {
      expect(currentEventSource).not.toBe(first);
    }, { timeout: 1000 });
  });

  it('emits replay gap debug events when reconnecting with last_event_id', async () => {
    const onDebug = vi.fn();

    renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_3', {
        onDebug,
        reconnectInterval: 10,
        maxReconnectAttempts: 1,
      }),
    );

    await waitFor(() => {
      expect(currentEventSource).not.toBeNull();
    });

    act(() => {
      currentEventSource?.onmessage?.({
        data: JSON.stringify({
          type: 'message',
          data: {
            id: 'msg_1',
            task_id: 'task_3',
            role: 'agent',
            content: 'hello',
            created_at: new Date().toISOString(),
          },
        }),
        lastEventId: 'evt-42',
      } as unknown as MessageEvent);
    });

    act(() => {
      if (currentEventSource) currentEventSource.readyState = 2;
      currentEventSource?.onerror?.({} as Event);
    });

    await waitFor(() => {
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'trace_gap_fill_start', summary: 'last_event_id=evt-42' }),
      );
    });

    act(() => {
      currentEventSource?.onopen?.();
    });

    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'trace_gap_fill_done', summary: 'last_event_id=evt-42' }),
    );
  });

  it('exposes ticket failure codes when initial SSE connect fails before EventSource opens', async () => {
    vi.mocked(createAuthenticatedSSEAsync).mockRejectedValueOnce(
      Object.assign(new Error('SSE ticket endpoint is not available in this environment.'), {
        code: 'SSE_TICKET_UNAVAILABLE',
      }),
    );

    const { result } = renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_4', {
        reconnectInterval: 10,
        maxReconnectAttempts: 1,
      }),
    );

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('error');
    });

    expect(result.current.connectionErrorCode).toBe('SSE_TICKET_UNAVAILABLE');
    expect(result.current.connectionErrorMessage).toContain('ticket endpoint');
  });

  it('marks stream as unavailable when reconnect exhausts before any open event', async () => {
    const { result } = renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_5', {
        reconnectInterval: 10,
        maxReconnectAttempts: 0,
      }),
    );

    await waitFor(() => {
      expect(currentEventSource).not.toBeNull();
    });

    act(() => {
      if (currentEventSource) currentEventSource.readyState = 2;
      currentEventSource?.onerror?.({} as Event);
    });

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('error');
    });

    expect(result.current.connectionErrorCode).toBe('TASK_EVENTS_STREAM_UNAVAILABLE');
  });

  it('marks stream recovery as exhausted after a previously opened connection fails repeatedly', async () => {
    const { result } = renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_6', {
        reconnectInterval: 10,
        maxReconnectAttempts: 0,
      }),
    );

    await waitFor(() => {
      expect(currentEventSource).not.toBeNull();
    });

    act(() => {
      currentEventSource?.onopen?.();
    });

    act(() => {
      currentEventSource?.onmessage?.({
        data: JSON.stringify({
          type: 'message',
          data: {
            id: 'msg_1',
            task_id: 'task_6',
            role: 'agent',
            content: 'hello',
            created_at: new Date().toISOString(),
          },
        }),
        lastEventId: 'evt-77',
      } as unknown as MessageEvent);
    });

    act(() => {
      if (currentEventSource) currentEventSource.readyState = 2;
      currentEventSource?.onerror?.({} as Event);
    });

    await waitFor(() => {
      expect(result.current.connectionStatus).toBe('error');
    });

    expect(result.current.connectionErrorCode).toBe('TASK_EVENTS_RECOVERY_EXHAUSTED');
  });

  it('reconnects when the stream goes silent during an active run', async () => {
    vi.useFakeTimers();
    const onDebug = vi.fn();

    renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_watchdog', {
        onDebug,
        reconnectInterval: 10,
        maxReconnectAttempts: 2,
        watchdogEnabled: true,
        watchdogTimeoutMs: 1_000,
      } as Parameters<typeof useTaskSSE>[3]),
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(currentEventSource).not.toBeNull();

    act(() => {
      currentEventSource?.onopen?.();
    });

    const first = currentEventSource;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(first?.close).toHaveBeenCalledTimes(1);
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'sse_error',
        summary: expect.stringContaining('watchdog_timeout_ms=1000'),
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'reconnect_scheduled',
        summary: 'attempt=1/2',
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
    });

    expect(currentEventSource).not.toBe(first);
  });
});
