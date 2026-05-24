import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { assertTaskExecutionContext } from '@mbos/agent-runner-contract';
import type { AgentResourceService } from './agent-resource-service.js';
import { AGENT_CONNECTION_TTL_MS, type AgentConnectionAuthKind } from './agent-presence-store.js';

export type RunnerSessionDispatchAuthority =
  | 'local_dispatchable'
  | 'remote_owned_not_local_dispatchable'
  | 'offline';

type DispatchScope = 'agent_fallback' | 'session_strict' | 'session_preferred_agent_fallback';
type AgentSocketLifecyclePhase = 'registering' | 'active' | 'superseded' | 'closing' | 'closed';
const TERMINAL_AGENT_SOCKET_LIFECYCLE_PHASES: ReadonlySet<AgentSocketLifecyclePhase> = new Set([
  'superseded',
  'closing',
  'closed',
]);

function isTerminalAgentSocketLifecyclePhase(phase: AgentSocketLifecyclePhase): boolean {
  return TERMINAL_AGENT_SOCKET_LIFECYCLE_PHASES.has(phase);
}

export interface AgentStreamEvent {
  type: 'delta' | 'done' | 'error' | 'event' | 'artifact';
  delta?: string;
  finish_reason?: string | null;
  usage_tokens?: number;
  error_code?: string;
  error_message?: string;
  event?: AgentExecutionTraceEventPayload;
  artifact?: AgentExecutionArtifactPayload;
}

export interface AgentTerminalEvent {
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
  reason?: RunnerDetachedReason;
}

export type RunnerDetachedReason =
  | 'agent_disconnected'
  | 'heartbeat_lost'
  | 'agent_stale_connection'
  | 'server_shutdown';

export type RunnerActiveTerminalDescriptor = {
  terminal_session_id: string;
  runner_session_id: string;
  generation: number;
  cols: number;
  rows: number;
  cwd?: string;
};

type RunnerReadyRecoveryMetadata = {
  runnerInstanceId: string;
  connectionEpoch: number;
};

export type TerminalRecoveryCoordinator = {
  handleRunnerDetached?: (event: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    runnerSessionId: string | null;
    connectionId: string;
    reason: RunnerDetachedReason;
    terminalSessionIds: string[];
    terminalProcessesTerminated?: boolean;
  }) => Promise<void> | void;
  handleRunnerReady?: (event: {
    workspaceId: string;
    projectId: string;
    agentId: string;
    runnerSessionId: string | null;
    runnerInstanceId: string | null;
    connectionId: string;
    connectionEpoch: number;
    activeTerminals: RunnerActiveTerminalDescriptor[];
  }) => Promise<void> | void;
  handleTerminalCloseAck?: (event: {
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
  }) => Promise<void> | void;
};

export type AdoptTerminalSessionInput = {
  workspaceId: string;
  projectId: string;
  sessionId: string;
  agentId: string;
  terminalSessionId: string;
  adoptAttemptId: string;
  connectionEpoch: number;
  generation: number;
  cols: number;
  rows: number;
  executionContext?: Record<string, unknown>;
};

export interface AgentExecutionTraceEventPayload {
  sequence: number;
  at: string;
  category: 'lifecycle' | 'progress' | 'tool' | 'artifact' | 'warning' | 'error' | 'debug';
  phase?: 'start' | 'update' | 'end';
  status?: 'running' | 'success' | 'error' | 'cancelled';
  name: string;
  summary: string;
  details?: Record<string, unknown>;
  raw?: string;
}

export interface AgentExecutionArtifactPayload {
  filename: string;
  task_relative_path: string;
  artifact_type: 'text' | 'image' | 'file' | 'other';
  mime_type?: string;
  file_size?: number;
  title?: string;
  content?: string;
  thumbnail_url?: string;
}

interface PendingStream {
  push: (event: AgentStreamEvent) => void;
  close: () => void;
  fail: (error: Error) => void;
  cancellationRequested?: boolean;
  cancelTimeout?: NodeJS.Timeout;
  firstEventTimer?: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
  maxRuntimeTimer?: NodeJS.Timeout;
  hasReceivedMeaningfulOutput?: boolean;
  lifecycleTraceEventsAreMeaningful?: boolean;
}

interface PendingTerminal {
  push: (event: AgentTerminalEvent) => void;
  close: () => void;
  fail: (error: Error) => void;
  runnerSessionId: string;
  controlScope: DispatchScope;
  lifecycle: 'start' | 'adopt';
  readyForInput?: boolean;
  pendingInput?: string;
  adoptAttemptId?: string;
  connectionEpoch?: number;
  generation?: number;
  firstEventTimer?: NodeJS.Timeout;
  idleTimer?: NodeJS.Timeout;
  maxRuntimeTimer?: NodeJS.Timeout;
  hasReceivedEvent?: boolean;
}

interface AgentSocketState {
  ws: WebSocket;
  socketKey: string;
  agentId: string;
  connectionId: string;
  apiInstanceId: string;
  sessionId?: string;
  workspaceId: string;
  projectId: string;
  authKind: AgentConnectionAuthKind;
  authKeyId?: string;
  authKeyExpiresAt?: string;
  connectedAt: string;
  pendingByRequestId: Map<string, PendingStream>;
  terminalBySessionId: Map<string, PendingTerminal>;
  heartbeatTimer?: NodeJS.Timeout;
  lastPingAt?: string;
  lastPongAt: string;
  missedPongs: number;
  connectionEpoch?: number;
  lifecyclePhase: AgentSocketLifecyclePhase;
  presenceRegistered: boolean;
  registrationLifecycle?: Promise<void>;
  releasePromise?: Promise<void>;
  refreshChain?: Promise<void>;
  readyChain?: Promise<void>;
  heartbeatInFlight?: Promise<void>;
}

interface AsyncQueue<T> {
  push: (item: T) => void;
  close: () => void;
  fail: (error: Error) => void;
  iterable: AsyncIterable<T>;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const items: T[] = [];
  const waiters: Array<(value: IteratorResult<T>) => void> = [];
  let closed = false;
  let error: Error | null = null;

  const push = (item: T) => {
    if (closed || error) return;
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
      return;
    }
    items.push(item);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.({ value: undefined as T, done: true });
    }
  };

  const fail = (err: Error) => {
    if (error) return;
    error = err;
    while (waiters.length > 0) {
      const waiter = waiters.shift();
      waiter?.(Promise.reject(err) as never);
    }
  };

  const iterable: AsyncIterable<T> = {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (error) {
            return Promise.reject(error);
          }
          if (items.length > 0) {
            return Promise.resolve({ value: items.shift() as T, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as T, done: true });
          }
          return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve));
        },
      };
    },
  };

  return { push, close, fail, iterable };
}

function parseBearerToken(req: http.IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice('bearer '.length).trim();
  return token || null;
}

function inferRemoteIp(req: http.IncomingMessage): string | undefined {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim();
  }
  return req.socket.remoteAddress ?? undefined;
}

function debugExecution(message: string): void {
  if (process.env.DEBUG_AGENT_EXECUTION !== '1') return;
  process.stdout.write(`[agent-execution] ${message}\n`);
}

function sanitizeDiagnosticText(input: string): string {
  const redacted = input
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(
      /\b(authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|token|key)=([^&\s]+)/gi,
      '$1=[redacted]',
    );
  return redacted.length > 200 ? `${redacted.slice(0, 197)}...` : redacted;
}

function normalizeCloseReason(reason: Buffer | string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  return sanitizeDiagnosticText(Buffer.isBuffer(reason) ? reason.toString('utf-8') : reason);
}

function logSocketCloseDiagnostic(
  socket: AgentSocketState,
  input: {
    closeKind: 'active_release' | 'passive_close';
    errorCode: string;
    closeCode: number;
    closeReason: string;
    closeEventCode?: number;
    closeEventReason?: Buffer;
  },
): void {
  const diagnostic: Record<string, unknown> = {
    event: 'agent_execution_ws_close',
    closeKind: input.closeKind,
    agent_id: socket.agentId,
    runner_session_id: socket.sessionId ?? null,
    connection_id: socket.connectionId,
    errorCode: input.errorCode,
    closeCode: input.closeCode,
    closeReason: normalizeCloseReason(input.closeReason) ?? '',
    lifecyclePhase: socket.lifecyclePhase,
    socketKey: socket.socketKey,
  };
  if (typeof input.closeEventCode === 'number') {
    diagnostic.closeEventCode = input.closeEventCode;
  }
  const closeEventReason = normalizeCloseReason(input.closeEventReason);
  if (closeEventReason !== undefined) {
    diagnostic.closeEventReason = closeEventReason;
  }
  try {
    process.stdout.write(`[agent-execution] ws_close_diagnostic ${JSON.stringify(diagnostic)}\n`);
  } catch {
    // Diagnostics must never alter websocket release behavior.
  }
}

function logRunnerReadyRecoveryDiagnostic(socket: AgentSocketState, error: unknown): void {
  const diagnostic: Record<string, unknown> = {
    event: 'agent_execution_runner_ready_recovery_failed',
    agent_id: socket.agentId,
    runner_session_id: socket.sessionId ?? null,
    connection_id: socket.connectionId,
    lifecyclePhase: socket.lifecyclePhase,
    socketKey: socket.socketKey,
    error: sanitizeDiagnosticText(error instanceof Error ? error.message : String(error)),
  };
  try {
    process.stdout.write(`[agent-execution] terminal recovery runner ready failed ${JSON.stringify(diagnostic)}\n`);
  } catch {
    // Diagnostics must never alter ready handling.
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function parseTraceEventPayload(input: unknown): AgentExecutionTraceEventPayload | null {
  if (!isPlainRecord(input)) return null;
  const sequence = input.sequence;
  const category = input.category;
  const name = input.name;
  const summary = input.summary;
  if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return null;
  if (
    category !== 'lifecycle'
    && category !== 'progress'
    && category !== 'tool'
    && category !== 'artifact'
    && category !== 'warning'
    && category !== 'error'
    && category !== 'debug'
  ) return null;
  if (typeof name !== 'string' || name.trim().length === 0) return null;
  if (typeof summary !== 'string') return null;

  const phase = input.phase;
  const status = input.status;
  const details = input.details;
  const raw = input.raw;
  if (phase !== undefined && phase !== 'start' && phase !== 'update' && phase !== 'end') return null;
  if (
    status !== undefined
    && status !== 'running'
    && status !== 'success'
    && status !== 'error'
    && status !== 'cancelled'
  ) return null;
  if (details !== undefined && !isPlainRecord(details)) return null;
  if (raw !== undefined && typeof raw !== 'string') return null;

  return {
    sequence,
    at: nowIso(),
    category,
    ...(phase ? { phase } : {}),
    ...(status ? { status } : {}),
    name,
    summary,
    ...(details ? { details } : {}),
    ...(typeof raw === 'string' ? { raw } : {}),
  };
}

function parseArtifactPayload(input: unknown): AgentExecutionArtifactPayload | null {
  if (!isPlainRecord(input)) return null;
  const filename = input.filename;
  const taskRelativePath = input.task_relative_path;
  const artifactType = input.artifact_type;
  if (typeof filename !== 'string' || filename.trim().length === 0) return null;
  if (typeof taskRelativePath !== 'string' || taskRelativePath.trim().length === 0) return null;
  const normalizedTaskRelativePath = taskRelativePath.trim();
  if (normalizedTaskRelativePath !== '.artifacts' && !normalizedTaskRelativePath.startsWith('.artifacts/')) {
    return null;
  }
  if (artifactType !== 'text' && artifactType !== 'image' && artifactType !== 'file' && artifactType !== 'other') {
    return null;
  }
  const mimeType = input.mime_type;
  const fileSize = input.file_size;
  const title = input.title;
  const content = input.content;
  const thumbnailUrl = input.thumbnail_url;
  if (mimeType !== undefined && typeof mimeType !== 'string') return null;
  if (fileSize !== undefined && (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize < 0)) {
    return null;
  }
  if (title !== undefined && typeof title !== 'string') return null;
  if (content !== undefined && typeof content !== 'string') return null;
  if (thumbnailUrl !== undefined && typeof thumbnailUrl !== 'string') return null;
  return {
    filename: filename.trim(),
    task_relative_path: normalizedTaskRelativePath,
    artifact_type: artifactType,
    ...(typeof mimeType === 'string' && mimeType.trim() ? { mime_type: mimeType.trim() } : {}),
    ...(typeof fileSize === 'number' ? { file_size: fileSize } : {}),
    ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
    ...(typeof content === 'string' ? { content } : {}),
    ...(typeof thumbnailUrl === 'string' ? { thumbnail_url: thumbnailUrl } : {}),
  };
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function readNonEmptyString(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return trimmed ? trimmed : null;
}

function readNonNegativeInteger(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) {
    return null;
  }
  return input;
}

function readPositiveInteger(input: unknown, minimum: number): number | null {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < minimum) {
    return null;
  }
  return input;
}

function isPositiveSafeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
}

