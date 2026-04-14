import { describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import { NotebookTerminalService } from './notebook-terminal-service.js';
import { resolveInternalTicket } from './internal-ticket-store.js';

class FakeWebSocket {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  closeCalls: Array<{ code: number; reason: string }> = [];
  private readonly handlers = new Map<string, Array<(...args: unknown[]) => void>>();

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(code: number, reason: string): void {
    this.closeCalls.push({ code, reason });
    this.readyState = 3;
    this.emit('close', code, Buffer.from(reason));
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

async function waitForAssertion(assertion: () => Promise<void> | void, attempts = 20): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

type TerminalRuntimeEvent = {
  type: 'started' | 'output' | 'exited' | 'error';
  session_id?: string;
  cols?: number;
  rows?: number;
  chunk?: string;
  exit_code?: number | null;
  signal?: string | null;
  error_code?: string;
  error_message?: string;
};

function createControlledRuntimeStream<T>() {
  const queued: Array<{
    event: T;
    resolveProcessed: () => void;
  }> = [];
  let closed = false;
  let resolveNext: (() => void) | undefined;

  const notify = (): void => {
    if (!resolveNext) return;
    const resolve = resolveNext;
    resolveNext = undefined;
    resolve();
  };

  return {
    push(event: T): Promise<void> {
      return new Promise<void>((resolveProcessed) => {
        queued.push({ event, resolveProcessed });
        notify();
      });
    },
    pushWithoutWaiting(event: T): void {
      queued.push({
        event,
        resolveProcessed: () => undefined,
      });
      notify();
    },
    close(): void {
      closed = true;
      notify();
    },
    stream: (async function* stream() {
      while (!closed || queued.length > 0) {
        if (queued.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
          continue;
        }
        const next = queued.shift();
        if (next !== undefined) {
          next.resolveProcessed();
          yield next.event;
        }
      }
    })(),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const TERMINAL_SERVICE_RELOAD_CLOSE_REASON = 'terminal_connection_failed_service_reload';

async function seedSessionForServiceReload(status: 'pending' | 'active' | 'disconnected') {
  const cache = new InMemoryCache();
  const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
  const service = new NotebookTerminalService(cache, {
    dispatchTerminalSession: vi.fn(async () => ({
      writeInput: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      stream: runtimeEvents.stream,
    })),
  } as never);

  const created = await service.createSession({
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    taskId: 'task_1',
    agentId: 'agent_1',
    runnerSessionId: 'task_1',
    userId: 'user_1',
    cols: 80,
    rows: 24,
  });

  let staleReconnectPath: string | null = null;
  if (status !== 'pending') {
    const session = await service.getSession(created.sessionId);
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
    });

    if (status === 'disconnected') {
      ws.close(1000, 'browser_tab_closed');
      await waitForAssertion(async () => {
        expect(await service.getSession(created.sessionId)).toMatchObject({
          id: created.sessionId,
          status: 'disconnected',
        });
      });

      const reconnect = await service.issueReconnectTicket(created.sessionId);
      staleReconnectPath = reconnect?.wsPath ?? null;
    }
  }

  return {
    cache,
    service,
    created,
    staleReconnectPath,
  };
}

describe('NotebookTerminalService', () => {
  it('creates an in-memory terminal session with a browser ws ticket', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 120,
      rows: 32,
    });

    expect(created.sessionId).toMatch(/^term_/);
    expect(created.wsPath).toContain(`/tasks/task_1/terminal/ws?session_id=${created.sessionId}`);
    expect(created.wsTicket).toMatch(/^term_/);

    const session = await service.getSession(created.sessionId);
    expect(session).not.toBeNull();
    expect(session?.status).toBe('pending');
    expect(session?.cols).toBe(120);
    expect(session?.rows).toBe(32);

    const ticket = await resolveInternalTicket(cache, created.wsTicket, 'terminal_ws_access');
    expect(ticket?.workspace_id).toBe('ws_default');
    expect(ticket?.project_id).toBe('proj_1');
    expect(ticket?.payload.task_id).toBe('task_1');
    expect(ticket?.payload.terminal_session_id).toBe(created.sessionId);
  });

  it('records terminal session completion metadata through lifecycle hooks', async () => {
    const cache = new InMemoryCache();
    const onSessionClosed = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);
    service.configureLifecycleHooks({ onSessionClosed });

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => void;
    }).finishSession(created.sessionId, 'closed', 'process_exited', 0);

    const session = await service.getSession(created.sessionId);
    expect(session?.status).toBe('closed');
    expect(session?.closeReason).toBe('process_exited');
    expect(session?.exitCode).toBe(0);
    expect(session?.endedAt).toMatch(/T/);
    expect(onSessionClosed).toHaveBeenCalledTimes(1);
    expect(onSessionClosed.mock.calls[0]?.[0]).toMatchObject({
      id: created.sessionId,
      status: 'closed',
      closeReason: 'process_exited',
      exitCode: 0,
    });
  });

  it('omits a closed session from task listings while preserving singular lookup until delete', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => void;
    }).finishSession(created.sessionId, 'closed', 'process_exited', 0);

    await expect(
      service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toEqual([]);

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closed',
      closeReason: 'process_exited',
      exitCode: 0,
    });
  });

  it('restores persisted session metadata when in-memory session is gone', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 90,
      rows: 25,
    });

    (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => void;
      sessions: Map<string, unknown>;
    }).finishSession(created.sessionId, 'closed', 'process_exited', 0);
    (service as unknown as { sessions: Map<string, unknown> }).sessions.clear();

    const restored = await service.getSession(created.sessionId);
    expect(restored).toMatchObject({
      id: created.sessionId,
      status: 'closed',
      closeReason: 'process_exited',
      exitCode: 0,
      cols: 90,
      rows: 25,
    });
  });

  it('does not crash when the browser socket disappears before terminal stream fails', async () => {
    const failStream = createDeferred<void>();
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: (async function* stream() {
          yield {
            type: 'started' as const,
            session_id: 'term_stream',
            cols: 80,
            rows: 24,
          };
          await failStream.promise;
          throw new Error('stream_boom');
        })(),
      })),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    const session = await service.getSession(created.sessionId);
    const ws = new FakeWebSocket();

    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    session!.browserSocket = undefined;
    failStream.resolve();
    await waitForAssertion(async () => {
      const updated = await service.getSession(created.sessionId);
      expect(updated?.status).toBe('failed');
      expect(updated?.closeReason).toBe('terminal_stream_failed');
    });
    expect(ws.closeCalls).toHaveLength(0);
  });

  it('preserves disconnected truth across post-close runtime output until browser reconnects', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    const session = await service.getSession(created.sessionId);
    const firstWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);

    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
    });

    firstWs.close(1000, 'browser_tab_closed');
    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
    });
    const disconnectedAt = (await service.getSession(created.sessionId))?.lastActivityAt;

    await new Promise((resolve) => setTimeout(resolve, 20));
    runtimeEvents.pushWithoutWaiting({
      type: 'output',
      session_id: created.sessionId,
      chunk: 'still running after disconnect',
    });

    await waitForAssertion(async () => {
      const updated = await service.getSession(created.sessionId);
      expect(updated?.lastActivityAt).not.toBe(disconnectedAt);
      expect(updated).toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
    });

    const disconnectedSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, disconnectedSession!);

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
    });
  });

  it('records browser websocket close as disconnected truth and returns the same session to active on reconnect', async () => {
    const cache = new InMemoryCache();
    const dispatchTerminalSession = vi.fn(async () => ({
      writeInput: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      stream: (async function* stream() {
        yield {
          type: 'started' as const,
          session_id: 'term_stream',
          cols: 80,
          rows: 24,
        };
        await new Promise(() => undefined);
      })(),
    }));
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    const session = await service.getSession(created.sessionId);
    const firstWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
    });

    firstWs.close(1000, 'browser_tab_closed');
    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
    });

    const reconnect = await service.issueReconnectTicket(created.sessionId);
    expect(reconnect).toMatchObject({
      wsPath: expect.stringContaining(`session_id=${created.sessionId}`),
      wsTicket: expect.stringMatching(/^term_/),
    });
    const reconnectTicket = await resolveInternalTicket(cache, reconnect!.wsTicket, 'terminal_ws_access');
    expect(reconnectTicket?.payload.terminal_session_id).toBe(created.sessionId);

    const disconnectedSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, disconnectedSession!);

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
    });
    expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
    expect(secondWs.sent).toContain(JSON.stringify({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    }));
  });

  it('keeps a disconnected terminal reconnectable across an 85-second realistic reload and re-entry window by default', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const runtimeClose = vi.fn();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: runtimeClose,
          stream: runtimeEvents.stream,
        })),
      } as never);

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });

      const session = await service.getSession(created.sessionId);
      const ws = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(ws, session!);
      const reconnectGraceMs = (service as unknown as { reconnectGraceMs: number }).reconnectGraceMs;
      expect(reconnectGraceMs).toBeGreaterThanOrEqual(90_000);
      expect(reconnectGraceMs).toBeLessThanOrEqual(120_000);

      await runtimeEvents.push({
        type: 'started',
        session_id: created.sessionId,
        cols: 80,
        rows: 24,
      });

      ws.close(1000, 'browser_tab_closed');
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });

      await vi.advanceTimersByTimeAsync(85_000);

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
      await expect(service.issueReconnectTicket(created.sessionId)).resolves.toMatchObject({
        wsPath: expect.stringContaining(`session_id=${created.sessionId}`),
        wsTicket: expect.stringMatching(/^term_/),
      });
      expect(runtimeClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets operators extend the reconnect grace through env without removing the bounded auto-close', async () => {
    vi.useFakeTimers();
    const previousReconnectGrace = process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS;
    process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS = '110000';
    try {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const runtimeClose = vi.fn();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: runtimeClose,
          stream: runtimeEvents.stream,
        })),
      } as never);

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });

      const session = await service.getSession(created.sessionId);
      const ws = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(ws, session!);

      await runtimeEvents.push({
        type: 'started',
        session_id: created.sessionId,
        cols: 80,
        rows: 24,
      });
      ws.close(1000, 'browser_tab_closed');

      await vi.advanceTimersByTimeAsync(109_000);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
      await expect(service.issueReconnectTicket(created.sessionId)).resolves.toMatchObject({
        wsPath: expect.stringContaining(`session_id=${created.sessionId}`),
        wsTicket: expect.stringMatching(/^term_/),
      });

      await vi.advanceTimersByTimeAsync(1_100);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'closed',
        closeReason: 'browser_disconnected_timeout',
      });
      expect(runtimeClose).toHaveBeenCalledTimes(1);
    } finally {
      if (previousReconnectGrace === undefined) delete process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS;
      else process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS = previousReconnectGrace;
      vi.useRealTimers();
    }
  });

  it('still auto-closes the default grace window after the longer realistic recovery budget elapses', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const runtimeClose = vi.fn();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: runtimeClose,
          stream: runtimeEvents.stream,
        })),
      } as never);

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });

      const session = await service.getSession(created.sessionId);
      const ws = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(ws, session!);
      const reconnectGraceMs = (service as unknown as { reconnectGraceMs: number }).reconnectGraceMs;
      expect(reconnectGraceMs).toBeGreaterThanOrEqual(90_000);
      expect(reconnectGraceMs).toBeLessThanOrEqual(120_000);

      await runtimeEvents.push({
        type: 'started',
        session_id: created.sessionId,
        cols: 80,
        rows: 24,
      });
      ws.close(1000, 'browser_tab_closed');

      await vi.advanceTimersByTimeAsync(reconnectGraceMs - 1_000);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });

      await vi.advanceTimersByTimeAsync(1_100);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'closed',
        closeReason: 'browser_disconnected_timeout',
      });
      expect(runtimeClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps reconnect grace from env so abandoned runtimes still self-heal', () => {
    const previousReconnectGrace = process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS;
    process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS = '999999';
    try {
      const cache = new InMemoryCache();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(),
      } as never);
      expect((service as unknown as { reconnectGraceMs: number }).reconnectGraceMs).toBe(120_000);
    } finally {
      if (previousReconnectGrace === undefined) delete process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS;
      else process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS = previousReconnectGrace;
    }
  });

  it('closes a disconnected terminal after the configured reconnect grace elapses', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const runtimeClose = vi.fn();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: runtimeClose,
          stream: runtimeEvents.stream,
        })),
      } as never, {
        reconnectGraceMs: 25,
      });

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });

      const session = await service.getSession(created.sessionId);
      const ws = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(ws, session!);

      await runtimeEvents.push({
        type: 'started',
        session_id: created.sessionId,
        cols: 80,
        rows: 24,
      });
      ws.close(1000, 'browser_tab_closed');

      await vi.advanceTimersByTimeAsync(24);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });

      await vi.advanceTimersByTimeAsync(2);

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'closed',
        closeReason: 'browser_disconnected_timeout',
      });
      expect(runtimeClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not leave an orphaned disconnect timer behind when browser websocket error is followed by close before reconnect', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const runtimeClose = vi.fn();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: runtimeClose,
          stream: runtimeEvents.stream,
        })),
      } as never, {
        reconnectGraceMs: 25,
      });

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });

      const session = await service.getSession(created.sessionId);
      const firstWs = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(firstWs, session!);

      await runtimeEvents.push({
        type: 'started',
        session_id: created.sessionId,
        cols: 80,
        rows: 24,
      });

      firstWs.emit('error', new Error('browser_transport_failed'));
      firstWs.close(1006, 'abnormal_closure');

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
      });

      const disconnectedSession = await service.getSession(created.sessionId);
      const secondWs = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
      }).bindBrowserSocket(secondWs, disconnectedSession!);

      await waitForAssertion(async () => {
        expect(await service.getSession(created.sessionId)).toMatchObject({
          id: created.sessionId,
          status: 'active',
        });
      });

      await vi.advanceTimersByTimeAsync(30);

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
      expect(runtimeClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a queued disconnect timeout callback after a newer browser bind has already reconnected the session', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const runtimeClose = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: runtimeClose,
        stream: runtimeEvents.stream,
      })),
    } as never, {
      reconnectGraceMs: 25,
    });

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    const session = await service.getSession(created.sessionId);
    const firstWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);

    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    let queuedDisconnectTimeout: (() => void) | null = null;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler) => {
      queuedDisconnectTimeout = () => {
        if (typeof handler === 'function') {
          handler();
        }
      };
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);

    try {
      firstWs.close(1000, 'browser_tab_closed');
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
      });
      expect(queuedDisconnectTimeout).not.toBeNull();

      const disconnectedSession = await service.getSession(created.sessionId);
      const secondWs = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
      }).bindBrowserSocket(secondWs, disconnectedSession!);

      await waitForAssertion(async () => {
        expect(await service.getSession(created.sessionId)).toMatchObject({
          id: created.sessionId,
          status: 'active',
        });
      });

      queuedDisconnectTimeout?.();

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
      expect(runtimeClose).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it('coalesces overlapping browser binds onto a single runtime dispatch and keeps the newer socket authoritative', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const firstDispatchStarted = createDeferred<void>();
    const dispatchDeferred = createDeferred<{
      writeInput: ReturnType<typeof vi.fn>;
      resize: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
      stream: AsyncIterable<TerminalRuntimeEvent>;
    }>();
    const dispatchTerminalSession = vi.fn(() => {
      if (dispatchTerminalSession.mock.calls.length === 1) {
        firstDispatchStarted.resolve();
      }
      return dispatchDeferred.promise;
    });
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    const session = await service.getSession(created.sessionId);
    const firstWs = new FakeWebSocket();
    const secondWs = new FakeWebSocket();

    const firstBind = (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);

    await firstDispatchStarted.promise;

    const secondBind = (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(secondWs, session!);

    expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);

    dispatchDeferred.resolve({
      writeInput: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      stream: runtimeEvents.stream,
    });

    await Promise.allSettled([firstBind, secondBind]);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
    });
    expect(firstWs.closeCalls).toContainEqual({ code: 1012, reason: 'terminal_replaced' });
    expect(firstWs.sent).not.toContain(JSON.stringify({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    }));
    expect(secondWs.sent).toContain(JSON.stringify({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    }));
  });

  it('fails a pending session when the runner never emits terminal start events', async () => {
    const cache = new InMemoryCache();
    const runtimeClose = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: runtimeClose,
        stream: (async function* stream() {
          await new Promise(() => undefined);
        })(),
      })),
    } as never, {
      startupTimeoutMs: 25,
    });

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    const session = await service.getSession(created.sessionId);
    const ws = new FakeWebSocket();

    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    await waitForAssertion(async () => {
      const updated = await service.getSession(created.sessionId);
      expect(updated).toMatchObject({
        id: created.sessionId,
        status: 'failed',
        closeReason: 'terminal_start_timeout',
      });
    });
    expect(runtimeClose).toHaveBeenCalledTimes(1);
    expect(ws.closeCalls.some((call) => call.reason === 'terminal_start_timeout')).toBe(true);
  });

  it('keeps a cold-start terminal pending until a delayed started event arrives within the default startup budget', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: vi.fn(),
          stream: (async function* stream() {
            await new Promise((resolve) => setTimeout(resolve, 20_000));
            yield {
              type: 'started' as const,
              session_id: 'term_delayed',
              cols: 80,
              rows: 24,
            };
            await new Promise(() => undefined);
          })(),
        })),
      } as never);

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });

      const session = await service.getSession(created.sessionId);
      const ws = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(ws, session!);

      await vi.advanceTimersByTimeAsync(19_000);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'pending',
      });

      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
      expect(ws.closeCalls.some((call) => call.reason === 'terminal_start_timeout')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an invalid-shell terminal pending until the browser binds, then fails on startup', async () => {
    const cache = new InMemoryCache();
    const dispatchTerminalSession = vi.fn(async () => {
      throw new Error('invalid_shell');
    });
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
      shell: '/definitely/not/a/real/shell',
    });

    expect(dispatchTerminalSession).not.toHaveBeenCalled();
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'pending',
    });

    const session = await service.getSession(created.sessionId);
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
    await waitForAssertion(async () => {
      const updated = await service.getSession(created.sessionId);
      expect(updated).toMatchObject({
        id: created.sessionId,
        status: 'failed',
        closeReason: 'invalid_shell',
      });
    });
    expect(ws.closeCalls.some((call) => call.reason === 'terminal_dispatch_failed')).toBe(true);
  });

  it('lists sessions for the same task in creation order and deleting one does not remove the other', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const first = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });
    const second = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 100,
      rows: 30,
    });

    await expect(
      service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject([
      { id: first.sessionId, status: 'pending' },
      { id: second.sessionId, status: 'pending' },
    ]);

    await service.deleteSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
      sessionId: first.sessionId,
    });

    await expect(
      service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject([
      { id: second.sessionId, status: 'pending' },
    ]);
    await expect(service.getSession(first.sessionId)).resolves.toBeNull();
    await expect(service.getSession(second.sessionId)).resolves.toMatchObject({
      id: second.sessionId,
      status: 'pending',
    });
  });

  it('rejects creating more than three sessions for the same task owner', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    for (let index = 0; index < 3; index += 1) {
      await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });
    }

    await expect(
      service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      }),
    ).rejects.toThrow('task_terminal_session_limit_reached');
  });

  it('reconciles persisted pending terminal sessions to failed truth after service reload', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const first = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });
    const second = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 100,
      rows: 30,
    });

    const reloadedService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    await expect(
      reloadedService.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject([
      { id: first.sessionId, status: 'failed', closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON },
      { id: second.sessionId, status: 'failed', closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON },
    ]);
  });

  it('keeps the persisted task session cap enforced across service reload without phantom sessions', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const createdIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const created = await firstService.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80 + index,
        rows: 24 + index,
      });
      createdIds.push(created.sessionId);
    }

    const reloadedService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    await expect(
      reloadedService.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 120,
        rows: 40,
      }),
    ).rejects.toThrow('task_terminal_session_limit_reached');

    await expect(
      reloadedService.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject(createdIds.map((id) => ({
      id,
      status: 'failed',
      closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
    })));
  });

  it('lets a reloaded service clean up a persisted failed session to clear backend truth without runner close replay', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    (firstService as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => void;
    }).finishSession(created.sessionId, 'failed', 'terminal_stream_failed');

    const closeTerminalSession = vi.fn(async () => 'signaled');
    const reloadedService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
      closeTerminalSession,
    } as never);

    await expect(
      reloadedService.deleteSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
        sessionId: created.sessionId,
      }),
    ).resolves.toBe(true);
    expect(closeTerminalSession).not.toHaveBeenCalled();
    await expect(reloadedService.getSession(created.sessionId)).resolves.toBeNull();
    await expect(
      reloadedService.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toEqual([]);
  });

  for (const persistedStatus of ['pending', 'active', 'disconnected'] as const) {
    it(`does not advertise a persisted ${persistedStatus} terminal session as reconnectable after service reload`, async () => {
      const seeded = await seedSessionForServiceReload(persistedStatus);
      const reloadedDispatchTerminalSession = vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: createControlledRuntimeStream<TerminalRuntimeEvent>().stream,
      }));
      const reloadedService = new NotebookTerminalService(seeded.cache, {
        dispatchTerminalSession: reloadedDispatchTerminalSession,
      } as never);

      await expect(reloadedService.issueReconnectTicket(seeded.created.sessionId)).resolves.toBeNull();
      await expect(reloadedService.getSession(seeded.created.sessionId)).resolves.toMatchObject({
        id: seeded.created.sessionId,
        status: 'failed',
        closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
      });
      expect(reloadedDispatchTerminalSession).not.toHaveBeenCalled();
    });
  }

  it('rejects stale reconnect websocket upgrades after service reload and converges the session to failed truth', async () => {
    const seeded = await seedSessionForServiceReload('disconnected');
    expect(seeded.staleReconnectPath).toBeTruthy();

    const reloadedDispatchTerminalSession = vi.fn();
    const reloadedService = new NotebookTerminalService(seeded.cache, {
      dispatchTerminalSession: reloadedDispatchTerminalSession,
    } as never);

    const upgradeSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
    };

    reloadedService.handleUpgrade(
      { url: seeded.staleReconnectPath! } as never,
      upgradeSocket as never,
      Buffer.alloc(0),
    );

    await waitForAssertion(() => {
      expect(upgradeSocket.write).toHaveBeenCalledWith('HTTP/1.1 404 Not Found\r\n\r\n');
    });
    expect(reloadedDispatchTerminalSession).not.toHaveBeenCalled();
    await expect(reloadedService.getSession(seeded.created.sessionId)).resolves.toMatchObject({
      id: seeded.created.sessionId,
      status: 'failed',
      closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
    });
  });

  it('sends a precise runner close for a persisted reload-interrupted terminal session before deleting backend truth', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    const closeTerminalSession = vi.fn(async () => 'signaled');
    const reloadedService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
      closeTerminalSession,
    } as never);

    await expect(
      reloadedService.deleteSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
        sessionId: created.sessionId,
      }),
    ).resolves.toBe(true);
    expect(closeTerminalSession).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_1',
      agentId: 'agent_1',
      terminalSessionId: created.sessionId,
    });
    await expect(reloadedService.getSession(created.sessionId)).resolves.toBeNull();
    await expect(
      reloadedService.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toEqual([]);
  });

  it('does not advertise a persisted failed session as reconnectable after service reload', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    (firstService as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => void;
    }).finishSession(created.sessionId, 'failed', 'terminal_stream_failed');

    const reloadedService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    await expect(reloadedService.issueReconnectTicket(created.sessionId)).resolves.toBeNull();
    await expect(reloadedService.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'failed',
      closeReason: 'terminal_stream_failed',
    });
  });
});
