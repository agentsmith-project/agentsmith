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
const DEFAULT_TERMINAL_REPLAY_MAX_CHUNKS = 500;
const DEFAULT_TERMINAL_REPLAY_MAX_BYTES = 256 * 1024;
const DEFAULT_TERMINAL_REPLAY_TTL_MS = 10 * 60_000;
const MAX_QUEUED_BROWSER_EVENTS = 1_000;
const AGENT_TASK_TERMINAL_RECONNECT_VIEW = 'agent_task.task_terminal';

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
  runtimeDispatchContext?: Record<string, unknown>;
  status: 'pending' | 'active' | 'disconnected' | 'closed' | 'failed';
  browserSocket?: WebSocket;
  runtime?: TerminalRuntime;
  runtimeReady?: boolean;
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
  browserHandshakeComplete?: boolean;
  browserReplayInProgress?: boolean;
  queuedBrowserEvents?: TerminalBrowserPayload[];
  outputReplayRing?: TerminalOutputReplayEntry[];
  outputReplayRingBytes?: number;
  nextOutputSeq?: number;
};

type TerminalRuntimeEvent = {
  type: 'started' | 'output' | 'exited' | 'error';
  terminal_session_id: string;
  cols?: number;
  rows?: number;
  chunk?: string;
  exit_code?: number | null;
  signal?: string | null;
  error_code?: string;
  error_message?: string;
};

type TerminalBrowserPayload = Record<string, unknown> & {
  type: string;
  terminal_session_id?: string;
};

type TerminalOutputReplayEntry = {
  seq: number;
  chunk: string;
  byteLength: number;
  recordedAtMs: number;
};

type TerminalReplayStatus = 'complete' | 'partial' | 'unavailable';

type TerminalReplayPlan = {
  status: TerminalReplayStatus;
  gap: boolean;
  afterSeq: number | null;
  earliestSeq: number | null;
  latestSeq: number;
  nextSeq: number;
  entries: TerminalOutputReplayEntry[];
  errorCode?: 'future_after_seq';
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
  beforeSessionRuntimeDispatch?: (session: RegisteredTerminalSession) => void | Promise<void>;
  onSessionClosed?: (session: RegisteredTerminalSession) => void | Promise<void>;
};

type TerminalSessionScopeInput = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
  sessionId: string;
};

export type NotebookTerminalAuthorizationInput = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
  terminalSessionId: string;
  requiredPermission: 'project:agent_task:terminal';
};

export type NotebookTerminalAuthorizationHook = (
  input: NotebookTerminalAuthorizationInput,
) => boolean | Promise<boolean>;

type NotebookTerminalAuthorizationHooks = {
  authorizeTerminalUse?: NotebookTerminalAuthorizationHook;
};

export class NotebookTerminalService {
  private readonly wsServer: WebSocketServer;
  private readonly sessions = new Map<string, RegisteredTerminalSession>();
  private configuredLifecycleHooks: NotebookTerminalLifecycleHooks = {};
  private readonly registeredLifecycleHooks = new Map<string, NotebookTerminalLifecycleHooks>();
  private configuredAuthorizationHooks: NotebookTerminalAuthorizationHooks = {};
  private readonly reconnectGraceMs: number;
  private readonly maxSessionsPerTask = 3;
  private readonly sessionTtlSeconds = 24 * 60 * 60;
  private readonly startupTimeoutMs: number;
  private readonly replayMaxChunks: number;
  private readonly replayMaxBytes: number;
  private readonly replayTtlMs: number;