function resolveStreamingDispatchScope(executionContext?: Record<string, unknown>): DispatchScope {
  return executionContext?.runner_session_scope === 'agent_presence'
    ? 'session_preferred_agent_fallback'
    : executionContext?.runner_session_scope === 'task_execution'
      ? 'session_strict'
      : 'agent_fallback';
}

export type AgentExecutionServiceOptions = {
  heartbeatIntervalMs?: number;
  heartbeatMaxMisses?: number;
  streamFirstEventTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  streamMaxRuntimeMs?: number;
  terminalFirstEventTimeoutMs?: number;
  terminalIdleTimeoutMs?: number;
  terminalMaxRuntimeMs?: number;
};

type ResolvedAgentExecutionServiceOptions = {
  heartbeatIntervalMs: number;
  heartbeatMaxMisses: number;
  streamFirstEventTimeoutMs: number;
  streamIdleTimeoutMs: number;
  streamMaxRuntimeMs: number;
  terminalFirstEventTimeoutMs: number;
  terminalIdleTimeoutMs: number;
  terminalMaxRuntimeMs: number;
};

const DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_AGENT_HEARTBEAT_MAX_MISSES = 2;
const DEFAULT_AGENT_STREAM_FIRST_EVENT_TIMEOUT_MS = 45_000;
const DEFAULT_AGENT_STREAM_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_AGENT_STREAM_MAX_RUNTIME_MS = 45 * 60_000;
const DEFAULT_AGENT_TERMINAL_FIRST_EVENT_TIMEOUT_MS = 45_000;
const DEFAULT_AGENT_TERMINAL_IDLE_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_AGENT_TERMINAL_MAX_RUNTIME_MS = 24 * 60 * 60_000;
const SOCKET_PRESENCE_RELEASE_MAX_ATTEMPTS = 6;
const SOCKET_PRESENCE_RELEASE_BACKOFF_BASE_MS = 20;
const SOCKET_PRESENCE_RELEASE_BACKOFF_MAX_MS = 250;
const SOCKET_PRESENCE_RELEASE_REPAIR_WINDOW_MS = AGENT_CONNECTION_TTL_MS;
const SOCKET_HANDOFF_SETTLE_MS = 20;

