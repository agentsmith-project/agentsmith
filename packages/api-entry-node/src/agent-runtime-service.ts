import type http from 'node:http';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { URL } from 'node:url';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import type { AgentResourceService } from './agent-resource-service.js';

export interface AgentStreamEvent {
  type: 'delta' | 'done' | 'error';
  delta?: string;
  finish_reason?: string | null;
  usage_tokens?: number;
  error_code?: string;
  error_message?: string;
}

interface PendingStream {
  push: (event: AgentStreamEvent) => void;
  close: () => void;
  fail: (error: Error) => void;
  timer: NodeJS.Timeout;
  timeoutMs: number;
}

interface AgentSocketState {
  ws: WebSocket;
  workspaceId: string;
  projectId: string;
  connectedAt: string;
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

function debugRuntime(message: string): void {
  if (process.env.DEBUG_AGENT_RUNTIME !== '1') return;
  process.stdout.write(`[agent-runtime] ${message}\n`);
}

function getAgentRuntimeRequestTimeoutMs(): number {
  const raw = process.env.AGENT_RUNTIME_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1000, Math.floor(parsed));
  }
  return 60_000;
}

function armPendingTimeout(
  pending: PendingStream,
  requestId: string,
  socket: AgentSocketState,
  agentId: string,
): void {
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    socket.pendingByRequestId.delete(requestId);
    debugRuntime(`request_timeout agent_id=${agentId} request_id=${requestId}`);
    pending.push({ type: 'error', error_code: 'AGENT_TIMEOUT', error_message: 'agent_response_timeout' });
    pending.close();
  }, pending.timeoutMs);
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function mergeRuntimePreferences(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!existing) return incoming ?? {};
  if (!incoming) return existing;

  const merged: Record<string, unknown> = { ...existing };
  for (const [key, incomingValue] of Object.entries(incoming)) {
    const existingValue = merged[key];
    if (isPlainObject(existingValue) && isPlainObject(incomingValue)) {
      merged[key] = mergeRuntimePreferences(existingValue, incomingValue);
      continue;
    }
    merged[key] = incomingValue;
  }
  return merged;
}

export class AgentRuntimeService {
  private readonly wsServer: WebSocketServer;
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
          payload: { protocol_version: '1.0', heartbeat_interval_sec: 15 },
        }),
      );

      ws.on('message', (data) => this.handleAgentMessage(agentId, data));
      ws.on('close', () => this.handleSocketClose(agentId));
      ws.on('error', () => this.handleSocketClose(agentId));
    });
  }

  handleUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/api/v1/agent-runtime/ws') {
      debugRuntime(`reject path=${url.pathname}`);
      socket.destroy();
      return;
    }

    const agentId = url.searchParams.get('agent_id') || '';
    if (!agentId) {
      debugRuntime('reject missing_agent_id');
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = parseBearerToken(req);
    if (!token) {
      debugRuntime(`reject missing_token agent_id=${agentId}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    void this.agentResourceService.verifyAgentKey(agentId, token).then(async (keyRecord) => {
      if (!keyRecord) {
        debugRuntime(`reject invalid_key agent_id=${agentId}`);
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
        debugRuntime(
          `reject agent_not_enabled_or_missing agent_id=${agentId} ws=${keyRecord.workspace_id} proj=${keyRecord.project_id} has_agent=${agent ? '1' : '0'} status=${agent?.status ?? 'null'}`,
        );
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      debugRuntime(`accept agent_id=${agentId} ws=${keyRecord.workspace_id} proj=${keyRecord.project_id}`);

      const existing = this.socketsByAgentId.get(agentId);
      if (existing) {
        for (const pending of existing.pendingByRequestId.values()) {
          clearTimeout(pending.timer);
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
      debugRuntime(`reject internal_error agent_id=${agentId}`);
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
    runtimeContext?: Record<string, unknown>;
    timeoutMs?: number;
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
    const timeoutMs = Math.max(1000, input.timeoutMs ?? getAgentRuntimeRequestTimeoutMs());
    const pending: PendingStream = {
      push: queue.push,
      close: queue.close,
      fail: queue.fail,
      timeoutMs,
      timer: setTimeout(() => undefined, timeoutMs),
    };
    armPendingTimeout(pending, requestId, socket, input.agentId);
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
          ...(input.runtimeContext ? { runtime_context: input.runtimeContext } : {}),
        },
      }),
    );

    return {
      requestId,
      stream: queue.iterable,
      cancel: () => {
        const state = socket.pendingByRequestId.get(requestId);
        if (!state) return;
        clearTimeout(state.timer);
        socket.pendingByRequestId.delete(requestId);
        state.push({ type: 'done', finish_reason: 'cancelled' });
        state.close();
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
      },
    };
  }

  private handleSocketClose(agentId: string): void {
    const socket = this.socketsByAgentId.get(agentId);
    if (!socket) return;
    for (const pending of socket.pendingByRequestId.values()) {
      clearTimeout(pending.timer);
      pending.push({
        type: 'error',
        error_code: 'AGENT_DISCONNECTED',
        error_message: 'agent_disconnected',
      });
      pending.close();
    }
    this.socketsByAgentId.delete(agentId);
    this.agentResourceService.markAgentDisconnected(agentId);
    void this.agentResourceService.touchAgentPresence(socket.workspaceId, socket.projectId, agentId, 'offline');
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
        const existing = isPlainObject(current?.runtime_preferences_json)
          ? current.runtime_preferences_json
          : {};
        const incoming = isPlainObject(payload.payload) ? payload.payload : {};
        return this.agentResourceService.updateAgent(socket.workspaceId, socket.projectId, agentId, {
          runtime_preferences_json: mergeRuntimePreferences(existing, incoming),
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
        clearTimeout(pending.timer);
        socket.pendingByRequestId.delete(requestId);
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
      armPendingTimeout(pending, requestId, socket, agentId);
      return;
    }

    if (payload.type === 'agent.response.done') {
      clearTimeout(pending.timer);
      socket.pendingByRequestId.delete(requestId);
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

    if (payload.type === 'agent.response.error') {
      clearTimeout(pending.timer);
      socket.pendingByRequestId.delete(requestId);
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

    clearTimeout(pending.timer);
    socket.pendingByRequestId.delete(requestId);
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
