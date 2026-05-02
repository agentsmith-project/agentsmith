import { describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import {
  NOTEBOOK_TASK_TERMINAL_RECONNECT_VIEW,
  NotebookTerminalService,
} from './notebook-terminal-service.js';
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
function sentPayloads(ws: FakeWebSocket): Array<Record<string, unknown>> {
  return ws.sent.map((payload) => JSON.parse(payload) as Record<string, unknown>);
}

function emitBrowserMessage(ws: FakeWebSocket, payload: Record<string, unknown>): void {
  ws.emit('message', Buffer.from(JSON.stringify(payload)));
}

function emitReconnect(
  ws: FakeWebSocket,
  sessionId: string,
  overrides: Record<string, unknown> = {},
): void {
  emitBrowserMessage(ws, {
    type: 'terminal.reconnect',
    terminal_session_id: sessionId,
    view: NOTEBOOK_TASK_TERMINAL_RECONNECT_VIEW,
    cols: 80,
    rows: 24,
    ...overrides,
  });
}

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
    emitReconnect(ws, created.sessionId);

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

  it('rejects cached websocket ticket upgrades after current terminal-use permission is revoked', async () => {
    const cache = new InMemoryCache();
    let terminalUseAllowed = true;
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never, {
      authorizeTerminalUse: vi.fn(async () => terminalUseAllowed),
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

    terminalUseAllowed = false;
    const upgradeSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
    };

    service.handleUpgrade(
      { url: created.wsPath } as never,
      upgradeSocket as never,
      Buffer.alloc(0),
    );

    await waitForAssertion(() => {
      expect(upgradeSocket.write).toHaveBeenCalledWith('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    expect(upgradeSocket.destroy).toHaveBeenCalledTimes(1);
  });

  it('records terminal session completion metadata through lifecycle hooks', async () => {
    const cache = new InMemoryCache();
    const onSessionCreated = vi.fn();
    const onSessionClosed = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);
    service.configureLifecycleHooks({ onSessionCreated, onSessionClosed });

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

    expect(onSessionCreated).toHaveBeenCalledTimes(1);
    expect(onSessionCreated.mock.calls[0]?.[0]).toMatchObject({
      id: created.sessionId,
      status: 'pending',
      taskId: 'task_1',
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

  it('rejects terminal side-effect messages before the browser reconnect handshake', async () => {
    const cache = new InMemoryCache();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const close = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput,
        resize,
        close,
        stream: (async function* stream() {
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    emitBrowserMessage(ws, { type: 'terminal.stdin', data: 'echo unsafe\n' });

    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(sentPayloads(ws)).toContainEqual({
      type: 'terminal.error',
      terminal_session_id: created.sessionId,
      error_code: 'handshake_required',
      error_message: 'terminal_reconnect_required',
    });
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'handshake_required' });
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'failed',
      closeReason: 'handshake_required',
    });
    await expect(
      service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toBe(false);
  });

  it('validates terminal reconnect payloads before dispatching the runtime', async () => {
    const cache = new InMemoryCache();
    const dispatchTerminalSession = vi.fn();
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
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    emitReconnect(ws, created.sessionId, { after_seq: -1 });

    expect(dispatchTerminalSession).not.toHaveBeenCalled();
    expect(sentPayloads(ws)).toContainEqual({
      type: 'terminal.error',
      terminal_session_id: created.sessionId,
      error_code: 'invalid_reconnect_payload',
      error_message: 'invalid_reconnect_payload',
    });
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'invalid_reconnect_payload' });
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'failed',
      closeReason: 'invalid_reconnect_payload',
    });
    await expect(service.issueReconnectTicket(created.sessionId)).resolves.toBeNull();
    await expect(
      service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toBe(false);
  });

  it('rejects reconnect payloads using the legacy helper view instead of the task terminal contract view', async () => {
    const cache = new InMemoryCache();
    const dispatchTerminalSession = vi.fn();
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
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    emitReconnect(ws, created.sessionId, { view: 'terminal' });

    expect(dispatchTerminalSession).not.toHaveBeenCalled();
    expect(sentPayloads(ws)).toContainEqual({
      type: 'terminal.error',
      terminal_session_id: created.sessionId,
      error_code: 'invalid_reconnect_payload',
      error_message: 'invalid_reconnect_payload',
    });
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'invalid_reconnect_payload' });
  });

  it('closes a cold pending terminal when the browser disconnects before handshake', async () => {
    const cache = new InMemoryCache();
    const dispatchTerminalSession = vi.fn();
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
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);

    ws.close(1000, 'browser_tab_closed_before_handshake');

    expect(dispatchTerminalSession).not.toHaveBeenCalled();
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closed',
      closeReason: 'browser_disconnected_before_handshake',
    });
    await expect(service.issueReconnectTicket(created.sessionId)).resolves.toBeNull();
    await expect(
      service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toBe(false);
  });

  it('keeps terminal input disabled after cold reconnect replay until the runtime reports ready', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const runtime = {
      writeInput,
      resize: vi.fn(),
      close: vi.fn(),
      stream: runtimeEvents.stream,
    };
    const dispatchDeferred = createDeferred<typeof runtime>();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(() => dispatchDeferred.promise),
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual({
        type: 'terminal.replay_end',
        terminal_session_id: created.sessionId,
        status: 'complete',
        gap: false,
        latest_seq: 0,
        input_enabled: false,
      });
    });
    expect(sentPayloads(ws)).not.toContainEqual(expect.objectContaining({
      type: 'terminal.state',
      state: 'ready',
      input_enabled: true,
    }));

    dispatchDeferred.resolve(runtime);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual({
        type: 'terminal.state',
        terminal_session_id: created.sessionId,
        state: 'ready',
        status: 'active',
        input_enabled: true,
        cols: 80,
        rows: 24,
      });
    });
    emitBrowserMessage(ws, { type: 'terminal.stdin', data: 'echo ready\n' });
    expect(writeInput).toHaveBeenCalledWith('echo ready\n');
  });

  it('rejects stdin after reconnect while runtime exists but has not enabled terminal input', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const runtime = {
      writeInput,
      resize,
      close: vi.fn(),
      stream: runtimeEvents.stream,
    };
    const dispatchDeferred = createDeferred<typeof runtime>();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(() => dispatchDeferred.promise),
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual(expect.objectContaining({
        type: 'terminal.replay_end',
        terminal_session_id: created.sessionId,
        input_enabled: false,
      }));
    });
    dispatchDeferred.resolve(runtime);
    await waitForAssertion(async () => {
      expect((await service.getSession(created.sessionId))?.runtime).toBe(runtime);
    });
    writeInput.mockClear();
    resize.mockClear();

    emitBrowserMessage(ws, { type: 'terminal.stdin', data: 'echo unsafe\n' });

    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(sentPayloads(ws)).toContainEqual({
      type: 'terminal.error',
      terminal_session_id: created.sessionId,
      error_code: 'terminal_not_ready',
      error_message: 'terminal_not_ready',
    });
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'terminal_not_ready' });
  });

  it('rejects resize after reconnect while runtime exists but has not enabled terminal input', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const runtime = {
      writeInput,
      resize,
      close: vi.fn(),
      stream: runtimeEvents.stream,
    };
    const dispatchDeferred = createDeferred<typeof runtime>();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(() => dispatchDeferred.promise),
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual(expect.objectContaining({
        type: 'terminal.replay_end',
        terminal_session_id: created.sessionId,
        input_enabled: false,
      }));
    });
    dispatchDeferred.resolve(runtime);
    await waitForAssertion(async () => {
      expect((await service.getSession(created.sessionId))?.runtime).toBe(runtime);
    });
    writeInput.mockClear();
    resize.mockClear();

    emitBrowserMessage(ws, { type: 'terminal.resize', cols: 100, rows: 30 });

    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(sentPayloads(ws)).toContainEqual({
      type: 'terminal.error',
      terminal_session_id: created.sessionId,
      error_code: 'terminal_not_ready',
      error_message: 'terminal_not_ready',
    });
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'terminal_not_ready' });
  });

  it('replays session-scoped terminal output seqs after reconnect without synthetic started', async () => {
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);

    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    await runtimeEvents.push({
      type: 'output',
      session_id: created.sessionId,
      chunk: 'first\n',
    });
    firstWs.close(1000, 'browser_tab_closed');
    await runtimeEvents.push({
      type: 'output',
      session_id: created.sessionId,
      chunk: 'second\n',
    });

    const disconnectedSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, disconnectedSession!);
    emitReconnect(secondWs, created.sessionId, { after_seq: 1 });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toEqual([
        {
          type: 'terminal.replay_start',
          terminal_session_id: created.sessionId,
          status: 'complete',
          gap: false,
          after_seq: 1,
          earliest_seq: 1,
          latest_seq: 2,
        },
        {
          type: 'terminal.output',
          terminal_session_id: created.sessionId,
          chunk: 'second\n',
          seq: 2,
        },
        {
          type: 'terminal.replay_end',
          terminal_session_id: created.sessionId,
          status: 'complete',
          gap: false,
          latest_seq: 2,
          input_enabled: true,
        },
      ]);
    });

  });

  it('allows terminal input immediately when reconnecting to an already active runtime', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput,
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    await waitForAssertion(() => {
      expect(sentPayloads(firstWs)).toContainEqual(expect.objectContaining({
        type: 'terminal.state',
        terminal_session_id: created.sessionId,
        input_enabled: true,
      }));
    });
    firstWs.close(1000, 'browser_tab_closed');

    const disconnectedSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, disconnectedSession!);
    emitReconnect(secondWs, created.sessionId, { after_seq: 0 });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toContainEqual({
        type: 'terminal.replay_end',
        terminal_session_id: created.sessionId,
        status: 'complete',
        gap: false,
        latest_seq: 0,
        input_enabled: true,
      });
    });
    emitBrowserMessage(secondWs, { type: 'terminal.stdin', data: 'echo still-live\n' });
    expect(writeInput).toHaveBeenCalledWith('echo still-live\n');
  });

  it('rejects reconnect when project terminal-use permission has been revoked after the ticket was issued', async () => {
    const cache = new InMemoryCache();
    let terminalUseAllowed = true;
    const authorizeTerminalUse = vi.fn(async () => terminalUseAllowed);
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput,
        resize,
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
    } as never, {
      authorizeTerminalUse,
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    firstWs.close(1000, 'browser_tab_closed');

    const disconnectedSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, disconnectedSession!);
    terminalUseAllowed = false;
    writeInput.mockClear();
    resize.mockClear();

    emitReconnect(secondWs, created.sessionId, { after_seq: 0 });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toContainEqual({
        type: 'terminal.error',
        terminal_session_id: created.sessionId,
        error_code: 'terminal_permission_revoked',
        error_message: 'terminal_permission_revoked',
      });
    });
    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(secondWs.closeCalls).toContainEqual({ code: 1008, reason: 'terminal_permission_revoked' });
    expect(authorizeTerminalUse).toHaveBeenLastCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
      terminalSessionId: created.sessionId,
      requiredPermission: 'project:terminal:use',
    });
  });

  it('rejects stdin when project terminal-use permission is revoked on an already open socket', async () => {
    const cache = new InMemoryCache();
    let terminalUseAllowed = true;
    const authorizeTerminalUse = vi.fn(async () => terminalUseAllowed);
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput,
        resize,
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
    } as never, {
      authorizeTerminalUse,
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual(expect.objectContaining({
        type: 'terminal.state',
        terminal_session_id: created.sessionId,
        input_enabled: true,
      }));
    });

    terminalUseAllowed = false;
    writeInput.mockClear();
    resize.mockClear();
    emitBrowserMessage(ws, { type: 'terminal.stdin', data: 'echo revoked\n' });

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual({
        type: 'terminal.error',
        terminal_session_id: created.sessionId,
        error_code: 'terminal_permission_revoked',
        error_message: 'terminal_permission_revoked',
      });
    });
    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'terminal_permission_revoked' });
  });

  it('rejects resize when project terminal-use permission is revoked on an already open socket', async () => {
    const cache = new InMemoryCache();
    let terminalUseAllowed = true;
    const authorizeTerminalUse = vi.fn(async () => terminalUseAllowed);
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput,
        resize,
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
    } as never, {
      authorizeTerminalUse,
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual(expect.objectContaining({
        type: 'terminal.state',
        terminal_session_id: created.sessionId,
        input_enabled: true,
      }));
    });

    terminalUseAllowed = false;
    writeInput.mockClear();
    resize.mockClear();
    emitBrowserMessage(ws, { type: 'terminal.resize', cols: 100, rows: 30 });

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual({
        type: 'terminal.error',
        terminal_session_id: created.sessionId,
        error_code: 'terminal_permission_revoked',
        error_message: 'terminal_permission_revoked',
      });
    });
    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'terminal_permission_revoked' });
  });

  it('ignores a stale reconnect whose async permission check resolves after a newer browser bind', async () => {
    const cache = new InMemoryCache();
    const pendingAuthorizations: Array<ReturnType<typeof createDeferred<boolean>>> = [];
    const authorizeTerminalUse = vi.fn(() => pendingAuthorizations.shift()?.promise ?? true);
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const runtime = {
      writeInput,
      resize,
      close: vi.fn(),
      stream: runtimeEvents.stream,
    };
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => runtime),
    } as never, {
      authorizeTerminalUse,
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);
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
        cols: 80,
        rows: 24,
      });
    });

    resize.mockClear();
    writeInput.mockClear();
    const staleReconnectAuthorization = createDeferred<boolean>();
    pendingAuthorizations.push(staleReconnectAuthorization);

    const disconnectedSession = await service.getSession(created.sessionId);
    const staleWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(staleWs, disconnectedSession!);
    emitReconnect(staleWs, created.sessionId, { cols: 100, rows: 30, after_seq: 0 });
    await waitForAssertion(() => {
      expect(authorizeTerminalUse).toHaveBeenCalledTimes(2);
    });

    const currentSession = await service.getSession(created.sessionId);
    const currentWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof currentSession>) => Promise<void>;
    }).bindBrowserSocket(currentWs, currentSession!);

    staleReconnectAuthorization.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(staleWs.closeCalls).toContainEqual({ code: 1012, reason: 'terminal_replaced' });
    expect(currentWs.sent).toEqual([]);
    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'disconnected',
      cols: 80,
      rows: 24,
      browserHandshakeComplete: false,
    });
  });

  it('ignores stale stdin and resize frames whose async permission checks resolve after a newer browser bind', async () => {
    const cache = new InMemoryCache();
    const pendingAuthorizations: Array<ReturnType<typeof createDeferred<boolean>>> = [];
    const authorizeTerminalUse = vi.fn(() => pendingAuthorizations.shift()?.promise ?? true);
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const runtime = {
      writeInput,
      resize,
      close: vi.fn(),
      stream: runtimeEvents.stream,
    };
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => runtime),
    } as never, {
      authorizeTerminalUse,
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
    const staleWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(staleWs, session!);
    emitReconnect(staleWs, created.sessionId);
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

    writeInput.mockClear();
    resize.mockClear();
    const staleStdinAuthorization = createDeferred<boolean>();
    const staleResizeAuthorization = createDeferred<boolean>();
    pendingAuthorizations.push(staleStdinAuthorization, staleResizeAuthorization);

    emitBrowserMessage(staleWs, { type: 'terminal.stdin', data: 'echo stale\n' });
    emitBrowserMessage(staleWs, { type: 'terminal.resize', cols: 100, rows: 30 });
    await waitForAssertion(() => {
      expect(authorizeTerminalUse).toHaveBeenCalledTimes(3);
    });

    const currentSession = await service.getSession(created.sessionId);
    const currentWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof currentSession>) => Promise<void>;
    }).bindBrowserSocket(currentWs, currentSession!);

    staleStdinAuthorization.resolve(true);
    staleResizeAuthorization.resolve(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(staleWs.closeCalls).toContainEqual({ code: 1012, reason: 'terminal_replaced' });
    expect(currentWs.sent).toEqual([]);
    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'active',
      cols: 80,
      rows: 24,
      browserHandshakeComplete: false,
    });
  });

  it.each(['close', 'error'] as const)(
    'ignores a stale browser socket %s after a newer ready browser bind',
    async (eventName) => {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const writeInput = vi.fn();
      const resize = vi.fn();
      const runtime = {
        writeInput,
        resize,
        close: vi.fn(),
        stream: runtimeEvents.stream,
      };
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => runtime),
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
      const staleWs = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(staleWs, session!);
      emitReconnect(staleWs, created.sessionId);
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
          browserHandshakeComplete: true,
        });
      });

      const currentSession = await service.getSession(created.sessionId);
      const currentWs = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof currentSession>) => Promise<void>;
      }).bindBrowserSocket(currentWs, currentSession!);
      emitReconnect(currentWs, created.sessionId, { after_seq: 0 });
      await waitForAssertion(async () => {
        expect(await service.getSession(created.sessionId)).toMatchObject({
          id: created.sessionId,
          status: 'active',
          browserHandshakeComplete: true,
          browserReplayInProgress: false,
        });
      });

      writeInput.mockClear();
      resize.mockClear();
      currentWs.sent.length = 0;

      if (eventName === 'close') {
        staleWs.emit('close', 1006, Buffer.from('late_network_close'));
      } else {
        staleWs.emit('error', new Error('late_network_error'));
      }

      await Promise.resolve();
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'active',
        browserHandshakeComplete: true,
        browserReplayInProgress: false,
      });

      emitBrowserMessage(currentWs, { type: 'terminal.stdin', data: 'echo current\n' });
      emitBrowserMessage(currentWs, { type: 'terminal.resize', cols: 100, rows: 30 });

      await waitForAssertion(() => {
        expect(writeInput).toHaveBeenCalledWith('echo current\n');
        expect(resize).toHaveBeenCalledWith(100, 30);
      });
      expect(sentPayloads(currentWs)).not.toContainEqual(expect.objectContaining({
        error_code: 'handshake_required',
      }));
    },
  );

  it('keeps a disconnected runtime reconnectable after an invalid reconnect attempt', async () => {
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
    const firstWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    firstWs.close(1000, 'browser_tab_closed');

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
      });
    });

    const disconnectedSession = await service.getSession(created.sessionId);
    const invalidWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(invalidWs, disconnectedSession!);
    emitReconnect(invalidWs, created.sessionId, { after_seq: -1 });

    expect(invalidWs.closeCalls).toContainEqual({ code: 1008, reason: 'invalid_reconnect_payload' });
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'disconnected',
    });
    await expect(service.issueReconnectTicket(created.sessionId)).resolves.toMatchObject({
      wsPath: expect.stringContaining(`session_id=${created.sessionId}`),
    });
    expect(runtimeClose).not.toHaveBeenCalled();
  });

  it('bounds terminal replay by chunk count and marks older cursors as partial', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
    } as never, {
      replayMaxChunks: 2,
      replayMaxBytes: 1_000,
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);

    await runtimeEvents.push({ type: 'output', session_id: created.sessionId, chunk: 'one\n' });
    await runtimeEvents.push({ type: 'output', session_id: created.sessionId, chunk: 'two\n' });
    await runtimeEvents.push({ type: 'output', session_id: created.sessionId, chunk: 'three\n' });
    firstWs.close(1000, 'browser_tab_closed');

    const disconnectedSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, disconnectedSession!);
    emitReconnect(secondWs, created.sessionId, { after_seq: 0 });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toEqual([
        {
          type: 'terminal.replay_start',
          terminal_session_id: created.sessionId,
          status: 'partial',
          gap: true,
          after_seq: 0,
          earliest_seq: 2,
          latest_seq: 3,
        },
        { type: 'terminal.output', terminal_session_id: created.sessionId, chunk: 'two\n', seq: 2 },
        { type: 'terminal.output', terminal_session_id: created.sessionId, chunk: 'three\n', seq: 3 },
        {
          type: 'terminal.replay_end',
          terminal_session_id: created.sessionId,
          status: 'partial',
          gap: true,
          latest_seq: 3,
          input_enabled: true,
        },
      ]);
    });

  });

  it('marks future terminal replay cursors as unavailable instead of silently accepting them', async () => {
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);
    await runtimeEvents.push({ type: 'output', session_id: created.sessionId, chunk: 'only\n' });
    firstWs.close(1000, 'browser_tab_closed');

    const disconnectedSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof disconnectedSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, disconnectedSession!);
    emitReconnect(secondWs, created.sessionId, { after_seq: 99 });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toEqual([
        {
          type: 'terminal.replay_start',
          terminal_session_id: created.sessionId,
          status: 'unavailable',
          gap: true,
          after_seq: 99,
          earliest_seq: 1,
          latest_seq: 1,
          next_seq: 2,
          error_code: 'future_after_seq',
        },
        {
          type: 'terminal.replay_end',
          terminal_session_id: created.sessionId,
          status: 'unavailable',
          gap: true,
          latest_seq: 1,
          next_seq: 2,
          input_enabled: true,
        },
      ]);
    });

    await runtimeEvents.push({ type: 'output', session_id: created.sessionId, chunk: 'live-after-gap\n' });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toContainEqual({
        type: 'terminal.output',
        terminal_session_id: created.sessionId,
        chunk: 'live-after-gap\n',
        seq: 2,
      });
    });
  });

  it('keeps disconnect grace outside close hooks until the session actually times out', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const onSessionClosed = vi.fn();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: vi.fn(),
          stream: runtimeEvents.stream,
        })),
      } as never, {
        reconnectGraceMs: 25,
      });
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

      const session = await service.getSession(created.sessionId);
      const ws = new FakeWebSocket();
      await (service as unknown as {
        bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(ws, session!);
      emitReconnect(ws, created.sessionId);

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
      expect(onSessionClosed).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30);

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'closed',
        closeReason: 'browser_disconnected_timeout',
      });
      expect(onSessionClosed).toHaveBeenCalledTimes(1);
      expect(onSessionClosed.mock.calls[0]?.[0]).toMatchObject({
        id: created.sessionId,
        status: 'closed',
        closeReason: 'browser_disconnected_timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('invokes both configured and registered lifecycle hooks when reload reconciliation releases a persisted live session', async () => {
    const seeded = await seedSessionForServiceReload('pending');
    const configuredOnSessionClosed = vi.fn();
    const registeredOnSessionClosed = vi.fn();
    const reloadedService = new NotebookTerminalService(seeded.cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);
    reloadedService.configureLifecycleHooks({
      onSessionClosed: configuredOnSessionClosed,
    });
    (
      reloadedService as unknown as {
        registerLifecycleHooks: (
          key: string,
          hooks: { onSessionClosed?: (session: unknown) => void | Promise<void> },
        ) => void;
      }
    ).registerLifecycleHooks('task_route_handler_internal_workload', {
      onSessionClosed: registeredOnSessionClosed,
    });

    await expect(reloadedService.getSession(seeded.created.sessionId)).resolves.toMatchObject({
      id: seeded.created.sessionId,
      status: 'failed',
      closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
    });

    expect(configuredOnSessionClosed).toHaveBeenCalledTimes(1);
    expect(registeredOnSessionClosed).toHaveBeenCalledTimes(1);
    expect(configuredOnSessionClosed.mock.calls[0]?.[0]).toMatchObject({
      id: seeded.created.sessionId,
      status: 'failed',
      closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
    });
    expect(registeredOnSessionClosed.mock.calls[0]?.[0]).toMatchObject({
      id: seeded.created.sessionId,
      status: 'failed',
      closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
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
    emitReconnect(ws, created.sessionId);

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
    emitReconnect(firstWs, created.sessionId);

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
    emitReconnect(secondWs, created.sessionId);

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
    emitReconnect(firstWs, created.sessionId);

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
    emitReconnect(secondWs, created.sessionId, { after_seq: 0 });

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'active',
      });
    });
    expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
    expect(sentPayloads(secondWs).some((payload) => payload.type === 'started')).toBe(false);
    expect(sentPayloads(secondWs)).toContainEqual({
      type: 'terminal.replay_start',
      terminal_session_id: created.sessionId,
      status: 'complete',
      gap: false,
      after_seq: 0,
      earliest_seq: null,
      latest_seq: 0,
    });
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
      emitReconnect(ws, created.sessionId);
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
      emitReconnect(ws, created.sessionId);

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
      emitReconnect(ws, created.sessionId);
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
      emitReconnect(ws, created.sessionId);

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
      emitReconnect(firstWs, created.sessionId);

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
      emitReconnect(secondWs, created.sessionId);

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
    emitReconnect(firstWs, created.sessionId);

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
      emitReconnect(secondWs, created.sessionId);

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
    emitReconnect(firstWs, created.sessionId);

    await firstDispatchStarted.promise;

    const secondBind = (service as unknown as {
      bindBrowserSocket: (ws: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(secondWs, session!);
    emitReconnect(secondWs, created.sessionId);

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
      type: 'terminal.state',
      terminal_session_id: created.sessionId,
      state: 'ready',
      status: 'active',
      input_enabled: true,
      cols: 80,
      rows: 24,
    }));
    expect(secondWs.sent).toContain(JSON.stringify({
      type: 'terminal.state',
      terminal_session_id: created.sessionId,
      state: 'ready',
      status: 'active',
      input_enabled: true,
      cols: 80,
      rows: 24,
    }));
  });

  it('returns input_enabled true when the runtime becomes ready between browser binds', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const runtime = {
      writeInput,
      resize: vi.fn(),
      close: vi.fn(),
      stream: runtimeEvents.stream,
    };
    const dispatchDeferred = createDeferred<typeof runtime>();
    const dispatchTerminalSession = vi.fn(() => dispatchDeferred.promise);
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
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(firstWs, session!);
    emitReconnect(firstWs, created.sessionId);
    await waitForAssertion(() => {
      expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
    });

    const pendingSession = await service.getSession(created.sessionId);
    const secondWs = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof pendingSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, pendingSession!);

    dispatchDeferred.resolve(runtime);
    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    await waitForAssertion(async () => {
      const updated = await service.getSession(created.sessionId);
      expect(updated?.runtime).toBe(runtime);
      expect(updated?.runtimeReady).toBe(true);
    });

    emitReconnect(secondWs, created.sessionId, { after_seq: 0 });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toContainEqual({
        type: 'terminal.replay_end',
        terminal_session_id: created.sessionId,
        status: 'complete',
        gap: false,
        latest_seq: 0,
        input_enabled: true,
      });
    });
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'active',
    });

    emitBrowserMessage(secondWs, { type: 'terminal.stdin', data: 'echo ready-after-bind\n' });
    expect(writeInput).toHaveBeenCalledWith('echo ready-after-bind\n');
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
    emitReconnect(ws, created.sessionId);

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
      emitReconnect(ws, created.sessionId);

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

    expect(dispatchTerminalSession).not.toHaveBeenCalled();
    emitReconnect(ws, created.sessionId);
    await waitForAssertion(() => {
      expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
    });
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

  it('does not count failed terminal history toward the per-task live session cap', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    for (let index = 0; index < 3; index += 1) {
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
      }).finishSession(created.sessionId, 'failed', 'runner_crashed');
    }

    await expect(
      service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 100,
        rows: 30,
      }),
    ).resolves.toMatchObject({
      sessionId: expect.stringMatching(/^term_/),
    });

    await expect(
      service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject([
      { status: 'failed', closeReason: 'runner_crashed' },
      { status: 'failed', closeReason: 'runner_crashed' },
      { status: 'failed', closeReason: 'runner_crashed' },
      { status: 'pending' },
    ]);
  });

  it('keeps failed terminal history visible while excluding it from live task-session truth', async () => {
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
    }).finishSession(created.sessionId, 'failed', 'terminal_start_timeout');

    await expect(
      service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject([
      { id: created.sessionId, status: 'failed', closeReason: 'terminal_start_timeout' },
    ]);
    await expect(
      service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toBe(false);
  });

  it('treats pending terminal sessions as live task blockers before any browser bind', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

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

    await expect(
      service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toBe(true);
  });

  it('treats active terminal sessions as live task blockers while the browser remains attached', async () => {
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
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);

    await runtimeEvents.push({
      type: 'started',
      session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    await expect(
      service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toBe(true);
  });

  it('keeps disconnected terminal sessions in live task-session truth until reconnect grace expires', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: vi.fn(),
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
        bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
      }).bindBrowserSocket(ws, session!);
      emitReconnect(ws, created.sessionId);

      await runtimeEvents.push({
        type: 'started',
        session_id: created.sessionId,
        cols: 80,
        rows: 24,
      });
      ws.close(1000, 'browser_tab_closed');

      await expect(
        service.hasLiveSessionsForTask({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          userId: 'user_1',
        }),
      ).resolves.toBe(true);

      await vi.advanceTimersByTimeAsync(30);

      await expect(
        service.hasLiveSessionsForTask({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          userId: 'user_1',
        }),
      ).resolves.toBe(false);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'closed',
        closeReason: 'browser_disconnected_timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  for (const persistedStatus of ['pending', 'active', 'disconnected'] as const) {
    it(`frees live blocking truth when a persisted ${persistedStatus} session is reconciled to failed after service reload`, async () => {
      const seeded = await seedSessionForServiceReload(persistedStatus);
      const reloadedService = new NotebookTerminalService(seeded.cache, {
        dispatchTerminalSession: vi.fn(),
      } as never);

      await expect(
        reloadedService.hasLiveSessionsForTask({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          userId: 'user_1',
        }),
      ).resolves.toBe(false);

      await expect(
        reloadedService.listSessionsForTask({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          userId: 'user_1',
        }),
      ).resolves.toMatchObject([
        {
          id: seeded.created.sessionId,
          status: 'failed',
          closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
        },
      ]);
    });
  }

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

  it('releases the live session cap after service reload reconciles persisted sessions to failed history', async () => {
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
    ).resolves.toMatchObject({
      sessionId: expect.stringMatching(/^term_/),
    });

    const sessions = await reloadedService.listSessionsForTask({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
    });
    expect(sessions).toMatchObject([
      ...createdIds.map((id) => ({
        id,
        status: 'failed',
        closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
      })),
      { status: 'pending' },
    ]);
    for (const id of createdIds) {
      await expect(reloadedService.getSession(id)).resolves.toMatchObject({
        id,
        status: 'failed',
        closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
      });
    }
  });

  it('prunes closed terminal ids from the task live-session index before enforcing quota', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const createdIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
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
      createdIds.push(created.sessionId);
      (service as unknown as {
        finishSession: (
          sessionId: string,
          status: 'closed' | 'failed',
          closeReason?: string,
          exitCode?: number | null,
        ) => void;
      }).finishSession(created.sessionId, 'closed', 'process_exited', 0);
    }

    await expect(
      service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 100,
        rows: 30,
      }),
    ).resolves.toMatchObject({
      sessionId: expect.stringMatching(/^term_/),
    });

    for (const id of createdIds) {
      await expect(service.getSession(id)).resolves.toMatchObject({
        id,
        status: 'closed',
      });
    }
    await expect(
      service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      }),
    ).resolves.toMatchObject([
      { status: 'pending' },
    ]);
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

  for (const persistedStatus of ['pending', 'active', 'disconnected'] as const) {
    it(`does not reconcile a persisted ${persistedStatus} session when scoped lookup misses after service reload`, async () => {
      const seeded = await seedSessionForServiceReload(persistedStatus);
      const reloadedService = new NotebookTerminalService(seeded.cache, {
        dispatchTerminalSession: vi.fn(),
      } as never);

      await expect(
        (reloadedService as unknown as {
          getSessionWithinScope: (input: {
            workspaceId: string;
            projectId: string;
            taskId: string;
            userId: string;
            sessionId: string;
          }) => Promise<unknown>;
        }).getSessionWithinScope({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          userId: 'user_other',
          sessionId: seeded.created.sessionId,
        }),
      ).resolves.toBeNull();

      await expect(seeded.cache.get(`notebook_terminal_session:${seeded.created.sessionId}`)).resolves.toEqual(
        expect.stringContaining(`"status":"${persistedStatus}"`),
      );
    });
  }

  for (const persistedStatus of ['pending', 'active', 'disconnected'] as const) {
    it(`does not reconcile a persisted ${persistedStatus} session when delete scope misses after service reload`, async () => {
      const seeded = await seedSessionForServiceReload(persistedStatus);
      const reloadedService = new NotebookTerminalService(seeded.cache, {
        dispatchTerminalSession: vi.fn(),
      } as never);

      await expect(
        reloadedService.deleteSession({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_other',
          userId: 'user_1',
          sessionId: seeded.created.sessionId,
        }),
      ).resolves.toBe(false);

      await expect(seeded.cache.get(`notebook_terminal_session:${seeded.created.sessionId}`)).resolves.toEqual(
        expect.stringContaining(`"status":"${persistedStatus}"`),
      );
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

  it('preserves persisted execution context when closing a reload-interrupted terminal session', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);
    const executionContext = {
      interaction_kind: 'notebook',
      runner_session_scope: 'agent_presence',
    };

    const created = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_presence',
      agentId: 'agent_1',
      runnerSessionId: 'task_presence',
      userId: 'user_1',
      cols: 80,
      rows: 24,
      executionContext,
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
        taskId: 'task_presence',
        userId: 'user_1',
        sessionId: created.sessionId,
      }),
    ).resolves.toBe(true);
    expect(closeTerminalSession).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_presence',
      agentId: 'agent_1',
      terminalSessionId: created.sessionId,
      executionContext,
    });
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
