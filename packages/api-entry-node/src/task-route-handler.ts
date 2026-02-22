import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  appendNotebookRuntimePrometheusMetrics,
  getNotebookRuntimeMetricsState,
  getNotebookTraceQueryLatencyByScopeSnapshot,
  observeNotebookTraceQueryLatency,
  type TraceQueryScope,
} from './notebook-runtime-metrics.js';
import {
  countInMemoryTraceRecords,
  deleteTaskTraceEvents,
  getNotebookTraceStoreLimits,
  listTaskTraceEventsFiltered,
  loadTaskTraceEvents,
  removeTaskTraceEventsFromMemory,
  type TaskTraceEventRecord,
} from './notebook-trace-store.js';
import {
  clearNotebookTaskEventState,
  emitNotebookTaskEvent,
  getNotebookTaskSseBrokerStats,
  replayBufferedNotebookTaskEvents,
  subscribeNotebookTaskEvents,
  unsubscribeNotebookTaskEvents,
  writeNotebookTaskSseEvent,
} from './notebook-task-sse-broker.js';
import { runNotebookTaskWithExternalAgent } from './notebook-runtime-orchestrator.js';
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
const ACTIVE_RUNS_BY_TASK = new Set<string>();
const NOTEBOOK_TRACE_STORE_LIMITS = getNotebookTraceStoreLimits();
const TASKS_COLLECTION = 'notebook_tasks';
const TASK_MESSAGES_COLLECTION = 'notebook_task_messages';
const TASK_ARTIFACTS_COLLECTION = 'notebook_task_artifacts';

