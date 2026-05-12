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
  type: 'started' | 'output' | 'exited' | 'error' | 'detached';
  terminal_session_id: string;
  runner_session_id?: string;
  generation?: number;
  connection_epoch?: number;
  cols?: number;
  rows?: number;
  chunk?: string;
  exit_code?: number | null;
  signal?: string | null;
  error_code?: string;
  error_message?: string;
  reason?: string;
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
    cols: 80,
    rows: 24,
    ...overrides,
  });
}

function startedRuntimeEvent(
  sessionId: string,
  overrides: Partial<TerminalRuntimeEvent> = {},
): TerminalRuntimeEvent {
  return {
    type: 'started',
    terminal_session_id: sessionId,
    runner_session_id: 'task_1',
    generation: 4,
    connection_epoch: 9,
    cols: 80,
    rows: 24,
    ...overrides,
  };
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
    resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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

async function createDeliveredClosingSession(
  service: NotebookTerminalService,
  input: {
    taskId: string;
    generation: number;
    connectionEpoch: number;
  },
): Promise<{
  sessionId: string;
  closeDeadlineAt: string | undefined;
}> {
  const created = await service.createSession({
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    taskId: input.taskId,
    agentId: 'agent_1',
    resolvedRunnerId: 'agent_1',
    runnerSessionId: input.taskId,
    userId: 'user_1',
    cols: 80,
    rows: 24,
  });
  const session = await service.getSession(created.sessionId);
  Object.assign(session!, {
    status: 'active',
    lifecycleStatus: 'active',
    runnerConnectionStatus: 'attached',
    runtimeReady: true,
    terminalGeneration: input.generation,
    terminalConnectionEpoch: input.connectionEpoch,
  });

  await expect(service.deleteSession({
    workspaceId: 'ws_default',
    projectId: 'proj_1',
    taskId: input.taskId,
    userId: 'user_1',
    sessionId: created.sessionId,
  })).resolves.toBe(true);

  const closing = await service.getSession(created.sessionId);
  return {
    sessionId: created.sessionId,
    closeDeadlineAt: closing?.closeDeadlineAt,
  };
}

describe('NotebookTerminalService', () => {
  it('uses NOTEBOOK_TERMINAL_CLOSE_TIMEOUT_MS for close tombstone deadlines', async () => {
    const originalCloseTimeout = process.env.NOTEBOOK_TERMINAL_CLOSE_TIMEOUT_MS;
    vi.useFakeTimers();
    try {
      process.env.NOTEBOOK_TERMINAL_CLOSE_TIMEOUT_MS = '12345';
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
      const cache = new InMemoryCache();
      const closeTerminalSession = vi.fn(async () => 'signaled');
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(),
        closeTerminalSession,
      } as never);

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });
      const session = await service.getSession(created.sessionId);
      Object.assign(session!, {
        status: 'active',
        lifecycleStatus: 'active',
        runnerConnectionStatus: 'attached',
        runtimeReady: true,
        runtime: {
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: vi.fn(),
          stream: (async function* stream() {
            await new Promise(() => undefined);
          })(),
        },
        terminalGeneration: 4,
        terminalConnectionEpoch: 9,
      });

      await expect(service.deleteSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
        sessionId: created.sessionId,
      })).resolves.toBe(true);

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'closing',
        closeDeadlineAt: '2026-05-08T12:00:12.345Z',
      });
      expect(closeTerminalSession).toHaveBeenCalledWith(expect.objectContaining({
        closeAttemptId: expect.stringMatching(/^close_/),
        generation: 4,
        connectionEpoch: 9,
      }));
    } finally {
      if (originalCloseTimeout === undefined) {
        delete process.env.NOTEBOOK_TERMINAL_CLOSE_TIMEOUT_MS;
      } else {
        process.env.NOTEBOOK_TERMINAL_CLOSE_TIMEOUT_MS = originalCloseTimeout;
      }
      vi.useRealTimers();
    }
  });

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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 120,
      rows: 32,
    });

    expect(created.sessionId).toMatch(/^term_/);
    expect(created.wsPath).toContain(`/tasks/task_1/terminal/ws?terminal_session_id=${created.sessionId}`);
    const wsUrl = new URL(created.wsPath, 'http://localhost');
    expect(wsUrl.searchParams.get('terminal_session_id')).toBe(created.sessionId);
    expect(wsUrl.searchParams.has('session_id')).toBe(false);
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

  it('persists the resolved runner id and dispatches reconnect with the persisted runner', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const dispatchTerminalSession = vi.fn(async () => ({
      writeInput,
      resize,
      close: vi.fn(),
      stream: runtimeEvents.stream,
    }));
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'legacy_agent_field',
      resolvedRunnerId: 'runner_creation_time',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 120,
      rows: 32,
    });

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      agentId: 'legacy_agent_field',
      resolvedRunnerId: 'runner_creation_time',
    });

    const session = await service.getSession(created.sessionId);
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);

    await waitForAssertion(() => {
      expect(dispatchTerminalSession).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'runner_creation_time',
        sessionId: 'task_1',
        terminalSessionId: created.sessionId,
      }));
    });
    await runtimeEvents.push({
      type: 'started',
      terminal_session_id: created.sessionId,
      cols: 120,
      rows: 32,
    });
    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual(expect.objectContaining({
        type: 'terminal.state',
        state: 'ready',
        input_enabled: true,
      }));
    });

    emitBrowserMessage(ws, { type: 'terminal.stdin', data: 'pwd\n' });
    emitBrowserMessage(ws, { type: 'terminal.resize', cols: 132, rows: 40 });
    expect(writeInput).toHaveBeenCalledWith('pwd\n');
    expect(resize).toHaveBeenCalledWith(132, 40);
    expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
  });

  it('fails closed instead of using agentId when resolvedRunnerId is missing', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    await expect(service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'legacy_agent_field',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    } as never)).rejects.toThrow('agent_runner_not_resolved');
  });

  it('rejects terminal websocket upgrades that use the legacy session_id query alias', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 120,
      rows: 32,
    });
    const legacyPath = created.wsPath.replace('terminal_session_id=', 'session_id=');
    const upgradeSocket = {
      write: vi.fn(),
      destroy: vi.fn(),
    };

    service.handleUpgrade(
      { url: legacyPath } as never,
      upgradeSocket as never,
      Buffer.alloc(0),
    );

    await waitForAssertion(() => {
      expect(upgradeSocket.write).toHaveBeenCalledWith('HTTP/1.1 401 Unauthorized\r\n\r\n');
    });
    expect(upgradeSocket.destroy).toHaveBeenCalledTimes(1);
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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

    await (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => Promise<void>;
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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

  it('rejects reconnect payloads that still send the legacy notebook task terminal view', async () => {
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
      resolvedRunnerId: 'agent_1',
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

    emitReconnect(ws, created.sessionId, { view: 'notebook.task_terminal' });

    expect(dispatchTerminalSession).not.toHaveBeenCalled();
    expect(sentPayloads(ws)).toContainEqual({
      type: 'terminal.error',
      terminal_session_id: created.sessionId,
      error_code: 'invalid_reconnect_payload',
      error_message: 'invalid_reconnect_payload',
    });
    expect(ws.closeCalls).toContainEqual({ code: 1008, reason: 'invalid_reconnect_payload' });
  });

  it('rejects reconnect payloads that include any removed view discriminator', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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

    emitReconnect(ws, created.sessionId, { view: 'agent_task.task_terminal' });

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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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

  it('runs terminal runtime warmup after websocket reconnect before dispatching to the runner', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const runtime = {
      writeInput: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      stream: runtimeEvents.stream,
    };
    const warmupDeferred = createDeferred<void>();
    const beforeSessionRuntimeDispatch = vi.fn(() => warmupDeferred.promise);
    const dispatchTerminalSession = vi.fn(async () => runtime);
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession,
    } as never);
    service.registerLifecycleHooks('terminal_runtime_warmup_test', {
      beforeSessionRuntimeDispatch,
    });

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
      runtimeDispatchContext: {
        managedInternalAgent: {
          workspaceFileLibraryId: 'lib_task_1',
        },
      },
    });

    const session = await service.getSession(created.sessionId);
    const ws = new FakeWebSocket();
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual({
        type: 'terminal.state',
        terminal_session_id: created.sessionId,
        state: 'starting',
        status: 'pending',
        input_enabled: false,
      });
      expect(beforeSessionRuntimeDispatch).toHaveBeenCalledWith(expect.objectContaining({
        id: created.sessionId,
        runtimeDispatchContext: {
          managedInternalAgent: {
            workspaceFileLibraryId: 'lib_task_1',
          },
        },
      }));
    });
    expect(dispatchTerminalSession).not.toHaveBeenCalled();

    warmupDeferred.resolve();
    await waitForAssertion(() => {
      expect(dispatchTerminalSession).toHaveBeenCalledTimes(1);
    });
  });

  it('fails closed when runtime events use the legacy session_id field', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const runtime = {
      writeInput: vi.fn(),
      resize: vi.fn(),
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
      resolvedRunnerId: 'agent_1',
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
    } as unknown as TerminalRuntimeEvent);

    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        id: created.sessionId,
        status: 'failed',
        closeReason: 'terminal_runtime_session_mismatch',
      });
    });
    expect(sentPayloads(ws)).toContainEqual({
      type: 'terminal.error',
      terminal_session_id: created.sessionId,
      error_code: 'TERMINAL_RUNTIME_SESSION_MISMATCH',
      error_message: 'terminal_runtime_session_mismatch',
    });
    expect(ws.closeCalls).toContainEqual({ code: 1011, reason: 'terminal_runtime_session_mismatch' });
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    await runtimeEvents.push({
      type: 'output',
      terminal_session_id: created.sessionId,
      chunk: 'first\n',
    });
    firstWs.close(1000, 'browser_tab_closed');
    await runtimeEvents.push({
      type: 'output',
      terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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

  it('keeps recovering terminal input disabled and does not dispatch a second start on browser attach', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const writeInput = vi.fn();
    const resize = vi.fn();
    const dispatchTerminalSession = vi.fn(async () => ({
      writeInput,
      resize,
      close: vi.fn(),
      stream: runtimeEvents.stream,
    }));
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    await (service as unknown as {
      handleRunnerDetached: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string;
        connectionId: string;
        reason: 'agent_disconnected';
        terminalSessionIds: string[];
      }) => Promise<void>;
    }).handleRunnerDetached({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      connectionId: 'runner_conn_1',
      reason: 'agent_disconnected',
      terminalSessionIds: [created.sessionId],
    });

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'recovering',
      lifecycleStatus: 'recovering',
      runnerConnectionStatus: 'transport_lost',
      inputEnabled: false,
      recoverable: true,
    });

    const reconnect = await service.issueReconnectTicket(created.sessionId);
    expect(reconnect).toMatchObject({
      wsPath: expect.stringContaining(`terminal_session_id=${created.sessionId}`),
    });
    const secondWs = new FakeWebSocket();
    const recoveringSession = await service.getSession(created.sessionId);
    await (service as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof recoveringSession>) => Promise<void>;
    }).bindBrowserSocket(secondWs, recoveringSession!);

    emitReconnect(secondWs, created.sessionId, { after_seq: 0 });
    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'terminal.state',
          terminal_session_id: created.sessionId,
          state: 'recovering',
          status: 'recovering',
          input_enabled: false,
        }),
        expect.objectContaining({
          type: 'terminal.replay_end',
          terminal_session_id: created.sessionId,
          input_enabled: false,
        }),
      ]));
    });

    dispatchTerminalSession.mockClear();
    resize.mockClear();
    writeInput.mockClear();
    emitBrowserMessage(secondWs, { type: 'terminal.stdin', data: 'echo blocked\n' });
    emitBrowserMessage(secondWs, { type: 'terminal.resize', cols: 100, rows: 30 });

    expect(dispatchTerminalSession).not.toHaveBeenCalled();
    expect(writeInput).not.toHaveBeenCalled();
    expect(resize).not.toHaveBeenCalled();
    expect(sentPayloads(secondWs)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'terminal.error',
        terminal_session_id: created.sessionId,
        error_code: 'terminal_input_disabled',
      }),
    ]));
    expect(secondWs.closeCalls.some((call) => call.reason === 'terminal_input_disabled')).toBe(false);
  });

  it('adopts a recovering terminal from runner ready and restores it to active', async () => {
    const cache = new InMemoryCache();
    const initialRuntimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const adoptedRuntimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const adoptTerminalSession = vi.fn(async () => ({
      writeInput: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      stream: adoptedRuntimeEvents.stream,
    }));
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: initialRuntimeEvents.stream,
      })),
      adoptTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
    await initialRuntimeEvents.push({
      type: 'started',
      terminal_session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });
    await (service as unknown as {
      handleRunnerDetached: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string;
        connectionId: string;
        reason: 'agent_disconnected';
        terminalSessionIds: string[];
      }) => Promise<void>;
    }).handleRunnerDetached({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      connectionId: 'runner_conn_1',
      reason: 'agent_disconnected',
      terminalSessionIds: [created.sessionId],
    });

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      status: 'recovering',
      lifecycleStatus: 'recovering',
      runnerConnectionStatus: 'transport_lost',
      inputEnabled: false,
    });

    await (service as unknown as {
      handleRunnerReadyForTerminalRecovery: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string | null;
        runnerInstanceId: string | null;
        connectionId: string;
        connectionEpoch: number;
        activeTerminals: Array<{
          terminal_session_id: string;
          runner_session_id: string;
          generation: number;
          cols: number;
          rows: number;
          cwd: string;
        }>;
      }) => Promise<void>;
    }).handleRunnerReadyForTerminalRecovery({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      runnerInstanceId: 'runner_instance_1',
      connectionId: 'runner_conn_2',
      connectionEpoch: 5,
      activeTerminals: [
        {
          terminal_session_id: created.sessionId,
          runner_session_id: 'task_1',
          generation: 4,
          cols: 120,
          rows: 30,
          cwd: '/home/task_1/workspace',
        },
      ],
    });

    expect(adoptTerminalSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'task_1',
      agentId: 'agent_1',
      terminalSessionId: created.sessionId,
      connectionEpoch: 5,
      generation: 4,
      cols: 120,
      rows: 30,
    }));
    await adoptedRuntimeEvents.push({
      type: 'started',
      terminal_session_id: created.sessionId,
      cols: 120,
      rows: 30,
    });

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'active',
      lifecycleStatus: 'active',
      runnerConnectionStatus: 'attached',
      inputEnabled: true,
      recoverable: false,
      recoveryDeadlineAt: undefined,
      failureKind: null,
    });
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      requiredPermissions: ['project:agent_task:use', 'project:agent_task:terminal'],
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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

  it('revalidates terminal close with the persisted resolved runner id before closing runtime', async () => {
    const cache = new InMemoryCache();
    let terminalUseAllowed = true;
    const authorizeTerminalUse = vi.fn(async () => terminalUseAllowed);
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
      authorizeTerminalUse,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'legacy_agent_field',
      resolvedRunnerId: 'developer_runner_bound_at_create',
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
      terminal_session_id: created.sessionId,
      cols: 80,
      rows: 24,
    });

    terminalUseAllowed = false;
    runtimeClose.mockClear();
    emitBrowserMessage(ws, { type: 'terminal.close' });

    await waitForAssertion(() => {
      expect(sentPayloads(ws)).toContainEqual({
        type: 'terminal.error',
        terminal_session_id: created.sessionId,
        error_code: 'terminal_permission_revoked',
        error_message: 'terminal_permission_revoked',
      });
    });
    expect(runtimeClose).not.toHaveBeenCalled();
    expect(authorizeTerminalUse).toHaveBeenLastCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
      terminalSessionId: created.sessionId,
      resolvedRunnerId: 'developer_runner_bound_at_create',
      runnerSessionId: 'task_1',
      requiredPermissions: ['project:agent_task:use', 'project:agent_task:terminal'],
    });
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
      wsPath: expect.stringContaining(`terminal_session_id=${created.sessionId}`),
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
      resolvedRunnerId: 'agent_1',
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

    await runtimeEvents.push({ type: 'output', terminal_session_id: created.sessionId, chunk: 'one\n' });
    await runtimeEvents.push({ type: 'output', terminal_session_id: created.sessionId, chunk: 'two\n' });
    await runtimeEvents.push({ type: 'output', terminal_session_id: created.sessionId, chunk: 'three\n' });
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
      resolvedRunnerId: 'agent_1',
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
    await runtimeEvents.push({ type: 'output', terminal_session_id: created.sessionId, chunk: 'only\n' });
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

    await runtimeEvents.push({ type: 'output', terminal_session_id: created.sessionId, chunk: 'live-after-gap\n' });

    await waitForAssertion(() => {
      expect(sentPayloads(secondWs)).toContainEqual({
        type: 'terminal.output',
        terminal_session_id: created.sessionId,
        chunk: 'live-after-gap\n',
        seq: 2,
      });
    });
  });

  it('keeps browser disconnect grace outside runtime close and close hooks', async () => {
    vi.useFakeTimers();
    try {
      const cache = new InMemoryCache();
      const onSessionClosed = vi.fn();
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
      service.configureLifecycleHooks({ onSessionClosed });

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
      expect(runtimeClose).not.toHaveBeenCalled();
      expect(onSessionClosed).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a persisted live session recovering after service reload without firing close hooks', async () => {
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
      status: 'recovering',
      lifecycleStatus: 'recovering',
      runnerConnectionStatus: 'transport_lost',
      browserConnectionStatus: 'none',
      inputEnabled: false,
      recoverable: true,
      closeReason: 'runner_transport_lost',
      failureKind: null,
    });

    const session = await reloadedService.getSession(seeded.created.sessionId);
    expect(session?.recoveryDeadlineAt).toEqual(expect.any(String));
    expect(configuredOnSessionClosed).not.toHaveBeenCalled();
    expect(registeredOnSessionClosed).not.toHaveBeenCalled();
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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    await (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => Promise<void>;
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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 90,
      rows: 25,
    });

    await (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => Promise<void>;
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
      dispatchTerminalSession: vi.fn(async (input: { terminalSessionId: string }) => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: (async function* stream() {
          yield {
            type: 'started' as const,
            terminal_session_id: input.terminalSessionId,
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
      terminal_session_id: created.sessionId,
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
    const dispatchTerminalSession = vi.fn(async (input: { terminalSessionId: string }) => ({
      writeInput: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      stream: (async function* stream() {
        yield {
          type: 'started' as const,
          terminal_session_id: input.terminalSessionId,
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
      resolvedRunnerId: 'agent_1',
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
      wsPath: expect.stringContaining(`terminal_session_id=${created.sessionId}`),
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
    await waitForAssertion(() => {
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
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
        wsPath: expect.stringContaining(`terminal_session_id=${created.sessionId}`),
        wsTicket: expect.stringMatching(/^term_/),
      });
      expect(runtimeClose).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets operators extend reconnect grace without turning browser disconnect into terminal close', async () => {
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
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
        wsPath: expect.stringContaining(`terminal_session_id=${created.sessionId}`),
        wsTicket: expect.stringMatching(/^term_/),
      });

      await vi.advanceTimersByTimeAsync(1_100);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
      expect(runtimeClose).not.toHaveBeenCalled();
    } finally {
      if (previousReconnectGrace === undefined) delete process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS;
      else process.env.NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS = previousReconnectGrace;
      vi.useRealTimers();
    }
  });

  it('keeps the default grace window bounded without closing the terminal runtime', async () => {
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
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
      expect(runtimeClose).not.toHaveBeenCalled();
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

  it('keeps a disconnected terminal alive after the configured reconnect grace elapses', async () => {
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
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
      expect(runtimeClose).not.toHaveBeenCalled();
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
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
    await waitForAssertion(() => {
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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
      resolvedRunnerId: 'agent_1',
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
        dispatchTerminalSession: vi.fn(async (input: { terminalSessionId: string }) => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: vi.fn(),
          stream: (async function* stream() {
            await new Promise((resolve) => setTimeout(resolve, 20_000));
            yield {
              type: 'started' as const,
              terminal_session_id: input.terminalSessionId,
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
        resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
        resolvedRunnerId: 'agent_1',
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
        resolvedRunnerId: 'agent_1',
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
        resolvedRunnerId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });
      await (service as unknown as {
        finishSession: (
          sessionId: string,
          status: 'closed' | 'failed',
          closeReason?: string,
          exitCode?: number | null,
        ) => Promise<void>;
      }).finishSession(created.sessionId, 'failed', 'runner_crashed');
    }

    await expect(
      service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    await (service as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => Promise<void>;
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
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      terminal_session_id: created.sessionId,
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

  it('keeps disconnected terminal sessions in live task-session truth across reconnect grace', async () => {
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
        resolvedRunnerId: 'agent_1',
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
        terminal_session_id: created.sessionId,
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
      ).resolves.toBe(true);
      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'disconnected',
        closeReason: 'browser_disconnected',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  for (const persistedStatus of ['pending', 'active', 'disconnected'] as const) {
    it(`keeps a reloaded persisted ${persistedStatus} session as a live recovering blocker until its deadline`, async () => {
      const seeded = await seedSessionForServiceReload(persistedStatus);
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
        const reloadedService = new NotebookTerminalService(seeded.cache, {
          dispatchTerminalSession: vi.fn(),
        } as never, {
          recoveryTimeoutMs: 25,
        });

        await expect(
          reloadedService.hasLiveSessionsForTask({
            workspaceId: 'ws_default',
            projectId: 'proj_1',
            taskId: 'task_1',
            userId: 'user_1',
          }),
        ).resolves.toBe(true);

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
            status: 'recovering',
            lifecycleStatus: 'recovering',
            runnerConnectionStatus: 'transport_lost',
            inputEnabled: false,
            recoverable: true,
          },
        ]);

        await vi.advanceTimersByTimeAsync(5_010);

        await expect(
          reloadedService.hasLiveSessionsForTask({
            workspaceId: 'ws_default',
            projectId: 'proj_1',
            taskId: 'task_1',
            userId: 'user_1',
          }),
        ).resolves.toBe(false);
        await expect(reloadedService.getSession(seeded.created.sessionId)).resolves.toMatchObject({
          id: seeded.created.sessionId,
          status: 'failed',
          lifecycleStatus: 'failed',
          failureKind: 'runner_recovery_timeout',
          closeReason: 'runner_recovery_timeout',
        });
      } finally {
        vi.useRealTimers();
      }
    });
  }

  it('reconciles persisted pending terminal sessions to recovering truth after service reload', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const first = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
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
      { id: first.sessionId, status: 'recovering', runnerConnectionStatus: 'transport_lost' },
      { id: second.sessionId, status: 'recovering', runnerConnectionStatus: 'transport_lost' },
    ]);
  });

  it('keeps the live session cap while reloaded sessions are recovering and releases it after expiry', async () => {
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
        resolvedRunnerId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80 + index,
        rows: 24 + index,
      });
      createdIds.push(created.sessionId);
    }

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
      const reloadedService = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(),
      } as never, {
        recoveryTimeoutMs: 25,
      });

      await expect(
        reloadedService.createSession({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          agentId: 'agent_1',
          resolvedRunnerId: 'agent_1',
          runnerSessionId: 'task_1',
          userId: 'user_1',
          cols: 120,
          rows: 40,
        }),
      ).rejects.toThrow('task_terminal_session_limit_reached');

      await vi.advanceTimersByTimeAsync(5_010);

      await expect(
        reloadedService.createSession({
          workspaceId: 'ws_default',
          projectId: 'proj_1',
          taskId: 'task_1',
          agentId: 'agent_1',
          resolvedRunnerId: 'agent_1',
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
      expect(sessions).toEqual(expect.arrayContaining([
        ...createdIds.map((id) => expect.objectContaining({
          id,
          status: 'failed',
          failureKind: 'runner_recovery_timeout',
        })),
        expect.objectContaining({ status: 'pending' }),
      ]));
    } finally {
      vi.useRealTimers();
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
        resolvedRunnerId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      });
      createdIds.push(created.sessionId);
      await (service as unknown as {
        finishSession: (
          sessionId: string,
          status: 'closed' | 'failed',
          closeReason?: string,
          exitCode?: number | null,
        ) => Promise<void>;
      }).finishSession(created.sessionId, 'closed', 'process_exited', 0);
    }

    await expect(
      service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    await (firstService as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => Promise<void>;
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
    it(`advertises a reloaded persisted ${persistedStatus} terminal session as recovering without starting a new runtime`, async () => {
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

      await expect(reloadedService.issueReconnectTicket(seeded.created.sessionId)).resolves.toMatchObject({
        wsPath: expect.stringContaining(`terminal_session_id=${seeded.created.sessionId}`),
      });
      await expect(reloadedService.getSession(seeded.created.sessionId)).resolves.toMatchObject({
        id: seeded.created.sessionId,
        status: 'recovering',
        lifecycleStatus: 'recovering',
        runnerConnectionStatus: 'transport_lost',
        inputEnabled: false,
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

  it('keeps stale reconnect tickets valid after service reload while the session is recovering', async () => {
    const seeded = await seedSessionForServiceReload('disconnected');
    expect(seeded.staleReconnectPath).toBeTruthy();

    const reloadedDispatchTerminalSession = vi.fn();
    const reloadedService = new NotebookTerminalService(seeded.cache, {
      dispatchTerminalSession: reloadedDispatchTerminalSession,
    } as never);

    await expect(reloadedService.issueReconnectTicket(seeded.created.sessionId)).resolves.toMatchObject({
      wsPath: expect.stringContaining(`terminal_session_id=${seeded.created.sessionId}`),
    });
    await expect(reloadedService.getSession(seeded.created.sessionId)).resolves.toMatchObject({
      id: seeded.created.sessionId,
      status: 'recovering',
      runnerConnectionStatus: 'transport_lost',
      inputEnabled: false,
    });
    expect(reloadedDispatchTerminalSession).not.toHaveBeenCalled();
  });

  it('keeps a reloaded persisted closing terminal session live before close deadline expiry', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
      const cache = new InMemoryCache();
      const closeTerminalSession = vi.fn(async () => 'signaled');
      const firstService = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(),
        closeTerminalSession,
      } as never, {
        closeTimeoutMs: 5_000,
      });
      const taskId = 'task_closing_reload_unexpired';

      const closing = await createDeliveredClosingSession(firstService, {
        taskId,
        generation: 4,
        connectionEpoch: 9,
      });
      vi.setSystemTime(new Date('2026-05-08T12:00:04.999Z'));

      const reloadedService = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(),
      } as never, {
        closeTimeoutMs: 5_000,
      });

      await expect(reloadedService.getSession(closing.sessionId)).resolves.toMatchObject({
        id: closing.sessionId,
        status: 'closing',
        lifecycleStatus: 'closing',
        runnerConnectionStatus: 'attached',
        inputEnabled: false,
        recoverable: false,
        closeState: 'delivered',
        closeDeadlineAt: closing.closeDeadlineAt,
      });
      await expect(reloadedService.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
        userId: 'user_1',
      })).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires reloaded persisted closing terminal sessions at read time and releases task blockers', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
      const cache = new InMemoryCache();
      const closeTerminalSession = vi.fn(async () => 'signaled');
      const firstService = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(),
        closeTerminalSession,
      } as never, {
        closeTimeoutMs: 5_000,
      });
      const taskId = 'task_closing_reload_expired';
      const closings: Array<{
        sessionId: string;
        closeDeadlineAt: string | undefined;
      }> = [];
      for (const index of [0, 1, 2]) {
        closings.push(await createDeliveredClosingSession(firstService, {
          taskId,
          generation: index + 1,
          connectionEpoch: index + 10,
        }));
      }
      expect(closeTerminalSession).toHaveBeenCalledTimes(3);
      vi.setSystemTime(new Date('2026-05-08T12:00:05.010Z'));

      const reloadedService = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(),
      } as never, {
        closeTimeoutMs: 5_000,
      });

      await expect(reloadedService.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
        userId: 'user_1',
      })).resolves.toBe(false);
      for (const closing of closings) {
        await expect(reloadedService.getSession(closing.sessionId)).resolves.toMatchObject({
          id: closing.sessionId,
          status: 'failed',
          lifecycleStatus: 'failed',
          runnerConnectionStatus: 'missing',
          inputEnabled: false,
          recoverable: false,
          closeState: 'expired',
          closeDiagnosticCode: 'close_tombstone_timeout',
          failureKind: 'terminal_process_lost',
          closeReason: 'close_tombstone_timeout',
          endedAt: '2026-05-08T12:00:05.010Z',
        });
      }
      await expect(reloadedService.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId,
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
        runnerSessionId: taskId,
        userId: 'user_1',
        cols: 80,
        rows: 24,
      })).resolves.toMatchObject({
        sessionId: expect.stringMatching(/^term_/),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a close tombstone requested without sending a zero-fenced close for a reload-interrupted terminal session without identity', async () => {
    const cache = new InMemoryCache();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await firstService.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
    expect(closeTerminalSession).not.toHaveBeenCalled();
    await expect(reloadedService.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closing',
      lifecycleStatus: 'closing',
      closeState: 'requested',
      closeReason: 'ended_by_user',
      closeDiagnosticCode: 'terminal_close_identity_missing',
      inputEnabled: false,
      recoverable: false,
    });
  });

  it('routes browser terminal.close through the close tombstone without closing runtime directly', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const runtimeClose = vi.fn();
    const closeTerminalSession = vi.fn(async () => 'signaled');
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: runtimeClose,
        stream: runtimeEvents.stream,
      })),
      closeTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
    await runtimeEvents.push(startedRuntimeEvent(created.sessionId));
    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({
        status: 'active',
        terminalGeneration: 4,
        terminalConnectionEpoch: 9,
      });
    });
    await expect(cache.get(`notebook_terminal_session:${created.sessionId}`)).resolves.toEqual(
      expect.stringContaining('"terminalGeneration":4'),
    );
    await expect(cache.get(`notebook_terminal_session:${created.sessionId}`)).resolves.toEqual(
      expect.stringContaining('"terminalConnectionEpoch":9'),
    );

    emitBrowserMessage(ws, { type: 'terminal.close' });

    await waitForAssertion(() => {
      expect(closeTerminalSession).toHaveBeenCalledTimes(1);
    });
    expect(closeTerminalSession).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      sessionId: 'task_1',
      agentId: 'agent_1',
      terminalSessionId: created.sessionId,
      closeRequestId: expect.stringMatching(/^close_req_/),
      closeAttemptId: expect.stringMatching(/^close_/),
      generation: 4,
      connectionEpoch: 9,
      reason: 'user_requested',
    });
    expect(runtimeClose).not.toHaveBeenCalled();
    expect(ws.closeCalls).toContainEqual({ code: 1000, reason: 'terminal_closed_by_user' });
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closing',
      lifecycleStatus: 'closing',
      closeState: 'delivered',
      inputEnabled: false,
    });
  });

  it('waits for close ack and session-closed lifecycle hooks when finalization is requested', async () => {
    const cache = new InMemoryCache();
    const closeTerminalSession = vi.fn(async () => 'signaled');
    const lifecycleDrain = createDeferred<void>();
    const onSessionClosed = vi.fn(async () => {
      await lifecycleDrain.promise;
    });
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
      closeTerminalSession,
    } as never);
    service.configureLifecycleHooks({ onSessionClosed });

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });
    const session = await service.getSession(created.sessionId);
    Object.assign(session!, {
      status: 'active',
      lifecycleStatus: 'active',
      runnerConnectionStatus: 'attached',
      runtimeReady: true,
      terminalGeneration: 4,
      terminalConnectionEpoch: 9,
    });

    let deleteResolved = false;
    const deletePromise = service.deleteSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
      sessionId: created.sessionId,
      waitForFinalization: true,
    }).then((value) => {
      deleteResolved = true;
      return value;
    });

    await vi.waitFor(() => {
      expect(closeTerminalSession).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    expect(deleteResolved).toBe(false);

    const closeRequest = closeTerminalSession.mock.calls[0]?.[0] as {
      closeRequestId: string;
      closeAttemptId: string;
      generation: number;
      connectionEpoch: number;
    };
    const closeAckPromise = (service as unknown as {
      handleTerminalCloseAck: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string;
        terminalSessionId: string;
        requestId: string;
        closeAttemptId: string;
        generation: number;
        connectionEpoch: number;
        status: 'closed';
      }) => Promise<void>;
    }).handleTerminalCloseAck({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      terminalSessionId: created.sessionId,
      requestId: closeRequest.closeRequestId,
      closeAttemptId: closeRequest.closeAttemptId,
      generation: closeRequest.generation,
      connectionEpoch: closeRequest.connectionEpoch,
      status: 'closed',
    });

    await vi.waitFor(() => {
      expect(onSessionClosed).toHaveBeenCalledTimes(1);
    });
    expect(deleteResolved).toBe(false);

    lifecycleDrain.resolve();
    await expect(closeAckPromise).resolves.toBeUndefined();
    await expect(deletePromise).resolves.toBe(true);
    expect(deleteResolved).toBe(true);
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      status: 'closed',
      closeState: 'acked',
    });
  });

  it('keeps closing tombstone authoritative when terminal exited arrives before close ack', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const closeTerminalSession = vi.fn(async () => 'signaled');
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
      closeTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
    await runtimeEvents.push(startedRuntimeEvent(created.sessionId));
    await waitForAssertion(async () => {
      expect(await service.getSession(created.sessionId)).toMatchObject({ status: 'active' });
    });

    await expect(service.deleteSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
      sessionId: created.sessionId,
    })).resolves.toBe(true);
    const closeRequest = closeTerminalSession.mock.calls[0]?.[0] as {
      closeRequestId: string;
      closeAttemptId: string;
      generation: number;
      connectionEpoch: number;
    };

    await runtimeEvents.push({
      type: 'exited',
      terminal_session_id: created.sessionId,
      exit_code: 0,
      signal: null,
    });

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closing',
      lifecycleStatus: 'closing',
      closeState: 'delivered',
      closeAttemptId: closeRequest.closeAttemptId,
      failureKind: null,
    });

    await (service as unknown as {
      handleTerminalCloseAck: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string;
        terminalSessionId: string;
        requestId: string;
        closeAttemptId: string;
        generation: number;
        connectionEpoch: number;
        status: 'closed';
      }) => Promise<void>;
    }).handleTerminalCloseAck({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      terminalSessionId: created.sessionId,
      requestId: closeRequest.closeRequestId,
      closeAttemptId: closeRequest.closeAttemptId,
      generation: closeRequest.generation,
      connectionEpoch: closeRequest.connectionEpoch,
      status: 'closed',
    });

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closed',
      lifecycleStatus: 'closed',
      closeState: 'acked',
      failureKind: null,
    });
  });

  it('rejects stale close ack fences before accepting the delivered request fence', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const closeTerminalSession = vi.fn(async () => 'signaled');
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
      closeTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
    await runtimeEvents.push(startedRuntimeEvent(created.sessionId));

    await expect(service.deleteSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
      sessionId: created.sessionId,
    })).resolves.toBe(true);
    const closeRequest = closeTerminalSession.mock.calls[0]?.[0] as {
      closeRequestId: string;
      closeAttemptId: string;
      generation: number;
      connectionEpoch: number;
    };
    const sendAck = (override: Partial<typeof closeRequest>) => (service as unknown as {
      handleTerminalCloseAck: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string;
        terminalSessionId: string;
        requestId: string;
        closeAttemptId: string;
        generation: number;
        connectionEpoch: number;
        status: 'closed';
      }) => Promise<void>;
    }).handleTerminalCloseAck({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      terminalSessionId: created.sessionId,
      requestId: override.closeRequestId ?? closeRequest.closeRequestId,
      closeAttemptId: override.closeAttemptId ?? closeRequest.closeAttemptId,
      generation: override.generation ?? closeRequest.generation,
      connectionEpoch: override.connectionEpoch ?? closeRequest.connectionEpoch,
      status: 'closed',
    });

    await sendAck({ closeRequestId: 'close_req_stale' });
    await sendAck({ closeAttemptId: 'close_stale' });
    await sendAck({ generation: closeRequest.generation + 1 });
    await sendAck({ connectionEpoch: closeRequest.connectionEpoch + 1 });
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closing',
      lifecycleStatus: 'closing',
      closeState: 'delivered',
    });

    await sendAck({});
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closed',
      lifecycleStatus: 'closed',
      closeState: 'acked',
    });
  });

  it('logs rejected close ack fences with received and expected diagnostic fields', async () => {
    const originalDebug = process.env.DEBUG_NOTEBOOK_TERMINAL;
    process.env.DEBUG_NOTEBOOK_TERMINAL = '1';
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const closeTerminalSession = vi.fn(async () => 'signaled');
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: vi.fn(),
          stream: runtimeEvents.stream,
        })),
        closeTerminalSession,
      } as never);

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
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
      await runtimeEvents.push(startedRuntimeEvent(created.sessionId));

      await expect(service.deleteSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
        sessionId: created.sessionId,
      })).resolves.toBe(true);
      const closeRequest = closeTerminalSession.mock.calls[0]?.[0] as {
        closeRequestId: string;
        closeAttemptId: string;
        generation: number;
        connectionEpoch: number;
      };

      await (service as unknown as {
        handleTerminalCloseAck: (event: {
          workspaceId: string;
          projectId: string;
          agentId: string;
          runnerSessionId: string;
          terminalSessionId: string;
          requestId: string;
          closeAttemptId: string;
          generation: number;
          connectionEpoch: number;
          status: 'closed';
        }) => Promise<void>;
      }).handleTerminalCloseAck({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        terminalSessionId: created.sessionId,
        requestId: 'close_req_stale',
        closeAttemptId: closeRequest.closeAttemptId,
        generation: closeRequest.generation,
        connectionEpoch: closeRequest.connectionEpoch,
        status: 'closed',
      });

      const debugOutput = stdoutWrite.mock.calls.map((call) => String(call[0])).join('');
      expect(debugOutput).toContain('[notebook-terminal] close_ack_rejected');
      expect(debugOutput).toContain('"reason":"request_mismatch"');
      expect(debugOutput).toContain('"received"');
      expect(debugOutput).toContain('"expected"');
      expect(debugOutput).toContain('"request_id":"close_req_stale"');
      expect(debugOutput).toContain(`"request_id":"${closeRequest.closeRequestId}"`);
      expect(debugOutput).toContain(`"close_attempt_id":"${closeRequest.closeAttemptId}"`);
      expect(debugOutput).toContain('"generation":4');
      expect(debugOutput).toContain('"connection_epoch":9');
    } finally {
      stdoutWrite.mockRestore();
      if (originalDebug === undefined) {
        delete process.env.DEBUG_NOTEBOOK_TERMINAL;
      } else {
        process.env.DEBUG_NOTEBOOK_TERMINAL = originalDebug;
      }
    }
  });

  it('keeps close ack error in closing until close tombstone deadline expiry releases blockers', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-05-08T12:00:00.000Z'));
      const cache = new InMemoryCache();
      const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
      const closeTerminalSession = vi.fn(async () => 'signaled');
      const service = new NotebookTerminalService(cache, {
        dispatchTerminalSession: vi.fn(async () => ({
          writeInput: vi.fn(),
          resize: vi.fn(),
          close: vi.fn(),
          stream: runtimeEvents.stream,
        })),
        closeTerminalSession,
      } as never, {
        closeTimeoutMs: 25,
      });

      const created = await service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
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
      await runtimeEvents.push(startedRuntimeEvent(created.sessionId));

      await expect(service.deleteSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
        sessionId: created.sessionId,
      })).resolves.toBe(true);
      const closeRequest = closeTerminalSession.mock.calls[0]?.[0] as {
        closeRequestId: string;
        closeAttemptId: string;
        generation: number;
        connectionEpoch: number;
      };
      const closing = await service.getSession(created.sessionId);
      const closeDeadlineAt = closing?.closeDeadlineAt;

      await (service as unknown as {
        handleTerminalCloseAck: (event: {
          workspaceId: string;
          projectId: string;
          agentId: string;
          runnerSessionId: string;
          terminalSessionId: string;
          requestId: string;
          closeAttemptId: string;
          generation: number;
          connectionEpoch: number;
          status: 'error';
          diagnosticCode: string;
          remainingPidCount: number;
        }) => Promise<void>;
      }).handleTerminalCloseAck({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        agentId: 'agent_1',
        runnerSessionId: 'task_1',
        terminalSessionId: created.sessionId,
        requestId: closeRequest.closeRequestId,
        closeAttemptId: closeRequest.closeAttemptId,
        generation: closeRequest.generation,
        connectionEpoch: closeRequest.connectionEpoch,
        status: 'error',
        diagnosticCode: 'runner_close_failed',
        remainingPidCount: 2,
      });

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'closing',
        lifecycleStatus: 'closing',
        closeState: 'delivered',
        closeDeadlineAt,
        closeDiagnosticCode: 'runner_close_failed',
        closeRemainingPidCount: 2,
      });
      expect((await service.getSession(created.sessionId))?.closeResult).toBeUndefined();
      await expect(service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      })).resolves.toBe(true);

      await vi.advanceTimersByTimeAsync(5_010);

      await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
        id: created.sessionId,
        status: 'failed',
        lifecycleStatus: 'failed',
        closeState: 'expired',
        closeReason: 'close_tombstone_timeout',
        failureKind: 'terminal_process_lost',
      });
      await expect(service.hasLiveSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      })).resolves.toBe(false);
      await expect(service.listSessionsForTask({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
      })).resolves.toMatchObject([
        {
          id: created.sessionId,
          status: 'failed',
          closeState: 'expired',
          closeReason: 'close_tombstone_timeout',
        },
      ]);
      await expect(service.createSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        agentId: 'agent_1',
        resolvedRunnerId: 'agent_1',
        runnerSessionId: 'task_1',
        userId: 'user_1',
        cols: 80,
        rows: 24,
      })).resolves.toMatchObject({
        sessionId: expect.stringMatching(/^term_/),
      });
      await expect(service.deleteSession({
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        taskId: 'task_1',
        userId: 'user_1',
        sessionId: created.sessionId,
      })).resolves.toBe(true);
      await expect(service.getSession(created.sessionId)).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('redelivers close tombstone after runner reconnect omits the closing terminal and accepts not_found ack', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const closeTerminalSession = vi.fn(async (request: {
      closeRequestId?: string;
      closeAttemptId?: string;
      terminalSessionId: string;
      generation: number;
      connectionEpoch: number;
    }) => {
      void request;
      return 'signaled';
    });
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
      closeTerminalSession,
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
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
    await runtimeEvents.push(startedRuntimeEvent(created.sessionId));

    await expect(service.deleteSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      userId: 'user_1',
      sessionId: created.sessionId,
    })).resolves.toBe(true);

    await (service as unknown as {
      handleRunnerReadyForTerminalRecovery: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string | null;
        runnerInstanceId: string | null;
        connectionId: string;
        connectionEpoch: number;
        activeTerminals: [];
      }) => Promise<void>;
    }).handleRunnerReadyForTerminalRecovery({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      runnerInstanceId: 'runner_instance_1',
      connectionId: 'runner_conn_2',
      connectionEpoch: 2,
      activeTerminals: [],
    });

    await waitForAssertion(() => {
      expect(closeTerminalSession).toHaveBeenCalledTimes(2);
    });
    const redeliveryRequest = closeTerminalSession.mock.calls[1]?.[0] as {
      closeRequestId: string;
      closeAttemptId: string;
      terminalSessionId: string;
      generation: number;
      connectionEpoch: number;
    };
    await (service as unknown as {
      handleTerminalCloseAck: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string;
        terminalSessionId: string;
        requestId: string;
        closeAttemptId: string;
        generation: number;
        connectionEpoch: number;
        status: 'not_found';
      }) => Promise<void>;
    }).handleTerminalCloseAck({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      terminalSessionId: redeliveryRequest.terminalSessionId,
      requestId: redeliveryRequest.closeRequestId,
      closeAttemptId: redeliveryRequest.closeAttemptId,
      generation: redeliveryRequest.generation,
      connectionEpoch: redeliveryRequest.connectionEpoch,
      status: 'not_found',
    });
    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'closed',
      lifecycleStatus: 'closed',
      closeState: 'acked',
      closeResult: 'not_found',
      closeDiagnosticCode: 'terminal_process_missing_on_close',
      failureKind: null,
      closeReason: 'ended_by_user',
    });
  });

  it('marks runner shutdown terminal processes failed and unrecoverable', async () => {
    const cache = new InMemoryCache();
    const service = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(),
    } as never);

    const created = await service.createSession({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      taskId: 'task_1',
      agentId: 'agent_1',
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    await (service as unknown as {
      handleRunnerDetached: (event: {
        workspaceId: string;
        projectId: string;
        agentId: string;
        runnerSessionId: string;
        connectionId: string;
        reason: 'agent_disconnected';
        terminalSessionIds: string[];
        terminalProcessesTerminated: true;
      }) => Promise<void>;
    }).handleRunnerDetached({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      agentId: 'agent_1',
      runnerSessionId: 'task_1',
      connectionId: 'runner_conn_shutdown',
      reason: 'agent_disconnected',
      terminalSessionIds: [created.sessionId],
      terminalProcessesTerminated: true,
    });

    await expect(service.getSession(created.sessionId)).resolves.toMatchObject({
      id: created.sessionId,
      status: 'failed',
      lifecycleStatus: 'failed',
      runnerConnectionStatus: 'closed',
      recoverable: false,
      inputEnabled: false,
      failureKind: 'runner_process_exited',
      closeReason: 'runner_process_exited',
    });
  });

  it('preserves persisted execution context when closing a reload-interrupted terminal session', async () => {
    const cache = new InMemoryCache();
    const runtimeEvents = createControlledRuntimeStream<TerminalRuntimeEvent>();
    const firstService = new NotebookTerminalService(cache, {
      dispatchTerminalSession: vi.fn(async () => ({
        writeInput: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(),
        stream: runtimeEvents.stream,
      })),
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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_presence',
      userId: 'user_1',
      cols: 80,
      rows: 24,
      executionContext,
    });
    const session = await firstService.getSession(created.sessionId);
    const ws = new FakeWebSocket();
    await (firstService as unknown as {
      bindBrowserSocket: (browserSocket: FakeWebSocket, session: NonNullable<typeof session>) => Promise<void>;
    }).bindBrowserSocket(ws, session!);
    emitReconnect(ws, created.sessionId);
    await runtimeEvents.push(startedRuntimeEvent(created.sessionId, {
      runner_session_id: 'task_presence',
      generation: 8,
      connection_epoch: 13,
    }));

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
      closeRequestId: expect.stringMatching(/^close_req_/),
      closeAttemptId: expect.stringMatching(/^close_/),
      generation: 8,
      connectionEpoch: 13,
      reason: 'user_requested',
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
      resolvedRunnerId: 'agent_1',
      runnerSessionId: 'task_1',
      userId: 'user_1',
      cols: 80,
      rows: 24,
    });

    await (firstService as unknown as {
      finishSession: (
        sessionId: string,
        status: 'closed' | 'failed',
        closeReason?: string,
        exitCode?: number | null,
      ) => Promise<void>;
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
