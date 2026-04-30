import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
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

const DEFAULT_TERMINAL_MOUNT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINAL_MOUNT_RETRY_COUNT = 2;
const DEFAULT_TERMINAL_MOUNT_RETRY_DELAY_MS = 750;
const DEFAULT_TERMINAL_BOOTSTRAP_OVERHEAD_MS = 10_000;
const DEFAULT_TERMINAL_STARTUP_TIMEOUT_FLOOR_MS = 15_000;
const DEFAULT_TERMINAL_REENTRY_OVERHEAD_MS = 20_000;
const DEFAULT_TERMINAL_RECONNECT_GRACE_FLOOR_MS = 90_000;
const MAX_TERMINAL_RECONNECT_GRACE_MS = 2 * 60_000;
const TERMINAL_SERVICE_RELOAD_CLOSE_REASON = 'terminal_connection_failed_service_reload';

function parsePositiveIntegerEnv(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function resolveDefaultTerminalStartupTimeoutMs(): number {
  const explicit = parsePositiveIntegerEnv('NOTEBOOK_TERMINAL_STARTUP_TIMEOUT_MS');
  if (explicit) return explicit;

  const mountReadyTimeoutMs = parsePositiveIntegerEnv('MBOS_AGENT_JUICEFS_MOUNT_READY_TIMEOUT_MS')
    ?? DEFAULT_TERMINAL_MOUNT_READY_TIMEOUT_MS;
  const mountRetryCount = parsePositiveIntegerEnv('MBOS_AGENT_JUICEFS_MOUNT_RETRY_COUNT')
    ?? DEFAULT_TERMINAL_MOUNT_RETRY_COUNT;
  const mountRetryDelayMs = parsePositiveIntegerEnv('MBOS_AGENT_JUICEFS_MOUNT_RETRY_DELAY_MS')
    ?? DEFAULT_TERMINAL_MOUNT_RETRY_DELAY_MS;

  const coldStartBudgetMs = (
    mountReadyTimeoutMs * Math.max(1, mountRetryCount)
    + mountRetryDelayMs * Math.max(0, mountRetryCount - 1)
    + DEFAULT_TERMINAL_BOOTSTRAP_OVERHEAD_MS
  );
  return Math.max(DEFAULT_TERMINAL_STARTUP_TIMEOUT_FLOOR_MS, coldStartBudgetMs);
}

function resolveDefaultTerminalReconnectGraceMs(): number {
  const explicit = parsePositiveIntegerEnv('NOTEBOOK_TERMINAL_RECONNECT_GRACE_MS');
  if (explicit) {
    return Math.min(MAX_TERMINAL_RECONNECT_GRACE_MS, Math.max(25, explicit));
  }

  // A realistic browser reload/re-entry path is bounded more by full-page bootstrap,
  // auth refresh, and task truth hydration than by a single websocket reconnect.
  // Reuse the platform startup budget and add explicit re-entry overhead so
  // recovery does not expire before the user can reopen in slower real environments.
  return Math.min(
    MAX_TERMINAL_RECONNECT_GRACE_MS,
    Math.max(
      DEFAULT_TERMINAL_RECONNECT_GRACE_FLOOR_MS,
      resolveDefaultTerminalStartupTimeoutMs() + DEFAULT_TERMINAL_REENTRY_OVERHEAD_MS,
    ),
  );
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
  status: 'pending' | 'active' | 'disconnected' | 'closed' | 'failed';
  browserSocket?: WebSocket;
  runtime?: TerminalRuntime;
  runtimeDispatchPromise?: Promise<TerminalRuntime>;
  disconnectTimer?: NodeJS.Timeout;
  disconnectVersion?: number;
  startupTimer?: NodeJS.Timeout;
  streamBound?: boolean;
  bindVersion?: number;
  createdAt: string;
  lastActivityAt: string;
  endedAt?: string;
  closeReason?: string;
  exitCode?: number | null;
};

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

type TerminalRuntime = {
  writeInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
  stream: AsyncIterable<TerminalRuntimeEvent>;
};

type PersistedTerminalSession = Omit<RegisteredTerminalSession, 'browserSocket'>;

type NotebookTerminalLifecycleHooks = {
  onSessionCreated?: (session: RegisteredTerminalSession) => void | Promise<void>;
  onSessionClosed?: (session: RegisteredTerminalSession) => void | Promise<void>;
};

type TerminalSessionScopeInput = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
  sessionId: string;
};