function debugNotebookRuntime(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_RUNTIME !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-runtime] ${message}${suffix}\n`);
}

export function getNotebookRuntimeMetricsSnapshot(): Record<string, unknown> {
  const metrics = getNotebookRuntimeMetricsState();
  const taskCount = [...TASKS_BY_PROJECT.values()].reduce((acc, items) => acc + items.length, 0);
  const messageCount = [...MESSAGES_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
  const artifactCount = [...ARTIFACTS_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
  const traceCount = countInMemoryTraceRecords();
  const sseBrokerStats = getNotebookTaskSseBrokerStats();
  return {
    ...metrics,
    active_runs: ACTIVE_RUNS_BY_TASK.size,
    task_sse_clients: sseBrokerStats.client_count,
    in_memory: {
      tasks: taskCount,
      messages: messageCount,
      artifacts: artifactCount,
      traces: traceCount,
      task_event_history_tasks: sseBrokerStats.history_task_count,
    },
    limits: {
      max_trace_events_per_task: NOTEBOOK_TRACE_STORE_LIMITS.maxTraceEventsPerTask,
      max_trace_details_bytes: NOTEBOOK_TRACE_STORE_LIMITS.maxTraceDetailsBytes,
      max_task_sse_events_per_task: sseBrokerStats.max_events_per_task,
    },
    trace_query_latency_by_scope: getNotebookTraceQueryLatencyByScopeSnapshot(),
  };
}

export function getNotebookRuntimeMetricsPrometheusText(): string {
  const snapshot = getNotebookRuntimeMetricsSnapshot() as {
    task_runs_started: number;
    task_runs_completed: number;
    task_runs_failed: number;
    task_runs_terminal_without_done: number;
    trace_events_recorded: number;
    trace_events_truncated_records: number;
    trace_details_truncated: number;
    task_traces_queries_total: number;
    task_traces_queries_message_scoped_total: number;
    task_traces_queries_run_scoped_total: number;
    active_runs: number;
    task_sse_clients: number;
    in_memory: {
      tasks: number;
      messages: number;
      artifacts: number;
      traces: number;
      task_event_history_tasks: number;
    };
    limits: {
      max_trace_events_per_task: number;
      max_trace_details_bytes: number;
      max_task_sse_events_per_task: number;
    };
  };

  const lines: string[] = [];
  appendNotebookRuntimePrometheusMetrics(lines, snapshot);
  return `${lines.join('\n')}\n`;
}

function projectKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
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

async function loadProjectTasks(deps: NodeApiDeps, workspaceId: string, projectId: string): Promise<TaskRecord[]> {
  const key = projectKey(workspaceId, projectId);
  const cached = TASKS_BY_PROJECT.get(key);
  if (cached) return cached;
  const listed = await deps.docStore.list<TaskRecord>(TASKS_COLLECTION, {
    workspace_id: workspaceId,
    project_id: projectId,
  });
  const sorted = listed.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  TASKS_BY_PROJECT.set(key, sorted);
  return sorted;
}

function getTaskMessages(taskId: string): TaskMessageRecord[] {
  let existing = MESSAGES_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    MESSAGES_BY_TASK.set(taskId, existing);
  }
  return existing;
}

async function loadTaskMessages(deps: NodeApiDeps, taskId: string): Promise<TaskMessageRecord[]> {
  const cached = MESSAGES_BY_TASK.get(taskId);
  if (cached) return cached;
  const listed = await deps.docStore.list<TaskMessageRecord>(TASK_MESSAGES_COLLECTION, { task_id: taskId });
  const sorted = listed.sort((a, b) => a.created_at.localeCompare(b.created_at));
  MESSAGES_BY_TASK.set(taskId, sorted);
  return sorted;
}

function getTaskArtifacts(taskId: string): TaskArtifactRecord[] {
  let existing = ARTIFACTS_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    ARTIFACTS_BY_TASK.set(taskId, existing);
  }
  return existing;
}

async function createTaskArtifactRecord(
  deps: NodeApiDeps,
  args: {
    taskId: string;
    payload: {
      artifact_type: 'text' | 'image' | 'file' | 'other';
      title?: string;
      content?: string;
      thumbnail_url?: string;
      file_size?: number;
      mime_type?: string;
      filename?: string;
    };
  },
): Promise<TaskArtifactRecord> {
  const { taskId, payload } = args;
  const artifact: TaskArtifactRecord = {
    id: buildId('artifact'),
    task_id: taskId,
    type: payload.artifact_type,
    ...(payload.title?.trim() ? { title: payload.title.trim() } : payload.filename?.trim() ? { title: payload.filename.trim() } : {}),
    ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
    ...(typeof payload.thumbnail_url === 'string' ? { thumbnail_url: payload.thumbnail_url } : {}),
    ...(typeof payload.file_size === 'number' ? { file_size: payload.file_size } : {}),
    ...(typeof payload.mime_type === 'string' ? { mime_type: payload.mime_type } : {}),
    created_at: nowIso(),
  };
  const items = getTaskArtifacts(taskId);
  items.push(artifact);
  await deps.docStore.upsert<TaskArtifactRecord>(TASK_ARTIFACTS_COLLECTION, artifact.id, artifact);
  return artifact;
}

async function loadTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<TaskArtifactRecord[]> {
  const cached = ARTIFACTS_BY_TASK.get(taskId);
  if (cached) return cached;
  const listed = await deps.docStore.list<TaskArtifactRecord>(TASK_ARTIFACTS_COLLECTION, { task_id: taskId });
  const sorted = listed.sort((a, b) => a.created_at.localeCompare(b.created_at));
  ARTIFACTS_BY_TASK.set(taskId, sorted);
  return sorted;
}

function findTask(workspaceId: string, projectId: string, taskId: string): TaskRecord | undefined {
  return getTasks(workspaceId, projectId).find((item) => item.id === taskId);
}

function sanitizePathPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'unknown';
}

async function deleteTaskMessages(deps: NodeApiDeps, taskId: string): Promise<void> {
  const existing = await deps.docStore.list<TaskMessageRecord>(TASK_MESSAGES_COLLECTION, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(TASK_MESSAGES_COLLECTION, item.id)));
}

async function deleteTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<void> {
  const existing = await deps.docStore.list<TaskArtifactRecord>(TASK_ARTIFACTS_COLLECTION, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(TASK_ARTIFACTS_COLLECTION, item.id)));
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
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
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
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
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
      id: buildId('task'),
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
    await deps.docStore.upsert<TaskRecord>(TASKS_COLLECTION, task.id, task);
    json(res, 201, task);
    return true;
  }

  if (route.kind === 'taskItem' && method === 'GET') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskItem' && method === 'PATCH') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
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
    await deps.docStore.upsert<TaskRecord>(TASKS_COLLECTION, task.id, task);
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskItem' && method === 'DELETE') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const tasks = getTasks(route.workspaceId, route.projectId);
    const index = tasks.findIndex((item) => item.id === route.taskId);
    if (index < 0) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    tasks.splice(index, 1);
    ACTIVE_RUNS_BY_TASK.delete(route.taskId);
    clearNotebookTaskEventState(route.taskId);
    MESSAGES_BY_TASK.delete(route.taskId);
    ARTIFACTS_BY_TASK.delete(route.taskId);
    removeTaskTraceEventsFromMemory(route.taskId);
    await deps.docStore.delete(TASKS_COLLECTION, route.taskId);
    await deleteTaskMessages(deps, route.taskId);
    await deleteTaskArtifacts(deps, route.taskId);
    await deleteTaskTraceEvents(deps, route.taskId);
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'taskSources' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const sourceIds = readStringArray(body.source_ids);
    task.attached_source_ids = Array.from(new Set([...task.attached_source_ids, ...sourceIds]));
    task.updated_at = nowIso();
    await deps.docStore.upsert<TaskRecord>(TASKS_COLLECTION, task.id, task);
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskSources' && method === 'GET') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const items = await Promise.all(task.attached_source_ids.map(async (sourceId) => {
      try {
        return await deps.getSourceUseCase.execute({
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          sourceId,
        });
      } catch {
        return null;
      }
    }));
    json(res, 200, items.filter((item): item is NonNullable<typeof item> => item !== null));
    return true;
  }

  if (route.kind === 'taskSourceItem' && method === 'DELETE') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    task.attached_source_ids = task.attached_source_ids.filter((item) => item !== route.sourceId);
    task.updated_at = nowIso();
    await deps.docStore.upsert<TaskRecord>(TASKS_COLLECTION, task.id, task);
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskMessages' && method === 'GET') {
    await loadTaskMessages(deps, route.taskId);
    json(res, 200, getTaskMessages(route.taskId));
    return true;
  }

  if (route.kind === 'taskTraces' && method === 'GET') {
    const traceQueryStart = Date.now();
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const requestUrl = new URL(req.url ?? '', 'http://localhost');
    const messageId = requestUrl.searchParams.get('message_id')?.trim();
    const runId = requestUrl.searchParams.get('run_id')?.trim();
    const afterId = requestUrl.searchParams.get('after_id')?.trim();
    const beforeId = requestUrl.searchParams.get('before_id')?.trim();
    const pageSize = Math.max(1, Math.min(500, Number(requestUrl.searchParams.get('page_size') ?? '200') || 200));
    const queryScope: TraceQueryScope = messageId && runId
      ? 'message_run'
      : (messageId ? 'message' : (runId ? 'run' : 'task'));
    let traces = await listTaskTraceEventsFiltered(deps, {
      taskId: route.taskId,
      ...(messageId ? { messageId } : {}),
      ...(runId ? { runId } : {}),
    });
    if (afterId) {
      const idx = traces.findIndex((item) => item.id === afterId);
      if (idx >= 0) traces = traces.slice(idx + 1);
    }
    if (beforeId) {
      const idx = traces.findIndex((item) => item.id === beforeId);
      if (idx >= 0) traces = traces.slice(0, idx);
    }
    const total = traces.length;
    const hasMore = total > pageSize;
    const items = hasMore ? traces.slice(total - pageSize) : traces;
    const nextAfterId = hasMore && items.length > 0 ? items[0]!.id : null;
    const latencyMs = Date.now() - traceQueryStart;
    observeNotebookTraceQueryLatency(queryScope, latencyMs);
    if (process.env.DEBUG_NOTEBOOK_RUNTIME === '1') {
      debugNotebookRuntime('task_traces_query', {
        task_id: route.taskId,
        scope: queryScope,
        message_id: messageId ?? null,
        run_id: runId ?? null,
        after_id: afterId ?? null,
        before_id: beforeId ?? null,
        page_size: pageSize,
        total,
        returned: items.length,
        has_more: hasMore,
        latency_ms: latencyMs,
      });
    }
    json(res, 200, { items, total, has_more: hasMore, next_after_id: nextAfterId });
    return true;
  }

  if (route.kind === 'taskMessages' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    await loadTaskMessages(deps, route.taskId);
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
      id: buildId('msg'),
      task_id: route.taskId,
      role,
      content,
      created_at: nowIso(),
    };
    getTaskMessages(route.taskId).push(message);
    await deps.docStore.upsert<TaskMessageRecord>(TASK_MESSAGES_COLLECTION, message.id, message);
    updateTaskActivity(task);
    await deps.docStore.upsert<TaskRecord>(TASKS_COLLECTION, task.id, task);

    if (role === 'user') {
      const assistantMessage: TaskMessageRecord = {
        id: buildId('msg'),
        task_id: route.taskId,
        role: 'agent',
        content: '',
        created_at: nowIso(),
      };
      getTaskMessages(route.taskId).push(assistantMessage);
      await deps.docStore.upsert<TaskMessageRecord>(TASK_MESSAGES_COLLECTION, assistantMessage.id, assistantMessage);
      updateTaskActivity(task);
      await deps.docStore.upsert<TaskRecord>(TASKS_COLLECTION, task.id, task);
      ACTIVE_RUNS_BY_TASK.add(route.taskId);

      void runNotebookTaskWithExternalAgent({
        deps,
        task,
        assistantMessage,
        agentId: task.agent_id,
        user,
        rawBearerToken,
        publicBaseUrl: resolvePublicBaseUrl(req),
        buildRunId: () => buildId('run'),
        buildProxyUsername: (u) => sanitizePathPart(u.email || u.name || u.id),
        mapTaskMessagesForRuntime,
        updateTaskActivity,
        emitTaskEvent: emitNotebookTaskEvent,
        onFinalize: (taskId) => {
          ACTIVE_RUNS_BY_TASK.delete(taskId);
        },
        debugLog: debugNotebookRuntime,
        taskCollections: {
          tasks: TASKS_COLLECTION,
          messages: TASK_MESSAGES_COLLECTION,
        },
        createTaskArtifact: async ({ taskId, payload }) => createTaskArtifactRecord(deps, {
          taskId,
          payload: {
            ...payload,
            filename: payload.filename,
          },
        }),
      });

      emitNotebookTaskEvent(route.taskId, { type: 'message', data: message });
      emitNotebookTaskEvent(route.taskId, { type: 'message', data: assistantMessage });
      emitNotebookTaskEvent(route.taskId, { type: 'task_update', data: task });
      json(res, 200, assistantMessage);
      return true;
    }

    emitNotebookTaskEvent(route.taskId, { type: 'message', data: message });
    emitNotebookTaskEvent(route.taskId, { type: 'task_update', data: task });
    json(res, 200, message);
    return true;
  }

  if (route.kind === 'taskArtifacts' && method === 'GET') {
    await loadTaskArtifacts(deps, route.taskId);
    json(res, 200, getTaskArtifacts(route.taskId));
    return true;
  }

  if (route.kind === 'taskEvents' && method === 'GET') {
    // handled below (kept here only to make route ordering explicit)
  }

  if (route.kind === 'taskArtifactSave' && method === 'POST') {
    await loadTaskArtifacts(deps, route.taskId);
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
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const requestUrl = new URL(req.url ?? '', 'http://localhost');
    const lastEventId = requestUrl.searchParams.get('last_event_id')?.trim() || null;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    subscribeNotebookTaskEvents(route.taskId, res);
    if (lastEventId) {
      replayBufferedNotebookTaskEvents(res, route.taskId, lastEventId);
    } else {
      writeNotebookTaskSseEvent(res, { type: 'task_update', data: findTask(route.workspaceId, route.projectId, route.taskId) });
      for (const traceEvent of await loadTaskTraceEvents(deps, route.taskId)) {
        writeNotebookTaskSseEvent(res, { type: 'trace_event', data: traceEvent });
      }
    }
    const timer = setInterval(() => {
      res.write('event: ping\n');
      res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    }, 15_000);
    req.on('close', () => {
      clearInterval(timer);
      unsubscribeNotebookTaskEvents(route.taskId, res);
    });
    return true;
  }

  return false;
}
