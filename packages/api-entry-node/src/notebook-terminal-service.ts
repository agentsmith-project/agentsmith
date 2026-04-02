import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { CachePort } from '@mbos/ports';
import {
  issueInternalTicket,
  resolveInternalTicket,
} from './internal-ticket-store.js';
import type { AgentExecutionService } from './agent-execution-service.js';

function debugTerminal(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_TERMINAL !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-terminal] ${message}${payload}\n`);
}

type RegisteredTerminalSession = {
  id: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  runnerSessionId: string;
  userId: string;
  cols: number;
  rows: number;
  shell?: string;
  executionContext?: Record<string, unknown>;
  status: 'pending' | 'active' | 'closed' | 'failed';
  browserSocket?: WebSocket;
  createdAt: string;
  lastActivityAt: string;
  endedAt?: string;
  closeReason?: string;
  exitCode?: number | null;
};

type PersistedTerminalSession = Omit<RegisteredTerminalSession, 'browserSocket'>;

type NotebookTerminalLifecycleHooks = {
  onSessionClosed?: (session: RegisteredTerminalSession) => void | Promise<void>;
};

export class NotebookTerminalService {
  private readonly wsServer: WebSocketServer;
  private readonly sessions = new Map<string, RegisteredTerminalSession>();
  private hooks: NotebookTerminalLifecycleHooks = {};

  constructor(
    private readonly cache: CachePort,
    private readonly agentExecutionService: AgentExecutionService,
  ) {
    this.wsServer = new WebSocketServer({ noServer: true });
  }

  configureLifecycleHooks(hooks: NotebookTerminalLifecycleHooks): void {
    this.hooks = hooks;
  }

  private sessionCacheKey(sessionId: string): string {
    return `notebook_terminal_session:${sessionId}`;
  }

  private async persistSession(session: RegisteredTerminalSession): Promise<void> {
    const payload: PersistedTerminalSession = {
      id: session.id,
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      taskId: session.taskId,
      agentId: session.agentId,
      runnerSessionId: session.runnerSessionId,
      userId: session.userId,
      cols: session.cols,
      rows: session.rows,
      ...(session.shell ? { shell: session.shell } : {}),
      ...(session.executionContext ? { executionContext: session.executionContext } : {}),
      status: session.status,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
      ...(session.endedAt ? { endedAt: session.endedAt } : {}),
      ...(session.closeReason ? { closeReason: session.closeReason } : {}),
      ...(session.exitCode !== undefined ? { exitCode: session.exitCode } : {}),
    };
    await this.cache.set(this.sessionCacheKey(session.id), JSON.stringify(payload), 24 * 60 * 60);
  }

  async createSession(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    agentId: string;
    runnerSessionId: string;
    userId: string;
    cols: number;
    rows: number;
    shell?: string;
    executionContext?: Record<string, unknown>;
  }): Promise<{
    sessionId: string;
    wsPath: string;
    wsTicket: string;
  }> {
    const sessionId = `term_${randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();
    this.sessions.set(sessionId, {
      id: sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      agentId: input.agentId,
      runnerSessionId: input.runnerSessionId,
      userId: input.userId,
      cols: Math.max(20, input.cols),
      rows: Math.max(5, input.rows),
      ...(input.shell?.trim() ? { shell: input.shell.trim() } : {}),
      ...(input.executionContext ? { executionContext: input.executionContext } : {}),
      status: 'pending',
      createdAt: now,
      lastActivityAt: now,
    });
    await this.persistSession(this.sessions.get(sessionId)!);

    const issued = await issueInternalTicket(this.cache, {
      purpose: 'terminal_ws_access',
      userId: input.userId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      prefix: 'term',
      ttlMs: 10 * 60 * 1000,
      maxUses: 3,
      payload: {
        task_id: input.taskId,
        terminal_session_id: sessionId,
      },
    });

    return {
      sessionId,
      wsPath: `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}`
        + `/projects/${encodeURIComponent(input.projectId)}`
        + `/tasks/${encodeURIComponent(input.taskId)}`
        + `/terminal/ws?session_id=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(issued.ticket)}`,
      wsTicket: issued.ticket,
    };
  }

  async getSession(sessionId: string): Promise<RegisteredTerminalSession | null> {
    const live = this.sessions.get(sessionId);
    if (live) return live;
    const raw = await this.cache.get(this.sessionCacheKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RegisteredTerminalSession;
    } catch {
      return null;
    }
  }

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '', 'http://localhost');
    const matched = url.pathname.match(
      /^\/api\/v1\/workspaces\/([^/]+)\/projects\/([^/]+)\/tasks\/([^/]+)\/terminal\/ws\/?$/,
    );
    if (!matched) {
      socket.destroy();
      return;
    }
    const workspaceId = decodeURIComponent(matched[1] ?? '');
    const projectId = decodeURIComponent(matched[2] ?? '');
    const taskId = decodeURIComponent(matched[3] ?? '');
    const sessionId = url.searchParams.get('session_id')?.trim() ?? '';
    const ticket = url.searchParams.get('ticket')?.trim() ?? '';
    if (!sessionId || !ticket) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    void resolveInternalTicket(this.cache, ticket, 'terminal_ws_access').then((resolved) => {
      if (!resolved) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (
        resolved.workspace_id !== workspaceId
        || resolved.project_id !== projectId
        || resolved.payload.task_id !== taskId
        || resolved.payload.terminal_session_id !== sessionId
      ) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      const registered = this.sessions.get(sessionId);
      if (!registered || registered.taskId !== taskId) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wsServer.handleUpgrade(req, socket, head, (ws) => {
        void this.bindBrowserSocket(ws, registered);
      });
    }).catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  }

  private async bindBrowserSocket(ws: WebSocket, session: RegisteredTerminalSession): Promise<void> {
    debugTerminal('bind_browser_socket', {
      session_id: session.id,
      task_id: session.taskId,
      agent_id: session.agentId,
      runner_session_id: session.runnerSessionId,
    });
    if (session.browserSocket && session.browserSocket.readyState === session.browserSocket.OPEN) {
      session.browserSocket.close(1012, 'terminal_replaced');
    }
    session.browserSocket = ws;
    session.status = 'pending';
    session.lastActivityAt = new Date().toISOString();
    await this.persistSession(session);

    let runtime: Awaited<ReturnType<AgentExecutionService['dispatchTerminalSession']>>;
    try {
      runtime = await this.agentExecutionService.dispatchTerminalSession({
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        sessionId: session.runnerSessionId,
        agentId: session.agentId,
        terminalSessionId: session.id,
        payload: {
          cols: session.cols,
          rows: session.rows,
          ...(session.shell ? { shell: session.shell } : {}),
          ...(session.executionContext ? { executionContext: session.executionContext } : {}),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'terminal_dispatch_failed';
      debugTerminal('dispatch_failed', {
        session_id: session.id,
        task_id: session.taskId,
        agent_id: session.agentId,
        runner_session_id: session.runnerSessionId,
        error: message,
      });
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          session_id: session.id,
          error_code: 'TERMINAL_DISPATCH_FAILED',
          error_message: message,
        }));
        ws.close(1011, 'terminal_dispatch_failed');
      }
      this.finishSession(session.id, 'failed', message);
      return;
    }

    ws.on('message', (raw) => {
      this.handleBrowserMessage(session, runtime, raw);
    });
    ws.on('close', () => {
      runtime.close();
      this.finishSession(session.id, 'closed', 'browser_socket_closed');
    });
    ws.on('error', () => {
      runtime.close();
      this.finishSession(session.id, 'failed', 'browser_socket_error');
    });

    void (async () => {
      for await (const event of runtime.stream) {
        debugTerminal('runtime_event', {
          session_id: session.id,
          type: event.type,
        });
        if (ws.readyState !== ws.OPEN) break;
        if (event.type === 'started') {
          session.status = 'active';
        }
        if (event.type === 'exited' || event.type === 'error') {
          session.status = event.type === 'exited' ? 'closed' : 'failed';
          session.exitCode = typeof event.exit_code === 'number' ? event.exit_code : null;
          session.closeReason = event.type === 'exited'
            ? 'process_exited'
            : (event.error_message?.trim() || 'runtime_error');
        }
        session.lastActivityAt = new Date().toISOString();
        await this.persistSession(session);
        ws.send(JSON.stringify(event));
      }
      if (ws.readyState === ws.OPEN) {
        ws.close(1000, 'terminal_complete');
      }
      this.finishSession(
        session.id,
        session.status === 'failed' ? 'failed' : 'closed',
        session.closeReason ?? 'terminal_complete',
        session.exitCode ?? null,
      );
    })().catch(() => {
      debugTerminal('runtime_stream_failed', {
        session_id: session.id,
      });
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, 'terminal_stream_failed');
      }
      this.finishSession(session.id, 'failed', 'terminal_stream_failed');
    });
  }

  private handleBrowserMessage(
    session: RegisteredTerminalSession,
    runtime: {
      writeInput: (data: string) => void;
      resize: (cols: number, rows: number) => void;
      close: () => void;
    },
    raw: RawData,
  ): void {
    let payload: { type?: string; data?: string; cols?: number; rows?: number };
    try {
      payload = JSON.parse(raw.toString('utf-8')) as { type?: string; data?: string; cols?: number; rows?: number };
    } catch {
      return;
    }
    session.lastActivityAt = new Date().toISOString();
    if (payload.type === 'terminal.stdin' && typeof payload.data === 'string') {
      runtime.writeInput(payload.data);
      return;
    }
    if (
      payload.type === 'terminal.resize'
      && typeof payload.cols === 'number'
      && typeof payload.rows === 'number'
    ) {
      session.cols = Math.max(20, Math.floor(payload.cols));
      session.rows = Math.max(5, Math.floor(payload.rows));
      runtime.resize(session.cols, session.rows);
      return;
    }
    if (payload.type === 'terminal.close') {
      runtime.close();
    }
  }

  private finishSession(
    sessionId: string,
    status: 'closed' | 'failed',
    closeReason?: string,
    exitCode?: number | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = status;
    const endedAt = new Date().toISOString();
    session.lastActivityAt = endedAt;
    session.endedAt = endedAt;
    if (closeReason?.trim()) session.closeReason = closeReason.trim();
    if (exitCode !== undefined) session.exitCode = exitCode;
    session.browserSocket = undefined;
    void this.persistSession(session);
    void this.hooks.onSessionClosed?.(session);
  }
}