export class NotebookTerminalService {
  private readonly wsServer: WebSocketServer;
  private readonly sessions = new Map<string, RegisteredTerminalSession>();
  private configuredLifecycleHooks: NotebookTerminalLifecycleHooks = {};
  private readonly registeredLifecycleHooks = new Map<string, NotebookTerminalLifecycleHooks>();
  private readonly reconnectGraceMs: number;
  private readonly maxSessionsPerTask = 3;
  private readonly sessionTtlSeconds = 24 * 60 * 60;
  private readonly startupTimeoutMs: number;

  constructor(
    private readonly cache: CachePort,
    private readonly agentExecutionService: AgentExecutionService,
    options?: {
      startupTimeoutMs?: number;
      reconnectGraceMs?: number;
    },
  ) {
    this.wsServer = new WebSocketServer({ noServer: true });
    this.startupTimeoutMs = Math.max(25, options?.startupTimeoutMs ?? resolveDefaultTerminalStartupTimeoutMs());
    this.reconnectGraceMs = Math.min(
      MAX_TERMINAL_RECONNECT_GRACE_MS,
      Math.max(25, options?.reconnectGraceMs ?? resolveDefaultTerminalReconnectGraceMs()),
    );
  }

  configureLifecycleHooks(hooks: NotebookTerminalLifecycleHooks): void {
    this.configuredLifecycleHooks = hooks;
  }

  registerLifecycleHooks(key: string, hooks: NotebookTerminalLifecycleHooks): void {
    this.registeredLifecycleHooks.set(key, hooks);
  }

  private async notifySessionCreated(session: RegisteredTerminalSession): Promise<void> {
    await this.callLifecycleHooks(session, 'onSessionCreated');
  }

  private async notifySessionClosed(session: RegisteredTerminalSession): Promise<void> {
    await this.callLifecycleHooks(session, 'onSessionClosed');
  }

  private async callLifecycleHooks(
    session: RegisteredTerminalSession,
    hookName: keyof NotebookTerminalLifecycleHooks,
  ): Promise<void> {
    const hooks = [
      this.configuredLifecycleHooks,
      ...this.registeredLifecycleHooks.values(),
    ];
    for (const hooksEntry of hooks) {
      await hooksEntry[hookName]?.(session);
    }
  }

  private isOpenSocket(socket?: WebSocket): socket is WebSocket {
    return socket?.readyState === WebSocket.OPEN;
  }

  private sendToBrowserSocket(socket: WebSocket | undefined, payload: unknown): void {
    if (!this.isOpenSocket(socket)) return;
    socket.send(JSON.stringify(payload));
  }

  private closeBrowserSocket(
    socket: WebSocket | undefined,
    code: number,
    reason: string,
  ): void {
    if (!this.isOpenSocket(socket)) return;
    socket.close(code, reason);
  }

  private sessionCacheKey(sessionId: string): string {
    return `notebook_terminal_session:${sessionId}`;
  }