  constructor(
    private readonly cache: CachePort,
    private readonly agentExecutionService: AgentExecutionService,
    options?: {
      startupTimeoutMs?: number;
      reconnectGraceMs?: number;
      replayMaxChunks?: number;
      replayMaxBytes?: number;
      replayTtlMs?: number;
      authorizeTerminalUse?: NotebookTerminalAuthorizationHook;
    },
  ) {
    this.wsServer = new WebSocketServer({ noServer: true });
    this.startupTimeoutMs = Math.max(25, options?.startupTimeoutMs ?? resolveDefaultTerminalStartupTimeoutMs());
    this.reconnectGraceMs = Math.min(
      MAX_TERMINAL_RECONNECT_GRACE_MS,
      Math.max(25, options?.reconnectGraceMs ?? resolveDefaultTerminalReconnectGraceMs()),
    );
    this.replayMaxChunks = Math.max(
      1,
      Math.floor(options?.replayMaxChunks ?? DEFAULT_TERMINAL_REPLAY_MAX_CHUNKS),
    );
    this.replayMaxBytes = Math.max(
      1,
      Math.floor(options?.replayMaxBytes ?? DEFAULT_TERMINAL_REPLAY_MAX_BYTES),
    );
    this.replayTtlMs = Math.max(
      25,
      Math.floor(options?.replayTtlMs ?? DEFAULT_TERMINAL_REPLAY_TTL_MS),
    );
    if (options?.authorizeTerminalUse) {
      this.configuredAuthorizationHooks = {
        authorizeTerminalUse: options.authorizeTerminalUse,
      };
    }
  }

  configureLifecycleHooks(hooks: NotebookTerminalLifecycleHooks): void {
    this.configuredLifecycleHooks = hooks;
  }

  configureAuthorizationHooks(hooks: NotebookTerminalAuthorizationHooks): void {
    this.configuredAuthorizationHooks = hooks;
  }

  registerLifecycleHooks(key: string, hooks: NotebookTerminalLifecycleHooks): void {
    this.registeredLifecycleHooks.set(key, hooks);
  }

  private async notifySessionCreated(session: RegisteredTerminalSession): Promise<void> {
    await this.callLifecycleHooks(session, 'onSessionCreated');
  }

  private async notifyBeforeSessionRuntimeDispatch(session: RegisteredTerminalSession): Promise<void> {
    await this.callLifecycleHooks(session, 'beforeSessionRuntimeDispatch');
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

  private sendTerminalErrorAndClose(
    socket: WebSocket | undefined,
    sessionId: string,
    errorCode: string,
    errorMessage: string,
    closeReason = errorCode,
  ): void {
    this.sendToBrowserSocket(socket, {
      type: 'terminal.error',
      terminal_session_id: sessionId,
      error_code: errorCode,
      error_message: errorMessage,
    });
    this.closeBrowserSocket(socket, 1008, closeReason);
  }

  private canFailUnestablishedSession(session: RegisteredTerminalSession): boolean {
    return (
      !session.runtime
      && !session.runtimeDispatchPromise
      && session.status !== 'closed'
      && session.status !== 'failed'
    );
  }

  private sendTerminalErrorFailingUnestablishedSessionAndClose(
    session: RegisteredTerminalSession,
    socket: WebSocket | undefined,
    errorCode: string,
    errorMessage: string,
    closeReason = errorCode,
  ): void {
    this.sendToBrowserSocket(socket, {
      type: 'terminal.error',
      terminal_session_id: session.id,
      error_code: errorCode,
      error_message: errorMessage,
    });
    if (this.canFailUnestablishedSession(session)) {
      this.finishSession(session.id, 'failed', closeReason);
    }
    this.closeBrowserSocket(socket, 1008, closeReason);
  }

  private isTerminalInputEnabled(session: RegisteredTerminalSession): boolean {
    return Boolean(session.runtime)
      && session.runtimeReady === true
      && session.status !== 'closed'
      && session.status !== 'failed';
  }

  private buildTerminalAuthorizationInput(
    session: RegisteredTerminalSession,
  ): NotebookTerminalAuthorizationInput {
    return {
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      taskId: session.taskId,
      userId: session.userId,
      terminalSessionId: session.id,
      requiredPermission: 'project:agent_task:terminal',
    };
  }

  private isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
    return typeof (value as Promise<T>)?.then === 'function';
  }

  private isTerminalUseAuthorized(session: RegisteredTerminalSession): boolean | Promise<boolean> {
    const authorizeTerminalUse = this.configuredAuthorizationHooks.authorizeTerminalUse;
    if (!authorizeTerminalUse) {
      return true;
    }
    try {
      return authorizeTerminalUse(this.buildTerminalAuthorizationInput(session));
    } catch {
      return false;
    }
  }

