import { describe, expect, it, vi } from 'vitest';
import { InMemoryCache } from '@mbos/adapters-private';
import { NotebookTerminalService } from './notebook-terminal-service.js';
import { resolveInternalTicket } from './internal-ticket-store.js';

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
});
