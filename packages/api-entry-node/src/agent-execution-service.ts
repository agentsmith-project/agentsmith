import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { AgentResourceService } from './agent-resource-service.js';

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
}

interface AgentSocketState {
  ws: WebSocket;
  workspaceId: string;
  projectId: string;
  connectedAt: string;
  resourceProxyBaseUrl?: string;
  pendingByRequestId: Map<string, PendingStream>;
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

function firstHeaderValue(input: string | string[] | undefined): string | null {
  if (!input) return null;
  const raw = Array.isArray(input) ? input[0] : input;
  const first = raw.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function inferRequestOrigin(req: http.IncomingMessage): string | null {
  const host = firstHeaderValue(req.headers['x-forwarded-host'])
    ?? firstHeaderValue(req.headers.host);
  const proto = firstHeaderValue(req.headers['x-forwarded-proto'])
    ?? (((req.socket as { encrypted?: boolean }).encrypted ?? false) ? 'https' : 'http');
  if (host) {
    return `${proto}://${host}`;
  }
  const wsBase = process.env.AGENT_EXECUTION_WS_BASE_URL?.trim();
  if (wsBase) {
    try {
      const parsed = new URL(wsBase.replace(/^wss?:\/\//, (m) => (m === 'wss://' ? 'https://' : 'http://')));
      return parsed.origin;
    } catch {
      // ignore malformed env and keep probing fallback
    }
  }
  if (typeof req.socket.localPort === 'number' && req.socket.localPort > 0) {
    return `http://localhost:${req.socket.localPort}`;
  }
  return null;
}

function readAgentNotebookEndpointId(agent: { execution_preferences_json?: unknown }): string | null {
  const executionPreferences = agent.execution_preferences_json;
  if (!isPlainRecord(executionPreferences)) return null;
  const notebook = executionPreferences.notebook;
  if (!isPlainRecord(notebook)) return null;
  const endpointId = notebook.endpoint_id;
  if (typeof endpointId !== 'string') return null;
  const trimmed = endpointId.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function mergeExecutionPreferences(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!existing) return incoming ?? {};
  if (!incoming) return existing;

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, incomingValue] of Object.entries(incoming)) {
    const existingValue = merged[key];
    if (isPlainObject(existingValue) && isPlainObject(incomingValue)) {
      merged[key] = mergeExecutionPreferences(existingValue, incomingValue);
      continue;
    }
    merged[key] = incomingValue;
  }
  return merged;
}

export class AgentExecutionService {
  private readonly wsServer: WebSocketServer;
  // Runtime sockets are indexed by agentId for the current MVP. The trusted
  // workspace/project boundary still comes from the verified agent key record,
  // and every dispatched request is checked against that scope again.
  private readonly socketsByAgentId = new Map<string, AgentSocketState>();

  constructor(private readonly agentResourceService: AgentResourceService) {
    this.wsServer = new WebSocketServer({ noServer: true });
    this.wsServer.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '', 'http://localhost');
      const agentId = url.searchParams.get('agent_id') || '';
      const socketState = this.socketsByAgentId.get(agentId);
      if (!socketState || socketState.ws !== ws) {
        ws.close(1011, 'agent_state_missing');
        return;
      }

      ws.send(
        JSON.stringify({
          type: 'server.hello',
          timestamp: new Date().toISOString(),
          payload: {
            protocol_version: '1.0',
            heartbeat_interval_sec: 15,
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

      ws.on('message', (data) => this.handleAgentMessage(agentId, data));
      ws.on('close', () => this.handleSocketClose(agentId));
      ws.on('error', () => this.handleSocketClose(agentId));
    });
  }

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/api/v1/agent-execution/ws') {
      debugExecution(`reject path=${url.pathname}`);
      socket.destroy();
      return;
    }

    const agentId = url.searchParams.get('agent_id') || '';
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
      const notebookEndpointId = readAgentNotebookEndpointId(agent);
      const origin = inferRequestOrigin(req);
      const resourceProxyBaseUrl = notebookEndpointId && origin
        ? `${origin}/api/v1/workspaces/${encodeURIComponent(keyRecord.workspace_id)}`
          + `/projects/${encodeURIComponent(keyRecord.project_id)}`
          + `/endpoints/${encodeURIComponent(notebookEndpointId)}/proxy`
        : undefined;

      const existing = this.socketsByAgentId.get(agentId);
      if (existing) {
        for (const pending of existing.pendingByRequestId.values()) {
          pending.push({
            type: 'error',
            error_code: 'AGENT_DISCONNECTED',
            error_message: 'agent_reconnected',
          });
          pending.close();
        }
        existing.ws.close(1012, 'agent_replaced');
      }

      this.wsServer.handleUpgrade(req, socket, head, (ws) => {
        this.socketsByAgentId.set(agentId, {
          ws,
          workspaceId: keyRecord.workspace_id,
          projectId: keyRecord.project_id,
          connectedAt: new Date().toISOString(),
          ...(resourceProxyBaseUrl ? { resourceProxyBaseUrl } : {}),
          pendingByRequestId: new Map(),
        });
        this.agentResourceService.markAgentConnected(agentId, {
          remote_ip: inferRemoteIp(req),
          protocol_version: '1.0',
          last_pong_at: new Date().toISOString(),
        });
        void this.agentResourceService.touchAgentPresence(
          keyRecord.workspace_id,
          keyRecord.project_id,
          agentId,
          'online',
        );
        this.wsServer.emit('connection', ws, req);
      });
    }).catch(() => {
      debugExecution(`reject internal_error agent_id=${agentId}`);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
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
    const socket = this.socketsByAgentId.get(input.agentId);
    if (!socket || socket.ws.readyState !== socket.ws.OPEN) {
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

  private handleSocketClose(agentId: string): void {
    const socket = this.socketsByAgentId.get(agentId);
    if (!socket) return;
    for (const pending of socket.pendingByRequestId.values()) {
      if (pending.cancelTimeout) {
        clearTimeout(pending.cancelTimeout);
      }
      pending.push({
        type: 'error',
        error_code: 'AGENT_DISCONNECTED',
        error_message: 'agent_disconnected',
      });
      pending.close();
    }
    this.socketsByAgentId.delete(agentId);
    this.agentResourceService.markAgentDisconnected(agentId);
    void this.agentResourceService.getAgent(socket.workspaceId, socket.projectId, agentId).then((agent) => (
      this.agentResourceService.touchAgentPresence(
        socket.workspaceId,
        socket.projectId,
        agentId,
        agent?.mode === 'internal' ? 'managed' : 'offline',
      )
    ));
  }

  private handleAgentMessage(agentId: string, raw: RawData): void {
    const socket = this.socketsByAgentId.get(agentId);
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
      const state = this.socketsByAgentId.get(agentId);
      if (state) {
        state.ws.close(1003, 'invalid_json');
      }
      return;
    }

    if (payload.type === 'agent.pong') {
      this.agentResourceService.markAgentConnected(agentId, {
        protocol_version: '1.0',
        last_pong_at: new Date().toISOString(),
      });
      return;
    }

    if (payload.type === 'agent.ready') {
      void this.agentResourceService.getAgent(socket.workspaceId, socket.projectId, agentId).then((current) => {
        const existing = isPlainObject(current?.execution_preferences_json)
          ? current.execution_preferences_json
          : {};
        const incoming = isPlainObject(payload.payload) ? payload.payload : {};
        return this.agentResourceService.updateAgent(socket.workspaceId, socket.projectId, agentId, {
          execution_preferences_json: mergeExecutionPreferences(existing, incoming),
        });
      });
      return;
    }

    const requestId = payload.request_id;
    if (!requestId) return;
    const pending = socket.pendingByRequestId.get(requestId);
    if (!pending) return;

    if (payload.type === 'agent.response.delta') {
      if (typeof payload.payload?.delta !== 'string') {
        socket.pendingByRequestId.delete(requestId);
        if (pending.cancelTimeout) {
          clearTimeout(pending.cancelTimeout);
        }
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
        if (pending.cancelTimeout) {
          clearTimeout(pending.cancelTimeout);
        }
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
      if (pending.cancelTimeout) {
        clearTimeout(pending.cancelTimeout);
      }
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
      const artifactPayload = parseArtifactPayload(payload.payload);
      if (!artifactPayload) {
        socket.pendingByRequestId.delete(requestId);
        if (pending.cancelTimeout) {
          clearTimeout(pending.cancelTimeout);
        }
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
      if (pending.cancelTimeout) {
        clearTimeout(pending.cancelTimeout);
      }
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
    if (pending.cancelTimeout) {
      clearTimeout(pending.cancelTimeout);
    }
    pending.push({
      type: 'error',
      error_code: 'AGENT_PROTOCOL_ERROR',
      error_message: 'agent_response_type_unsupported',
    });
    pending.close();
  }

  getAgentOnlineState(agentId: string): boolean {
    const socket = this.socketsByAgentId.get(agentId);
    return !!socket && socket.ws.readyState === socket.ws.OPEN;
  }

  listOnlineAgentIds(): string[] {
    return [...this.socketsByAgentId.keys()];
  }
}
