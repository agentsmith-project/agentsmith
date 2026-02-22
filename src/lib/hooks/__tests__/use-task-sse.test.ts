import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTaskSSE } from '../use-task-sse';

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
  fetchSSETicket: vi.fn(async () => 'ticket-123'),
  createAuthenticatedSSE: vi.fn((_path: string, _ticket: string) => {
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
    vi.unstubAllGlobals();
  });

  it('emits debug events for connect/open/message', async () => {
    const onDebug = vi.fn();
    const onMessage = vi.fn();

    renderHook(() =>
      useTaskSSE('ws_default', 'proj_1', 'task_1', {
        onDebug,
        onMessage,
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
});
