import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { ProjectsRoute } from './projects-route-match.js';

interface TaskRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  agent_id: string;
  agent_name: string;
  status: 'active' | 'closed' | 'archived';
  attached_source_ids: string[];
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

interface TaskMessageRecord {
  id: string;
  task_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string;
  referenced_source_ids?: string[];
  turn_id?: string;
}

interface TaskArtifactRecord {
  id: string;
  task_id: string;
  type: 'text' | 'image' | 'file' | 'other';
  title?: string;
  content?: string;
  thumbnail_url?: string;
  file_size?: number;
  mime_type?: string;
  created_at: string;
}

interface TaskRouteHandlerArgs {
  route: ProjectsRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  rawBearerToken: string | null;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

const TASKS_BY_PROJECT = new Map<string, TaskRecord[]>();
const MESSAGES_BY_TASK = new Map<string, TaskMessageRecord[]>();
const ARTIFACTS_BY_TASK = new Map<string, TaskArtifactRecord[]>();
const TASK_EVENT_CLIENTS = new Map<string, Set<http.ServerResponse>>();
const ACTIVE_RUNS_BY_TASK = new Set<string>();
let nextTaskId = 1;
let nextMessageId = 1;

function debugNotebookRuntime(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_RUNTIME !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-runtime] ${message}${suffix}\n`);
}

function projectKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildId(prefix: string, index: number): string {
  return `${prefix}_${String(index).padStart(6, '0')}`;
}

function asObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function readStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string').map((s) => s.trim()).filter(Boolean);
}

function getTasks(workspaceId: string, projectId: string): TaskRecord[] {
  const key = projectKey(workspaceId, projectId);
  let existing = TASKS_BY_PROJECT.get(key);
  if (!existing) {
    existing = [];
    TASKS_BY_PROJECT.set(key, existing);
  }
  return existing;
}

function getTaskMessages(taskId: string): TaskMessageRecord[] {
  let existing = MESSAGES_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    MESSAGES_BY_TASK.set(taskId, existing);
  }
  return existing;
}

function getTaskArtifacts(taskId: string): TaskArtifactRecord[] {
  let existing = ARTIFACTS_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    ARTIFACTS_BY_TASK.set(taskId, existing);
  }
  return existing;
}

function findTask(workspaceId: string, projectId: string, taskId: string): TaskRecord | undefined {
  return getTasks(workspaceId, projectId).find((item) => item.id === taskId);
}

function writeDefaultSSE(res: http.ServerResponse, payload: unknown): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function emitTaskEvent(taskId: string, payload: unknown): void {
  const clients = TASK_EVENT_CLIENTS.get(taskId);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    if (client.writableEnded || client.destroyed) {
      clients.delete(client);
      continue;
    }
    try {
      writeDefaultSSE(client, payload);
    } catch {
      clients.delete(client);
    }
  }
  if (clients.size === 0) {
    TASK_EVENT_CLIENTS.delete(taskId);
  }
}

function sanitizePathPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'unknown';
}

function mapTaskMessagesForRuntime(taskId: string, assistantMessageId: string): Array<Record<string, unknown>> {
  return getTaskMessages(taskId)
    .filter((item) => item.id !== assistantMessageId)
    .filter((item) => item.role === 'user' || (item.role === 'agent' && item.content.trim().length > 0))
    .map((item) => ({
      role: item.role === 'agent' ? 'assistant' : 'user',
      content: item.content,
    }));
}

function updateTaskActivity(task: TaskRecord): void {
  const now = nowIso();
  task.last_activity_at = now;
  task.updated_at = now;
}

function readSortValue(task: TaskRecord, sortBy: string): string {
  if (sortBy === 'created_at') return task.created_at;
  if (sortBy === 'updated_at') return task.updated_at;
  if (sortBy === 'last_activity_at') return task.last_activity_at;
  return task.last_activity_at;
}

async function runTaskWithExternalAgent(input: {
  deps: NodeApiDeps;
  task: TaskRecord;
  assistantMessage: TaskMessageRecord;
  agentId: string;
  user: AuthenticatedUser;
  rawBearerToken: string | null;
  publicBaseUrl: string;
}): Promise<void> {
  const { deps, task, assistantMessage, agentId, user, rawBearerToken, publicBaseUrl } = input;
  const taskId = task.id;
  const runId = buildId('run', Date.now());
  let reachedTerminal = false;
  let endpointIdForLog: string | null = null;

  try {
    const agent = await deps.agentResourceService.getAgent(task.workspace_id, task.project_id, agentId);
    if (!agent || agent.status !== 'enabled') {
      throw Object.assign(new Error('agent_not_available'), { code: 'AGENT_OFFLINE' });
    }

    const runtimePreferences = asObject(agent.runtime_preferences_json);
    const notebookPreferences = asObject(runtimePreferences.notebook);
    const endpointId = typeof notebookPreferences.endpoint_id === 'string'
      ? notebookPreferences.endpoint_id.trim()
      : '';
    endpointIdForLog = endpointId || null;
    if (!endpointId) {
      throw Object.assign(new Error('task_agent_endpoint_not_configured'), {
        code: 'TASK_AGENT_ENDPOINT_NOT_CONFIGURED',
      });
    }

    const endpoint = await deps.endpointResourceService.getEndpoint(
      task.workspace_id,
      task.project_id,
      endpointId,
    );
    if (!endpoint || endpoint.status !== 'active') {
      throw Object.assign(new Error('endpoint_not_available'), { code: 'VALIDATION_ERROR' });
    }
    if (!rawBearerToken) {
      throw Object.assign(new Error('user_token_missing'), { code: 'UNAUTHORIZED' });
    }

    const explicitModel = typeof notebookPreferences.model === 'string'
      ? notebookPreferences.model.trim()
      : '';
    const model = explicitModel || endpoint.openai_model || 'gpt-5-codex';
    const wireApi = notebookPreferences.wire_api === 'responses' ? 'responses' : 'chat';
    const userHandle = sanitizePathPart(user.email || user.name || user.id);
    const proxyBase = `${publicBaseUrl.replace(/\/+$/, '')}`
      + `/api/v1/workspaces/${encodeURIComponent(task.workspace_id)}`
      + `/projects/${encodeURIComponent(task.project_id)}`
      + `/endpoints/${encodeURIComponent(endpointId)}/proxy`;

    const dispatched = await deps.agentRuntimeService.dispatchStreamingRequest({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      sessionId: task.id,
      agentId: agentId,
      model,
      messages: mapTaskMessagesForRuntime(taskId, assistantMessage.id),
      runtimeContext: {
        workspace_id: task.workspace_id,
        project_id: task.project_id,
        task_id: task.id,
        run_id: runId,
        username: userHandle,
        endpoint_id: endpointId,
        endpoint_proxy_base: proxyBase,
        user_bearer_token: rawBearerToken,
        wire_api: wireApi,
        model,
      },
    });
    debugNotebookRuntime('dispatch_streaming_request', {
      task_id: task.id,
      run_id: runId,
      agent_id: agentId,
      endpoint_id: endpointId,
      request_id: dispatched.requestId,
      model,
      wire_api: wireApi,
    });

    for await (const event of dispatched.stream) {
      if (event.type === 'delta' && event.delta) {
        assistantMessage.content += event.delta;
        debugNotebookRuntime('runtime_event_delta', {
          task_id: task.id,
          run_id: runId,
          request_id: dispatched.requestId,
          delta_chars: event.delta.length,
          total_agent_chars: assistantMessage.content.length,
        });
        emitTaskEvent(taskId, { type: 'message', data: assistantMessage });
        continue;
      }
      if (event.type === 'error') {
        task.status = 'closed';
        reachedTerminal = true;
        debugNotebookRuntime('runtime_event_error', {
          task_id: task.id,
          run_id: runId,
          request_id: dispatched.requestId,
          code: event.error_code ?? 'AGENT_UPSTREAM_ERROR',
          message: event.error_message ?? 'agent_runtime_error',
          agent_chars: assistantMessage.content.length,
        });
        emitTaskEvent(taskId, {
          type: 'error',
          data: {
            message: event.error_message ?? 'agent_runtime_error',
            code: event.error_code ?? 'AGENT_UPSTREAM_ERROR',
          },
        });
        break;
      }
      if (event.type === 'done') {
        task.status = 'closed';
        reachedTerminal = true;
        debugNotebookRuntime('runtime_event_done', {
          task_id: task.id,
          run_id: runId,
          request_id: dispatched.requestId,
          finish_reason: event.finish_reason ?? 'stop',
          usage_tokens: event.usage_tokens ?? null,
          agent_chars: assistantMessage.content.length,
        });
        break;
      }
    }
  } catch (error) {
    task.status = 'closed';
    reachedTerminal = true;
    const codeCandidate = error instanceof Error
      ? (error as Error & { code?: unknown }).code
      : undefined;
    const code = typeof codeCandidate === 'string'
      ? codeCandidate
      : 'AGENT_UPSTREAM_ERROR';
    debugNotebookRuntime('runtime_dispatch_exception', {
      task_id: task.id,
      run_id: runId,
      agent_id: agentId,
      endpoint_id: endpointIdForLog,
      code,
      message: error instanceof Error ? error.message : 'agent_runtime_error',
    });
    emitTaskEvent(taskId, {
      type: 'error',
      data: {
        message: error instanceof Error ? error.message : 'agent_runtime_error',
        code,
      },
    });
  } finally {
    if (!reachedTerminal) {
      // Defensive: if the stream exited without explicit done/error, do not leave notebook task active forever.
      task.status = 'closed';
      debugNotebookRuntime('runtime_stream_finalized_without_terminal', {
        task_id: task.id,
        run_id: runId,
        agent_id: agentId,
        endpoint_id: endpointIdForLog,
        agent_chars: assistantMessage.content.length,
      });
    }
    updateTaskActivity(task);
    debugNotebookRuntime('task_run_finalized', {
      task_id: task.id,
      run_id: runId,
      agent_id: agentId,
      endpoint_id: endpointIdForLog,
      status: task.status,
      agent_chars: assistantMessage.content.length,
      reached_terminal: reachedTerminal,
    });
    emitTaskEvent(taskId, { type: 'message', data: assistantMessage });
    emitTaskEvent(taskId, { type: 'task_update', data: task });
    ACTIVE_RUNS_BY_TASK.delete(taskId);
  }
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolvePublicBaseUrl(req: http.IncomingMessage): string {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto']);
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host']);
  const host = firstHeaderValue(req.headers.host);
  const proto = (forwardedProto?.split(',')[0]?.trim() || 'http').toLowerCase();
  const resolvedHost = forwardedHost?.split(',')[0]?.trim() || host?.trim();
  if (resolvedHost) {
    return `${proto}://${resolvedHost}`;
  }
  return process.env.MBOS_PUBLIC_BASE_URL ?? 'http://localhost:20000';
}

