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
import type {
  AdoptTerminalSessionInput,
  AgentExecutionService,
  RunnerActiveTerminalDescriptor,
  RunnerDetachedReason,
} from './agent-execution-service.js';

function debugTerminal(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_TERMINAL !== '1') return;
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-terminal] ${message}${payload}\n`);
}

const DEFAULT_TERMINAL_WORKSPACE_READY_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINAL_WORKSPACE_RETRY_COUNT = 2;
const DEFAULT_TERMINAL_WORKSPACE_RETRY_DELAY_MS = 750;
const DEFAULT_TERMINAL_BOOTSTRAP_OVERHEAD_MS = 10_000;
const DEFAULT_TERMINAL_STARTUP_TIMEOUT_FLOOR_MS = 15_000;
const DEFAULT_TERMINAL_REENTRY_OVERHEAD_MS = 20_000;
const DEFAULT_TERMINAL_RECONNECT_GRACE_FLOOR_MS = 90_000;
const MAX_TERMINAL_RECONNECT_GRACE_MS = 2 * 60_000;
const DEFAULT_TERMINAL_RECOVERY_TIMEOUT_MS = 120_000;
const DEFAULT_TERMINAL_RECOVERY_TIMEOUT_MAX_MS = 300_000;
const DEFAULT_TERMINAL_CLOSE_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINAL_REPLAY_MAX_CHUNKS = 500;
const DEFAULT_TERMINAL_REPLAY_MAX_BYTES = 256 * 1024;
const DEFAULT_TERMINAL_REPLAY_TTL_MS = 10 * 60_000;
const MAX_QUEUED_BROWSER_EVENTS = 1_000;

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

  const workspaceReadyTimeoutMs = parsePositiveIntegerEnv('MBOS_AGENT_WORKSPACE_READY_TIMEOUT_MS')
    ?? DEFAULT_TERMINAL_WORKSPACE_READY_TIMEOUT_MS;
  const workspaceRetryCount = parsePositiveIntegerEnv('MBOS_AGENT_WORKSPACE_READY_RETRY_COUNT')
    ?? DEFAULT_TERMINAL_WORKSPACE_RETRY_COUNT;
  const workspaceRetryDelayMs = parsePositiveIntegerEnv('MBOS_AGENT_WORKSPACE_READY_RETRY_DELAY_MS')
    ?? DEFAULT_TERMINAL_WORKSPACE_RETRY_DELAY_MS;

  const coldStartBudgetMs = (
    workspaceReadyTimeoutMs * Math.max(1, workspaceRetryCount)
    + workspaceRetryDelayMs * Math.max(0, workspaceRetryCount - 1)
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

function clampBoundedTimeoutMs(value: number | undefined, fallback: number, max: number): number {
  const normalized = typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
  return Math.min(max, Math.max(5_000, normalized));
}

function readPositiveInteger(input: unknown): number | null {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0 ? input : null;
}

function readPublicCloseResult(input: unknown): TerminalCloseResult | undefined {
  return input === 'closed' || input === 'not_found' ? input : undefined;
}

function resolveTerminalRecoveryTimeoutMs(explicit?: number): number {
  const envMax = parsePositiveIntegerEnv('NOTEBOOK_TERMINAL_RECOVERY_TIMEOUT_MAX_MS')
    ?? DEFAULT_TERMINAL_RECOVERY_TIMEOUT_MAX_MS;
  const max = Math.max(5_000, envMax);
  const envTimeout = parsePositiveIntegerEnv('NOTEBOOK_TERMINAL_RECOVERY_TIMEOUT_MS')
    ?? DEFAULT_TERMINAL_RECOVERY_TIMEOUT_MS;
  return clampBoundedTimeoutMs(explicit ?? envTimeout, DEFAULT_TERMINAL_RECOVERY_TIMEOUT_MS, max);
}

function resolveTerminalCloseTimeoutMs(explicit?: number): number {
  const envTimeout = parsePositiveIntegerEnv('NOTEBOOK_TERMINAL_CLOSE_TIMEOUT_MS')
    ?? DEFAULT_TERMINAL_CLOSE_TIMEOUT_MS;
  return clampBoundedTimeoutMs(explicit ?? envTimeout, DEFAULT_TERMINAL_CLOSE_TIMEOUT_MS, DEFAULT_TERMINAL_RECOVERY_TIMEOUT_MAX_MS);
}

type RegisteredTerminalSession = {
  id: string;
  workspaceId: string;
  projectId: string;
  taskId: string;
  agentId: string;
  resolvedRunnerId: string;
  runnerSessionId: string;
  userId: string;
  cols: number;
  rows: number;
  shell?: string;
  executionContext?: Record<string, unknown>;
  runtimeDispatchContext?: Record<string, unknown>;
  status: TerminalSessionStatus;
  lifecycleStatus: TerminalLifecycleStatus;
  runnerConnectionStatus: TerminalRunnerConnectionStatus;
  browserConnectionStatus: TerminalBrowserConnectionStatus;
  inputEnabled: boolean;
  recoverable: boolean;
  recoveryDeadlineAt?: string;
  failureKind: TerminalFailureKind | null;
  closeState: TerminalCloseState;
  closeDeadlineAt?: string;
  closeAttemptId?: string;
  closeRequestId?: string;
  closeGeneration?: number;
  closeConnectionEpoch?: number;
  closeResult?: TerminalCloseResult;
  closeDiagnosticCode?: string;
  closeRemainingPidCount?: number;
  terminalGeneration?: number;
  terminalConnectionEpoch?: number;
  closeReason?: string;
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
  exitCode?: number | null;
  browserHandshakeComplete?: boolean;
  browserReplayInProgress?: boolean;
  queuedBrowserEvents?: TerminalBrowserPayload[];
  outputReplayRing?: TerminalOutputReplayEntry[];
  outputReplayRingBytes?: number;
  nextOutputSeq?: number;
};

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

type TerminalSessionStatus = 'pending' | 'active' | 'disconnected' | 'recovering' | 'closing' | 'closed' | 'failed';
type TerminalLifecycleStatus = 'pending' | 'starting' | 'active' | 'recovering' | 'closing' | 'closed' | 'failed';
type TerminalRunnerConnectionStatus = 'dispatching' | 'attached' | 'transport_lost' | 'adopting' | 'missing' | 'closed';
type TerminalBrowserConnectionStatus = 'attached' | 'browser_disconnected' | 'none';
type TerminalCloseState = 'none' | 'requested' | 'delivered' | 'acked' | 'expired';
type TerminalCloseResult = 'closed' | 'not_found';
type TerminalFailureKind =
  | 'process_start_failed'
  | 'process_exited_unexpectedly'
  | 'protocol_error'
  | 'permission_revoked'
  | 'runner_recovery_timeout'
  | 'terminal_process_lost'
  | 'runner_process_exited'
  | 'terminal_runtime_session_mismatch';

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
  resolvedRunnerId: string;
  runnerSessionId: string;
  requiredPermissions: readonly ['project:agent_task:use', 'project:agent_task:terminal'];
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
  private readonly recoveryTimeoutMs: number;
  private readonly closeTimeoutMs: number;
  private readonly replayMaxChunks: number;
  private readonly replayMaxBytes: number;
  private readonly replayTtlMs: number;

  constructor(
    private readonly cache: CachePort,
    private readonly agentExecutionService: AgentExecutionService,
    options?: {
      startupTimeoutMs?: number;
      reconnectGraceMs?: number;
      recoveryTimeoutMs?: number;
      closeTimeoutMs?: number;
      replayMaxChunks?: number;
      replayMaxBytes?: number;
      replayTtlMs?: number;
      authorizeTerminalUse?: NotebookTerminalAuthorizationHook;
    },
  ) {
    this.wsServer = new WebSocketServer({ noServer: true });
    this.startupTimeoutMs = Math.max(25, options?.startupTimeoutMs ?? resolveDefaultTerminalStartupTimeoutMs());
    this.recoveryTimeoutMs = resolveTerminalRecoveryTimeoutMs(options?.recoveryTimeoutMs);
    this.closeTimeoutMs = resolveTerminalCloseTimeoutMs(options?.closeTimeoutMs);
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
    const registerCoordinator = (
      this.agentExecutionService as Partial<AgentExecutionService> & {
        registerTerminalRecoveryCoordinator?: AgentExecutionService['registerTerminalRecoveryCoordinator'];
      }
    ).registerTerminalRecoveryCoordinator;
    if (typeof registerCoordinator === 'function') {
      registerCoordinator.call(this.agentExecutionService, {
        handleRunnerDetached: (event) => this.handleRunnerDetached(event),
        handleRunnerReady: (event) => this.handleRunnerReadyForTerminalRecovery(event),
        handleTerminalCloseAck: (event) => this.handleTerminalCloseAck(event),
      });
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
    return session.inputEnabled === true
      && session.runtimeReady === true
      && session.status === 'active'
      && session.lifecycleStatus === 'active'
      && Boolean(session.runtime);
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
      resolvedRunnerId: session.resolvedRunnerId,
      runnerSessionId: session.runnerSessionId,
      requiredPermissions: ['project:agent_task:use', 'project:agent_task:terminal'],
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
      const isDisabledLifecycle = session.lifecycleStatus === 'recovering' || session.lifecycleStatus === 'closing';
      this.sendToBrowserSocket(socket, {
        type: 'terminal.error',
        terminal_session_id: session.id,
        error_code: isDisabledLifecycle ? 'terminal_input_disabled' : 'terminal_not_ready',
        error_message: isDisabledLifecycle ? 'terminal_input_disabled' : 'terminal_not_ready',
      });
      if (!isDisabledLifecycle) {
        this.closeBrowserSocket(socket, 1008, 'terminal_not_ready');
      }
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

  private recoveryIndexCacheKey(): string {
    return 'notebook_terminal_recovery_index';
  }

  private closingIndexCacheKey(): string {
    return 'notebook_terminal_closing_index';
  }

  private async readSessionIndex(key: string): Promise<string[]> {
    const raw = await this.cache.get(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
    } catch {
      return [];
    }
  }

  private async writeSessionIndex(key: string, sessionIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(sessionIds)];
    if (uniqueIds.length === 0) {
      await this.cache.del(key);
      return;
    }
    await this.cache.set(key, JSON.stringify(uniqueIds), this.sessionTtlSeconds);
  }

  private async addSessionToIndex(key: string, sessionId: string): Promise<void> {
    const ids = await this.readSessionIndex(key);
    if (ids.includes(sessionId)) return;
    ids.push(sessionId);
    await this.writeSessionIndex(key, ids);
  }

  private async removeSessionFromIndex(key: string, sessionId: string): Promise<void> {
    const ids = await this.readSessionIndex(key);
    if (!ids.includes(sessionId)) return;
    await this.writeSessionIndex(key, ids.filter((id) => id !== sessionId));
  }

  private async updateLifecycleIndexes(session: RegisteredTerminalSession): Promise<void> {
    if (session.lifecycleStatus === 'recovering') {
      await this.addSessionToIndex(this.recoveryIndexCacheKey(), session.id);
    } else {
      await this.removeSessionFromIndex(this.recoveryIndexCacheKey(), session.id);
    }
    if (session.lifecycleStatus === 'closing') {
      await this.addSessionToIndex(this.closingIndexCacheKey(), session.id);
    } else {
      await this.removeSessionFromIndex(this.closingIndexCacheKey(), session.id);
    }
  }

  private normalizeSession(session: RegisteredTerminalSession): RegisteredTerminalSession {
    const status = session.status;
    const lifecycleStatus = session.lifecycleStatus ?? (
      status === 'pending'
        ? 'pending'
        : status === 'active' || status === 'disconnected'
          ? 'active'
          : status
    );
    const runnerConnectionStatus = session.runnerConnectionStatus ?? (
      status === 'closed'
        ? 'closed'
        : status === 'failed'
          ? 'missing'
          : 'dispatching'
    );
    const browserConnectionStatus = session.browserConnectionStatus ?? (
      status === 'active'
        ? 'attached'
        : status === 'disconnected'
          ? 'browser_disconnected'
          : 'none'
    );
    const inputEnabled = session.inputEnabled ?? (
      Boolean(session.runtime) && session.runtimeReady === true && status === 'active'
    );
    const terminalGeneration = readPositiveInteger(session.terminalGeneration);
    const terminalConnectionEpoch = readPositiveInteger(session.terminalConnectionEpoch);
    return {
      ...session,
      lifecycleStatus,
      runnerConnectionStatus,
      browserConnectionStatus,
      inputEnabled,
      recoverable: session.recoverable ?? lifecycleStatus === 'recovering',
      failureKind: session.failureKind ?? null,
      closeState: session.closeState ?? 'none',
      closeResult: readPublicCloseResult(session.closeResult),
      ...(terminalGeneration !== null
        ? { terminalGeneration }
        : { terminalGeneration: undefined }),
      ...(terminalConnectionEpoch !== null
        ? { terminalConnectionEpoch }
        : { terminalConnectionEpoch: undefined }),
    };
  }

  private setBrowserConnectionStatus(session: RegisteredTerminalSession): void {
    if (session.browserSocket && session.browserHandshakeComplete) {
      session.browserConnectionStatus = 'attached';
      return;
    }
    if (session.status === 'disconnected') {
      session.browserConnectionStatus = 'browser_disconnected';
      return;
    }
    session.browserConnectionStatus = 'none';
  }

  private setInputEnabled(session: RegisteredTerminalSession, enabled: boolean): void {
    session.inputEnabled = enabled
      && Boolean(session.runtime)
      && session.runtimeReady === true
      && session.lifecycleStatus === 'active'
      && session.status === 'active';
  }

  private isVisibleTaskSessionStatus(status: RegisteredTerminalSession['status']): boolean {
    return status === 'pending'
      || status === 'active'
      || status === 'disconnected'
      || status === 'recovering'
      || status === 'closing'
      || status === 'failed';
  }

  private isLiveTaskSessionStatus(status: RegisteredTerminalSession['status']): boolean {
    return status === 'pending'
      || status === 'active'
      || status === 'disconnected'
      || status === 'recovering'
      || status === 'closing';
  }

  private isLiveBindableSessionStatus(status: RegisteredTerminalSession['status']): boolean {
    return status === 'pending' || status === 'active' || status === 'disconnected' || status === 'recovering';
  }

  private async applyTerminalDeadlineExpiry(
    session: RegisteredTerminalSession,
  ): Promise<RegisteredTerminalSession> {
    const normalized = this.normalizeSession(session);
    Object.assign(session, normalized);
    const nowMs = Date.now();
    if (
      normalized.lifecycleStatus === 'recovering'
      && normalized.recoveryDeadlineAt
      && Date.parse(normalized.recoveryDeadlineAt) <= nowMs
    ) {
      session.status = 'failed';
      session.lifecycleStatus = 'failed';
      session.runnerConnectionStatus = 'missing';
      session.inputEnabled = false;
      session.recoverable = false;
      session.failureKind = 'runner_recovery_timeout';
      session.closeReason = 'runner_recovery_timeout';
      session.endedAt = new Date(nowMs).toISOString();
      session.lastActivityAt = session.endedAt;
      session.runtime = undefined;
      session.runtimeReady = false;
      session.runtimeDispatchPromise = undefined;
      session.streamBound = false;
      await this.persistSession(session);
      void this.notifySessionClosed(session);
      return session;
    }
    if (
      normalized.lifecycleStatus === 'closing'
      && normalized.closeDeadlineAt
      && Date.parse(normalized.closeDeadlineAt) <= nowMs
    ) {
      session.status = 'failed';
      session.lifecycleStatus = 'failed';
      session.runnerConnectionStatus = 'missing';
      session.inputEnabled = false;
      session.recoverable = false;
      session.closeState = 'expired';
      session.closeResult = undefined;
      session.closeDiagnosticCode = session.closeDiagnosticCode ?? 'close_tombstone_timeout';
      session.failureKind = 'terminal_process_lost';
      session.closeReason = 'close_tombstone_timeout';
      session.endedAt = new Date(nowMs).toISOString();
      session.lastActivityAt = session.endedAt;
      session.runtime = undefined;
      session.runtimeReady = false;
      session.runtimeDispatchPromise = undefined;
      session.streamBound = false;
      await this.persistSession(session);
      void this.notifySessionClosed(session);
      return session;
    }
    return session;
  }

  private async reconcilePersistedSessionAfterServiceReload(
    session: RegisteredTerminalSession,
  ): Promise<RegisteredTerminalSession> {
    const normalized = this.normalizeSession(session);
    if (normalized.status === 'closing' || normalized.lifecycleStatus === 'closing') {
      await this.persistSession(normalized);
      return this.applyTerminalDeadlineExpiry(normalized);
    }
    if (normalized.status === 'recovering' || normalized.lifecycleStatus === 'recovering') {
      await this.persistSession(normalized);
      return this.applyTerminalDeadlineExpiry(normalized);
    }
    if (!this.isLiveBindableSessionStatus(normalized.status)) {
      return this.applyTerminalDeadlineExpiry(normalized);
    }

    const now = new Date().toISOString();
    const deadlineAt = normalized.recoveryDeadlineAt
      && Date.parse(normalized.recoveryDeadlineAt) > Date.now()
      ? normalized.recoveryDeadlineAt
      : new Date(Date.now() + this.recoveryTimeoutMs).toISOString();
    const reconciled: RegisteredTerminalSession = {
      ...normalized,
      status: 'recovering',
      lifecycleStatus: 'recovering',
      runnerConnectionStatus: 'transport_lost',
      browserConnectionStatus: 'none',
      inputEnabled: false,
      recoverable: true,
      recoveryDeadlineAt: deadlineAt,
      failureKind: null,
      closeState: normalized.closeState ?? 'none',
      closeReason: 'runner_transport_lost',
      lastActivityAt: now,
      exitCode: normalized.exitCode ?? null,
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
    return this.applyTerminalDeadlineExpiry(reconciled);
  }

  private async loadResolvedPersistedSession(sessionId: string): Promise<RegisteredTerminalSession | null> {
    const persisted = await this.loadPersistedSession(sessionId);
    if (!persisted) return null;
    if (
      persisted.status === 'closing'
      || persisted.lifecycleStatus === 'closing'
      || persisted.status === 'recovering'
      || persisted.lifecycleStatus === 'recovering'
      || this.isLiveBindableSessionStatus(persisted.status)
    ) {
      return this.reconcilePersistedSessionAfterServiceReload(persisted);
    }
    return this.applyTerminalDeadlineExpiry(persisted);
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
    const normalized = this.normalizeSession(session);
    Object.assign(session, normalized);
    const payload: PersistedTerminalSession = {
      id: normalized.id,
      workspaceId: normalized.workspaceId,
      projectId: normalized.projectId,
      taskId: normalized.taskId,
      agentId: normalized.agentId,
      resolvedRunnerId: normalized.resolvedRunnerId,
      runnerSessionId: normalized.runnerSessionId,
      userId: normalized.userId,
      cols: normalized.cols,
      rows: normalized.rows,
      ...(normalized.shell ? { shell: normalized.shell } : {}),
      ...(normalized.executionContext ? { executionContext: normalized.executionContext } : {}),
      ...(normalized.runtimeDispatchContext ? { runtimeDispatchContext: normalized.runtimeDispatchContext } : {}),
      status: normalized.status,
      lifecycleStatus: normalized.lifecycleStatus,
      runnerConnectionStatus: normalized.runnerConnectionStatus,
      browserConnectionStatus: normalized.browserConnectionStatus,
      inputEnabled: normalized.inputEnabled,
      recoverable: normalized.recoverable,
      ...(normalized.recoveryDeadlineAt ? { recoveryDeadlineAt: normalized.recoveryDeadlineAt } : {}),
      failureKind: normalized.failureKind,
      closeState: normalized.closeState,
      ...(normalized.closeDeadlineAt ? { closeDeadlineAt: normalized.closeDeadlineAt } : {}),
      ...(normalized.closeAttemptId ? { closeAttemptId: normalized.closeAttemptId } : {}),
      ...(normalized.closeRequestId ? { closeRequestId: normalized.closeRequestId } : {}),
      ...(typeof normalized.closeGeneration === 'number' ? { closeGeneration: normalized.closeGeneration } : {}),
      ...(typeof normalized.closeConnectionEpoch === 'number'
        ? { closeConnectionEpoch: normalized.closeConnectionEpoch }
        : {}),
      ...(normalized.closeResult ? { closeResult: normalized.closeResult } : {}),
      ...(normalized.closeDiagnosticCode ? { closeDiagnosticCode: normalized.closeDiagnosticCode } : {}),
      ...(typeof normalized.closeRemainingPidCount === 'number'
        ? { closeRemainingPidCount: normalized.closeRemainingPidCount }
        : {}),
      ...(typeof normalized.terminalGeneration === 'number' ? { terminalGeneration: normalized.terminalGeneration } : {}),
      ...(typeof normalized.terminalConnectionEpoch === 'number'
        ? { terminalConnectionEpoch: normalized.terminalConnectionEpoch }
        : {}),
      createdAt: normalized.createdAt,
      lastActivityAt: normalized.lastActivityAt,
      ...(normalized.endedAt ? { endedAt: normalized.endedAt } : {}),
      ...(normalized.closeReason ? { closeReason: normalized.closeReason } : {}),
      ...(normalized.exitCode !== undefined ? { exitCode: normalized.exitCode } : {}),
    };
    await this.cache.set(this.sessionCacheKey(normalized.id), JSON.stringify(payload), this.sessionTtlSeconds);
    await this.updateLifecycleIndexes(normalized);
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
      return this.normalizeSession(JSON.parse(raw) as RegisteredTerminalSession);
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
      const resolved = await this.applyTerminalDeadlineExpiry(live);
      return this.isLiveBindableSessionStatus(resolved.status) ? resolved : null;
    }

    const persisted = await this.loadPersistedSession(sessionId);
    if (persisted && this.isLiveBindableSessionStatus(persisted.status)) {
      const reconciled = await this.reconcilePersistedSessionAfterServiceReload(persisted);
      return this.isLiveBindableSessionStatus(reconciled.status) ? reconciled : null;
    }
    return null;
  }

  private readSessionResolvedRunnerId(session: RegisteredTerminalSession): string | null {
    const resolvedRunnerId = session.resolvedRunnerId?.trim();
    return resolvedRunnerId || null;
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

  private async enterRecovering(
    session: RegisteredTerminalSession,
    reason: RunnerDetachedReason | 'server_shutdown',
    terminalProcessesTerminated?: boolean,
  ): Promise<void> {
    const now = new Date().toISOString();
    this.clearStartupTimer(session);
    if (terminalProcessesTerminated || reason === 'server_shutdown') {
      session.status = 'failed';
      session.lifecycleStatus = 'failed';
      session.runnerConnectionStatus = 'closed';
      session.inputEnabled = false;
      session.recoverable = false;
      session.failureKind = 'runner_process_exited';
      session.closeReason = 'runner_process_exited';
      session.endedAt = now;
      session.lastActivityAt = now;
      await this.persistSession(session);
      void this.notifySessionClosed(session);
      this.queueOrSendBrowserPayload(session, {
        type: 'terminal.error',
        terminal_session_id: session.id,
        error_code: 'runner_process_exited',
        error_message: 'runner_process_exited',
      });
      return;
    }

    const existingDeadlineMs = session.recoveryDeadlineAt ? Date.parse(session.recoveryDeadlineAt) : NaN;
    const deadlineAt = Number.isFinite(existingDeadlineMs) && existingDeadlineMs > Date.now()
      ? session.recoveryDeadlineAt
      : new Date(Date.now() + this.recoveryTimeoutMs).toISOString();
    session.status = 'recovering';
    session.lifecycleStatus = 'recovering';
    session.runnerConnectionStatus = 'transport_lost';
    this.setBrowserConnectionStatus(session);
    session.inputEnabled = false;
    session.runtimeReady = false;
    session.runtime = undefined;
    session.runtimeDispatchPromise = undefined;
    session.streamBound = false;
    session.recoverable = true;
    session.recoveryDeadlineAt = deadlineAt;
    session.failureKind = null;
    session.closeReason = 'runner_transport_lost';
    session.lastActivityAt = now;
    await this.persistSession(session);
    this.queueOrSendBrowserPayload(session, {
      type: 'terminal.state',
      terminal_session_id: session.id,
      state: 'recovering',
      status: 'recovering',
      input_enabled: false,
      recovery_deadline_at: deadlineAt,
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
          const eventRunnerSessionId = event.runner_session_id?.trim() ?? '';
          const eventGeneration = readPositiveInteger(event.generation);
          const eventConnectionEpoch = readPositiveInteger(event.connection_epoch);
          if (
            eventRunnerSessionId
            && eventRunnerSessionId === session.runnerSessionId
            && eventGeneration !== null
            && eventConnectionEpoch !== null
          ) {
            session.terminalGeneration = eventGeneration;
            session.terminalConnectionEpoch = eventConnectionEpoch;
          } else {
            debugTerminal('runtime_started_identity_missing', {
              terminal_session_id: session.id,
              has_runner_session_id: Boolean(eventRunnerSessionId),
              generation: event.generation,
              connection_epoch: event.connection_epoch,
            });
          }
          if (session.lifecycleStatus !== 'closing') {
            session.runtimeReady = true;
            if (session.status !== 'disconnected' || (this.isOpenSocket(session.browserSocket) && session.browserHandshakeComplete)) {
              session.status = 'active';
            }
            session.lifecycleStatus = 'active';
            session.runnerConnectionStatus = 'attached';
            session.recoverable = false;
            session.recoveryDeadlineAt = undefined;
            this.setInputEnabled(session, true);
          }
        }
        if (event.type === 'output') {
          this.clearStartupTimer(session);
          if (session.lifecycleStatus !== 'closing') {
            session.runtimeReady = true;
            if (session.status !== 'disconnected' || (this.isOpenSocket(session.browserSocket) && session.browserHandshakeComplete)) {
              session.status = 'active';
            }
            session.lifecycleStatus = 'active';
            session.runnerConnectionStatus = 'attached';
            session.recoverable = false;
            session.recoveryDeadlineAt = undefined;
            this.setInputEnabled(session, true);
          }
        }
        if (event.type === 'detached') {
          await this.enterRecovering(session, event.reason === 'server_shutdown' ? 'server_shutdown' : 'agent_disconnected');
          continue;
        }
        if (event.type === 'exited' || event.type === 'error') {
          this.clearStartupTimer(session);
          session.exitCode = typeof event.exit_code === 'number' ? event.exit_code : null;
          session.recoverable = false;
          session.inputEnabled = false;
          session.runtimeReady = false;
          if (session.lifecycleStatus !== 'closing') {
            session.status = event.type === 'exited' ? 'closed' : 'failed';
            session.lifecycleStatus = event.type === 'exited' ? 'closed' : 'failed';
            session.runnerConnectionStatus = event.type === 'exited' ? 'closed' : 'missing';
            session.closeReason = event.type === 'exited'
              ? 'process_exited'
              : (event.error_message?.trim() || 'runtime_error');
            session.failureKind = event.type === 'error'
              ? event.error_message === 'terminal_process_lost'
                ? 'terminal_process_lost'
                : event.error_message === 'runner_recovery_timeout'
                  ? 'runner_recovery_timeout'
                  : 'process_exited_unexpectedly'
              : null;
          }
        }
        this.setBrowserConnectionStatus(session);
        session.lastActivityAt = new Date().toISOString();
        await this.persistSession(session);
        const inputBecameEnabled = !inputWasEnabled && this.isTerminalInputEnabled(session);
        if ((inputBecameEnabled || event.type === 'started') && session.lifecycleStatus !== 'closing') {
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
        if (event.type === 'output' && session.lifecycleStatus !== 'closing') {
          this.queueOrSendBrowserPayload(session, this.recordTerminalOutput(session, event));
        } else if (event.type === 'exited' && session.lifecycleStatus !== 'closing') {
          this.queueOrSendBrowserPayload(session, {
            type: 'terminal.state',
            terminal_session_id: session.id,
            state: 'closed',
            status: 'closed',
            input_enabled: false,
            exit_code: typeof event.exit_code === 'number' ? event.exit_code : null,
            signal: event.signal ?? null,
          });
        } else if (event.type === 'error' && session.lifecycleStatus !== 'closing') {
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
      if (session.lifecycleStatus === 'recovering' || session.lifecycleStatus === 'closing') {
        return;
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
      if (session.lifecycleStatus === 'recovering' || session.lifecycleStatus === 'closing') {
        return;
      }
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
        const resolvedRunnerId = this.readSessionResolvedRunnerId(session);
        if (!resolvedRunnerId) {
          throw new Error('terminal_runner_unavailable');
        }
        return this.agentExecutionService.dispatchTerminalSession({
          workspaceId: session.workspaceId,
          projectId: session.projectId,
          sessionId: session.runnerSessionId,
          agentId: resolvedRunnerId,
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
      this.clearDisconnectTimer(session);
      session.status = session.status === 'closing' || session.status === 'recovering' ? session.status : 'pending';
      session.lifecycleStatus = session.lifecycleStatus === 'closing' || session.lifecycleStatus === 'recovering'
        ? session.lifecycleStatus
        : 'pending';
      session.runnerConnectionStatus = session.runnerConnectionStatus ?? 'dispatching';
      session.browserConnectionStatus = 'none';
      session.inputEnabled = false;
      session.closeReason = options.closeReason;
      session.lastActivityAt = new Date().toISOString();
      void this.persistSession(session);
      return;
    }
    this.clearDisconnectTimer(session);
    const disconnectVersion = this.bumpDisconnectVersion(session);
    session.status = 'disconnected';
    session.lifecycleStatus = 'active';
    session.runnerConnectionStatus = 'attached';
    session.browserConnectionStatus = 'browser_disconnected';
    session.inputEnabled = false;
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
      session.disconnectTimer = undefined;
      session.browserConnectionStatus = 'browser_disconnected';
      session.inputEnabled = false;
      session.lastActivityAt = new Date().toISOString();
      void this.persistSession(session);
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
    resolvedRunnerId?: string;
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
    const resolvedRunnerId = input.resolvedRunnerId?.trim() ?? '';
    if (!resolvedRunnerId) {
      throw new Error('agent_runner_not_resolved');
    }
    const sessionId = `term_${randomUUID().replace(/-/g, '')}`;
    const now = new Date().toISOString();
    this.sessions.set(sessionId, {
      id: sessionId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      taskId: input.taskId,
      agentId: input.agentId,
      resolvedRunnerId,
      runnerSessionId: input.runnerSessionId,
      userId: input.userId,
      cols: Math.max(20, input.cols),
      rows: Math.max(5, input.rows),
      ...(input.shell?.trim() ? { shell: input.shell.trim() } : {}),
      ...(input.executionContext ? { executionContext: input.executionContext } : {}),
      ...(input.runtimeDispatchContext ? { runtimeDispatchContext: input.runtimeDispatchContext } : {}),
      status: 'pending',
      lifecycleStatus: 'pending',
      runnerConnectionStatus: 'dispatching',
      browserConnectionStatus: 'none',
      inputEnabled: false,
      recoverable: false,
      failureKind: null,
      closeState: 'none',
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
    if (!this.readSessionResolvedRunnerId(session)) return null;
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
    if (live) return this.applyTerminalDeadlineExpiry(live);
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

  async handleRunnerDetached(event: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    runnerSessionId: string | null;
    connectionId: string;
    reason: RunnerDetachedReason;
    terminalSessionIds: string[];
    terminalProcessesTerminated?: boolean;
  }): Promise<void> {
    for (const terminalSessionId of event.terminalSessionIds) {
      const session = await this.getSession(terminalSessionId);
      if (
        !session
        || session.workspaceId !== event.workspaceId
        || session.projectId !== event.projectId
        || this.readSessionResolvedRunnerId(session) !== event.agentId
        || (event.runnerSessionId && session.runnerSessionId !== event.runnerSessionId)
        || session.status === 'closed'
        || session.status === 'failed'
        || session.status === 'closing'
      ) {
        continue;
      }
      await this.enterRecovering(session, event.reason, event.terminalProcessesTerminated);
    }
  }

  async handleRunnerReadyForTerminalRecovery(event: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    runnerSessionId: string | null;
    runnerInstanceId: string | null;
    connectionId: string;
    connectionEpoch: number;
    activeTerminals: RunnerActiveTerminalDescriptor[];
  }): Promise<void> {
    const activeTerminalIds = new Set(event.activeTerminals.map((descriptor) => descriptor.terminal_session_id));
    for (const descriptor of event.activeTerminals) {
      await this.handleActiveTerminalDescriptor(event, descriptor);
    }
    await this.redeliverMissingClosingTombstones(event, activeTerminalIds);
  }

  private async redeliverMissingClosingTombstones(
    event: {
      workspaceId: string;
      projectId: string;
      agentId: string;
      runnerSessionId: string | null;
    },
    activeTerminalIds: Set<string>,
  ): Promise<void> {
    const closingSessionIds = await this.readSessionIndex(this.closingIndexCacheKey());
    for (const terminalSessionId of closingSessionIds) {
      if (activeTerminalIds.has(terminalSessionId)) {
        continue;
      }
      const session = await this.getSession(terminalSessionId);
      if (
        !session
        || session.workspaceId !== event.workspaceId
        || session.projectId !== event.projectId
        || this.readSessionResolvedRunnerId(session) !== event.agentId
        || (event.runnerSessionId && session.runnerSessionId !== event.runnerSessionId)
        || session.lifecycleStatus !== 'closing'
      ) {
        continue;
      }
      await this.deliverCloseTombstone(session);
    }
  }

  private async handleActiveTerminalDescriptor(
    event: {
      workspaceId: string;
      projectId: string;
      agentId: string;
      runnerSessionId: string | null;
      connectionEpoch: number;
    },
    descriptor: RunnerActiveTerminalDescriptor,
  ): Promise<void> {
    const session = await this.getSession(descriptor.terminal_session_id);
    if (
      !session
      || session.workspaceId !== event.workspaceId
      || session.projectId !== event.projectId
      || this.readSessionResolvedRunnerId(session) !== event.agentId
      || session.runnerSessionId !== descriptor.runner_session_id
    ) {
      return;
    }
    if (session.lifecycleStatus === 'closing') {
      session.terminalGeneration = descriptor.generation;
      session.terminalConnectionEpoch = event.connectionEpoch;
      await this.persistSession(session);
      await this.deliverCloseTombstone(session);
      return;
    }
    const refreshed = await this.applyTerminalDeadlineExpiry(session);
    if (refreshed.lifecycleStatus !== 'recovering' || refreshed.status !== 'recovering') {
      return;
    }

    const adoptAttemptId = `adopt_${randomUUID().replace(/-/g, '')}`;
    refreshed.runnerConnectionStatus = 'adopting';
    refreshed.inputEnabled = false;
    refreshed.cols = descriptor.cols;
    refreshed.rows = descriptor.rows;
    refreshed.terminalGeneration = descriptor.generation;
    refreshed.terminalConnectionEpoch = event.connectionEpoch;
    refreshed.lastActivityAt = new Date().toISOString();
    await this.persistSession(refreshed);

    const adoptTerminalSession = (
      this.agentExecutionService as Partial<AgentExecutionService> & {
        adoptTerminalSession?: (input: AdoptTerminalSessionInput) => Promise<TerminalRuntime>;
      }
    ).adoptTerminalSession;
    if (typeof adoptTerminalSession !== 'function') {
      this.finishSession(refreshed.id, 'failed', 'runner_recovery_timeout');
      return;
    }

    try {
      const runtime = await adoptTerminalSession.call(this.agentExecutionService, {
        workspaceId: refreshed.workspaceId,
        projectId: refreshed.projectId,
        sessionId: refreshed.runnerSessionId,
        agentId: event.agentId,
        terminalSessionId: refreshed.id,
        adoptAttemptId,
        connectionEpoch: event.connectionEpoch,
        generation: descriptor.generation,
        cols: descriptor.cols,
        rows: descriptor.rows,
        ...(refreshed.executionContext ? { executionContext: refreshed.executionContext } : {}),
      });
      if (refreshed.lifecycleStatus !== 'recovering' || refreshed.status !== 'recovering') {
        runtime.close();
        return;
      }
      refreshed.runtime = runtime;
      refreshed.runtimeReady = false;
      refreshed.streamBound = false;
      this.bindRuntimeStream(refreshed);
      await this.persistSession(refreshed);
    } catch {
      this.finishSession(refreshed.id, 'failed', 'runner_recovery_timeout');
    }
  }

  async handleTerminalCloseAck(event: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    runnerSessionId: string;
    terminalSessionId: string;
    requestId: string;
    closeAttemptId: string;
    generation: number;
    connectionEpoch: number;
    status: 'closed' | 'not_found' | 'error';
    diagnosticCode?: string;
    remainingPidCount?: number;
  }): Promise<void> {
    const session = await this.getSession(event.terminalSessionId);
    const receivedFence = {
      workspace_id: event.workspaceId,
      project_id: event.projectId,
      agent_id: event.agentId,
      runner_session_id: event.runnerSessionId,
      terminal_session_id: event.terminalSessionId,
      request_id: event.requestId,
      close_attempt_id: event.closeAttemptId,
      generation: event.generation,
      connection_epoch: event.connectionEpoch,
      status: event.status,
    };
    const expectedFence = session
      ? {
        workspace_id: session.workspaceId,
        project_id: session.projectId,
        agent_id: this.readSessionResolvedRunnerId(session),
        runner_session_id: session.runnerSessionId,
        terminal_session_id: session.id,
        request_id: session.closeRequestId,
        close_attempt_id: session.closeAttemptId,
        generation: session.closeGeneration,
        connection_epoch: session.closeConnectionEpoch,
        lifecycle_status: session.lifecycleStatus,
      }
      : null;
    const rejectReason = !session
      ? 'session_not_found'
      : session.workspaceId !== event.workspaceId
        ? 'workspace_mismatch'
        : session.projectId !== event.projectId
          ? 'project_mismatch'
          : this.readSessionResolvedRunnerId(session) !== event.agentId
            ? 'agent_mismatch'
            : session.runnerSessionId !== event.runnerSessionId
              ? 'runner_session_mismatch'
              : session.closeRequestId !== event.requestId
                ? 'request_mismatch'
                : session.closeAttemptId !== event.closeAttemptId
                  ? 'attempt_mismatch'
                  : session.closeGeneration !== event.generation
                    ? 'generation_mismatch'
                    : session.closeConnectionEpoch !== event.connectionEpoch
                      ? 'connection_epoch_mismatch'
                      : session.lifecycleStatus !== 'closing'
                        ? 'not_closing'
                        : null;
    if (
      !session
      || session.workspaceId !== event.workspaceId
      || session.projectId !== event.projectId
      || this.readSessionResolvedRunnerId(session) !== event.agentId
      || session.runnerSessionId !== event.runnerSessionId
      || session.closeRequestId !== event.requestId
      || session.closeAttemptId !== event.closeAttemptId
      || session.closeGeneration !== event.generation
      || session.closeConnectionEpoch !== event.connectionEpoch
      || session.lifecycleStatus !== 'closing'
    ) {
      debugTerminal('close_ack_rejected', {
        terminal_session_id: event.terminalSessionId,
        reason: rejectReason,
        received: receivedFence,
        expected: expectedFence,
      });
      return;
    }
    if (readPositiveInteger(event.generation) === null || readPositiveInteger(event.connectionEpoch) === null) {
      debugTerminal('close_ack_rejected', {
        terminal_session_id: event.terminalSessionId,
        reason: 'invalid_positive_identity',
        received: receivedFence,
        expected: expectedFence,
      });
      return;
    }
    if (event.status === 'closed' || event.status === 'not_found') {
      session.closeState = 'acked';
      session.closeResult = event.status;
      session.closeDiagnosticCode = event.status === 'not_found'
        ? 'terminal_process_missing_on_close'
        : event.diagnosticCode;
      if (typeof event.remainingPidCount === 'number') {
        session.closeRemainingPidCount = event.remainingPidCount;
      }
      session.failureKind = null;
      this.finishSession(session.id, 'closed', session.closeReason ?? 'ended_by_user', 0);
      session.closeState = 'acked';
      session.closeResult = event.status;
      session.closeDiagnosticCode = event.status === 'not_found'
        ? 'terminal_process_missing_on_close'
        : event.diagnosticCode;
      if (typeof event.remainingPidCount === 'number') {
        session.closeRemainingPidCount = event.remainingPidCount;
      }
      session.failureKind = null;
      await this.persistSession(session);
      await this.forgetTaskSession(session);
      return;
    }
    session.closeState = 'delivered';
    session.closeResult = undefined;
    session.closeDiagnosticCode = event.diagnosticCode ?? 'terminal_close_error';
    if (typeof event.remainingPidCount === 'number') {
      session.closeRemainingPidCount = event.remainingPidCount;
    }
    session.lastActivityAt = new Date().toISOString();
    await this.persistSession(session);
  }

  private async deliverCloseTombstone(session: RegisteredTerminalSession): Promise<void> {
    const closeTerminalSession = (
      this.agentExecutionService as Partial<AgentExecutionService> & {
        closeTerminalSession?: (request: {
          workspaceId: string;
          projectId: string;
          sessionId: string;
          agentId: string;
          terminalSessionId: string;
          executionContext?: Record<string, unknown>;
          closeRequestId?: string;
          closeAttemptId: string;
          generation: number;
          connectionEpoch: number;
          reason?: 'user_requested' | 'permission_revoked' | 'garbage_collect' | 'shutdown';
        }) => Promise<unknown>;
      }
    ).closeTerminalSession;
    const resolvedRunnerId = this.readSessionResolvedRunnerId(session);
    if (typeof closeTerminalSession !== 'function' || !resolvedRunnerId) {
      return;
    }
    const closeAttemptId = session.closeAttemptId ?? `close_${randomUUID().replace(/-/g, '')}`;
    session.closeAttemptId = closeAttemptId;
    const closeRequestId = `close_req_${randomUUID().replace(/-/g, '')}`;
    const generation = readPositiveInteger(session.terminalGeneration) ?? readPositiveInteger(session.closeGeneration);
    const connectionEpoch = readPositiveInteger(session.terminalConnectionEpoch)
      ?? readPositiveInteger(session.closeConnectionEpoch);
    if (generation === null || connectionEpoch === null) {
      session.closeDiagnosticCode = session.closeDiagnosticCode ?? 'terminal_close_identity_missing';
      session.lastActivityAt = new Date().toISOString();
      debugTerminal('close_tombstone_not_delivered', {
        terminal_session_id: session.id,
        reason: 'terminal_close_identity_missing',
        generation: session.terminalGeneration ?? session.closeGeneration,
        connection_epoch: session.terminalConnectionEpoch ?? session.closeConnectionEpoch,
      });
      await this.persistSession(session);
      return;
    }
    const result = await closeTerminalSession.call(this.agentExecutionService, {
      workspaceId: session.workspaceId,
      projectId: session.projectId,
      sessionId: session.runnerSessionId,
      agentId: resolvedRunnerId,
      terminalSessionId: session.id,
      ...(session.executionContext ? { executionContext: session.executionContext } : {}),
      closeRequestId,
      closeAttemptId,
      generation,
      connectionEpoch,
      reason: 'user_requested',
    }).catch(() => 'agent_offline');
    if (result === 'signaled' && session.lifecycleStatus === 'closing') {
      session.closeState = 'delivered';
      session.closeRequestId = closeRequestId;
      session.closeGeneration = generation;
      session.closeConnectionEpoch = connectionEpoch;
      session.lastActivityAt = new Date().toISOString();
      await this.persistSession(session);
    } else if (result === 'invalid_terminal_identity' && session.lifecycleStatus === 'closing') {
      session.closeDiagnosticCode = session.closeDiagnosticCode ?? 'terminal_close_identity_missing';
      session.lastActivityAt = new Date().toISOString();
      await this.persistSession(session);
    }
  }

  private async beginCloseTombstone(session: RegisteredTerminalSession): Promise<boolean> {
    if (session.status === 'closed' || session.status === 'failed') {
      return false;
    }
    const wasClosing = session.lifecycleStatus === 'closing' || session.status === 'closing';
    this.clearDisconnectTimer(session);
    this.clearStartupTimer(session);
    session.status = 'closing';
    session.lifecycleStatus = 'closing';
    session.inputEnabled = false;
    session.recoverable = false;
    session.closeState = wasClosing && session.closeState !== 'none' ? session.closeState : 'requested';
    if (!wasClosing) {
      session.closeReason = 'ended_by_user';
    }
    session.closeAttemptId = session.closeAttemptId ?? `close_${randomUUID().replace(/-/g, '')}`;
    session.closeDeadlineAt = session.closeDeadlineAt ?? new Date(Date.now() + this.closeTimeoutMs).toISOString();
    session.browserConnectionStatus = 'none';
    session.runtimeReady = false;
    session.lastActivityAt = new Date().toISOString();
    const browserSocket = session.browserSocket;
    session.browserSocket = undefined;
    session.browserHandshakeComplete = false;
    session.browserReplayInProgress = false;
    session.queuedBrowserEvents = [];
    this.closeBrowserSocket(browserSocket, 1000, 'terminal_closed_by_user');
    await this.persistSession(session);
    await this.deliverCloseTombstone(session);
    return true;
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
    if (!await Promise.resolve(this.isTerminalUseAuthorized(session))) {
      return false;
    }
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = undefined;
    }
    this.clearStartupTimer(session);
    if (
      session.runtime
      || session.status === 'active'
      || session.status === 'disconnected'
      || session.status === 'recovering'
      || session.status === 'closing'
    ) {
      if (liveSession && !this.sessions.has(session.id)) {
        this.sessions.set(session.id, session);
      }
      if (!liveSession && !this.sessions.has(session.id)) {
        this.sessions.set(session.id, session);
      }
      return this.beginCloseTombstone(session);
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
      agent_runner_id: this.readSessionResolvedRunnerId(session) ?? session.agentId,
      runner_session_id: session.runnerSessionId,
    });
    const bindVersion = this.nextBindVersion(session);
    this.closeBrowserSocket(session.browserSocket, 1012, 'terminal_replaced');
    session.browserSocket = ws;
    session.browserHandshakeComplete = false;
    session.browserReplayInProgress = false;
    session.queuedBrowserEvents = [];
    if (
      !session.runtime
      && session.status !== 'recovering'
      && session.status !== 'closing'
      && session.status !== 'closed'
      && session.status !== 'failed'
    ) {
      session.status = 'pending';
      session.lifecycleStatus = 'pending';
      session.runnerConnectionStatus = 'dispatching';
    }
    session.browserConnectionStatus = 'none';
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
    const hasUnsupportedView = Object.prototype.hasOwnProperty.call(payload, 'view');
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
    if (session.lifecycleStatus === 'recovering' || session.status === 'recovering') {
      session.status = 'recovering';
      session.lifecycleStatus = 'recovering';
      session.runnerConnectionStatus = session.runnerConnectionStatus === 'adopting' ? 'adopting' : 'transport_lost';
      session.browserConnectionStatus = 'attached';
      session.inputEnabled = false;
    } else if (session.lifecycleStatus === 'closing' || session.status === 'closing') {
      session.status = 'closing';
      session.lifecycleStatus = 'closing';
      session.browserConnectionStatus = 'attached';
      session.inputEnabled = false;
    } else if (session.runtime) {
      if (session.runtimeReady === true) {
        session.status = 'active';
        session.lifecycleStatus = 'active';
        session.runnerConnectionStatus = 'attached';
        session.browserConnectionStatus = 'attached';
        session.inputEnabled = true;
        this.clearStartupTimer(session);
        session.runtime.resize(cols, rows);
      }
    } else if (session.status !== 'closed' && session.status !== 'failed') {
      session.status = 'pending';
      session.lifecycleStatus = 'pending';
      session.runnerConnectionStatus = 'dispatching';
      session.browserConnectionStatus = 'attached';
      session.inputEnabled = false;
    }
    await this.persistSession(session);

    const browserBindStillCurrent = this.isCurrentBrowserBind(session, ws, bindVersion);
    if (browserBindStillCurrent) {
      if (session.lifecycleStatus === 'recovering') {
        this.sendToBrowserSocket(ws, {
          type: 'terminal.state',
          terminal_session_id: session.id,
          state: 'recovering',
          status: 'recovering',
          input_enabled: false,
          ...(session.recoveryDeadlineAt ? { recovery_deadline_at: session.recoveryDeadlineAt } : {}),
        });
      } else if (session.lifecycleStatus === 'closing') {
        this.sendToBrowserSocket(ws, {
          type: 'terminal.state',
          terminal_session_id: session.id,
          state: 'closing',
          status: 'closing',
          input_enabled: false,
        });
      }
      const replay = this.buildReplayPlan(session, afterSeq);
      this.sendReplay(session, ws, replay);
      session.browserReplayInProgress = false;
      this.flushQueuedBrowserPayloads(session);
    } else {
      session.browserReplayInProgress = false;
      session.queuedBrowserEvents = [];
    }

    if (
      session.runtime
      || session.status === 'recovering'
      || session.status === 'closing'
      || session.status === 'closed'
      || session.status === 'failed'
    ) {
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
        agent_runner_id: this.readSessionResolvedRunnerId(session) ?? session.agentId,
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
      const closeAuthorized = this.ensureTerminalUseAuthorized(session, ws);
      if (this.isPromiseLike(closeAuthorized)) {
        if (!await closeAuthorized) {
          return;
        }
        if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
          return;
        }
      } else if (!closeAuthorized) {
        return;
      }
      if (!this.isCurrentBrowserBind(session, ws, bindVersion)) {
        return;
      }
      await this.beginCloseTombstone(session);
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
    session.lifecycleStatus = status;
    session.runnerConnectionStatus = status === 'closed' ? 'closed' : 'missing';
    session.browserConnectionStatus = 'none';
    session.inputEnabled = false;
    session.recoverable = false;
    const endedAt = new Date().toISOString();
    session.lastActivityAt = endedAt;
    session.endedAt = endedAt;
    if (closeReason?.trim()) session.closeReason = closeReason.trim();
    if (exitCode !== undefined) session.exitCode = exitCode;
    if (status === 'failed' && !session.failureKind) {
      session.failureKind = closeReason === 'terminal_runtime_session_mismatch'
        ? 'terminal_runtime_session_mismatch'
        : closeReason === 'terminal_start_timeout'
          ? 'process_start_failed'
          : 'process_exited_unexpectedly';
    }
    if (status === 'closed') {
      session.failureKind = null;
    }
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