function resolvePositiveMs(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function resolvePositiveInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveAgentExecutionServiceOptions(
  options?: AgentExecutionServiceOptions,
): ResolvedAgentExecutionServiceOptions {
  return {
    heartbeatIntervalMs: resolvePositiveMs(options?.heartbeatIntervalMs, DEFAULT_AGENT_HEARTBEAT_INTERVAL_MS),
    heartbeatMaxMisses: resolvePositiveInteger(options?.heartbeatMaxMisses, DEFAULT_AGENT_HEARTBEAT_MAX_MISSES),
    streamFirstEventTimeoutMs: resolvePositiveMs(
      options?.streamFirstEventTimeoutMs,
      DEFAULT_AGENT_STREAM_FIRST_EVENT_TIMEOUT_MS,
    ),
    streamIdleTimeoutMs: resolvePositiveMs(options?.streamIdleTimeoutMs, DEFAULT_AGENT_STREAM_IDLE_TIMEOUT_MS),
    streamMaxRuntimeMs: resolvePositiveMs(options?.streamMaxRuntimeMs, DEFAULT_AGENT_STREAM_MAX_RUNTIME_MS),
    terminalFirstEventTimeoutMs: resolvePositiveMs(
      options?.terminalFirstEventTimeoutMs,
      DEFAULT_AGENT_TERMINAL_FIRST_EVENT_TIMEOUT_MS,
    ),
    terminalIdleTimeoutMs: resolvePositiveMs(options?.terminalIdleTimeoutMs, DEFAULT_AGENT_TERMINAL_IDLE_TIMEOUT_MS),
    terminalMaxRuntimeMs: resolvePositiveMs(options?.terminalMaxRuntimeMs, DEFAULT_AGENT_TERMINAL_MAX_RUNTIME_MS),
  };
}

export class AgentExecutionService {
  private readonly wsServer: WebSocketServer;
  private readonly socketsByKey = new Map<string, AgentSocketState>();
  private readonly socketsByWebSocket = new Map<WebSocket, AgentSocketState>();
  private readonly backgroundTasks = new Set<Promise<unknown>>();
  private readonly runnerDetachChainsBySocketKey = new Map<string, Promise<void>>();
  private readonly apiInstanceId = randomUUID();
  private readonly options: ResolvedAgentExecutionServiceOptions;
  private terminalRecoveryCoordinator: TerminalRecoveryCoordinator = {};
  private shuttingDown = false;

  constructor(
    private readonly agentResourceService: AgentResourceService,
    options?: AgentExecutionServiceOptions,
  ) {
    this.options = resolveAgentExecutionServiceOptions(options);
    this.wsServer = new WebSocketServer({ noServer: true });
    this.wsServer.on('connection', (ws, _req) => {
      const socketState = this.socketsByWebSocket.get(ws);
      if (!socketState) {
        ws.close(1011, 'agent_state_missing');
        return;
      }

      ws.send(
        JSON.stringify({
          type: 'server.hello',
          timestamp: new Date().toISOString(),
          payload: {
            protocol_version: '1.0',
            heartbeat_interval_sec: this.options.heartbeatIntervalMs / 1000,
          },
        }),
      );

      ws.on('message', (data) => this.handleAgentMessage(ws, data));
      ws.on('close', (code, reason) => this.handleSocketClose(ws, code, reason));
      ws.on('error', () => this.handleSocketClose(ws));
    });
  }

  registerTerminalRecoveryCoordinator(coordinator: TerminalRecoveryCoordinator): void {
    this.terminalRecoveryCoordinator = coordinator;
  }

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this.shuttingDown) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/api/v1/agent-execution/ws') {
      debugExecution(`reject path=${url.pathname}`);
      socket.destroy();
      return;
    }

    const agentId = readNonEmptyString(url.searchParams.get('agent_runner_id')) ?? '';
    const sessionId = readNonEmptyString(url.searchParams.get('runner_session_id')) ?? undefined;
    if (!agentId) {
      debugExecution('reject missing_agent_runner_id');
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = parseBearerToken(req);
    if (!token) {
      debugExecution(`reject missing_token agent_id=${agentId}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    void this.agentResourceService.verifyAgentKey(agentId, token).then(async (keyRecord) => {
      if (!keyRecord) {
        debugExecution(`reject invalid_key agent_id=${agentId}`);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      const agent = await this.agentResourceService.getAgent(
        keyRecord.workspace_id,
        keyRecord.project_id,
        agentId,
      );
      if (!agent || agent.status !== 'enabled') {
        debugExecution(
          `reject agent_not_enabled_or_missing agent_id=${agentId} ws=${keyRecord.workspace_id} proj=${keyRecord.project_id} has_agent=${agent ? '1' : '0'} status=${agent?.status ?? 'null'}`,
        );
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      debugExecution(`accept agent_id=${agentId} ws=${keyRecord.workspace_id} proj=${keyRecord.project_id}`);

      const socketKey = buildSocketKey(agentId, sessionId);
      const existing = this.socketsByKey.get(socketKey);

      this.wsServer.handleUpgrade(req, socket, head, (ws) => {
        const now = new Date().toISOString();
        const connectionId = randomUUID();
        const authKind: AgentConnectionAuthKind = keyRecord.expires_at ? 'service_key' : 'managed_private_key';
        const socketState: AgentSocketState = {
          ws,
          socketKey,
          agentId,
          connectionId,
          apiInstanceId: this.apiInstanceId,
          ...(sessionId ? { sessionId } : {}),
          workspaceId: keyRecord.workspace_id,
          projectId: keyRecord.project_id,
          authKind,
          authKeyId: keyRecord.id,
          ...(keyRecord.expires_at ? { authKeyExpiresAt: keyRecord.expires_at } : {}),
          connectedAt: now,
          pendingByRequestId: new Map(),
          terminalBySessionId: new Map(),
          lastPongAt: now,
          missedPongs: 0,
          lifecyclePhase: 'registering',
          presenceRegistered: false,
        };
        this.socketsByWebSocket.set(ws, socketState);
        const registrationTask = this.registerSocketLifecycle({
          socketKey,
          socket: socketState,
          previousSocket: existing,
          remoteIp: inferRemoteIp(req),
        });
        const trackedRegistrationTask = this.trackBackgroundTask(registrationTask.finally(() => {
          if (socketState.registrationLifecycle === trackedRegistrationTask) {
            socketState.registrationLifecycle = undefined;
          }
        }));
        socketState.registrationLifecycle = trackedRegistrationTask;
        this.wsServer.emit('connection', ws, req);
      });
    }).catch(() => {
      debugExecution(`reject internal_error agent_id=${agentId}`);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  }

  private clearStreamTimers(pending: PendingStream): void {
    if (pending.cancelTimeout) clearTimeout(pending.cancelTimeout);
    if (pending.firstEventTimer) clearTimeout(pending.firstEventTimer);
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxRuntimeTimer) clearTimeout(pending.maxRuntimeTimer);
    pending.cancelTimeout = undefined;
    pending.firstEventTimer = undefined;
    pending.idleTimer = undefined;
    pending.maxRuntimeTimer = undefined;
  }

  private clearTerminalTimers(pending: PendingTerminal): void {
    if (pending.firstEventTimer) clearTimeout(pending.firstEventTimer);
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxRuntimeTimer) clearTimeout(pending.maxRuntimeTimer);
    pending.firstEventTimer = undefined;
    pending.idleTimer = undefined;
    pending.maxRuntimeTimer = undefined;
  }

  private failPendingStream(
    socket: AgentSocketState,
    requestId: string,
    errorCode: string,
    errorMessage: string,
  ): void {
    const pending = socket.pendingByRequestId.get(requestId);
    if (!pending) return;
    socket.pendingByRequestId.delete(requestId);
    this.clearStreamTimers(pending);
    pending.push({
      type: 'error',
      error_code: errorCode,
      error_message: errorMessage,
    });
    pending.close();
  }

  private failPendingTerminal(
    socket: AgentSocketState,
    terminalSessionId: string,
    errorCode: string,
    errorMessage: string,
  ): void {
    const pending = socket.terminalBySessionId.get(terminalSessionId);
    if (!pending) return;
    socket.terminalBySessionId.delete(terminalSessionId);
    this.clearTerminalTimers(pending);
    pending.push({
      type: 'error',
      terminal_session_id: terminalSessionId,
      error_code: errorCode,
      error_message: errorMessage,
    });
    pending.close();
  }

  private markStreamMeaningfulOutput(pending: PendingStream): void {
    if (!pending.hasReceivedMeaningfulOutput) {
      pending.hasReceivedMeaningfulOutput = true;
      if (pending.firstEventTimer) {
        clearTimeout(pending.firstEventTimer);
        pending.firstEventTimer = undefined;
      }
    }
  }

  private markStreamActivity(socket: AgentSocketState, requestId: string, pending: PendingStream): void {
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    pending.idleTimer = setTimeout(() => {
      this.failPendingStream(socket, requestId, 'AGENT_REQUEST_TIMEOUT', 'agent_request_idle_timeout');
    }, this.options.streamIdleTimeoutMs);
    pending.idleTimer.unref?.();
  }

  private shouldTreatEventAsMeaningfulOutput(
    pending: PendingStream,
    eventPayload: AgentExecutionTraceEventPayload,
  ): boolean {
    if (eventPayload.category === 'lifecycle' && !pending.lifecycleTraceEventsAreMeaningful) {
      return false;
    }
    return true;
  }

  private markTerminalEvent(socket: AgentSocketState, terminalSessionId: string, pending: PendingTerminal): void {
    if (!pending.hasReceivedEvent) {
      pending.hasReceivedEvent = true;
      if (pending.firstEventTimer) {
        clearTimeout(pending.firstEventTimer);
        pending.firstEventTimer = undefined;
      }
    }
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    pending.idleTimer = setTimeout(() => {
      this.failPendingTerminal(
        socket,
        terminalSessionId,
        'AGENT_TERMINAL_TIMEOUT',
        'agent_terminal_idle_timeout',
      );
    }, this.options.terminalIdleTimeoutMs);
    pending.idleTimer.unref?.();
  }

  private armStreamTimeouts(socket: AgentSocketState, requestId: string, pending: PendingStream): void {
    pending.firstEventTimer = setTimeout(() => {
      this.failPendingStream(socket, requestId, 'AGENT_REQUEST_TIMEOUT', 'agent_request_first_event_timeout');
    }, this.options.streamFirstEventTimeoutMs);
    pending.firstEventTimer.unref?.();
    pending.maxRuntimeTimer = setTimeout(() => {
      this.failPendingStream(socket, requestId, 'AGENT_REQUEST_TIMEOUT', 'agent_request_max_runtime_timeout');
    }, this.options.streamMaxRuntimeMs);
    pending.maxRuntimeTimer.unref?.();
  }

  private armTerminalTimeouts(socket: AgentSocketState, terminalSessionId: string, pending: PendingTerminal): void {
    pending.firstEventTimer = setTimeout(() => {
      this.failPendingTerminal(
        socket,
        terminalSessionId,
        'AGENT_TERMINAL_TIMEOUT',
        'agent_terminal_first_event_timeout',
      );
    }, this.options.terminalFirstEventTimeoutMs);
    pending.firstEventTimer.unref?.();
    pending.maxRuntimeTimer = setTimeout(() => {
      this.failPendingTerminal(
        socket,
        terminalSessionId,
        'AGENT_TERMINAL_TIMEOUT',
        'agent_terminal_max_runtime_timeout',
      );
    }, this.options.terminalMaxRuntimeMs);
    pending.maxRuntimeTimer.unref?.();
  }

  private startHeartbeat(socketKey: string, socket: AgentSocketState): void {
    socket.heartbeatTimer = setInterval(() => {
      if (socket.heartbeatInFlight) {
        return;
      }
      const tick = this.trackBackgroundTask(this.runHeartbeatTick(socketKey, socket).finally(() => {
        if (socket.heartbeatInFlight === tick) {
          socket.heartbeatInFlight = undefined;
        }
      }));
      socket.heartbeatInFlight = tick;
    }, this.options.heartbeatIntervalMs);
    socket.heartbeatTimer.unref?.();
  }

  private clearSocketHeartbeat(socket: AgentSocketState): void {
    if (!socket.heartbeatTimer) return;
    clearInterval(socket.heartbeatTimer);
    socket.heartbeatTimer = undefined;
    socket.heartbeatInFlight = undefined;
  }

  private trackBackgroundTask<T>(task: Promise<T>): Promise<T> {
    this.backgroundTasks.add(task);
    task.finally(() => {
      this.backgroundTasks.delete(task);
    }).catch(() => undefined);
    return task;
  }

  private isSocketOpen(socket: AgentSocketState | undefined): socket is AgentSocketState {
    return !!socket && socket.ws.readyState === socket.ws.OPEN;
  }

  private isSocketDispatchable(socket: AgentSocketState | undefined): socket is AgentSocketState {
    return this.isSocketOpen(socket) && socket.lifecyclePhase === 'active';
  }

  private scheduleSocketPresenceRelease(socket: AgentSocketState): Promise<void> {
    if (socket.releasePromise) {
      return socket.releasePromise;
    }
    if (!socket.presenceRegistered) {
      return Promise.resolve();
    }
    const release = this.trackBackgroundTask(this.releaseSocketPresenceWithRetry(socket));
    socket.releasePromise = release.finally(() => {
      if (socket.releasePromise === release) {
        socket.releasePromise = undefined;
      }
    });
    return socket.releasePromise;
  }

  private async releaseSocketPresenceWithRetry(socket: AgentSocketState): Promise<void> {
    const deadline = Date.now() + SOCKET_PRESENCE_RELEASE_REPAIR_WINDOW_MS;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.agentResourceService.releaseAgentConnection({
          workspaceId: socket.workspaceId,
          projectId: socket.projectId,
          agentId: socket.agentId,
          connectionId: socket.connectionId,
        });
        socket.presenceRegistered = false;
        return;
      } catch (error) {
        const stale = await this.agentResourceService.isAgentConnectionCurrent(
          socket.agentId,
          socket.connectionId,
        ).then((isCurrent) => !isCurrent).catch(() => false);
        if (stale) {
          socket.presenceRegistered = false;
          return;
        }
        if (attempt >= SOCKET_PRESENCE_RELEASE_MAX_ATTEMPTS && Date.now() >= deadline) {
          debugExecution(
            `release presence failed agent_id=${socket.agentId} connection_id=${socket.connectionId} attempts=${attempt} error=${error instanceof Error ? error.message : String(error)}`,
          );
          throw error;
        }
        debugExecution(
          `release presence retrying agent_id=${socket.agentId} connection_id=${socket.connectionId} attempt=${attempt} error=${error instanceof Error ? error.message : String(error)}`,
        );
        const backoffMs = Math.min(
          SOCKET_PRESENCE_RELEASE_BACKOFF_BASE_MS * (2 ** (attempt - 1)),
          SOCKET_PRESENCE_RELEASE_BACKOFF_MAX_MS,
        );
        await delay(backoffMs);
      }
    }
  }

  private async waitForSocketRegistrationTurn(): Promise<void> {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }

  private async waitForSocketHandoffSettle(): Promise<void> {
    await delay(SOCKET_HANDOFF_SETTLE_MS);
  }

  private async restorePreviousSocketAuthority(args: {
    socketKey: string;
    socket: AgentSocketState;
    previousSocket?: AgentSocketState;
  }): Promise<void> {
    const previousSocket = args.previousSocket;
    if (!previousSocket || previousSocket.lifecyclePhase === 'closed' || !this.isSocketOpen(previousSocket)) {
      await this.scheduleSocketPresenceRelease(args.socket);
      return;
    }

    try {
      await this.agentResourceService.registerAgentConnection({
        agentId: previousSocket.agentId,
        workspaceId: previousSocket.workspaceId,
        projectId: previousSocket.projectId,
        connectionId: previousSocket.connectionId,
        socketKey: previousSocket.socketKey,
        apiInstanceId: previousSocket.apiInstanceId,
        ...(previousSocket.sessionId ? { sessionId: previousSocket.sessionId } : {}),
        protocolVersion: '1.0',
        connectedAt: previousSocket.connectedAt,
        lastPongAt: previousSocket.lastPongAt,
        authenticatedKey: {
          kind: previousSocket.authKind,
          ...(previousSocket.authKeyId ? { keyId: previousSocket.authKeyId } : {}),
          ...(previousSocket.authKeyExpiresAt ? { expiresAt: previousSocket.authKeyExpiresAt } : {}),
        },
      });
      args.socket.presenceRegistered = false;
      previousSocket.presenceRegistered = true;
      previousSocket.lifecyclePhase = 'active';
      this.socketsByKey.set(args.socketKey, previousSocket);
    } catch (error) {
      debugExecution(
        `rollback restore failed agent_id=${previousSocket.agentId} connection_id=${previousSocket.connectionId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      void this.scheduleSocketPresenceRelease(args.socket);
      this.releaseSocketState(previousSocket, {
        errorCode: 'AGENT_CONNECTION_AUTHORITY_FAILED',
        errorMessage: 'agent_connection_authority_failed',
        closeCode: 1011,
        closeReason: 'agent_connection_authority_failed',
      });
    }
  }

  private queueSocketRefresh(socket: AgentSocketState, lastPongAt: string): void {
    const previous = socket.refreshChain ?? Promise.resolve();
    const refreshTask = previous
      .catch(() => undefined)
      .then(async () => {
        if (socket.lifecyclePhase !== 'active') return;
        try {
          const result = await this.agentResourceService.refreshAgentConnection({
            agentId: socket.agentId,
            connectionId: socket.connectionId,
            lastPongAt,
            protocolVersion: '1.0',
          });
          if (result.stale) {
            this.releaseSocketState(socket, {
              errorCode: 'AGENT_STALE_CONNECTION',
              errorMessage: 'agent_stale_connection',
              closeCode: 4001,
              closeReason: 'agent_stale_connection',
            });
          }
        } catch (error) {
          debugExecution(
            `refresh authority failed agent_id=${socket.agentId} connection_id=${socket.connectionId} error=${error instanceof Error ? error.message : String(error)}`,
          );
          this.releaseSocketState(socket, {
            errorCode: 'AGENT_CONNECTION_AUTHORITY_FAILED',
            errorMessage: 'agent_connection_authority_failed',
            closeCode: 1011,
            closeReason: 'agent_connection_authority_failed',
          });
        }
      });
    const trackedRefreshTask = this.trackBackgroundTask(refreshTask.finally(() => {
      if (socket.refreshChain === trackedRefreshTask) {
        socket.refreshChain = undefined;
      }
    }));
    socket.refreshChain = trackedRefreshTask;
  }

  private async getAuthoritativeConnection(
    agentId: string,
    sessionId: string,
    scope: DispatchScope,
  ) {
    return this.agentResourceService.getAuthorizedSessionConnectionInfo(agentId, sessionId, {
      allowAgentFallback: scope === 'agent_fallback',
    });
  }

  private resolvePrimarySocket(agentId: string, sessionId: string, scope: DispatchScope): AgentSocketState | undefined {
    if (scope === 'session_strict') {
      return this.socketsByKey.get(buildSocketKey(agentId, sessionId));
    }
    const exact = this.socketsByKey.get(buildSocketKey(agentId, sessionId));
    if (exact) return exact;
    return this.socketsByKey.get(buildSocketKey(agentId));
  }

  private releaseStaleSocket(socket: AgentSocketState | undefined): void {
    if (!socket) {
      return;
    }
    this.releaseSocketState(socket, {
      errorCode: 'AGENT_STALE_CONNECTION',
      errorMessage: 'agent_stale_connection',
      closeCode: 4001,
      closeReason: 'agent_stale_connection',
    });
  }

  private async resolveSessionPreferredAgentFallbackSocket(input: {
    agentId: string;
    sessionId: string;
  }): Promise<AgentSocketState | null> {
    const exactLocal = this.socketsByKey.get(buildSocketKey(input.agentId, input.sessionId));
    const exactAuthoritative = await this.getAuthoritativeConnection(
      input.agentId,
      input.sessionId,
      'session_strict',
    );
    if (exactAuthoritative) {
      if (exactAuthoritative.api_instance_id && exactAuthoritative.api_instance_id !== this.apiInstanceId) {
        this.releaseStaleSocket(exactLocal);
        return null;
      }
      if (!this.isSocketDispatchable(exactLocal)) {
        return null;
      }
      if (exactLocal.connectionId !== exactAuthoritative.connection_id) {
        this.releaseStaleSocket(exactLocal);
        return null;
      }
      return exactLocal;
    }

    const fallbackLocal = this.socketsByKey.get(buildSocketKey(input.agentId));
    const fallbackAuthoritative = await this.getAuthoritativeConnection(
      input.agentId,
      input.sessionId,
      'agent_fallback',
    );
    if (!fallbackAuthoritative) {
      this.releaseStaleSocket(fallbackLocal);
      return null;
    }
    if (fallbackAuthoritative.session_id !== undefined) {
      return null;
    }
    if (fallbackAuthoritative.api_instance_id && fallbackAuthoritative.api_instance_id !== this.apiInstanceId) {
      this.releaseStaleSocket(fallbackLocal);
      return null;
    }
    if (!this.isSocketDispatchable(fallbackLocal)) {
      return null;
    }
    if (fallbackLocal.connectionId !== fallbackAuthoritative.connection_id) {
      this.releaseStaleSocket(fallbackLocal);
      return null;
    }
    return fallbackLocal;
  }

  private async resolveDispatchSocket(input: {
    agentId: string;
    sessionId: string;
    scope: DispatchScope;
  }): Promise<AgentSocketState | null> {
    if (input.scope === 'session_preferred_agent_fallback') {
      return this.resolveSessionPreferredAgentFallbackSocket({
        agentId: input.agentId,
        sessionId: input.sessionId,
      });
    }
    const local = this.resolvePrimarySocket(input.agentId, input.sessionId, input.scope);
    const authoritative = await this.getAuthoritativeConnection(input.agentId, input.sessionId, input.scope);
    if (!authoritative) {
      this.releaseStaleSocket(local);
      return null;
    }
    if (authoritative.api_instance_id && authoritative.api_instance_id !== this.apiInstanceId) {
      this.releaseStaleSocket(local);
      return null;
    }
    if (!this.isSocketDispatchable(local)) {
      return null;
    }
    if (local.connectionId !== authoritative.connection_id) {
      this.releaseStaleSocket(local);
      return null;
    }
    return local;
  }

  private queueTerminalControlFrame(input: {
    socket: AgentSocketState;
    sessionId: string;
    scope: DispatchScope;
    terminalSessionId: string;
    type: 'server.terminal.stdin' | 'server.terminal.resize' | 'server.terminal.close';
    requestId?: string;
    payload: Record<string, unknown>;
  }): void {
    const task = this.resolveDispatchSocket({
      agentId: input.socket.agentId,
      sessionId: input.sessionId,
      scope: input.scope,
    }).then((authoritativeSocket) => {
      if (!authoritativeSocket || authoritativeSocket !== input.socket) {
        return;
      }
      if (!input.socket.terminalBySessionId.has(input.terminalSessionId)) {
        return;
      }
      const sent = this.trySendSocketFrame(input.socket, {
        type: input.type,
        ...(input.requestId ? { request_id: input.requestId } : {}),
        runner_session_id: input.sessionId,
        terminal_session_id: input.terminalSessionId,
        timestamp: new Date().toISOString(),
        payload: input.payload,
      }, 'agent_dispatch_send_failed');
      if (!sent) {
        return;
      }
    }).catch((error) => {
      debugExecution(
        `terminal control authority failed agent_id=${input.socket.agentId} connection_id=${input.socket.connectionId} terminal_session=${input.terminalSessionId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      this.releaseSocketState(input.socket, {
        errorCode: 'AGENT_CONNECTION_AUTHORITY_FAILED',
        errorMessage: 'agent_connection_authority_failed',
        closeCode: 1011,
        closeReason: 'agent_connection_authority_failed',
      });
    });
    void this.trackBackgroundTask(task);
  }

  private queueTerminalInputFrame(input: {
    socket: AgentSocketState;
    pendingTerminal: PendingTerminal;
    terminalSessionId: string;
    data: string;
  }): void {
    if (!input.pendingTerminal.readyForInput) {
      input.pendingTerminal.pendingInput = `${input.pendingTerminal.pendingInput ?? ''}${input.data}`;
      return;
    }
    this.queueTerminalControlFrame({
      socket: input.socket,
      sessionId: input.pendingTerminal.runnerSessionId,
      scope: input.pendingTerminal.controlScope,
      terminalSessionId: input.terminalSessionId,
      type: 'server.terminal.stdin',
      payload: { data: input.data },
    });
  }

  private flushBufferedTerminalInput(
    socket: AgentSocketState,
    terminalSessionId: string,
    pendingTerminal: PendingTerminal,
  ): void {
    const data = pendingTerminal.pendingInput;
    pendingTerminal.pendingInput = undefined;
    if (!data) return;
    this.queueTerminalControlFrame({
      socket,
      sessionId: pendingTerminal.runnerSessionId,
      scope: pendingTerminal.controlScope,
      terminalSessionId,
      type: 'server.terminal.stdin',
      payload: { data },
    });
  }

  private async registerSocketLifecycle(args: {
    socketKey: string;
    socket: AgentSocketState;
    previousSocket?: AgentSocketState;
    remoteIp?: string;
  }): Promise<void> {
    try {
      await this.agentResourceService.registerAgentConnection({
        agentId: args.socket.agentId,
        workspaceId: args.socket.workspaceId,
        projectId: args.socket.projectId,
        connectionId: args.socket.connectionId,
        socketKey: args.socketKey,
        apiInstanceId: args.socket.apiInstanceId,
        ...(args.socket.sessionId ? { sessionId: args.socket.sessionId } : {}),
        ...(args.remoteIp ? { remoteIp: args.remoteIp } : {}),
        protocolVersion: '1.0',
        connectedAt: args.socket.connectedAt,
        lastPongAt: args.socket.lastPongAt,
        authenticatedKey: {
          kind: args.socket.authKind,
          ...(args.socket.authKeyId ? { keyId: args.socket.authKeyId } : {}),
          ...(args.socket.authKeyExpiresAt ? { expiresAt: args.socket.authKeyExpiresAt } : {}),
        },
      });
      args.socket.presenceRegistered = true;
    } catch (error) {
      debugExecution(
        `register failed agent_id=${args.socket.agentId} connection_id=${args.socket.connectionId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      if (args.previousSocket && args.previousSocket.lifecyclePhase !== 'closed' && this.isSocketOpen(args.previousSocket)) {
        args.previousSocket.lifecyclePhase = 'active';
        this.socketsByKey.set(args.socketKey, args.previousSocket);
      }
      this.releaseSocketState(args.socket, {
        errorCode: 'AGENT_CONNECTION_REGISTRATION_FAILED',
        errorMessage: 'agent_connection_registration_failed',
        closeCode: 1011,
        closeReason: 'agent_connection_registration_failed',
        skipPresenceUpdate: true,
      });
      return;
    }

    if (this.shuttingDown) {
      this.releaseSocketState(args.socket, {
        errorCode: 'AGENT_SERVICE_SHUTDOWN',
        errorMessage: 'agent_service_shutdown',
        closeCode: 1001,
        closeReason: 'server_shutdown',
      });
      return;
    }
    if (!this.isSocketOpen(args.socket)) {
      await this.restorePreviousSocketAuthority(args);
      return;
    }
    await this.waitForSocketRegistrationTurn();
    if (args.socket.lifecyclePhase !== 'registering' || !this.isSocketOpen(args.socket)) {
      await this.restorePreviousSocketAuthority(args);
      return;
    }
    args.socket.lifecyclePhase = 'active';
    this.socketsByKey.set(args.socketKey, args.socket);
    this.startHeartbeat(args.socketKey, args.socket);
    if (args.previousSocket && args.previousSocket !== args.socket && args.previousSocket.lifecyclePhase !== 'closed') {
      args.previousSocket.lifecyclePhase = 'superseded';
      await this.waitForSocketHandoffSettle();
      if (args.socket.lifecyclePhase !== 'active' || !this.isSocketOpen(args.socket)) {
        await this.restorePreviousSocketAuthority(args);
        return;
      }
      if (args.previousSocket.lifecyclePhase === 'superseded') {
        this.releaseSocketState(args.previousSocket, {
          errorCode: 'AGENT_DISCONNECTED',
          errorMessage: 'agent_reconnected',
          closeCode: 1012,
          closeReason: 'agent_replaced',
          skipPresenceUpdate: true,
        });
      }
    }
  }

  private async runHeartbeatTick(socketKey: string, socket: AgentSocketState): Promise<void> {
    const current = this.socketsByKey.get(socketKey);
    if (current !== socket || socket.lifecyclePhase !== 'active') return;

    let isCurrent = false;
    try {
      isCurrent = await this.agentResourceService.isAgentConnectionCurrent(socket.agentId, socket.connectionId);
    } catch (error) {
      debugExecution(
        `heartbeat authority failed agent_id=${socket.agentId} connection_id=${socket.connectionId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_CONNECTION_AUTHORITY_FAILED',
        errorMessage: 'agent_connection_authority_failed',
        closeCode: 1011,
        closeReason: 'agent_connection_authority_failed',
      });
      return;
    }

    if (this.socketsByKey.get(socketKey) !== socket) return;

    if (!isCurrent) {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_STALE_CONNECTION',
        errorMessage: 'agent_stale_connection',
        closeCode: 4001,
        closeReason: 'agent_stale_connection',
      });
      return;
    }
    if (socket.ws.readyState !== socket.ws.OPEN) {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_DISCONNECTED',
        errorMessage: 'agent_disconnected',
        closeCode: 1006,
        closeReason: 'agent_disconnected',
        skipCloseFrame: true,
      });
      return;
    }
    if (socket.missedPongs >= this.options.heartbeatMaxMisses) {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_HEARTBEAT_TIMEOUT',
        errorMessage: 'agent_heartbeat_timeout',
        closeCode: 4000,
        closeReason: 'agent_heartbeat_timeout',
      });
      return;
    }
    const now = new Date().toISOString();
    socket.lastPingAt = now;
    socket.missedPongs += 1;
    if (!this.trySendSocketFrame(socket, {
      type: 'server.ping',
      timestamp: now,
      payload: {},
    }, 'agent_heartbeat_send_failed')) {
      return;
    }
  }

  private releaseSocketState(
    socket: AgentSocketState,
    options: {
      errorCode: string;
      errorMessage: string;
      closeCode: number;
      closeReason: string;
      skipCloseFrame?: boolean;
      skipPresenceUpdate?: boolean;
      terminalProcessesTerminated?: boolean;
      closeKind?: 'active_release' | 'passive_close';
      closeEventCode?: number;
      closeEventReason?: Buffer;
    },
  ): void {
    if (socket.lifecyclePhase === 'closed' || socket.lifecyclePhase === 'closing') return;
    logSocketCloseDiagnostic(socket, {
      closeKind: options.closeKind ?? 'active_release',
      errorCode: options.errorCode,
      closeCode: options.closeCode,
      closeReason: options.closeReason,
      ...(typeof options.closeEventCode === 'number' ? { closeEventCode: options.closeEventCode } : {}),
      ...(options.closeEventReason ? { closeEventReason: options.closeEventReason } : {}),
    });
    socket.lifecyclePhase = 'closing';

    this.clearSocketHeartbeat(socket);
    for (const [requestId, pending] of socket.pendingByRequestId.entries()) {
      socket.pendingByRequestId.delete(requestId);
      this.clearStreamTimers(pending);
      pending.push({
        type: 'error',
        error_code: options.errorCode,
        error_message: options.errorMessage,
      });
      pending.close();
    }
    const detachedTerminalSessionIds: string[] = [];
    const detachReason = this.mapReleaseReasonToTerminalDetach(options);
    for (const [terminalSessionId, pending] of socket.terminalBySessionId.entries()) {
      socket.terminalBySessionId.delete(terminalSessionId);
      this.clearTerminalTimers(pending);
      detachedTerminalSessionIds.push(terminalSessionId);
      pending.push({
        type: 'detached',
        terminal_session_id: terminalSessionId,
        reason: detachReason,
      });
      pending.close();
    }
    this.enqueueRunnerDetachedCallback(socket, {
      reason: detachReason,
      terminalSessionIds: detachedTerminalSessionIds,
      terminalProcessesTerminated: options.terminalProcessesTerminated ?? detachReason === 'server_shutdown',
    });
    if (this.socketsByKey.get(socket.socketKey) === socket) {
      this.socketsByKey.delete(socket.socketKey);
    }
    this.socketsByWebSocket.delete(socket.ws);

    if (!options.skipCloseFrame && socket.ws.readyState === socket.ws.OPEN) {
      socket.ws.close(options.closeCode, options.closeReason);
    }

    if (!options.skipPresenceUpdate) {
      void this.scheduleSocketPresenceRelease(socket);
    } else {
      socket.presenceRegistered = false;
    }
    socket.lifecyclePhase = 'closed';
  }

  private trySendSocketFrame(
    socket: AgentSocketState,
    frame: Record<string, unknown>,
    failureReason: 'agent_dispatch_send_failed' | 'agent_heartbeat_send_failed',
  ): boolean {
    if (socket.ws.readyState !== socket.ws.OPEN) {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_DISCONNECTED',
        errorMessage: 'agent_disconnected',
        closeCode: 1006,
        closeReason: 'agent_disconnected',
        skipCloseFrame: true,
      });
      return false;
    }
    try {
      socket.ws.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      debugExecution(
        `socket send failed agent_id=${socket.agentId} connection_id=${socket.connectionId} reason=${failureReason} error=${error instanceof Error ? error.message : String(error)}`,
      );
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_DISPATCH_SEND_FAILED',
        errorMessage: failureReason,
        closeCode: 1011,
        closeReason: failureReason,
      });
      return false;
    }
  }

  private async sendDispatchFrameWithAuthorityFence(input: {
    socket: AgentSocketState;
    sessionId: string;
    scope: DispatchScope;
    frame: Record<string, unknown>;
  }): Promise<boolean> {
    const authoritative = await this.resolveDispatchSocket({
      agentId: input.socket.agentId,
      sessionId: input.sessionId,
      scope: input.scope,
    });
    if (!authoritative || authoritative !== input.socket) {
      return false;
    }
    return this.trySendSocketFrame(authoritative, input.frame, 'agent_dispatch_send_failed');
  }

  private mapReleaseReasonToTerminalDetach(options: {
    errorMessage: string;
    closeReason: string;
  }): RunnerDetachedReason {
    if (options.closeReason === 'server_shutdown' || options.errorMessage === 'agent_service_shutdown') {
      return 'server_shutdown';
    }
    if (
      options.closeReason === 'agent_stale_connection'
      || options.errorMessage === 'agent_stale_connection'
      || options.errorMessage === 'agent_connection_authority_failed'
    ) {
      return 'agent_stale_connection';
    }
    if (options.errorMessage === 'agent_heartbeat_timeout') {
      return 'heartbeat_lost';
    }
    return 'agent_disconnected';
  }

  private enqueueRunnerDetachedCallback(
    socket: AgentSocketState,
    event: {
      reason: RunnerDetachedReason;
      terminalSessionIds: string[];
      terminalProcessesTerminated?: boolean;
    },
  ): void {
    const handleRunnerDetached = this.terminalRecoveryCoordinator.handleRunnerDetached;
    if (!handleRunnerDetached || event.terminalSessionIds.length === 0) {
      return;
    }
    const previous = this.runnerDetachChainsBySocketKey.get(socket.socketKey) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => handleRunnerDetached({
        workspaceId: socket.workspaceId,
        projectId: socket.projectId,
        agentId: socket.agentId,
        runnerSessionId: socket.sessionId ?? null,
        connectionId: socket.connectionId,
        reason: event.reason,
        terminalSessionIds: event.terminalSessionIds,
        ...(event.terminalProcessesTerminated !== undefined
          ? { terminalProcessesTerminated: event.terminalProcessesTerminated }
          : {}),
      }))
      .then(() => undefined);
    const tracked = this.trackBackgroundTask(task.finally(() => {
      if (this.runnerDetachChainsBySocketKey.get(socket.socketKey) === tracked) {
        this.runnerDetachChainsBySocketKey.delete(socket.socketKey);
      }
    }));
    this.runnerDetachChainsBySocketKey.set(socket.socketKey, tracked);
  }

  private async waitForRunnerDetachedCallbacks(socket: AgentSocketState): Promise<void> {
    const pending = this.runnerDetachChainsBySocketKey.get(socket.socketKey);
    if (!pending) return;
    await pending.catch(() => undefined);
  }

  async dispatchStreamingRequest(input: {
    workspaceId: string;
    projectId: string;
    sessionId: string;
    agentId: string;
    model: string;
    messages: Array<Record<string, unknown>>;
    executionContext: Record<string, unknown>;
  }): Promise<{ requestId: string; stream: AsyncIterable<AgentStreamEvent>; cancel: () => void }> {
    if (this.shuttingDown) {
      throw new Error('agent_execution_service_shutdown');
    }
    if (input.executionContext === undefined) {
      throw new Error('agent_execution_context_required');
    }
    const executionContext = assertTaskExecutionContext(input.executionContext);
    const dispatchScope = resolveStreamingDispatchScope(executionContext);
    const socket = await this.resolveDispatchSocket({
      agentId: input.agentId,
      sessionId: input.sessionId,
      scope: dispatchScope,
    });
    if (!socket) {
      throw new Error('agent_offline');
    }
    if (socket.workspaceId !== input.workspaceId || socket.projectId !== input.projectId) {
      throw new Error('agent_workspace_mismatch');
    }

    const requestId = randomUUID();
    const queue = createAsyncQueue<AgentStreamEvent>();
    const pending: PendingStream = {
      push: queue.push,
      close: queue.close,
      fail: queue.fail,
      lifecycleTraceEventsAreMeaningful:
        executionContext.runner_session_scope === 'task_execution'
        || executionContext.runner_session_scope === 'agent_presence',
    };
    socket.pendingByRequestId.set(requestId, pending);
    this.armStreamTimeouts(socket, requestId, pending);

    const sent = await this.sendDispatchFrameWithAuthorityFence({
      socket,
      sessionId: input.sessionId,
      scope: dispatchScope,
      frame: {
        type: 'server.request.start',
        request_id: requestId,
        runner_session_id: input.sessionId,
        timestamp: new Date().toISOString(),
        payload: {
          model: input.model,
          stream: true,
          messages: input.messages,
          execution_context: executionContext,
        },
      },
    });
    if (!sent) {
      this.failPendingStream(socket, requestId, 'AGENT_OFFLINE', 'agent_offline');
      throw new Error('agent_offline');
    }

    return {
      requestId,
      stream: queue.iterable,
      cancel: () => {
        const state = socket.pendingByRequestId.get(requestId);
        if (!state) return;
        if (state.cancellationRequested) return;
        state.cancellationRequested = true;
        if (socket.ws.readyState === socket.ws.OPEN) {
          socket.ws.send(
            JSON.stringify({
              type: 'server.request.cancel',
              request_id: requestId,
              runner_session_id: input.sessionId,
              timestamp: new Date().toISOString(),
              payload: { reason: 'client_cancelled' },
            }),
          );
        }
        // Wait for terminal frame from runner after cancellation request.
        // If runner is unresponsive, force-close this stream so task route can finalize.
        state.cancelTimeout = setTimeout(() => {
          const current = socket.pendingByRequestId.get(requestId);
          if (!current) return;
          socket.pendingByRequestId.delete(requestId);
          this.clearStreamTimers(current);
          current.push({
            type: 'error',
            error_code: 'AGENT_CANCEL_TIMEOUT',
            error_message: 'agent_cancel_timeout',
          });
          current.close();
        }, 12_000);
      },
    };
  }

  async dispatchTerminalSession(input: {
    workspaceId: string;
    projectId: string;
    sessionId: string;
    agentId: string;
    terminalSessionId: string;
    payload: {
      cols: number;
      rows: number;
      shell?: string;
      cwd?: string;
      executionContext?: Record<string, unknown>;
    };
  }): Promise<{
    stream: AsyncIterable<AgentTerminalEvent>;
    writeInput: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    close: () => void;
  }> {
    if (this.shuttingDown) {
      throw new Error('agent_execution_service_shutdown');
    }
    debugExecution(
      `dispatch_terminal_start agent_id=${input.agentId} runner_session=${input.sessionId} terminal_session=${input.terminalSessionId}`,
    );
    if (input.payload.executionContext === undefined) {
      throw new Error('agent_execution_context_required');
    }
    const executionContext = assertTaskExecutionContext(input.payload.executionContext);
    const dispatchScope = resolveStreamingDispatchScope(executionContext);
    const socket = await this.resolveDispatchSocket({
      agentId: input.agentId,
      sessionId: input.sessionId,
      scope: dispatchScope,
    });
    if (!socket) {
      debugExecution(
        `dispatch_terminal_offline agent_id=${input.agentId} runner_session=${input.sessionId} terminal_session=${input.terminalSessionId}`,
      );
      throw new Error('agent_offline');
    }
    if (socket.workspaceId !== input.workspaceId || socket.projectId !== input.projectId) {
      debugExecution(
        `dispatch_terminal_workspace_mismatch agent_id=${input.agentId} runner_session=${input.sessionId} terminal_session=${input.terminalSessionId}`,
      );
      throw new Error('agent_workspace_mismatch');
    }
    if (socket.terminalBySessionId.has(input.terminalSessionId)) {
      debugExecution(
        `dispatch_terminal_already_exists agent_id=${input.agentId} runner_session=${input.sessionId} terminal_session=${input.terminalSessionId}`,
      );
      throw new Error('terminal_session_already_exists');
    }

    const queue = createAsyncQueue<AgentTerminalEvent>();
    const pending: PendingTerminal = {
      push: queue.push,
      close: queue.close,
      fail: queue.fail,
      runnerSessionId: input.sessionId,
      controlScope: dispatchScope,
      lifecycle: 'start',
    };
    socket.terminalBySessionId.set(input.terminalSessionId, pending);
    this.armTerminalTimeouts(socket, input.terminalSessionId, pending);

    const sent = await this.sendDispatchFrameWithAuthorityFence({
      socket,
      sessionId: input.sessionId,
      scope: dispatchScope,
      frame: {
        type: 'server.terminal.start',
        runner_session_id: input.sessionId,
        terminal_session_id: input.terminalSessionId,
        timestamp: new Date().toISOString(),
        payload: {
          cols: input.payload.cols,
          rows: input.payload.rows,
          ...(typeof input.payload.shell === 'string' && input.payload.shell.trim()
            ? { shell: input.payload.shell.trim() }
            : {}),
          ...(typeof input.payload.cwd === 'string' && input.payload.cwd.trim()
            ? { cwd: input.payload.cwd.trim() }
            : {}),
          execution_context: executionContext,
        },
      },
    });
    if (!sent) {
      this.failPendingTerminal(socket, input.terminalSessionId, 'AGENT_OFFLINE', 'agent_offline');
      throw new Error('agent_offline');
    }
    debugExecution(
      `dispatch_terminal_sent agent_id=${input.agentId} runner_session=${input.sessionId} terminal_session=${input.terminalSessionId}`,
    );

    return {
      stream: queue.iterable,
      writeInput: (data: string) => {
        this.queueTerminalInputFrame({
          socket,
          pendingTerminal: pending,
          terminalSessionId: input.terminalSessionId,
          data,
        });
      },
      resize: (cols: number, rows: number) => {
        this.queueTerminalControlFrame({
          socket,
          sessionId: input.sessionId,
          scope: dispatchScope,
          terminalSessionId: input.terminalSessionId,
          type: 'server.terminal.resize',
          payload: { cols, rows },
        });
      },
      close: () => {
        if (!isPositiveSafeInteger(pending.generation) || !isPositiveSafeInteger(pending.connectionEpoch)) {
          debugExecution(
            `terminal_close_rejected reason=missing_positive_identity terminal_session=${input.terminalSessionId}`,
          );
          return;
        }
        const closeAttemptId = `close_${randomUUID().replace(/-/g, '')}`;
        this.queueTerminalControlFrame({
          socket,
          sessionId: input.sessionId,
          scope: dispatchScope,
          terminalSessionId: input.terminalSessionId,
          type: 'server.terminal.close',
          requestId: `close_req_${randomUUID().replace(/-/g, '')}`,
          payload: {
            close_attempt_id: closeAttemptId,
            generation: pending.generation,
            connection_epoch: pending.connectionEpoch,
            reason: 'shutdown',
          },
        });
      },
    };
  }

  async adoptTerminalSession(input: AdoptTerminalSessionInput): Promise<{
    stream: AsyncIterable<AgentTerminalEvent>;
    writeInput: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    close: () => void;
  }> {
    if (this.shuttingDown) {
      throw new Error('agent_execution_service_shutdown');
    }
    const dispatchScope = input.executionContext
      ? resolveStreamingDispatchScope(input.executionContext)
      : 'session_strict';
    const socket = await this.resolveDispatchSocket({
      agentId: input.agentId,
      sessionId: input.sessionId,
      scope: dispatchScope,
    });
    if (!socket) {
      throw new Error('agent_offline');
    }
    if (socket.workspaceId !== input.workspaceId || socket.projectId !== input.projectId) {
      throw new Error('agent_workspace_mismatch');
    }
    if (socket.terminalBySessionId.has(input.terminalSessionId)) {
      throw new Error('terminal_session_already_exists');
    }

    const queue = createAsyncQueue<AgentTerminalEvent>();
    const pending: PendingTerminal = {
      push: queue.push,
      close: queue.close,
      fail: queue.fail,
      runnerSessionId: input.sessionId,
      controlScope: dispatchScope,
      lifecycle: 'adopt',
      adoptAttemptId: input.adoptAttemptId,
      connectionEpoch: input.connectionEpoch,
      generation: input.generation,
    };
    socket.terminalBySessionId.set(input.terminalSessionId, pending);
    this.armTerminalTimeouts(socket, input.terminalSessionId, pending);

    const sent = await this.sendDispatchFrameWithAuthorityFence({
      socket,
      sessionId: input.sessionId,
      scope: dispatchScope,
      frame: {
        type: 'server.terminal.adopt',
        request_id: input.adoptAttemptId,
        runner_session_id: input.sessionId,
        terminal_session_id: input.terminalSessionId,
        timestamp: new Date().toISOString(),
        payload: {
          adopt_attempt_id: input.adoptAttemptId,
          connection_epoch: input.connectionEpoch,
          generation: input.generation,
          cols: input.cols,
          rows: input.rows,
        },
      },
    });
    if (!sent) {
      this.failPendingTerminal(socket, input.terminalSessionId, 'AGENT_OFFLINE', 'agent_offline');
      throw new Error('agent_offline');
    }

    return {
      stream: queue.iterable,
      writeInput: (data: string) => {
        this.queueTerminalInputFrame({
          socket,
          pendingTerminal: pending,
          terminalSessionId: input.terminalSessionId,
          data,
        });
      },
      resize: (cols: number, rows: number) => {
        this.queueTerminalControlFrame({
          socket,
          sessionId: input.sessionId,
          scope: dispatchScope,
          terminalSessionId: input.terminalSessionId,
          type: 'server.terminal.resize',
          payload: { cols, rows },
        });
      },
      close: () => {
        if (!isPositiveSafeInteger(pending.generation) || !isPositiveSafeInteger(pending.connectionEpoch)) {
          debugExecution(
            `terminal_close_rejected reason=missing_positive_identity terminal_session=${input.terminalSessionId}`,
          );
          return;
        }
        const closeAttemptId = `close_${randomUUID().replace(/-/g, '')}`;
        this.queueTerminalControlFrame({
          socket,
          sessionId: input.sessionId,
          scope: dispatchScope,
          terminalSessionId: input.terminalSessionId,
          type: 'server.terminal.close',
          requestId: `close_req_${randomUUID().replace(/-/g, '')}`,
          payload: {
            close_attempt_id: closeAttemptId,
            generation: pending.generation,
            connection_epoch: pending.connectionEpoch,
            reason: 'shutdown',
          },
        });
      },
    };
  }

  async closeTerminalSession(input: {
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
  }): Promise<'signaled' | 'agent_offline' | 'agent_workspace_mismatch' | 'invalid_terminal_identity'> {
    if (!isPositiveSafeInteger(input.generation) || !isPositiveSafeInteger(input.connectionEpoch)) {
      debugExecution(
        `terminal_close_rejected reason=invalid_positive_identity terminal_session=${input.terminalSessionId}`,
      );
      return 'invalid_terminal_identity';
    }
    const dispatchScope = input.executionContext
      ? resolveStreamingDispatchScope(input.executionContext)
      : 'session_strict';
    const socket = await this.resolveDispatchSocket({
      agentId: input.agentId,
      sessionId: input.sessionId,
      scope: dispatchScope,
    });
    if (!socket) {
      return 'agent_offline';
    }
    if (socket.workspaceId !== input.workspaceId || socket.projectId !== input.projectId) {
      return 'agent_workspace_mismatch';
    }

    const closeRequestId = input.closeRequestId ?? `close_req_${randomUUID().replace(/-/g, '')}`;
    const sent = await this.sendDispatchFrameWithAuthorityFence({
      socket,
      sessionId: input.sessionId,
      scope: dispatchScope,
      frame: {
        type: 'server.terminal.close',
        request_id: closeRequestId,
        runner_session_id: input.sessionId,
        terminal_session_id: input.terminalSessionId,
        timestamp: new Date().toISOString(),
        payload: {
          close_attempt_id: input.closeAttemptId,
          generation: input.generation,
          connection_epoch: input.connectionEpoch,
          reason: input.reason ?? 'user_requested',
        },
      },
    });
    if (!sent) {
      return 'agent_offline';
    }
    return 'signaled';
  }

  private queueReadyHandshake(socket: AgentSocketState, payload: Record<string, unknown> | undefined): void {
    const previous = socket.readyChain ?? Promise.resolve();
    const readyTask = previous
      .catch(() => undefined)
      .then(() => this.processReadyMessage(socket, payload));
    const trackedReadyTask = this.trackBackgroundTask(readyTask.finally(() => {
      if (socket.readyChain === trackedReadyTask) {
        socket.readyChain = undefined;
      }
    }));
    socket.readyChain = trackedReadyTask;
  }

  private async waitForReadyRegistrationLifecycle(socket: AgentSocketState): Promise<boolean> {
    const registrationLifecycle = socket.registrationLifecycle;
    if (registrationLifecycle) {
      try {
        await registrationLifecycle;
      } catch (error) {
        debugExecution(
          `agent.ready registration lifecycle failed agent_id=${socket.agentId} connection_id=${socket.connectionId} error=${error instanceof Error ? error.message : String(error)}`,
        );
        return false;
      }
    }
    return this.isSocketOpen(socket) && socket.lifecyclePhase === 'active';
  }

  private async recheckReadyAuthority(socket: AgentSocketState): Promise<boolean> {
    if (isTerminalAgentSocketLifecyclePhase(socket.lifecyclePhase)) {
      return false;
    }

    const currentLocal = this.socketsByKey.get(socket.socketKey);
    if (currentLocal && currentLocal !== socket) {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_STALE_CONNECTION',
        errorMessage: 'agent_stale_connection',
        closeCode: 4001,
        closeReason: 'agent_stale_connection',
      });
      return false;
    }

    if (socket.presenceRegistered) {
      const authoritative = await this.agentResourceService.getAuthorizedSessionConnectionInfo(
        socket.agentId,
        socket.sessionId,
        socket.sessionId ? { allowAgentFallback: false } : undefined,
      );
      if (!authoritative || authoritative.connection_id !== socket.connectionId) {
        this.releaseSocketState(socket, {
          errorCode: 'AGENT_STALE_CONNECTION',
          errorMessage: 'agent_stale_connection',
          closeCode: 4001,
          closeReason: 'agent_stale_connection',
        });
        return false;
      }
      if (authoritative.api_instance_id && authoritative.api_instance_id !== this.apiInstanceId) {
        this.releaseSocketState(socket, {
          errorCode: 'AGENT_STALE_CONNECTION',
          errorMessage: 'agent_stale_connection',
          closeCode: 4001,
          closeReason: 'agent_stale_connection',
        });
        return false;
      }
    }

    if (isTerminalAgentSocketLifecyclePhase(socket.lifecyclePhase)) {
      return false;
    }
    const latestLocal = this.socketsByKey.get(socket.socketKey);
    if (latestLocal && latestLocal !== socket) {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_STALE_CONNECTION',
        errorMessage: 'agent_stale_connection',
        closeCode: 4001,
        closeReason: 'agent_stale_connection',
      });
      return false;
    }
    return true;
  }

  private async processReadyMessage(
    socket: AgentSocketState,
    payload: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (socket.lifecyclePhase === 'closed' || socket.lifecyclePhase === 'closing') {
      return;
    }
    if (!(await this.waitForReadyRegistrationLifecycle(socket))) {
      return;
    }
    try {
      if (!(await this.recheckReadyAuthority(socket))) {
        return;
      }

      const incoming = isPlainObject(payload) ? payload : {};
      const activeTerminals = this.parseActiveTerminalDescriptors(incoming.active_terminals);
      const recoveryMetadata = this.parseRunnerReadyRecoveryMetadata(
        incoming,
        Object.prototype.hasOwnProperty.call(incoming, 'active_terminals'),
      );
      const connectionEpoch = readPositiveInteger(incoming.connection_epoch, 1);
      if (connectionEpoch !== null) {
        socket.connectionEpoch = connectionEpoch;
      }
      const metadata = Object.fromEntries(
        Object.entries(incoming).filter(([key]) => key !== 'runner_spec'),
      );
      if (!(await this.recheckReadyAuthority(socket))) {
        return;
      }
      await this.waitForRunnerDetachedCallbacks(socket);
      if (!(await this.recheckReadyAuthority(socket))) {
        return;
      }
      await this.agentResourceService.updateAgentRuntimeState(
        socket.workspaceId,
        socket.projectId,
        socket.agentId,
        {
          last_error: undefined,
          last_error_at: undefined,
          metadata: {
            ...metadata,
            ready_at: new Date().toISOString(),
          },
        },
      );
      if (recoveryMetadata && this.terminalRecoveryCoordinator.handleRunnerReady) {
        try {
          await this.terminalRecoveryCoordinator.handleRunnerReady({
            workspaceId: socket.workspaceId,
            projectId: socket.projectId,
            agentId: socket.agentId,
            runnerSessionId: socket.sessionId ?? null,
            runnerInstanceId: recoveryMetadata.runnerInstanceId,
            connectionId: socket.connectionId,
            connectionEpoch: recoveryMetadata.connectionEpoch,
            activeTerminals,
          });
        } catch (error) {
          logRunnerReadyRecoveryDiagnostic(socket, error);
        }
      }
    } catch (error) {
      debugExecution(
        `agent.ready validation failed agent_id=${socket.agentId} connection_id=${socket.connectionId} error=${error instanceof Error ? error.message : String(error)}`,
      );
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_READY_VALIDATION_FAILED',
        errorMessage: 'agent_ready_validation_failed',
        closeCode: 1011,
        closeReason: 'agent_ready_validation_failed',
      });
    }
  }

  private parseRunnerReadyRecoveryMetadata(
    incoming: Record<string, unknown>,
    hasActiveTerminalsField: boolean,
  ): RunnerReadyRecoveryMetadata | null {
    if (!hasActiveTerminalsField) {
      return null;
    }
    const runnerInstanceId = readNonEmptyString(incoming.runner_instance_id);
    const connectionEpoch = readPositiveInteger(incoming.connection_epoch, 1);
    if (!runnerInstanceId || connectionEpoch === null) {
      throw new Error('active_terminal_recovery_identity_missing');
    }
    return {
      runnerInstanceId,
      connectionEpoch,
    };
  }

  private parseActiveTerminalDescriptors(input: unknown): RunnerActiveTerminalDescriptor[] {
    if (input === undefined) return [];
    if (!Array.isArray(input)) {
      throw new Error('active_terminals_invalid');
    }
    if (input.length > 64) {
      throw new Error('active_terminals_too_many');
    }
    const descriptors: RunnerActiveTerminalDescriptor[] = [];
    for (const item of input) {
      if (!isPlainObject(item)) {
        debugExecution('agent_ready_active_terminal_descriptor_invalid reason=not_object');
        continue;
      }
      const terminalSessionId = readNonEmptyString(item.terminal_session_id);
      const runnerSessionId = readNonEmptyString(item.runner_session_id);
      const generation = readPositiveInteger(item.generation, 1);
      const cols = readPositiveInteger(item.cols, 20);
      const rows = readPositiveInteger(item.rows, 5);
      if (!terminalSessionId || !runnerSessionId || generation === null || cols === null || rows === null) {
        debugExecution('agent_ready_active_terminal_descriptor_invalid reason=fields');
        continue;
      }
      const cwd = readNonEmptyString(item.cwd);
      descriptors.push({
        terminal_session_id: terminalSessionId,
        runner_session_id: runnerSessionId,
        generation,
        cols,
        rows,
        ...(cwd ? { cwd } : {}),
      });
    }
    return descriptors;
  }

  private handleSocketClose(ws: WebSocket, closeEventCode?: number, closeEventReason?: Buffer): void {
    const socket = this.socketsByWebSocket.get(ws);
    if (!socket) return;
    this.releaseSocketState(socket, {
      errorCode: 'AGENT_DISCONNECTED',
      errorMessage: 'agent_disconnected',
      closeCode: 1006,
      closeReason: 'agent_disconnected',
      skipCloseFrame: true,
      closeKind: 'passive_close',
      ...(typeof closeEventCode === 'number' ? { closeEventCode } : {}),
      ...(closeEventReason ? { closeEventReason } : {}),
    });
  }

  private handleAgentMessage(ws: WebSocket, raw: RawData): void {
    const socket = this.socketsByWebSocket.get(ws);
    if (!socket) return;

    let payload: {
      type?: string;
      request_id?: string;
      payload?: Record<string, unknown>;
    };
    try {
      payload = JSON.parse(raw.toString('utf-8')) as {
        type?: string;
        request_id?: string;
        payload?: Record<string, unknown>;
      };
    } catch {
      const state = this.socketsByWebSocket.get(ws);
      if (state) {
        state.ws.close(1003, 'invalid_json');
      }
      return;
    }

    if (payload.type === 'agent.pong') {
      const now = new Date().toISOString();
      socket.lastPongAt = now;
      socket.missedPongs = 0;
      this.queueSocketRefresh(socket, now);
      return;
    }

    if (payload.type === 'agent.ready') {
      this.queueReadyHandshake(socket, payload.payload);
      return;
    }

    if (payload.type === 'agent.shutdown') {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_SHUTDOWN',
        errorMessage: 'agent_shutdown',
        closeCode: 1000,
        closeReason: 'agent_shutdown',
        terminalProcessesTerminated: payload.payload?.terminal_processes_terminated === true,
      });
      return;
    }

    const isTerminalMessage = typeof payload.type === 'string' && payload.type.startsWith('agent.terminal.');
    const legacyTerminalSessionId = isTerminalMessage
      ? readNonEmptyString((payload as { session_id?: unknown }).session_id)
        ?? readNonEmptyString(payload.payload?.session_id)
      : null;
    if (legacyTerminalSessionId) {
      this.failPendingTerminal(
        socket,
        legacyTerminalSessionId,
        'AGENT_PROTOCOL_ERROR',
        'agent_terminal_legacy_session_id_unsupported',
      );
      return;
    }

    const terminalSessionId = readNonEmptyString((payload as { terminal_session_id?: unknown }).terminal_session_id);
    if (terminalSessionId) {
      const payloadTerminalSessionId = readNonEmptyString(payload.payload?.terminal_session_id);
      const pendingTerminal = socket.terminalBySessionId.get(terminalSessionId);
      if (payloadTerminalSessionId && payloadTerminalSessionId !== terminalSessionId) {
        if (pendingTerminal) {
          this.failPendingTerminal(
            socket,
            terminalSessionId,
            'AGENT_PROTOCOL_ERROR',
            'agent_terminal_session_mismatch',
          );
        }
        return;
      }

      if (payload.type === 'agent.terminal.close_ack') {
        const requestId = readNonEmptyString(payload.request_id);
        const topLevelRunnerSessionId = readNonEmptyString(
          (payload as { runner_session_id?: unknown }).runner_session_id,
        );
        const payloadRunnerSessionId = readNonEmptyString(payload.payload?.runner_session_id);
        const runnerSessionId = topLevelRunnerSessionId ?? '';
        const closeAttemptId = readNonEmptyString(payload.payload?.close_attempt_id);
        const generation = readPositiveInteger(payload.payload?.generation, 1);
        const connectionEpoch = readPositiveInteger(payload.payload?.connection_epoch, 1);
        const status = payload.payload?.status;
        const receivedFence = {
          request_id: requestId,
          runner_session_id: runnerSessionId || null,
          payload_runner_session_id: payloadRunnerSessionId,
          terminal_session_id: terminalSessionId,
          payload_terminal_session_id: payloadTerminalSessionId,
          close_attempt_id: closeAttemptId,
          generation,
          connection_epoch: connectionEpoch,
          status: typeof status === 'string' ? status : null,
          connection_id: socket.connectionId,
          socket_key: socket.socketKey,
          lifecycle_phase: socket.lifecyclePhase,
        };
        if (
          !requestId
          || !runnerSessionId
          || payloadRunnerSessionId !== runnerSessionId
          || !closeAttemptId
          || generation === null
          || connectionEpoch === null
          || (status !== 'closed' && status !== 'not_found' && status !== 'error')
        ) {
          const rejectReason = !requestId
            ? 'missing_request_id'
            : !runnerSessionId
              ? 'missing_runner_session_id'
              : payloadRunnerSessionId !== runnerSessionId
                ? 'runner_session_mismatch'
                : !closeAttemptId
                  ? 'missing_close_attempt_id'
                  : generation === null
                    ? 'invalid_generation'
                    : connectionEpoch === null
                      ? 'invalid_connection_epoch'
                      : 'invalid_status';
          debugExecution(
            `terminal_close_ack_rejected reason=${rejectReason} terminal_session=${terminalSessionId}`
            + ` diagnostic=${JSON.stringify({
              received: receivedFence,
              expected: {
                request_id: 'non_empty_string',
                runner_session_id: (runnerSessionId || socket.sessionId) ?? null,
                payload_runner_session_id: runnerSessionId || null,
                terminal_session_id: terminalSessionId,
                payload_terminal_session_id: terminalSessionId,
                close_attempt_id: 'non_empty_string',
                generation: 'positive_integer',
                connection_epoch: 'positive_integer',
                status: ['closed', 'not_found', 'error'],
                lifecycle_phase: 'active',
              },
            })}`,
          );
          return;
        }
        if (this.terminalRecoveryCoordinator.handleTerminalCloseAck) {
          const handleTerminalCloseAck = this.terminalRecoveryCoordinator.handleTerminalCloseAck;
          const diagnosticCode = readNonEmptyString(payload.payload?.diagnostic_code);
          const remainingPidCount = readNonNegativeInteger(payload.payload?.remaining_pid_count);
          void this.trackBackgroundTask(Promise.resolve().then(async () => {
            if (!(await this.recheckReadyAuthority(socket))) {
              debugExecution(
                `terminal_close_ack_rejected reason=stale_socket_authority terminal_session=${terminalSessionId}`
                + ` diagnostic=${JSON.stringify({
                  received: receivedFence,
                  expected: {
                    authoritative_socket: true,
                    agent_id: socket.agentId,
                    runner_session_id: socket.sessionId ?? runnerSessionId,
                    connection_id: socket.connectionId,
                    socket_key: socket.socketKey,
                    lifecycle_phase: 'active',
                  },
                })}`,
              );
              return;
            }
            await handleTerminalCloseAck({
              workspaceId: socket.workspaceId,
              projectId: socket.projectId,
              agentId: socket.agentId,
              runnerSessionId,
              terminalSessionId,
              requestId,
              closeAttemptId,
              generation,
              connectionEpoch,
              status,
              ...(diagnosticCode ? { diagnosticCode } : {}),
              ...(remainingPidCount !== null ? { remainingPidCount } : {}),
            });
          }).then(() => undefined));
        }
        if (pendingTerminal && (status === 'closed' || status === 'not_found')) {
          socket.terminalBySessionId.delete(terminalSessionId);
          this.clearTerminalTimers(pendingTerminal);
          pendingTerminal.push({
            type: 'exited',
            terminal_session_id: terminalSessionId,
            exit_code: 0,
            signal: null,
          });
          pendingTerminal.close();
        }
        return;
      }

      if (!pendingTerminal) return;

      if (payload.type === 'agent.terminal.adopted') {
        if (
          pendingTerminal.lifecycle !== 'adopt'
          || readNonEmptyString(payload.request_id) !== pendingTerminal.adoptAttemptId
          || readNonEmptyString(payload.payload?.adopt_attempt_id) !== pendingTerminal.adoptAttemptId
          || readNonEmptyString(payload.payload?.runner_session_id) !== pendingTerminal.runnerSessionId
          || readPositiveInteger(payload.payload?.connection_epoch, 1) !== pendingTerminal.connectionEpoch
          || readPositiveInteger(payload.payload?.generation, 1) !== pendingTerminal.generation
        ) {
          return;
        }
        this.markTerminalEvent(socket, terminalSessionId, pendingTerminal);
        pendingTerminal.readyForInput = true;
        pendingTerminal.push({
          type: 'started',
          terminal_session_id: terminalSessionId,
          runner_session_id: pendingTerminal.runnerSessionId,
          generation: pendingTerminal.generation,
          connection_epoch: pendingTerminal.connectionEpoch,
          cols: typeof payload.payload?.cols === 'number' ? payload.payload.cols : undefined,
          rows: typeof payload.payload?.rows === 'number' ? payload.payload.rows : undefined,
        });
        this.flushBufferedTerminalInput(socket, terminalSessionId, pendingTerminal);
        return;
      }

      if (payload.type === 'agent.terminal.not_found') {
        socket.terminalBySessionId.delete(terminalSessionId);
        this.clearTerminalTimers(pendingTerminal);
        pendingTerminal.push({
          type: 'error',
          terminal_session_id: terminalSessionId,
          error_code: 'TERMINAL_PROCESS_LOST',
          error_message: 'terminal_process_lost',
        });
        pendingTerminal.close();
        return;
      }

      if (payload.type === 'agent.terminal.started') {
        debugExecution(`terminal_started agent_id=${socket.agentId} runner_session=${socket.sessionId ?? ''} terminal_session=${terminalSessionId}`);
        const topLevelRunnerSessionId = readNonEmptyString(
          (payload as { runner_session_id?: unknown }).runner_session_id,
        );
        const payloadRunnerSessionId = readNonEmptyString(payload.payload?.runner_session_id);
        const runnerSessionId = topLevelRunnerSessionId ?? payloadRunnerSessionId;
        const generation = readPositiveInteger(payload.payload?.generation, 1);
        const connectionEpoch = readPositiveInteger(payload.payload?.connection_epoch, 1) ?? socket.connectionEpoch ?? null;
        if (
          !runnerSessionId
          || runnerSessionId !== pendingTerminal.runnerSessionId
          || (payloadRunnerSessionId !== null && payloadRunnerSessionId !== runnerSessionId)
          || generation === null
          || connectionEpoch === null
        ) {
          const rejectReason = !runnerSessionId
            ? 'missing_runner_session_id'
            : runnerSessionId !== pendingTerminal.runnerSessionId
              ? 'runner_session_mismatch'
              : payloadRunnerSessionId !== null && payloadRunnerSessionId !== runnerSessionId
                ? 'payload_runner_session_mismatch'
                : generation === null
                  ? 'invalid_generation'
                  : 'invalid_connection_epoch';
          debugExecution(
            `terminal_started_rejected reason=${rejectReason} terminal_session=${terminalSessionId}`,
          );
          this.failPendingTerminal(
            socket,
            terminalSessionId,
            'AGENT_PROTOCOL_ERROR',
            `agent_terminal_started_${rejectReason}`,
          );
          return;
        }
        pendingTerminal.generation = generation;
        pendingTerminal.connectionEpoch = connectionEpoch;
        this.markTerminalEvent(socket, terminalSessionId, pendingTerminal);
        pendingTerminal.push({
          type: 'started',
          terminal_session_id: terminalSessionId,
          runner_session_id: runnerSessionId,
          generation,
          connection_epoch: connectionEpoch,
          cols: typeof payload.payload?.cols === 'number' ? payload.payload.cols : undefined,
          rows: typeof payload.payload?.rows === 'number' ? payload.payload.rows : undefined,
        });
        return;
      }

      if (payload.type === 'agent.terminal.output') {
        debugExecution(`terminal_output agent_id=${socket.agentId} runner_session=${socket.sessionId ?? ''} terminal_session=${terminalSessionId}`);
        this.markTerminalEvent(socket, terminalSessionId, pendingTerminal);
        if (typeof payload.payload?.chunk !== 'string') {
          this.failPendingTerminal(
            socket,
            terminalSessionId,
            'AGENT_PROTOCOL_ERROR',
            'agent_terminal_output_invalid',
          );
          return;
        }
        pendingTerminal.push({
          type: 'output',
          terminal_session_id: terminalSessionId,
          chunk: payload.payload.chunk,
        });
        if (!pendingTerminal.readyForInput) {
          pendingTerminal.readyForInput = true;
          this.flushBufferedTerminalInput(socket, terminalSessionId, pendingTerminal);
        }
        return;
      }

      if (payload.type === 'agent.terminal.exited') {
        debugExecution(`terminal_exited agent_id=${socket.agentId} runner_session=${socket.sessionId ?? ''} terminal_session=${terminalSessionId}`);
        socket.terminalBySessionId.delete(terminalSessionId);
        this.clearTerminalTimers(pendingTerminal);
        pendingTerminal.push({
          type: 'exited',
          terminal_session_id: terminalSessionId,
          exit_code: typeof payload.payload?.exit_code === 'number' ? payload.payload.exit_code : null,
          signal: typeof payload.payload?.signal === 'string' ? payload.payload.signal : null,
        });
        pendingTerminal.close();
        return;
      }

      if (payload.type === 'agent.terminal.error') {
        debugExecution(`terminal_error agent_id=${socket.agentId} runner_session=${socket.sessionId ?? ''} terminal_session=${terminalSessionId}`);
        socket.terminalBySessionId.delete(terminalSessionId);
        this.clearTerminalTimers(pendingTerminal);
        pendingTerminal.push({
          type: 'error',
          terminal_session_id: terminalSessionId,
          error_code:
            typeof payload.payload?.error_code === 'string' ? payload.payload.error_code : 'AGENT_UPSTREAM_ERROR',
          error_message:
            typeof payload.payload?.error_message === 'string' ? payload.payload.error_message : 'agent_upstream_error',
        });
        pendingTerminal.close();
        return;
      }
    }

    const requestId = payload.request_id;
    if (!requestId) return;
    const pending = socket.pendingByRequestId.get(requestId);
    if (!pending) return;

    if (payload.type === 'agent.response.delta') {
      this.markStreamActivity(socket, requestId, pending);
      this.markStreamMeaningfulOutput(pending);
      if (typeof payload.payload?.delta !== 'string') {
        socket.pendingByRequestId.delete(requestId);
        this.clearStreamTimers(pending);
        pending.push({
          type: 'error',
          error_code: 'AGENT_PROTOCOL_ERROR',
          error_message: 'agent_response_delta_invalid',
        });
        pending.close();
        return;
      }
      pending.push({
        type: 'delta',
        delta: payload.payload.delta,
      });
      return;
    }

    if (payload.type === 'agent.response.event') {
      const eventPayload = parseTraceEventPayload(payload.payload);
      if (!eventPayload) {
        socket.pendingByRequestId.delete(requestId);
        this.clearStreamTimers(pending);
        pending.push({
          type: 'error',
          error_code: 'AGENT_PROTOCOL_ERROR',
          error_message: 'agent_response_event_invalid',
        });
        pending.close();
        return;
      }
      this.markStreamActivity(socket, requestId, pending);
      if (this.shouldTreatEventAsMeaningfulOutput(pending, eventPayload)) {
        this.markStreamMeaningfulOutput(pending);
      }
      pending.push({
        type: 'event',
        event: eventPayload,
      });
      return;
    }

    if (payload.type === 'agent.response.done') {
      socket.pendingByRequestId.delete(requestId);
      this.clearStreamTimers(pending);
      pending.push({
        type: 'done',
        finish_reason:
          typeof payload.payload?.finish_reason === 'string' ? payload.payload.finish_reason : 'stop',
        usage_tokens:
          typeof payload.payload?.usage_tokens === 'number' ? payload.payload.usage_tokens : undefined,
      });
      pending.close();
      return;
    }

    if (payload.type === 'agent.response.artifact') {
      this.markStreamActivity(socket, requestId, pending);
      this.markStreamMeaningfulOutput(pending);
      const artifactPayload = parseArtifactPayload(payload.payload);
      if (!artifactPayload) {
        socket.pendingByRequestId.delete(requestId);
        this.clearStreamTimers(pending);
        pending.push({
          type: 'error',
          error_code: 'AGENT_PROTOCOL_ERROR',
          error_message: 'agent_response_artifact_invalid',
        });
        pending.close();
        return;
      }
      pending.push({
        type: 'artifact',
        artifact: artifactPayload,
      });
      return;
    }

    if (payload.type === 'agent.response.error') {
      socket.pendingByRequestId.delete(requestId);
      this.clearStreamTimers(pending);
      pending.push({
        type: 'error',
        error_code:
          typeof payload.payload?.error_code === 'string' ? payload.payload.error_code : 'AGENT_UPSTREAM_ERROR',
        error_message:
          typeof payload.payload?.error_message === 'string' ? payload.payload.error_message : 'agent_upstream_error',
      });
      pending.close();
      return;
    }

    socket.pendingByRequestId.delete(requestId);
    this.clearStreamTimers(pending);
    pending.push({
      type: 'error',
      error_code: 'AGENT_PROTOCOL_ERROR',
      error_message: 'agent_response_type_unsupported',
    });
    pending.close();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    for (const socket of [...this.socketsByWebSocket.values()]) {
      this.releaseSocketState(socket, {
        errorCode: 'AGENT_SERVICE_SHUTDOWN',
        errorMessage: 'agent_service_shutdown',
        closeCode: 1001,
        closeReason: 'server_shutdown',
      });
    }
    await new Promise<void>((resolve) => {
      this.wsServer.close(() => resolve());
    });
    await Promise.allSettled([...this.backgroundTasks]);
  }

  getAgentOnlineState(agentId: string): boolean {
    return [...this.socketsByKey.values()].some((socket) => (
      socket.agentId === agentId && this.isSocketDispatchable(socket)
    ));
  }

  getAgentSessionOnlineState(agentId: string, sessionId?: string): boolean {
    const key = sessionId ? buildSocketKey(agentId, sessionId) : buildSocketKey(agentId);
    return this.isSocketDispatchable(this.socketsByKey.get(key));
  }

  disconnectAgentRunner(
    agentId: string,
    reason: 'agent_key_rotated' | 'agent_key_revoked' | 'agent_key_expired' = 'agent_key_revoked',
  ): number {
    let disconnected = 0;
    for (const socket of [...this.socketsByWebSocket.values()]) {
      if (socket.agentId !== agentId || socket.lifecyclePhase === 'closed' || socket.lifecyclePhase === 'closing') {
        continue;
      }
      disconnected += 1;
      this.releaseSocketState(socket, {
        errorCode: reason.toUpperCase(),
        errorMessage: reason,
        closeCode: 4003,
        closeReason: reason,
      });
    }
    return disconnected;
  }

  async getAgentSessionDispatchAuthority(
    agentId: string,
    sessionId: string,
  ): Promise<RunnerSessionDispatchAuthority> {
    const socket = this.socketsByKey.get(buildSocketKey(agentId, sessionId));
    const connection = await this.agentResourceService.getAuthorizedSessionConnectionInfo(agentId, sessionId, {
      allowAgentFallback: false,
    });
    if (
      connection
      && connection.api_instance_id === this.apiInstanceId
      && this.isSocketDispatchable(socket)
      && socket.connectionId === connection.connection_id
    ) {
      return 'local_dispatchable';
    }
    if (connection?.api_instance_id && connection.api_instance_id !== this.apiInstanceId) {
      return 'remote_owned_not_local_dispatchable';
    }

    return 'offline';
  }

  listOnlineAgentIds(): string[] {
    return [...new Set(
      [...this.socketsByKey.values()]
        .filter((socket) => this.isSocketDispatchable(socket))
        .map((socket) => socket.agentId),
    )];
  }
}

function buildSocketKey(agentId: string, sessionId?: string): string {
  return sessionId && sessionId.trim().length > 0 ? `${agentId}::${sessionId.trim()}` : agentId;
}