  private denyTerminalUse(
    session: RegisteredTerminalSession,
    socket: WebSocket | undefined,
  ): void {
    this.sendTerminalErrorAndClose(
      socket,
      session.id,
      'terminal_permission_revoked',
      'terminal_permission_revoked',
    );
  }

  private ensureTerminalUseAuthorized(
    session: RegisteredTerminalSession,
    socket: WebSocket | undefined,
  ): boolean | Promise<boolean> {
    const authorized = this.isTerminalUseAuthorized(session);
    if (!this.isPromiseLike(authorized)) {
      if (!authorized) {
        this.denyTerminalUse(session, socket);
      }
      return authorized;
    }
    return authorized.then(
      (granted) => {
        if (!granted) {
          this.denyTerminalUse(session, socket);
        }
        return granted;
      },
      () => {
        this.denyTerminalUse(session, socket);
        return false;
      },
    );
  }

  private ensureTerminalInputAccepted(
    session: RegisteredTerminalSession,
    socket: WebSocket | undefined,
  ): boolean | Promise<boolean> {
    if (!this.isTerminalInputEnabled(session)) {
      this.sendTerminalErrorAndClose(
        socket,
        session.id,
        'terminal_not_ready',
        'terminal_not_ready',
      );
      return false;
    }
    return this.ensureTerminalUseAuthorized(session, socket);
  }

  private queueOrSendBrowserPayload(
    session: RegisteredTerminalSession,
    payload: TerminalBrowserPayload,
  ): void {
    if (!this.isOpenSocket(session.browserSocket)) return;
    if (session.browserReplayInProgress) {
      const queued = session.queuedBrowserEvents ?? [];
      queued.push(payload);
      if (queued.length > MAX_QUEUED_BROWSER_EVENTS) {
        queued.splice(0, queued.length - MAX_QUEUED_BROWSER_EVENTS);
      }
      session.queuedBrowserEvents = queued;
      return;
    }
    if (!session.browserHandshakeComplete) {
      return;
    }
    this.sendToBrowserSocket(session.browserSocket, payload);
  }

