import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { isMatchingRunnerSpec, type AgentRunnerSpec } from '@mbos/agent-runner';
import type { AgentResourceService } from './agent-resource-service.js';
import { resolveRequiredConfiguredPublicApiBase } from './agent-execution-api-base.js';
import {
  readAgentExecutionPreferences,
  resolveAgentInteractionKind,
} from './agent-execution-preferences.js';
import { resolveExecutionApiBase } from './notebook-execution-orchestrator.js';

export type RunnerSessionDispatchAuthority =
  | 'local_dispatchable'
  | 'remote_owned_not_local_dispatchable'
  | 'offline';

type DispatchScope = 'agent_fallback' | 'session_strict';
type AgentSocketLifecyclePhase = 'registering' | 'active' | 'superseded' | 'closing' | 'closed';

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
  type: 'started' | 'output' | 'exited' | 'error';
  session_id?: string;
  cols?: number;
  rows?: number;
  chunk?: string;
  exit_code?: number | null;
  signal?: string | null;
  error_code?: string;
  error_message?: string;
}

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
  hasReceivedEvent?: boolean;
}

interface PendingTerminal {
  push: (event: AgentTerminalEvent) => void;
  close: () => void;
  fail: (error: Error) => void;
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
  connectedAt: string;
  resourceProxyBaseUrl?: string;
  pendingByRequestId: Map<string, PendingStream>;
  terminalBySessionId: Map<string, PendingTerminal>;
  heartbeatTimer?: NodeJS.Timeout;
  lastPingAt?: string;
  lastPongAt: string;
  missedPongs: number;
  lifecyclePhase: AgentSocketLifecyclePhase;
  presenceRegistered: boolean;
  releasePromise?: Promise<void>;
  refreshChain?: Promise<void>;
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

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function parseTraceEventPayload(input: unknown): AgentExecutionTraceEventPayload | null {
  if (!isPlainRecord(input)) return null;
  const sequence = input.sequence;
  const at = input.at;
  const category = input.category;
  const name = input.name;
  const summary = input.summary;
  if (typeof sequence !== 'number' || !Number.isFinite(sequence)) return null;
  if (typeof at !== 'string' || at.trim().length === 0) return null;
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
    at,
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
    task_relative_path: taskRelativePath.trim(),
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

function readRunnerSpec(input: unknown): Partial<AgentRunnerSpec> | null {
  if (!isPlainObject(input)) return null;
  const runnerSpec = input.runner_spec;
  if (!isPlainObject(runnerSpec)) return null;
  return runnerSpec as Partial<AgentRunnerSpec>;
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
  private readonly apiInstanceId = randomUUID();
  private readonly options: ResolvedAgentExecutionServiceOptions;
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
            ...(socketState.resourceProxyBaseUrl
              ? {
                resource_proxy: {
                  base_url: socketState.resourceProxyBaseUrl,
                },
              }
              : {}),
          },
        }),
      );

      ws.on('message', (data) => this.handleAgentMessage(ws, data));
      ws.on('close', () => this.handleSocketClose(ws));
      ws.on('error', () => this.handleSocketClose(ws));
    });
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

    const agentId = url.searchParams.get('agent_id') || '';
    const sessionId = url.searchParams.get('session_id') || undefined;
    if (!agentId) {
      debugExecution('reject missing_agent_id');
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
      const interactionKind = resolveAgentInteractionKind(agent);
      if (!interactionKind) {
        debugExecution(`reject interaction_kind_required agent_id=${agentId}`);
        await this.agentResourceService.updateAgentRuntimeState(
          keyRecord.workspace_id,
          keyRecord.project_id,
          agentId,
          {
            last_error: 'agent_interaction_kind_required',
            last_error_at: new Date().toISOString(),
          },
        );
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      const executionEndpointId = readAgentExecutionPreferences(agent, interactionKind).endpointId;
      const executionApiBase = executionEndpointId
        ? resolveExecutionApiBase(resolveRequiredConfiguredPublicApiBase(), agent)
        : null;
      const resourceProxyBaseUrl = executionEndpointId && executionApiBase
        ? `${executionApiBase}/workspaces/${encodeURIComponent(keyRecord.workspace_id)}`
          + `/projects/${encodeURIComponent(keyRecord.project_id)}`
          + `/endpoints/${encodeURIComponent(executionEndpointId)}/proxy/openai`
        : undefined;

      const socketKey = buildSocketKey(agentId, sessionId);
      const existing = this.socketsByKey.get(socketKey);

      this.wsServer.handleUpgrade(req, socket, head, (ws) => {
        const now = new Date().toISOString();
        const connectionId = randomUUID();
        const socketState: AgentSocketState = {
          ws,
          socketKey,
          agentId,
          connectionId,
          apiInstanceId: this.apiInstanceId,
          ...(sessionId ? { sessionId } : {}),
          workspaceId: keyRecord.workspace_id,
          projectId: keyRecord.project_id,
          connectedAt: now,
          ...(resourceProxyBaseUrl ? { resourceProxyBaseUrl } : {}),
          pendingByRequestId: new Map(),
          terminalBySessionId: new Map(),
          lastPongAt: now,
          missedPongs: 0,
          lifecyclePhase: 'registering',
          presenceRegistered: false,
        };
        this.socketsByWebSocket.set(ws, socketState);
        this.trackBackgroundTask(this.registerSocketLifecycle({
          socketKey,
          socket: socketState,
          previousSocket: existing,
          remoteIp: inferRemoteIp(req),
        }));
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
      session_id: terminalSessionId,
      error_code: errorCode,
      error_message: errorMessage,
    });
    pending.close();
  }

  private markStreamEvent(socket: AgentSocketState, requestId: string, pending: PendingStream): void {
    if (!pending.hasReceivedEvent) {
      pending.hasReceivedEvent = true;
      if (pending.firstEventTimer) {
        clearTimeout(pending.firstEventTimer);
        pending.firstEventTimer = undefined;
      }
    }
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    pending.idleTimer = setTimeout(() => {
      this.failPendingStream(socket, requestId, 'AGENT_REQUEST_TIMEOUT', 'agent_request_idle_timeout');
    }, this.options.streamIdleTimeoutMs);
    pending.idleTimer.unref?.();
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
      void this.runHeartbeatTick(socketKey, socket);
    }, this.options.heartbeatIntervalMs);
    socket.heartbeatTimer.unref?.();
  }

  private clearSocketHeartbeat(socket: AgentSocketState): void {
    if (!socket.heartbeatTimer) return;
    clearInterval(socket.heartbeatTimer);
    socket.heartbeatTimer = undefined;
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
    for (let attempt = 1; attempt <= SOCKET_PRESENCE_RELEASE_MAX_ATTEMPTS; attempt += 1) {
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
        if (attempt >= SOCKET_PRESENCE_RELEASE_MAX_ATTEMPTS) {
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
    return this.agentResourceService.getSessionConnectionInfo(agentId, sessionId, {
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

  private async resolveDispatchSocket(input: {
    agentId: string;
    sessionId: string;
    scope: DispatchScope;
  }): Promise<AgentSocketState | null> {
    const local = this.resolvePrimarySocket(input.agentId, input.sessionId, input.scope);
    const authoritative = await this.getAuthoritativeConnection(input.agentId, input.sessionId, input.scope);
    if (!authoritative) {
      if (local) {
        this.releaseSocketState(local, {
          errorCode: 'AGENT_STALE_CONNECTION',
          errorMessage: 'agent_stale_connection',
          closeCode: 4001,
          closeReason: 'agent_stale_connection',
        });
      }
      return null;
    }
    if (authoritative.api_instance_id && authoritative.api_instance_id !== this.apiInstanceId) {
      if (local) {
        this.releaseSocketState(local, {
          errorCode: 'AGENT_STALE_CONNECTION',
          errorMessage: 'agent_stale_connection',
          closeCode: 4001,
          closeReason: 'agent_stale_connection',
        });
      }
      return null;
    }
    if (!this.isSocketDispatchable(local)) {
      return null;
    }
    if (local.connectionId !== authoritative.connection_id) {
      this.releaseSocketState(local, {
        errorCode: 'AGENT_STALE_CONNECTION',
        errorMessage: 'agent_stale_connection',
        closeCode: 4001,
        closeReason: 'agent_stale_connection',
      });
      return null;
    }
    return local;
  }

  private queueTerminalControlFrame(input: {
    socket: AgentSocketState;
    sessionId: string;
    terminalSessionId: string;
    type: 'server.terminal.stdin' | 'server.terminal.resize' | 'server.terminal.close';
    payload: Record<string, unknown>;
  }): void {
    const task = this.resolveDispatchSocket({
      agentId: input.socket.agentId,
      sessionId: input.sessionId,
      scope: 'session_strict',
    }).then((authoritativeSocket) => {
      if (!authoritativeSocket || authoritativeSocket !== input.socket) {
        return;
      }
      if (!input.socket.terminalBySessionId.has(input.terminalSessionId)) {
        return;
      }
      if (input.socket.ws.readyState !== input.socket.ws.OPEN) {
        return;
      }
      input.socket.ws.send(
        JSON.stringify({
          type: input.type,
          session_id: input.sessionId,
          terminal_session_id: input.terminalSessionId,
          timestamp: new Date().toISOString(),
          payload: input.payload,
        }),
      );
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
      if (args.previousSocket && args.previousSocket.lifecyclePhase !== 'closed' && this.isSocketOpen(args.previousSocket)) {
        await this.agentResourceService.registerAgentConnection({
          agentId: args.previousSocket.agentId,
          workspaceId: args.previousSocket.workspaceId,
          projectId: args.previousSocket.projectId,
          connectionId: args.previousSocket.connectionId,
          socketKey: args.previousSocket.socketKey,
          apiInstanceId: args.previousSocket.apiInstanceId,
          ...(args.previousSocket.sessionId ? { sessionId: args.previousSocket.sessionId } : {}),
          protocolVersion: '1.0',
          connectedAt: args.previousSocket.connectedAt,
          lastPongAt: args.previousSocket.lastPongAt,
        }).catch(() => undefined);
        args.previousSocket.presenceRegistered = true;
        args.previousSocket.lifecyclePhase = 'active';
        this.socketsByKey.set(args.socketKey, args.previousSocket);
      } else {
        await this.scheduleSocketPresenceRelease(args.socket);
      }
      return;
    }
    args.socket.lifecyclePhase = 'active';
    this.socketsByKey.set(args.socketKey, args.socket);
    this.startHeartbeat(args.socketKey, args.socket);
    if (args.previousSocket && args.previousSocket !== args.socket && args.previousSocket.lifecyclePhase !== 'closed') {
      args.previousSocket.lifecyclePhase = 'superseded';
      this.releaseSocketState(args.previousSocket, {
        errorCode: 'AGENT_DISCONNECTED',
        errorMessage: 'agent_reconnected',
        closeCode: 1012,
        closeReason: 'agent_replaced',
        skipPresenceUpdate: true,
      });
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
    socket.ws.send(JSON.stringify({
      type: 'server.ping',
      timestamp: now,
      payload: {},
    }));
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
    },
  ): void {
    if (socket.lifecyclePhase === 'closed' || socket.lifecyclePhase === 'closing') return;
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
    for (const [terminalSessionId, pending] of socket.terminalBySessionId.entries()) {
      socket.terminalBySessionId.delete(terminalSessionId);
      this.clearTerminalTimers(pending);
      pending.push({
        type: 'error',
        session_id: terminalSessionId,
        error_code: options.errorCode,
        error_message: options.errorMessage,
      });
      pending.close();
    }
    if (this.socketsByKey.get(socket.socketKey) === socket) {
      this.socketsByKey.delete(socket.socketKey);
    }
    this.socketsByWebSocket.delete(socket.ws);

    if (!options.skipCloseFrame && socket.ws.readyState === socket.ws.OPEN) {
      socket.ws.close(options.closeCode, options.closeReason);
    }

    if (!options.skipPresenceUpdate) {
      void this.scheduleSocketPresenceRelease(socket).catch(() => undefined);
    } else {
      socket.presenceRegistered = false;
    }
    socket.lifecyclePhase = 'closed';
  }

  async dispatchStreamingRequest(input: {
    workspaceId: string;
    projectId: string;
    sessionId: string;
    agentId: string;
    model: string;
    messages: Array<Record<string, unknown>>;
    executionContext?: Record<string, unknown>;
  }): Promise<{ requestId: string; stream: AsyncIterable<AgentStreamEvent>; cancel: () => void }> {
    if (this.shuttingDown) {
      throw new Error('agent_execution_service_shutdown');
    }
    const dispatchScope: DispatchScope = input.executionContext?.interaction_kind === 'notebook'
      ? 'session_strict'
      : 'agent_fallback';
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
    };
    socket.pendingByRequestId.set(requestId, pending);
    this.armStreamTimeouts(socket, requestId, pending);

    socket.ws.send(
      JSON.stringify({
        type: 'server.request.start',
        request_id: requestId,
        session_id: input.sessionId,
        timestamp: new Date().toISOString(),
        payload: {
          model: input.model,
          stream: true,
          messages: input.messages,
          ...(input.executionContext ? { execution_context: input.executionContext } : {}),
        },
      }),
    );

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
              session_id: input.sessionId,
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
    const socket = await this.resolveDispatchSocket({
      agentId: input.agentId,
      sessionId: input.sessionId,
      scope: 'session_strict',
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
    };
    socket.terminalBySessionId.set(input.terminalSessionId, pending);
    this.armTerminalTimeouts(socket, input.terminalSessionId, pending);

    socket.ws.send(
      JSON.stringify({
        type: 'server.terminal.start',
        session_id: input.sessionId,
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
          ...(input.payload.executionContext ? { execution_context: input.payload.executionContext } : {}),
        },
      }),
    );
    debugExecution(
      `dispatch_terminal_sent agent_id=${input.agentId} runner_session=${input.sessionId} terminal_session=${input.terminalSessionId}`,
    );

    return {
      stream: queue.iterable,
      writeInput: (data: string) => {
        this.queueTerminalControlFrame({
          socket,
          sessionId: input.sessionId,
          terminalSessionId: input.terminalSessionId,
          type: 'server.terminal.stdin',
          payload: { data },
        });
      },
      resize: (cols: number, rows: number) => {
        this.queueTerminalControlFrame({
          socket,
          sessionId: input.sessionId,
          terminalSessionId: input.terminalSessionId,
          type: 'server.terminal.resize',
          payload: { cols, rows },
        });
      },
      close: () => {
        this.queueTerminalControlFrame({
          socket,
          sessionId: input.sessionId,
          terminalSessionId: input.terminalSessionId,
          type: 'server.terminal.close',
          payload: {},
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
  }): Promise<'signaled' | 'agent_offline' | 'agent_workspace_mismatch'> {
    const socket = await this.resolveDispatchSocket({
      agentId: input.agentId,
      sessionId: input.sessionId,
      scope: 'session_strict',
    });
    if (!socket) {
      return 'agent_offline';
    }
    if (socket.workspaceId !== input.workspaceId || socket.projectId !== input.projectId) {
      return 'agent_workspace_mismatch';
    }

    socket.ws.send(
      JSON.stringify({
        type: 'server.terminal.close',
        session_id: input.sessionId,
        terminal_session_id: input.terminalSessionId,
        timestamp: new Date().toISOString(),
        payload: {},
      }),
    );
    return 'signaled';
  }

  private handleSocketClose(ws: WebSocket): void {
    const socket = this.socketsByWebSocket.get(ws);
    if (!socket) return;
    this.releaseSocketState(socket, {
      errorCode: 'AGENT_DISCONNECTED',
      errorMessage: 'agent_disconnected',
      closeCode: 1006,
      closeReason: 'agent_disconnected',
      skipCloseFrame: true,
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
      void this.agentResourceService.getAgent(socket.workspaceId, socket.projectId, socket.agentId).then((current) => {
        const interactionKind = current ? resolveAgentInteractionKind(current) : null;
        if (!interactionKind) {
          void this.agentResourceService.updateAgentRuntimeState(
            socket.workspaceId,
            socket.projectId,
            socket.agentId,
            {
              last_error: 'agent_interaction_kind_required',
              last_error_at: new Date().toISOString(),
            },
          );
          socket.ws.close(1008, 'agent_interaction_kind_required');
          return;
        }

        const runnerSpec = readRunnerSpec(payload.payload);
        if (runnerSpec && !isMatchingRunnerSpec(interactionKind, runnerSpec)) {
          void this.agentResourceService.updateAgentRuntimeState(
            socket.workspaceId,
            socket.projectId,
            socket.agentId,
            {
              last_error: 'agent_runner_spec_mismatch',
              last_error_at: new Date().toISOString(),
              runner_spec_mismatch: {
                expected_interaction_kind: interactionKind,
                actual_runner_spec: runnerSpec as Record<string, unknown>,
              },
            },
          );
          socket.ws.close(1008, 'agent_runner_spec_mismatch');
          return;
        }

        const incoming = isPlainObject(payload.payload) ? payload.payload : {};
        const metadata = Object.fromEntries(
          Object.entries(incoming).filter(([key]) => key !== 'runner_spec'),
        );
        return this.agentResourceService.updateAgentRuntimeState(
          socket.workspaceId,
          socket.projectId,
          socket.agentId,
          {
            last_error: undefined,
            last_error_at: undefined,
            metadata: {
              ...metadata,
              ready_at: new Date().toISOString(),
              ...(runnerSpec ? { runner_spec: runnerSpec as Record<string, unknown> } : {}),
            },
            ...(runnerSpec ? { runner_spec_mismatch: undefined } : {}),
          },
        );
      });
      return;
    }

    const terminalSessionId =
      typeof payload.payload?.terminal_session_id === 'string'
        ? payload.payload.terminal_session_id
        : (typeof (payload as { terminal_session_id?: unknown }).terminal_session_id === 'string'
          ? (payload as { terminal_session_id?: string }).terminal_session_id ?? null
          : null);
    if (terminalSessionId) {
      const pendingTerminal = socket.terminalBySessionId.get(terminalSessionId);
      if (!pendingTerminal) return;

      if (payload.type === 'agent.terminal.started') {
        debugExecution(`terminal_started agent_id=${socket.agentId} runner_session=${socket.sessionId ?? ''} terminal_session=${terminalSessionId}`);
        this.markTerminalEvent(socket, terminalSessionId, pendingTerminal);
        pendingTerminal.push({
          type: 'started',
          session_id: terminalSessionId,
          cols: typeof payload.payload?.cols === 'number' ? payload.payload.cols : undefined,
          rows: typeof payload.payload?.rows === 'number' ? payload.payload.rows : undefined,
        });
        return;
      }

      if (payload.type === 'agent.terminal.output') {
        debugExecution(`terminal_output agent_id=${socket.agentId} runner_session=${socket.sessionId ?? ''} terminal_session=${terminalSessionId}`);
        this.markTerminalEvent(socket, terminalSessionId, pendingTerminal);
        if (typeof payload.payload?.chunk !== 'string') {
          socket.terminalBySessionId.delete(terminalSessionId);
          this.clearTerminalTimers(pendingTerminal);
          pendingTerminal.push({
            type: 'error',
            error_code: 'AGENT_PROTOCOL_ERROR',
            error_message: 'agent_terminal_output_invalid',
          });
          pendingTerminal.close();
          return;
        }
        pendingTerminal.push({
          type: 'output',
          session_id: terminalSessionId,
          chunk: payload.payload.chunk,
        });
        return;
      }

      if (payload.type === 'agent.terminal.exited') {
        debugExecution(`terminal_exited agent_id=${socket.agentId} runner_session=${socket.sessionId ?? ''} terminal_session=${terminalSessionId}`);
        socket.terminalBySessionId.delete(terminalSessionId);
        this.clearTerminalTimers(pendingTerminal);
        pendingTerminal.push({
          type: 'exited',
          session_id: terminalSessionId,
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
          session_id: terminalSessionId,
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
      this.markStreamEvent(socket, requestId, pending);
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
      this.markStreamEvent(socket, requestId, pending);
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
      this.markStreamEvent(socket, requestId, pending);
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

  async getAgentSessionDispatchAuthority(
    agentId: string,
    sessionId: string,
  ): Promise<RunnerSessionDispatchAuthority> {
    const socket = this.socketsByKey.get(buildSocketKey(agentId, sessionId));
    const connection = await this.agentResourceService.getSessionConnectionInfo(agentId, sessionId, {
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