  private taskSessionsCacheKey(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
  }): string {
    return `notebook_terminal_task_sessions:${input.workspaceId}:${input.projectId}:${input.taskId}:${input.userId}`;
  }

  private isVisibleTaskSessionStatus(status: RegisteredTerminalSession['status']): boolean {
    return status === 'pending' || status === 'active' || status === 'disconnected' || status === 'failed';
  }

  private isLiveTaskSessionStatus(status: RegisteredTerminalSession['status']): boolean {
    return status === 'pending' || status === 'active' || status === 'disconnected';
  }

  private isLiveBindableSessionStatus(status: RegisteredTerminalSession['status']): boolean {
    return status === 'pending' || status === 'active' || status === 'disconnected';
  }

  private async reconcilePersistedSessionAfterServiceReload(
    session: RegisteredTerminalSession,
  ): Promise<RegisteredTerminalSession> {
    if (!this.isLiveBindableSessionStatus(session.status)) {
      return session;
    }

    const endedAt = new Date().toISOString();
    const reconciled: RegisteredTerminalSession = {
      ...session,
      status: 'failed',
      lastActivityAt: endedAt,
      endedAt,
      closeReason: TERMINAL_SERVICE_RELOAD_CLOSE_REASON,
      exitCode: session.exitCode ?? null,
      browserSocket: undefined,
      runtime: undefined,
      runtimeDispatchPromise: undefined,
      disconnectTimer: undefined,
      disconnectVersion: undefined,
      startupTimer: undefined,
      streamBound: false,
      bindVersion: undefined,
    };
    await this.persistSession(reconciled);
    void this.notifySessionClosed(reconciled);
    return reconciled;
  }

  private async loadResolvedPersistedSession(sessionId: string): Promise<RegisteredTerminalSession | null> {
    const persisted = await this.loadPersistedSession(sessionId);
    if (!persisted) return null;
    if (this.isLiveBindableSessionStatus(persisted.status)) {
      return this.reconcilePersistedSessionAfterServiceReload(persisted);
    }
    return persisted;
  }

  private async countTaskSessions(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
  }): Promise<number> {
    const sessions = await this.listSessionsForTask(input);
    return sessions.filter((session) => this.isLiveTaskSessionStatus(session.status)).length;
  }

  async hasLiveSessionsForTask(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
  }): Promise<boolean> {
    const sessions = await this.listSessionsForTask(input);
    return sessions.some((session) => this.isLiveTaskSessionStatus(session.status));
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
    await this.cache.set(this.sessionCacheKey(session.id), JSON.stringify(payload), this.sessionTtlSeconds);
  }

  private async readTaskSessionIds(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
  }): Promise<string[]> {
    const raw = await this.cache.get(this.taskSessionsCacheKey(input));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
    } catch {
      return [];
    }
  }

  private async writeTaskSessionIds(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
  }, sessionIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(sessionIds)];
    if (uniqueIds.length === 0) {
      await this.cache.del(this.taskSessionsCacheKey(input));
      return;
    }
    await this.cache.set(
      this.taskSessionsCacheKey(input),
      JSON.stringify(uniqueIds),
      this.sessionTtlSeconds,
    );
  }

  private async rememberTaskSession(session: RegisteredTerminalSession): Promise<void> {
    const sessionIds = await this.readTaskSessionIds(session);
    if (sessionIds.includes(session.id)) return;
    sessionIds.push(session.id);
    await this.writeTaskSessionIds(session, sessionIds);
  }

  private async forgetTaskSession(session: RegisteredTerminalSession): Promise<void> {
    const sessionIds = await this.readTaskSessionIds(session);
    if (!sessionIds.includes(session.id)) return;
    await this.writeTaskSessionIds(
      session,
      sessionIds.filter((sessionId) => sessionId !== session.id),
    );
  }

  private async loadPersistedSession(sessionId: string): Promise<RegisteredTerminalSession | null> {
    const raw = await this.cache.get(this.sessionCacheKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RegisteredTerminalSession;
    } catch {
      return null;
    }
  }

  private matchesSessionScope(
    session: Pick<RegisteredTerminalSession, 'workspaceId' | 'projectId' | 'taskId' | 'userId'>,
    input: Omit<TerminalSessionScopeInput, 'sessionId'>,
  ): boolean {
    return (
      session.workspaceId === input.workspaceId
      && session.projectId === input.projectId
      && session.taskId === input.taskId
      && session.userId === input.userId
    );
  }

  private async peekSession(sessionId: string): Promise<RegisteredTerminalSession | null> {
    return this.sessions.get(sessionId) ?? this.loadPersistedSession(sessionId);
  }

  private async peekSessionWithinScope(
    input: TerminalSessionScopeInput,
  ): Promise<RegisteredTerminalSession | null> {
    const session = await this.peekSession(input.sessionId);
    if (!session) return null;
    return this.matchesSessionScope(session, input) ? session : null;
  }

  private async resolveLiveBindableSession(sessionId: string): Promise<RegisteredTerminalSession | null> {
    const live = this.sessions.get(sessionId);
    if (live) {
      return this.isLiveBindableSessionStatus(live.status) ? live : null;
    }

    const persisted = await this.loadPersistedSession(sessionId);
    if (persisted && this.isLiveBindableSessionStatus(persisted.status)) {
      await this.reconcilePersistedSessionAfterServiceReload(persisted);
    }
    return null;
  }

  private clearStartupTimer(session: RegisteredTerminalSession): void {
    if (!session.startupTimer) return;
    clearTimeout(session.startupTimer);
    session.startupTimer = undefined;
  }

  private bumpDisconnectVersion(session: RegisteredTerminalSession): number {
    session.disconnectVersion = (session.disconnectVersion ?? 0) + 1;
    return session.disconnectVersion;
  }

  private nextBindVersion(session: RegisteredTerminalSession): number {
    session.bindVersion = (session.bindVersion ?? 0) + 1;
    return session.bindVersion;
  }

  private isLatestBindVersion(session: RegisteredTerminalSession, bindVersion: number): boolean {
    return (session.bindVersion ?? 0) === bindVersion;
  }

  private clearDisconnectTimer(session: RegisteredTerminalSession): void {
    if (!session.disconnectTimer) return;
    clearTimeout(session.disconnectTimer);
    session.disconnectTimer = undefined;
    this.bumpDisconnectVersion(session);
  }

  private bindRuntimeStream(session: RegisteredTerminalSession): void {
    if (!session.runtime || session.streamBound) {
      return;
    }
    const runtime = session.runtime;
    session.streamBound = true;
    void (async () => {
      for await (const event of runtime.stream) {
        debugTerminal('runtime_event', {
          session_id: session.id,
          type: event.type,
        });
        if (event.type === 'started') {
          this.clearStartupTimer(session);
          if (this.isOpenSocket(session.browserSocket)) {
            session.status = 'active';
          }
        }
        if (event.type === 'output') {
          this.clearStartupTimer(session);
          if (this.isOpenSocket(session.browserSocket)) {
            session.status = 'active';
          }
        }
        if (event.type === 'exited' || event.type === 'error') {
          this.clearStartupTimer(session);
          session.status = event.type === 'exited' ? 'closed' : 'failed';
          session.exitCode = typeof event.exit_code === 'number' ? event.exit_code : null;
          session.closeReason = event.type === 'exited'
            ? 'process_exited'
            : (event.error_message?.trim() || 'runtime_error');
        }
        session.lastActivityAt = new Date().toISOString();
        await this.persistSession(session);
        this.sendToBrowserSocket(session.browserSocket, event);
      }
      this.closeBrowserSocket(session.browserSocket, 1000, 'terminal_complete');
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
      this.closeBrowserSocket(session.browserSocket, 1011, 'terminal_stream_failed');
      this.finishSession(session.id, 'failed', 'terminal_stream_failed');
    });
  }

  private async ensureSessionRuntime(session: RegisteredTerminalSession): Promise<TerminalRuntime> {
    if (session.runtime) {
      this.bindRuntimeStream(session);
      return session.runtime;
    }
    if (!session.runtimeDispatchPromise) {
      const dispatchPromise = this.agentExecutionService.dispatchTerminalSession({
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
      }).then((runtime) => {
        if (!this.sessions.has(session.id) || session.status === 'closed' || session.status === 'failed') {
          runtime.close();
          throw new Error('terminal_dispatch_abandoned');
        }
        if (!session.runtime) {
          session.runtime = runtime;
          this.armStartupTimer(session);
        }
        this.bindRuntimeStream(session);
        return session.runtime;
      }).finally(() => {
        if (session.runtimeDispatchPromise === dispatchPromise) {
          session.runtimeDispatchPromise = undefined;
        }
      });
      session.runtimeDispatchPromise = dispatchPromise;
    }
    const runtime = await session.runtimeDispatchPromise;
    this.bindRuntimeStream(session);
    return runtime;
  }

  private scheduleBrowserDisconnectResolution(
    session: RegisteredTerminalSession,
    ws: WebSocket,
    options: {
      closeReason: string;
      terminalStatus: 'closed' | 'failed';
      terminalCloseReason: string;
    },
  ): void {
    if (session.browserSocket !== ws) {
      return;
    }
    session.browserSocket = undefined;
    if (!session.runtime || session.status === 'closed' || session.status === 'failed') {
      return;
    }
    this.clearDisconnectTimer(session);
    const disconnectVersion = this.bumpDisconnectVersion(session);
    session.status = 'disconnected';
    session.lastActivityAt = new Date().toISOString();
    session.closeReason = options.closeReason;
    void this.persistSession(session);
    session.disconnectTimer = setTimeout(() => {
      if ((session.disconnectVersion ?? 0) !== disconnectVersion) {
        return;
      }
      if (session.browserSocket || !session.runtime || session.status !== 'disconnected') {
        return;
      }
      session.runtime?.close();
      this.finishSession(session.id, options.terminalStatus, options.terminalCloseReason);
    }, this.reconnectGraceMs);
  }

  private armStartupTimer(session: RegisteredTerminalSession): void {
    if (session.status !== 'pending') return;
    if (!session.runtime) return;
    if (session.startupTimer) return;
    session.startupTimer = setTimeout(() => {
      session.startupTimer = undefined;
      if (!this.sessions.has(session.id)) return;
      if (session.status !== 'pending') return;
      this.sendToBrowserSocket(session.browserSocket, {
        type: 'error',
        session_id: session.id,
        error_code: 'TERMINAL_START_TIMEOUT',
        error_message: 'terminal_start_timeout',
      });
      this.closeBrowserSocket(session.browserSocket, 1011, 'terminal_start_timeout');
      session.runtime?.close();
      this.finishSession(session.id, 'failed', 'terminal_start_timeout');
    }, this.startupTimeoutMs);
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
    if (await this.countTaskSessions(input) >= this.maxSessionsPerTask) {
      throw new Error('task_terminal_session_limit_reached');
    }
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
    await this.rememberTaskSession(this.sessions.get(sessionId)!);
    await this.notifySessionCreated(this.sessions.get(sessionId)!);

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

  async issueReconnectTicket(sessionId: string): Promise<{
    wsPath: string;
    wsTicket: string;
  } | null> {
    const session = await this.resolveLiveBindableSession(sessionId);
    if (!session) return null;
    const issued = await issueInternalTicket(this.cache, {
      purpose: 'terminal_ws_access',
      userId: session.userId,
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      prefix: 'term',
      ttlMs: 10 * 60 * 1000,
      maxUses: 3,
      payload: {
        task_id: session.taskId,
        terminal_session_id: session.id,
      },
    });
    return {
      wsPath: `/api/v1/workspaces/${encodeURIComponent(session.workspaceId)}`
        + `/projects/${encodeURIComponent(session.projectId)}`
        + `/tasks/${encodeURIComponent(session.taskId)}`
        + `/terminal/ws?session_id=${encodeURIComponent(session.id)}&ticket=${encodeURIComponent(issued.ticket)}`,
      wsTicket: issued.ticket,
    };
  }

  async getSession(sessionId: string): Promise<RegisteredTerminalSession | null> {
    const live = this.sessions.get(sessionId);
    if (live) return live;
    return this.loadResolvedPersistedSession(sessionId);
  }

  async getSessionWithinScope(input: TerminalSessionScopeInput): Promise<RegisteredTerminalSession | null> {
    const scoped = await this.peekSessionWithinScope(input);
    if (!scoped) return null;
    return this.getSession(input.sessionId);
  }

  async listSessionsForTask(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
  }): Promise<RegisteredTerminalSession[]> {
    const sessions: RegisteredTerminalSession[] = [];
    const sessionIds = await this.readTaskSessionIds(input);
    const seen = new Set<string>();
    const retainedIds: string[] = [];

    for (const sessionId of sessionIds) {
      const session = await this.getSession(sessionId);
      if (
        !session
        || session.workspaceId !== input.workspaceId
        || session.projectId !== input.projectId
        || session.taskId !== input.taskId
        || session.userId !== input.userId
      ) {
        continue;
      }
      retainedIds.push(session.id);
      seen.add(session.id);
      if (this.isVisibleTaskSessionStatus(session.status)) {
        sessions.push(session);
      }
    }

    for (const session of this.sessions.values()) {
      if (
        session.workspaceId === input.workspaceId
        && session.projectId === input.projectId
        && session.taskId === input.taskId
        && session.userId === input.userId
      ) {
        if (seen.has(session.id)) continue;
        retainedIds.push(session.id);
        seen.add(session.id);
        if (this.isVisibleTaskSessionStatus(session.status)) {
          sessions.push(session);
        }
      }
    }

    sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const sortedRetainedIds = retainedIds
      .map((sessionId) => sessions.find((session) => session.id === sessionId))
      .filter((session): session is RegisteredTerminalSession => Boolean(session))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((session) => session.id);
    await this.writeTaskSessionIds(input, sortedRetainedIds);
    return sessions;
  }

  async deleteSession(input: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
    sessionId: string;
  }): Promise<boolean> {
    const liveSession = this.sessions.get(input.sessionId);
    if (liveSession && !this.matchesSessionScope(liveSession, input)) {
      return false;
    }
    if (!liveSession) {
      const scopedPersisted = await this.peekSessionWithinScope(input);
      if (!scopedPersisted) return false;
    }
    const session = liveSession ?? await this.loadResolvedPersistedSession(input.sessionId);
    if (!session) return false;
    if (!this.matchesSessionScope(session, input)) {
      return false;
    }
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = undefined;
    }
    this.clearStartupTimer(session);
    if (liveSession) {
      session.runtime?.close();
    } else if (session.closeReason === TERMINAL_SERVICE_RELOAD_CLOSE_REASON) {
      const closeTerminalSession = (
        this.agentExecutionService as Partial<AgentExecutionService> & {
          closeTerminalSession?: (request: {
            workspaceId: string;
            projectId: string;
            sessionId: string;
            agentId: string;
            terminalSessionId: string;
          }) => Promise<unknown>;
        }
      ).closeTerminalSession;
      if (typeof closeTerminalSession === 'function') {
        await closeTerminalSession.call(this.agentExecutionService, {
          workspaceId: session.workspaceId,
          projectId: session.projectId,
          sessionId: session.runnerSessionId,
          agentId: session.agentId,
          terminalSessionId: session.id,
        }).catch(() => undefined);
      }
    }
    this.closeBrowserSocket(session.browserSocket, 1000, 'terminal_closed_by_user');
    if (liveSession && this.sessions.has(session.id)) {
      this.finishSession(session.id, 'closed', 'ended_by_user');
    }
    this.sessions.delete(session.id);
    await this.cache.del(this.sessionCacheKey(session.id));
    await this.forgetTaskSession(session);
    return true;
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
      void this.resolveLiveBindableSession(sessionId).then((registered) => {
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
    const bindVersion = this.nextBindVersion(session);
    this.clearDisconnectTimer(session);
    this.closeBrowserSocket(session.browserSocket, 1012, 'terminal_replaced');
    session.browserSocket = ws;
    if (session.runtime) {
      session.status = session.status === 'failed' || session.status === 'closed'
        ? session.status
        : 'active';
      this.clearStartupTimer(session);
    } else {
      session.status = 'pending';
    }
    session.lastActivityAt = new Date().toISOString();

    ws.on('message', (raw) => {
      if (session.browserSocket !== ws || !session.runtime) return;
      this.handleBrowserMessage(session, session.runtime, raw);
    });
    ws.on('close', (_code, reasonBuffer) => {
      const reason = reasonBuffer.toString();
      if (reason === 'terminal_replaced') {
        return;
      }
      this.scheduleBrowserDisconnectResolution(session, ws, {
        closeReason: 'browser_disconnected',
        terminalStatus: 'closed',
        terminalCloseReason: 'browser_disconnected_timeout',
      });
    });
    ws.on('error', () => {
      this.scheduleBrowserDisconnectResolution(session, ws, {
        closeReason: 'browser_socket_error',
        terminalStatus: 'failed',
        terminalCloseReason: 'browser_socket_error',
      });
    });

    await this.persistSession(session);

    if (!this.isLatestBindVersion(session, bindVersion)) {
      return;
    }

    const hadRuntimeBeforeBind = Boolean(session.runtime);
    try {
      await this.ensureSessionRuntime(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'terminal_dispatch_failed';
      if (!this.isLatestBindVersion(session, bindVersion) || message === 'terminal_dispatch_abandoned') {
        return;
      }
      debugTerminal('dispatch_failed', {
        session_id: session.id,
        task_id: session.taskId,
        agent_id: session.agentId,
        runner_session_id: session.runnerSessionId,
        error: message,
      });
      this.sendToBrowserSocket(session.browserSocket, {
        type: 'error',
        session_id: session.id,
        error_code: 'TERMINAL_DISPATCH_FAILED',
        error_message: message,
      });
      this.closeBrowserSocket(session.browserSocket, 1011, 'terminal_dispatch_failed');
      this.finishSession(session.id, 'failed', message);
      return;
    }

    if (!this.isLatestBindVersion(session, bindVersion)) {
      return;
    }
    if (hadRuntimeBeforeBind) {
      this.sendToBrowserSocket(session.browserSocket, {
        type: 'started',
        session_id: session.id,
        cols: session.cols,
        rows: session.rows,
      });
    }
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
    this.clearDisconnectTimer(session);
    this.clearStartupTimer(session);
    session.status = status;
    const endedAt = new Date().toISOString();
    session.lastActivityAt = endedAt;
    session.endedAt = endedAt;
    if (closeReason?.trim()) session.closeReason = closeReason.trim();
    if (exitCode !== undefined) session.exitCode = exitCode;
    session.browserSocket = undefined;
    session.runtime = undefined;
    session.runtimeDispatchPromise = undefined;
    session.streamBound = false;
    void this.persistSession(session);
    if (status === 'closed') {
      void this.forgetTaskSession(session);
    }
    void this.notifySessionClosed(session);
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.clearDisconnectTimer(session);
      this.clearStartupTimer(session);
      this.closeBrowserSocket(session.browserSocket, 1001, 'server_shutdown');
      session.runtime?.close();
      session.browserSocket = undefined;
      session.runtime = undefined;
      session.runtimeDispatchPromise = undefined;
      session.streamBound = false;
    }
    this.sessions.clear();
    await new Promise<void>((resolve) => {
      this.wsServer.close(() => resolve());
    });
  }
}