  private flushQueuedBrowserPayloads(session: RegisteredTerminalSession): void {
    if (!this.isOpenSocket(session.browserSocket) || !session.browserHandshakeComplete) {
      session.queuedBrowserEvents = [];
      return;
    }
    const queued = session.queuedBrowserEvents ?? [];
    session.queuedBrowserEvents = [];
    for (const payload of queued) {
      this.sendToBrowserSocket(session.browserSocket, payload);
    }
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
      runtimeReady: false,
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
      ...(session.runtimeDispatchContext ? { runtimeDispatchContext: session.runtimeDispatchContext } : {}),
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

  private isCurrentBrowserBind(
    session: RegisteredTerminalSession,
    socket: WebSocket | undefined,
    bindVersion: number,
  ): socket is WebSocket {
    return Boolean(socket)
      && this.isLatestBindVersion(session, bindVersion)
      && session.browserSocket === socket;
  }

  private trimReplayRing(session: RegisteredTerminalSession): void {
    const ring = session.outputReplayRing ?? [];
    if (ring.length === 0) {
      session.outputReplayRing = [];
      session.outputReplayRingBytes = 0;
      return;
    }

    const expiresBefore = Date.now() - this.replayTtlMs;
    while (ring.length > 0 && ring[0]!.recordedAtMs < expiresBefore) {
      const removed = ring.shift()!;
      session.outputReplayRingBytes = Math.max(0, (session.outputReplayRingBytes ?? 0) - removed.byteLength);
    }
    while (ring.length > this.replayMaxChunks) {
      const removed = ring.shift()!;
      session.outputReplayRingBytes = Math.max(0, (session.outputReplayRingBytes ?? 0) - removed.byteLength);
    }
    while (ring.length > 0 && (session.outputReplayRingBytes ?? 0) > this.replayMaxBytes) {
      const removed = ring.shift()!;
      session.outputReplayRingBytes = Math.max(0, (session.outputReplayRingBytes ?? 0) - removed.byteLength);
    }
    session.outputReplayRing = ring;
  }

  private recordTerminalOutput(
    session: RegisteredTerminalSession,
    event: TerminalRuntimeEvent,
  ): TerminalBrowserPayload {
    const seq = session.nextOutputSeq ?? 1;
    session.nextOutputSeq = seq + 1;
    const chunk = typeof event.chunk === 'string' ? event.chunk : '';
    const byteLength = Buffer.byteLength(chunk, 'utf-8');

    if (byteLength <= this.replayMaxBytes) {
      const ring = session.outputReplayRing ?? [];
      ring.push({
        seq,
        chunk,
        byteLength,
        recordedAtMs: Date.now(),
      });
      session.outputReplayRing = ring;
      session.outputReplayRingBytes = (session.outputReplayRingBytes ?? 0) + byteLength;
      this.trimReplayRing(session);
    } else {
      session.outputReplayRing = [];
      session.outputReplayRingBytes = 0;
    }

    return {
      type: 'terminal.output',
      terminal_session_id: session.id,
      chunk,
      seq,
    };
  }

  private isCanonicalRuntimeEventForSession(
    session: RegisteredTerminalSession,
    event: TerminalRuntimeEvent,
  ): boolean {
    const eventSessionId = typeof event.terminal_session_id === 'string'
      ? event.terminal_session_id.trim()
      : '';
    return eventSessionId === session.id
      && !Object.prototype.hasOwnProperty.call(event, 'session_id');
  }

  private failRuntimeSessionMismatch(session: RegisteredTerminalSession): void {
    const socket = session.browserSocket;
    this.sendToBrowserSocket(socket, {
      type: 'terminal.error',
      terminal_session_id: session.id,
      error_code: 'TERMINAL_RUNTIME_SESSION_MISMATCH',
      error_message: 'terminal_runtime_session_mismatch',
    });
    this.closeBrowserSocket(socket, 1011, 'terminal_runtime_session_mismatch');
    session.runtime?.close();
    this.finishSession(session.id, 'failed', 'terminal_runtime_session_mismatch');
  }

  private buildReplayPlan(
    session: RegisteredTerminalSession,
    afterSeq: number | null,
  ): TerminalReplayPlan {
    this.trimReplayRing(session);
    const ring = session.outputReplayRing ?? [];
    const latestSeq = (session.nextOutputSeq ?? 1) - 1;
    const nextSeq = latestSeq + 1;
    const earliestSeq = ring[0]?.seq ?? null;

    if (latestSeq === 0) {
      return {
        status: 'complete',
        gap: false,
        afterSeq,
        earliestSeq: null,
        latestSeq,
        nextSeq,
        entries: [],
      };
    }

    if (ring.length === 0 || earliestSeq === null) {
      return {
        status: 'unavailable',
        gap: true,
        afterSeq,
        earliestSeq: null,
        latestSeq,
        nextSeq,
        entries: [],
      };
    }

    if (afterSeq !== null && afterSeq > latestSeq) {
      return {
        status: 'unavailable',
        gap: true,
        afterSeq,
        earliestSeq,
        latestSeq,
        nextSeq,
        entries: [],
        errorCode: 'future_after_seq',
      };
    }

    if (afterSeq === null) {
      const gap = earliestSeq > 1;
      return {
        status: gap ? 'partial' : 'complete',
        gap,
        afterSeq,
        earliestSeq,
        latestSeq,
        nextSeq,
        entries: [...ring],
      };
    }

    if (afterSeq < earliestSeq - 1) {
      return {
        status: 'partial',
        gap: true,
        afterSeq,
        earliestSeq,
        latestSeq,
        nextSeq,
        entries: [...ring],
      };
    }

    return {
      status: 'complete',
      gap: false,
      afterSeq,
      earliestSeq,
      latestSeq,
      nextSeq,
      entries: ring.filter((entry) => entry.seq > afterSeq),
    };
  }

  private sendReplay(
    session: RegisteredTerminalSession,
    socket: WebSocket | undefined,
    replay: TerminalReplayPlan,
  ): void {
    this.sendToBrowserSocket(socket, {
      type: 'terminal.replay_start',
      terminal_session_id: session.id,
      status: replay.status,
      gap: replay.gap,
      after_seq: replay.afterSeq,
      earliest_seq: replay.earliestSeq,
      latest_seq: replay.latestSeq,
      ...(replay.status === 'unavailable' ? { next_seq: replay.nextSeq } : {}),
      ...(replay.errorCode ? { error_code: replay.errorCode } : {}),
    });
    for (const entry of replay.entries) {
      this.sendToBrowserSocket(socket, {
        type: 'terminal.output',
        terminal_session_id: session.id,
        chunk: entry.chunk,
        seq: entry.seq,
      });
    }
    this.sendToBrowserSocket(socket, {
      type: 'terminal.replay_end',
      terminal_session_id: session.id,
      status: replay.status,
      gap: replay.gap,
      latest_seq: replay.latestSeq,
      ...(replay.status === 'unavailable' ? { next_seq: replay.nextSeq } : {}),
      input_enabled: this.isTerminalInputEnabled(session),
    });
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
        if (!this.isCanonicalRuntimeEventForSession(session, event)) {
          this.failRuntimeSessionMismatch(session);
          return;
        }
        const inputWasEnabled = this.isTerminalInputEnabled(session);
        debugTerminal('runtime_event', {
          terminal_session_id: session.id,
          type: event.type,
        });
        if (event.type === 'started') {
          this.clearStartupTimer(session);
          session.runtimeReady = true;
          if (this.isOpenSocket(session.browserSocket) && session.browserHandshakeComplete) {
            session.status = 'active';
          }
        }
        if (event.type === 'output') {
          this.clearStartupTimer(session);
          session.runtimeReady = true;
          if (this.isOpenSocket(session.browserSocket) && session.browserHandshakeComplete) {
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
          session.runtimeReady = false;
        }
        session.lastActivityAt = new Date().toISOString();
        await this.persistSession(session);
        const inputBecameEnabled = !inputWasEnabled && this.isTerminalInputEnabled(session);
        if (inputBecameEnabled || event.type === 'started') {
          this.queueOrSendBrowserPayload(session, {
            type: 'terminal.state',
            terminal_session_id: session.id,
            state: 'ready',
            status: 'active',
            input_enabled: true,
            ...(typeof event.cols === 'number' ? { cols: event.cols } : {}),
            ...(typeof event.rows === 'number' ? { rows: event.rows } : {}),
          });
        }
        if (event.type === 'output') {
          this.queueOrSendBrowserPayload(session, this.recordTerminalOutput(session, event));
        } else if (event.type === 'exited') {
          this.queueOrSendBrowserPayload(session, {
            type: 'terminal.state',
            terminal_session_id: session.id,
            state: 'closed',
            status: 'closed',
            input_enabled: false,
            exit_code: typeof event.exit_code === 'number' ? event.exit_code : null,
            signal: event.signal ?? null,
          });
        } else if (event.type === 'error') {
          this.queueOrSendBrowserPayload(session, {
            type: 'terminal.error',
            terminal_session_id: session.id,
            error_code: event.error_code,
            error_message: event.error_message ?? 'runtime_error',
          });
        } else {
          // `started` is represented by the terminal.state ready frame above.
        }
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
        terminal_session_id: session.id,
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
      const dispatchPromise = (async () => {
        await this.notifyBeforeSessionRuntimeDispatch(session);
        if (!this.sessions.has(session.id) || session.status === 'closed' || session.status === 'failed') {
          throw new Error('terminal_dispatch_abandoned');
        }
        return this.agentExecutionService.dispatchTerminalSession({
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
      })().then((runtime) => {
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
      unestablishedTerminalCloseReason?: string;
    },
  ): void {
    if (session.browserSocket !== ws) {
      return;
    }
    session.browserSocket = undefined;
    session.browserHandshakeComplete = false;
    session.browserReplayInProgress = false;
    session.queuedBrowserEvents = [];
    if (session.status === 'closed' || session.status === 'failed') {
      return;
    }
    if (!session.runtime) {
      this.finishSession(
        session.id,
        options.terminalStatus,
        options.unestablishedTerminalCloseReason ?? options.terminalCloseReason,
      );
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
      if (
        (session.browserSocket && session.browserHandshakeComplete)
        || !session.runtime
        || session.status !== 'disconnected'
      ) {
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
        type: 'terminal.error',
        terminal_session_id: session.id,
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
    runtimeDispatchContext?: Record<string, unknown>;
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
      ...(input.runtimeDispatchContext ? { runtimeDispatchContext: input.runtimeDispatchContext } : {}),
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
        + `/terminal/ws?terminal_session_id=${encodeURIComponent(sessionId)}&ticket=${encodeURIComponent(issued.ticket)}`,
      wsTicket: issued.ticket,
    };
  }

  async issueReconnectTicket(sessionId: string): Promise<{
    wsPath: string;
    wsTicket: string;
  } | null> {
    const session = await this.resolveLiveBindableSession(sessionId);
    if (!session) return null;
    if (!await Promise.resolve(this.isTerminalUseAuthorized(session))) return null;
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
        + `/terminal/ws?terminal_session_id=${encodeURIComponent(session.id)}&ticket=${encodeURIComponent(issued.ticket)}`,
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
            executionContext?: Record<string, unknown>;
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
          ...(session.executionContext ? { executionContext: session.executionContext } : {}),
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
    const sessionId = url.searchParams.get('terminal_session_id')?.trim() ?? '';
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
        void Promise.resolve(this.isTerminalUseAuthorized(registered)).then((authorized) => {
          if (!authorized) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
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
    }).catch(() => {
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  }

  private async bindBrowserSocket(ws: WebSocket, session: RegisteredTerminalSession): Promise<void> {
    debugTerminal('bind_browser_socket', {
      terminal_session_id: session.id,
      task_id: session.taskId,
      agent_runner_id: session.agentId,
      runner_session_id: session.runnerSessionId,
    });
    const bindVersion = this.nextBindVersion(session);
    this.closeBrowserSocket(session.browserSocket, 1012, 'terminal_replaced');
    session.browserSocket = ws;
    session.browserHandshakeComplete = false;
    session.browserReplayInProgress = false;
    session.queuedBrowserEvents = [];
    if (!session.runtime && session.status !== 'closed' && session.status !== 'failed') {
      session.status = 'pending';
    }
    session.lastActivityAt = new Date().toISOString();

    ws.on('message', (raw) => {
      if (!this.isCurrentBrowserBind(session, ws, bindVersion)) return;
      void this.handleBrowserMessage(session, raw, bindVersion).catch(() => {
        this.sendTerminalErrorAndClose(
          ws,
          session.id,
          'terminal_message_failed',
          'terminal_message_failed',
        );
      });
    });
    ws.on('close', (_code, reasonBuffer) => {
      const reason = reasonBuffer.toString();
      if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
        return;
      }
      if (reason === 'terminal_replaced') {
        return;
      }
      const wasHandshakeComplete = session.browserHandshakeComplete;
      session.browserHandshakeComplete = false;
      session.browserReplayInProgress = false;
      session.queuedBrowserEvents = [];
      if (!wasHandshakeComplete) {
        if (session.status === 'disconnected' && session.runtime) {
          if (session.browserSocket === ws) {
            session.browserSocket = undefined;
          }
          return;
        }
        if (this.canFailUnestablishedSession(session)) {
          this.finishSession(session.id, 'closed', 'browser_disconnected_before_handshake');
          return;
        }
      }
      this.scheduleBrowserDisconnectResolution(session, ws, {
        closeReason: 'browser_disconnected',
        terminalStatus: 'closed',
        terminalCloseReason: 'browser_disconnected_timeout',
        unestablishedTerminalCloseReason: 'browser_disconnected_before_runtime',
      });
    });
    ws.on('error', () => {
      if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
        return;
      }
      const wasHandshakeComplete = session.browserHandshakeComplete;
      session.browserHandshakeComplete = false;
      session.browserReplayInProgress = false;
      session.queuedBrowserEvents = [];
      if (!wasHandshakeComplete) {
        if (session.status === 'disconnected' && session.runtime) {
          if (session.browserSocket === ws) {
            session.browserSocket = undefined;
          }
          return;
        }
        if (this.canFailUnestablishedSession(session)) {
          this.finishSession(session.id, 'failed', 'browser_socket_error_before_handshake');
          return;
        }
      }
      this.scheduleBrowserDisconnectResolution(session, ws, {
        closeReason: 'browser_socket_error',
        terminalStatus: 'failed',
        terminalCloseReason: 'browser_socket_error',
        unestablishedTerminalCloseReason: 'browser_socket_error_before_runtime',
      });
    });

    await this.persistSession(session);

    if (!this.isLatestBindVersion(session, bindVersion)) {
      return;
    }
  }

  private parseBrowserPayload(raw: RawData): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(raw.toString('utf-8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private parsePositiveDimension(value: unknown, minimum: number): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const normalized = Math.floor(value);
    if (normalized < minimum) return null;
    return normalized;
  }

  private parseAfterSeq(value: unknown): number | null | undefined {
    if (value === undefined || value === null) return null;
    if (
      typeof value !== 'number'
      || !Number.isSafeInteger(value)
      || value < 0
    ) {
      return undefined;
    }
    return value;
  }

  private isTerminalSideEffectType(type: string): boolean {
    return type === 'terminal.stdin'
      || type === 'terminal.resize'
      || type === 'terminal.close';
  }

  private async completeReconnectHandshake(
    session: RegisteredTerminalSession,
    payload: Record<string, unknown>,
    bindVersion: number,
  ): Promise<void> {
    const ws = session.browserSocket;
    const terminalSessionId = typeof payload.terminal_session_id === 'string'
      ? payload.terminal_session_id.trim()
      : '';
    const view = typeof payload.view === 'string' ? payload.view.trim() : '';
    const hasUnsupportedView = Object.prototype.hasOwnProperty.call(payload, 'view')
      && view !== AGENT_TASK_TERMINAL_RECONNECT_VIEW;
    const cols = this.parsePositiveDimension(payload.cols, 20);
    const rows = this.parsePositiveDimension(payload.rows, 5);
    const afterSeq = this.parseAfterSeq(payload.after_seq);

    if (
      terminalSessionId !== session.id
      || hasUnsupportedView
      || cols === null
      || rows === null
      || afterSeq === undefined
    ) {
      this.sendTerminalErrorFailingUnestablishedSessionAndClose(
        session,
        ws,
        'invalid_reconnect_payload',
        'invalid_reconnect_payload',
      );
      return;
    }

    if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
      return;
    }
    const reconnectAuthorized = this.ensureTerminalUseAuthorized(session, ws);
    if (this.isPromiseLike(reconnectAuthorized)) {
      if (!await reconnectAuthorized) {
        return;
      }
      if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
        return;
      }
    } else if (!reconnectAuthorized) {
      return;
    }
    if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
      return;
    }

    this.clearDisconnectTimer(session);
    session.browserHandshakeComplete = true;
    session.browserReplayInProgress = true;
    session.queuedBrowserEvents = [];
    session.cols = cols;
    session.rows = rows;
    session.lastActivityAt = new Date().toISOString();
    if (session.runtime) {
      if (this.isTerminalInputEnabled(session)) {
        session.status = 'active';
        this.clearStartupTimer(session);
        session.runtime.resize(cols, rows);
      }
    } else if (session.status !== 'closed' && session.status !== 'failed') {
      session.status = 'pending';
    }
    await this.persistSession(session);

    const browserBindStillCurrent = this.isCurrentBrowserBind(session, ws, bindVersion);
    if (browserBindStillCurrent) {
      const replay = this.buildReplayPlan(session, afterSeq);
      this.sendReplay(session, ws, replay);
      session.browserReplayInProgress = false;
      this.flushQueuedBrowserPayloads(session);
    } else {
      session.browserReplayInProgress = false;
      session.queuedBrowserEvents = [];
    }

    if (session.runtime || session.status === 'closed' || session.status === 'failed') {
      return;
    }

    if (browserBindStillCurrent) {
      this.sendToBrowserSocket(ws, {
        type: 'terminal.state',
        terminal_session_id: session.id,
        state: 'starting',
        status: session.status,
        input_enabled: false,
      });
    }

    try {
      await this.ensureSessionRuntime(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'terminal_dispatch_failed';
      if (!this.isCurrentBrowserBind(session, ws, bindVersion) || message === 'terminal_dispatch_abandoned') {
        return;
      }
      debugTerminal('dispatch_failed', {
        terminal_session_id: session.id,
        task_id: session.taskId,
        agent_runner_id: session.agentId,
        runner_session_id: session.runnerSessionId,
        error: message,
      });
      this.sendToBrowserSocket(ws, {
        type: 'terminal.error',
        terminal_session_id: session.id,
        error_code: 'TERMINAL_DISPATCH_FAILED',
        error_message: message,
      });
      this.closeBrowserSocket(ws, 1011, 'terminal_dispatch_failed');
      this.finishSession(session.id, 'failed', message);
    }
  }

  private async handleBrowserMessage(
    session: RegisteredTerminalSession,
    raw: RawData,
    bindVersion: number,
  ): Promise<void> {
    const payload = this.parseBrowserPayload(raw);
    if (!payload) return;
    const type = typeof payload.type === 'string' ? payload.type : '';
    const ws = session.browserSocket;
    if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
      return;
    }

    session.lastActivityAt = new Date().toISOString();

    if (!session.browserHandshakeComplete) {
      if (type === 'terminal.reconnect') {
        await this.completeReconnectHandshake(session, payload, bindVersion);
        return;
      }
      if (this.isTerminalSideEffectType(type)) {
        this.sendTerminalErrorFailingUnestablishedSessionAndClose(
          session,
          ws,
          'handshake_required',
          'terminal_reconnect_required',
        );
      }
      return;
    }

    if (type === 'terminal.reconnect') {
      await this.completeReconnectHandshake(session, payload, bindVersion);
      return;
    }

    if (type === 'terminal.resize') {
      const cols = this.parsePositiveDimension(payload.cols, 20);
      const rows = this.parsePositiveDimension(payload.rows, 5);
      if (cols === null || rows === null) {
        this.sendTerminalErrorAndClose(
          ws,
          session.id,
          'invalid_resize_payload',
          'invalid_resize_payload',
        );
        return;
      }
      const inputAccepted = this.ensureTerminalInputAccepted(session, ws);
      if (this.isPromiseLike(inputAccepted)) {
        if (!await inputAccepted) {
          return;
        }
        if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
          return;
        }
      } else if (!inputAccepted) {
        return;
      }
      if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
        return;
      }
      session.cols = cols;
      session.rows = rows;
      session.runtime?.resize(cols, rows);
      await this.persistSession(session);
      return;
    }

    if (type === 'terminal.stdin' && typeof payload.data === 'string') {
      const inputAccepted = this.ensureTerminalInputAccepted(session, ws);
      if (this.isPromiseLike(inputAccepted)) {
        if (!await inputAccepted) {
          return;
        }
        if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
          return;
        }
      } else if (!inputAccepted) {
        return;
      }
      if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
        return;
      }
      session.runtime?.writeInput(payload.data);
      return;
    }

    if (type === 'terminal.close') {
      if (session.runtime) {
        session.runtime.close();
      } else {
        this.finishSession(session.id, 'closed', 'ended_by_user');
      }
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
    session.browserHandshakeComplete = false;
    session.browserReplayInProgress = false;
    session.queuedBrowserEvents = [];
    session.outputReplayRing = [];
    session.outputReplayRingBytes = 0;
    session.runtime = undefined;
    session.runtimeReady = false;
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
      session.browserHandshakeComplete = false;
      session.browserReplayInProgress = false;
      session.queuedBrowserEvents = [];
      session.outputReplayRing = [];
      session.outputReplayRingBytes = 0;
      session.runtime = undefined;
      session.runtimeReady = false;
      session.runtimeDispatchPromise = undefined;
      session.streamBound = false;
    }
    this.sessions.clear();
    await new Promise<void>((resolve) => {
      this.wsServer.close(() => resolve());
    });
  }
}
