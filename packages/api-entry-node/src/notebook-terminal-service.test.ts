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
    await waitForAssertion(async () => {
      const updated = await service.getSession(created.sessionId);
      expect(updated?.status).toBe('failed');
      expect(updated?.closeReason).toBe('terminal_stream_failed');
    });
    expect(ws.closeCalls).toHaveLength(0);
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
});