export async function handleTaskRoute(args: TaskRouteHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, rawBearerToken, json, readBody } = args;

  if (route.kind === 'tasks' && method === 'GET') {
    const requestUrl = new URL(req.url ?? '', 'http://localhost');
    const search = requestUrl.searchParams.get('search')?.trim().toLowerCase() ?? '';
    const sortBy = requestUrl.searchParams.get('sort_by') ?? 'last_activity_at';
    const sortOrder = requestUrl.searchParams.get('sort_order') === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, Number(requestUrl.searchParams.get('page') ?? '1') || 1);
    const pageSize = Math.max(1, Number(requestUrl.searchParams.get('page_size') ?? '20') || 20);

    const all = getTasks(route.workspaceId, route.projectId)
      .filter((item) => (search ? item.title.toLowerCase().includes(search) : true))
      .sort((a, b) => {
        const aa = readSortValue(a, sortBy);
        const bb = readSortValue(b, sortBy);
        return sortOrder === 'asc' ? aa.localeCompare(bb) : bb.localeCompare(aa);
      });

    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);
    json(res, 200, {
      items,
      total: all.length,
      page,
      page_size: pageSize,
      has_more: start + pageSize < all.length,
    });
    return true;
  }

  if (route.kind === 'tasks' && method === 'POST') {
    const body = asObject(await readBody(req));
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const agentId = typeof body.agent_id === 'string' ? body.agent_id.trim() : '';
    if (!title) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'task_title_required' });
      return true;
    }
    if (!agentId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_id_required' });
      return true;
    }

    const agent = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, agentId);
    if (!agent || agent.status !== 'enabled' || agent.interaction_mode === 'chat') {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found_or_not_notebook_compatible' });
      return true;
    }

    const createdAt = nowIso();
    const task: TaskRecord = {
      id: buildId('task', nextTaskId++),
      workspace_id: route.workspaceId,
      project_id: route.projectId,
      owner_user_id: user.id,
      title,
      agent_id: agent.id,
      agent_name: agent.name,
      status: 'active',
      attached_source_ids: readStringArray(body.initial_source_ids),
      created_at: createdAt,
      updated_at: createdAt,
      last_activity_at: createdAt,
    };
    getTasks(route.workspaceId, route.projectId).unshift(task);
    json(res, 201, task);
    return true;
  }

  if (route.kind === 'taskItem' && method === 'GET') {
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskItem' && method === 'PATCH') {
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    if (typeof body.title === 'string' && body.title.trim()) {
      task.title = body.title.trim();
    }
    if (body.status === 'active' || body.status === 'closed' || body.status === 'archived') {
      task.status = body.status;
    }
    task.updated_at = nowIso();
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskItem' && method === 'DELETE') {
    const tasks = getTasks(route.workspaceId, route.projectId);
    const index = tasks.findIndex((item) => item.id === route.taskId);
    if (index < 0) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    tasks.splice(index, 1);
    ACTIVE_RUNS_BY_TASK.delete(route.taskId);
    TASK_EVENT_CLIENTS.delete(route.taskId);
    MESSAGES_BY_TASK.delete(route.taskId);
    ARTIFACTS_BY_TASK.delete(route.taskId);
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'taskSources' && method === 'POST') {
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const sourceIds = readStringArray(body.source_ids);
    task.attached_source_ids = Array.from(new Set([...task.attached_source_ids, ...sourceIds]));
    task.updated_at = nowIso();
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskSourceItem' && method === 'DELETE') {
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    task.attached_source_ids = task.attached_source_ids.filter((item) => item !== route.sourceId);
    task.updated_at = nowIso();
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskMessages' && method === 'GET') {
    json(res, 200, getTaskMessages(route.taskId));
    return true;
  }

  if (route.kind === 'taskMessages' && method === 'POST') {
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const content = typeof body.content === 'string' ? body.content : '';
    const role = body.role === 'agent' ? 'agent' : 'user';
    if (role === 'user' && ACTIVE_RUNS_BY_TASK.has(route.taskId)) {
      json(res, 409, { error_code: 'TASK_STREAM_CONFLICT', message: 'task_stream_conflict' });
      return true;
    }
    const message: TaskMessageRecord = {
      id: buildId('msg', nextMessageId++),
      task_id: route.taskId,
      role,
      content,
      created_at: nowIso(),
    };
    getTaskMessages(route.taskId).push(message);
    updateTaskActivity(task);

    if (role === 'user') {
      const assistantMessage: TaskMessageRecord = {
        id: buildId('msg', nextMessageId++),
        task_id: route.taskId,
        role: 'agent',
        content: '',
        created_at: nowIso(),
      };
      getTaskMessages(route.taskId).push(assistantMessage);
      updateTaskActivity(task);
      ACTIVE_RUNS_BY_TASK.add(route.taskId);

      void runTaskWithExternalAgent({
        deps,
        task,
        assistantMessage,
        agentId: task.agent_id,
        user,
        rawBearerToken,
        publicBaseUrl: resolvePublicBaseUrl(req),
      });

      emitTaskEvent(route.taskId, { type: 'message', data: message });
      emitTaskEvent(route.taskId, { type: 'message', data: assistantMessage });
      emitTaskEvent(route.taskId, { type: 'task_update', data: task });
      json(res, 200, assistantMessage);
      return true;
    }

    emitTaskEvent(route.taskId, { type: 'message', data: message });
    emitTaskEvent(route.taskId, { type: 'task_update', data: task });
    json(res, 200, message);
    return true;
  }

  if (route.kind === 'taskArtifacts' && method === 'GET') {
    json(res, 200, getTaskArtifacts(route.taskId));
    return true;
  }

  if (route.kind === 'taskArtifactSave' && method === 'POST') {
    const artifact = getTaskArtifacts(route.taskId).find((item) => item.id === route.artifactId);
    if (!artifact) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'artifact_not_found' });
      return true;
    }
    json(res, 200, {
      id: `file_${artifact.id}`,
      project_id: route.projectId,
      file_name: artifact.title ?? `${artifact.id}.txt`,
      file_type: artifact.mime_type ?? 'text/plain',
      file_size: artifact.file_size ?? 0,
      status: 'ready',
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    return true;
  }

  if (route.kind === 'taskArtifactDownload' && method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('artifact download is not available in local in-memory backend');
    return true;
  }

  if (route.kind === 'taskEvents' && method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    let clients = TASK_EVENT_CLIENTS.get(route.taskId);
    if (!clients) {
      clients = new Set<http.ServerResponse>();
      TASK_EVENT_CLIENTS.set(route.taskId, clients);
    }
    clients.add(res);
    writeDefaultSSE(res, { type: 'task_update', data: findTask(route.workspaceId, route.projectId, route.taskId) });
    const timer = setInterval(() => {
      res.write('event: ping\n');
      res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    }, 15_000);
    req.on('close', () => {
      clearInterval(timer);
      const subscribedClients = TASK_EVENT_CLIENTS.get(route.taskId);
      subscribedClients?.delete(res);
      if (subscribedClients && subscribedClients.size === 0) {
        TASK_EVENT_CLIENTS.delete(route.taskId);
      }
    });
    return true;
  }

  return false;
}
