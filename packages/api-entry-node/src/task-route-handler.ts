import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  appendNotebookTaskPrometheusMetrics,
  getNotebookTaskMetricsState,
  getNotebookTraceQueryLatencyByScopeSnapshot,
  observeNotebookTraceQueryLatency,
  type TraceQueryScope,
} from './notebook-task-metrics.js';
import {
  countInMemoryTraceRecords,
  deleteTaskTraceEvents,
  getNotebookTraceStoreLimits,
  listTaskTraceEventsFiltered,
  loadTaskTraceEvents,
  removeTaskTraceEventsFromMemory,
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
import { resolveNotebookTaskInputDetails, type NotebookTaskInputRefRecord as SharedNotebookTaskInputRefRecord } from './notebook-input-refs.js';
import { runNotebookTaskWithExecutionAgent } from './notebook-execution-orchestrator.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import type { ProjectsRoute } from './projects-route-match.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

interface TaskRecord {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  agent_id: string;
  agent_name: string;
  status: 'active' | 'archived';
  attached_inputs: TaskInputRefRecord[];
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

interface TaskListItem extends TaskRecord {
  agent_presence?: 'online' | 'offline' | 'managed' | 'unknown';
  run_state?: 'running' | 'idle';
  stats?: {
    user_turn_count: number;
    message_count: number;
    artifact_count: number;
    attached_input_count: number;
  };
}

type TaskInputRefRecord =
  | {
      id: string;
      kind: 'source';
      source_id: string;
    }
  | {
      id: string;
      kind: 'library_object';
      library_id: string;
      key: string;
      name?: string;
      content_type?: string;
      size_bytes?: number;
    }
  | {
      id: string;
      kind: 'artifact';
      task_id: string;
      artifact_id: string;
      task_relative_path?: string;
      name?: string;
      content_type?: string;
      size_bytes?: number;
    }
  | {
      id: string;
      kind: 'url';
      url: string;
      name?: string;
      imported_library_id?: string;
      imported_key?: string;
      content_type?: string;
      size_bytes?: number;
    };

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
  task_relative_path?: string;
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
const ACTIVE_RUN_CANCEL_BY_TASK = new Map<string, { runId: string; requestId: string; cancel: () => void }>();
const ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK = new Map<string, { runId: string; requestedAt: string }>();
const NOTEBOOK_TRACE_STORE_LIMITS = getNotebookTraceStoreLimits();
const TASKS_COLLECTION = 'notebook_tasks';
const TASK_MESSAGES_COLLECTION = 'notebook_task_messages';
const TASK_ARTIFACTS_COLLECTION = 'notebook_task_artifacts';

function notebookTasksCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(TASKS_COLLECTION, workspaceId);
}

function notebookTaskMessagesCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(TASK_MESSAGES_COLLECTION, workspaceId);
}

function notebookTaskArtifactsCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(TASK_ARTIFACTS_COLLECTION, workspaceId);
}

function debugNotebookExecution(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_EXECUTION !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-execution] ${message}${suffix}\n`);
}

export function getNotebookTaskMetricsSnapshot(): Record<string, unknown> {
  const metrics = getNotebookTaskMetricsState();
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

export function getNotebookTaskMetricsPrometheusText(): string {
  const snapshot = getNotebookTaskMetricsSnapshot() as {
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
  appendNotebookTaskPrometheusMetrics(lines, snapshot);
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

function readTaskInputRefs(raw: unknown): TaskInputRefRecord[] {
  if (!Array.isArray(raw)) return [];
  const results: TaskInputRefRecord[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const obj = asObject(item);
    const kind = typeof obj.kind === 'string' ? obj.kind.trim() : '';
    if (kind === 'source') {
      const sourceId = typeof obj.source_id === 'string' ? obj.source_id.trim() : '';
      if (!sourceId) continue;
      const dedupeKey = `source:${sourceId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({ id: buildId('in'), kind: 'source', source_id: sourceId });
      continue;
    }
    if (kind === 'library_object') {
      const libraryId = typeof obj.library_id === 'string' ? obj.library_id.trim() : '';
      const key = typeof obj.key === 'string' ? obj.key.trim() : '';
      if (!libraryId || !key) continue;
      const dedupeKey = `library_object:${libraryId}:${key}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({
        id: buildId('in'),
        kind: 'library_object',
        library_id: libraryId,
        key,
        ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
        ...(typeof obj.content_type === 'string' && obj.content_type.trim() ? { content_type: obj.content_type.trim() } : {}),
        ...(typeof obj.size_bytes === 'number' && Number.isFinite(obj.size_bytes) && obj.size_bytes >= 0
          ? { size_bytes: Math.floor(obj.size_bytes) }
          : {}),
      });
      continue;
    }
    if (kind === 'artifact') {
      const taskId = typeof obj.task_id === 'string' ? obj.task_id.trim() : '';
      const artifactId = typeof obj.artifact_id === 'string' ? obj.artifact_id.trim() : '';
      if (!taskId || !artifactId) continue;
      const dedupeKey = `artifact:${taskId}:${artifactId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({
        id: buildId('in'),
        kind: 'artifact',
        task_id: taskId,
        artifact_id: artifactId,
        ...(typeof obj.task_relative_path === 'string' && obj.task_relative_path.trim()
          ? { task_relative_path: obj.task_relative_path.trim() }
          : {}),
        ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
        ...(typeof obj.content_type === 'string' && obj.content_type.trim() ? { content_type: obj.content_type.trim() } : {}),
        ...(typeof obj.size_bytes === 'number' && Number.isFinite(obj.size_bytes) && obj.size_bytes >= 0
          ? { size_bytes: Math.floor(obj.size_bytes) }
          : {}),
      });
      continue;
    }
    if (kind === 'url') {
      const url = typeof obj.url === 'string' ? obj.url.trim() : '';
      if (!/^https?:\/\//i.test(url)) continue;
      const dedupeKey = `url:${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      results.push({
        id: buildId('in'),
        kind: 'url',
        url,
        ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim() } : {}),
        ...(typeof obj.imported_library_id === 'string' && obj.imported_library_id.trim()
          ? { imported_library_id: obj.imported_library_id.trim() }
          : {}),
        ...(typeof obj.imported_key === 'string' && obj.imported_key.trim()
          ? { imported_key: obj.imported_key.trim() }
          : {}),
        ...(typeof obj.content_type === 'string' && obj.content_type.trim() ? { content_type: obj.content_type.trim() } : {}),
        ...(typeof obj.size_bytes === 'number' && Number.isFinite(obj.size_bytes) && obj.size_bytes >= 0
          ? { size_bytes: Math.floor(obj.size_bytes) }
          : {}),
      });
    }
  }
  return results;
}

function normalizeTaskRecord(input: TaskRecord): TaskRecord {
  const raw = asObject(input);
  const attachedInputs = readTaskInputRefs(raw.attached_inputs);
  return {
    ...input,
    attached_inputs: attachedInputs,
  };
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
  const listed = await deps.docStore.list<TaskRecord>(notebookTasksCollection(workspaceId), {
    workspace_id: workspaceId,
    project_id: projectId,
  });
  const sorted = listed.map((item) => normalizeTaskRecord(item)).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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
  const task = findTaskById(taskId);
  if (!task) return [];
  const listed = await deps.docStore.list<TaskMessageRecord>(notebookTaskMessagesCollection(task.workspace_id), { task_id: taskId });
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

async function maybeReleaseInternalAgentWorkload(
  deps: NodeApiDeps,
  workspaceId: string,
  projectId: string,
  task: TaskRecord,
): Promise<void> {
  if (!deps.internalAgentPodManager) return;
  const agent = await deps.agentResourceService.getAgent(workspaceId, projectId, task.agent_id);
  if (!agent || agent.mode !== 'internal') return;
  await deps.internalAgentPodManager.releasePod(
    workspaceId,
    projectId,
    sanitizeWorkloadId(task.id),
  ).catch((err: unknown) => {
    console.warn('[sandbox] releasePod failed for task %s: %s', task.id, err instanceof Error ? err.message : err);
  });
}

async function createTaskArtifactRecord(
  deps: NodeApiDeps,
  args: {
    taskId: string;
    payload: {
      artifact_type: 'text' | 'image' | 'file' | 'other';
      task_relative_path: string;
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
  const task = findTaskById(taskId);
  if (!task) {
    throw new Error('task_not_found');
  }
  const normalizedTitle = payload.title?.trim() || payload.filename?.trim() || undefined;
  const normalizedPath = payload.task_relative_path.trim();
  const items = getTaskArtifacts(taskId);
  const existing = items.find((item) => {
    if (item.type !== payload.artifact_type) return false;
    const samePath = typeof item.task_relative_path === 'string'
      ? item.task_relative_path === normalizedPath
      : (item.title?.trim() || '') === (normalizedTitle ?? '');
    if (!samePath) return false;
    if ((item.file_size ?? null) !== (typeof payload.file_size === 'number' ? payload.file_size : null)) return false;
    if ((item.mime_type ?? null) !== (typeof payload.mime_type === 'string' ? payload.mime_type : null)) return false;
    if ((item.content ?? null) !== (typeof payload.content === 'string' ? payload.content : null)) return false;
    if ((item.thumbnail_url ?? null) !== (typeof payload.thumbnail_url === 'string' ? payload.thumbnail_url : null)) return false;
    return true;
  });
  if (existing) return existing;

  const artifact: TaskArtifactRecord = {
    id: buildId('artifact'),
    task_id: taskId,
    type: payload.artifact_type,
    ...(normalizedPath ? { task_relative_path: normalizedPath } : {}),
    ...(normalizedTitle ? { title: normalizedTitle } : {}),
    ...(typeof payload.content === 'string' ? { content: payload.content } : {}),
    ...(typeof payload.thumbnail_url === 'string' ? { thumbnail_url: payload.thumbnail_url } : {}),
    ...(typeof payload.file_size === 'number' ? { file_size: payload.file_size } : {}),
    ...(typeof payload.mime_type === 'string' ? { mime_type: payload.mime_type } : {}),
    created_at: nowIso(),
  };
  items.push(artifact);
  await deps.docStore.upsert<TaskArtifactRecord>(notebookTaskArtifactsCollection(task.workspace_id), artifact.id, artifact);
  return artifact;
}

async function loadTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<TaskArtifactRecord[]> {
  const cached = ARTIFACTS_BY_TASK.get(taskId);
  if (cached) return cached;
  const task = findTaskById(taskId);
  if (!task) return [];
  const listed = await deps.docStore.list<TaskArtifactRecord>(notebookTaskArtifactsCollection(task.workspace_id), { task_id: taskId });
  const sorted = listed.sort((a, b) => a.created_at.localeCompare(b.created_at));
  ARTIFACTS_BY_TASK.set(taskId, sorted);
  return sorted;
}

async function buildTaskRealtimeView(
  deps: NodeApiDeps,
  workspaceId: string,
  projectId: string,
  task: TaskRecord,
): Promise<TaskListItem> {
  await Promise.all([
    loadTaskMessages(deps, task.id),
    loadTaskArtifacts(deps, task.id),
  ]);
  const messages = getTaskMessages(task.id);
  const artifacts = getTaskArtifacts(task.id);
  const userTurnCount = messages.filter((item) => item.role === 'user').length;
  const agent = await deps.agentResourceService.getAgent(workspaceId, projectId, task.agent_id);
  const agentPresence: TaskListItem['agent_presence'] = (
    !agent ? 'unknown'
    : agent.mode === 'internal' ? 'managed'
    : (agent.presence === 'online' ? 'online' : 'offline')
  );
  return {
    ...task,
    agent_presence: agentPresence,
    run_state: ACTIVE_RUNS_BY_TASK.has(task.id) ? 'running' : 'idle',
    stats: {
      user_turn_count: userTurnCount,
      message_count: messages.length,
      artifact_count: artifacts.length,
      attached_input_count: task.attached_inputs.length,
    },
  };
}

function findTask(workspaceId: string, projectId: string, taskId: string): TaskRecord | undefined {
  return getTasks(workspaceId, projectId).find((item) => item.id === taskId);
}

function findTaskById(taskId: string): TaskRecord | undefined {
  for (const tasks of TASKS_BY_PROJECT.values()) {
    const found = tasks.find((item) => item.id === taskId);
    if (found) return found;
  }
  return undefined;
}

function sanitizePathPart(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'unknown';
}

async function deleteTaskMessages(deps: NodeApiDeps, taskId: string): Promise<void> {
  const task = findTaskById(taskId);
  if (!task) return;
  const collection = notebookTaskMessagesCollection(task.workspace_id);
  const existing = await deps.docStore.list<TaskMessageRecord>(collection, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(collection, item.id)));
}

async function deleteTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<void> {
  const task = findTaskById(taskId);
  if (!task) return;
  const collection = notebookTaskArtifactsCollection(task.workspace_id);
  const existing = await deps.docStore.list<TaskArtifactRecord>(collection, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(collection, item.id)));
}

function mapTaskMessagesForExecution(taskId: string, assistantMessageId: string): Array<Record<string, unknown>> {
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
    const enrichedItems: TaskListItem[] = await Promise.all(
      items.map((task) => buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task)),
    );
    json(res, 200, {
      items: enrichedItems,
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
      attached_inputs: readTaskInputRefs(body.initial_inputs),
      created_at: createdAt,
      updated_at: createdAt,
      last_activity_at: createdAt,
    };
    getTasks(route.workspaceId, route.projectId).unshift(task);
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'notebook.task.created',
      resourceType: 'notebook_task',
      resourceId: task.id,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
      metadata: { agent_id: task.agent_id, initial_input_count: task.attached_inputs.length },
    });
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
    json(res, 200, await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task));
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
    const previousStatus = task.status;
    if (typeof body.title === 'string' && body.title.trim()) {
      task.title = body.title.trim();
    }
    if (body.status === 'active' || body.status === 'archived') {
      task.status = body.status;
    }
    task.updated_at = nowIso();
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
    if (
      previousStatus === 'active'
      && task.status === 'archived'
    ) {
      await maybeReleaseInternalAgentWorkload(deps, route.workspaceId, route.projectId, task);
    }
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
    const [removedTask] = tasks.splice(index, 1);
    ACTIVE_RUNS_BY_TASK.delete(route.taskId);
    ACTIVE_RUN_CANCEL_BY_TASK.delete(route.taskId);
    ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(route.taskId);
    clearNotebookTaskEventState(route.taskId);
    MESSAGES_BY_TASK.delete(route.taskId);
    ARTIFACTS_BY_TASK.delete(route.taskId);
    removeTaskTraceEventsFromMemory(route.taskId);
    await deps.docStore.delete(notebookTasksCollection(route.workspaceId), route.taskId);
    await deleteTaskMessages(deps, route.taskId);
    await deleteTaskArtifacts(deps, route.taskId);
    await deleteTaskTraceEvents(deps, route.workspaceId, route.taskId);
    if (removedTask) {
      await maybeReleaseInternalAgentWorkload(deps, route.workspaceId, route.projectId, removedTask);
    }
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'taskInputs' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const inputs = readTaskInputRefs(body.inputs);
    for (const inputRef of inputs) {
      if (inputRef.kind !== 'artifact') continue;
      const sourceTask = findTask(route.workspaceId, route.projectId, inputRef.task_id);
      if (!sourceTask) {
        json(res, 422, {
          error_code: 'VALIDATION_ERROR',
          message: 'artifact_input_task_not_found',
          field: 'inputs',
        });
        return true;
      }
      await loadTaskArtifacts(deps, inputRef.task_id);
      const sourceArtifacts = ARTIFACTS_BY_TASK.get(inputRef.task_id) ?? [];
      if (!sourceArtifacts.some((item) => item.id === inputRef.artifact_id)) {
        json(res, 422, {
          error_code: 'VALIDATION_ERROR',
          message: 'artifact_input_not_found',
          field: 'inputs',
        });
        return true;
      }
    }
    const existingKeys = new Set(
      task.attached_inputs.map((item) =>
        item.kind === 'source'
          ? `source:${item.source_id}`
          : item.kind === 'library_object'
            ? `library_object:${item.library_id}:${item.key}`
            : item.kind === 'artifact'
              ? `artifact:${item.task_id}:${item.artifact_id}`
            : `url:${item.url}`,
      ),
    );
    for (const inputRef of inputs) {
      const key = inputRef.kind === 'source'
        ? `source:${inputRef.source_id}`
        : inputRef.kind === 'library_object'
          ? `library_object:${inputRef.library_id}:${inputRef.key}`
          : inputRef.kind === 'artifact'
            ? `artifact:${inputRef.task_id}:${inputRef.artifact_id}`
          : `url:${inputRef.url}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      task.attached_inputs.push(inputRef);
    }
    task.updated_at = nowIso();
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskInputs' && method === 'GET') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const items = await resolveNotebookTaskInputDetails({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      inputs: task.attached_inputs as SharedNotebookTaskInputRefRecord[],
      loadArtifactsForTask: async (taskId) => {
        await loadTaskArtifacts(deps, taskId);
        return (ARTIFACTS_BY_TASK.get(taskId) ?? []).map((item) => ({
          id: item.id,
          title: item.title,
          mime_type: item.mime_type,
          file_size: item.file_size,
          task_relative_path: item.task_relative_path,
        }));
      },
    });
    json(res, 200, items);
    return true;
  }

  if (route.kind === 'taskInputItem' && method === 'DELETE') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const beforeCount = task.attached_inputs.length;
    task.attached_inputs = task.attached_inputs.filter((item) => item.id !== route.inputId);
    task.updated_at = nowIso();
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
    if (task.attached_inputs.length !== beforeCount) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'notebook.task.input_removed',
        resourceType: 'notebook_task',
        resourceId: task.id,
        requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
        metadata: { input_id: route.inputId },
      });
    }
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
    if (process.env.DEBUG_NOTEBOOK_EXECUTION === '1') {
      debugNotebookExecution('task_traces_query', {
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
    await deps.docStore.upsert<TaskMessageRecord>(notebookTaskMessagesCollection(route.workspaceId), message.id, message);
    updateTaskActivity(task);
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);

    if (role === 'user') {
      const assistantMessage: TaskMessageRecord = {
        id: buildId('msg'),
        task_id: route.taskId,
        role: 'agent',
        content: '',
        created_at: nowIso(),
      };
      getTaskMessages(route.taskId).push(assistantMessage);
      await deps.docStore.upsert<TaskMessageRecord>(notebookTaskMessagesCollection(route.workspaceId), assistantMessage.id, assistantMessage);
      updateTaskActivity(task);
      await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
      ACTIVE_RUNS_BY_TASK.add(route.taskId);

      void runNotebookTaskWithExecutionAgent({
        deps,
        task,
        assistantMessage,
        agentId: task.agent_id,
        user,
        rawBearerToken,
        publicBaseUrl: resolvePublicBaseUrl(req),
        buildRunId: () => buildId('run'),
        buildProxyUsername: (u) => sanitizePathPart(u.email || u.name || u.id),
        mapTaskMessagesForExecution,
        updateTaskActivity,
        emitTaskEvent: (taskId, payload) => {
          if (payload.type !== 'task_update') {
            emitNotebookTaskEvent(taskId, payload);
            return;
          }
          const current = findTask(route.workspaceId, route.projectId, taskId);
          if (!current) {
            emitNotebookTaskEvent(taskId, payload);
            return;
          }
          void buildTaskRealtimeView(deps, route.workspaceId, route.projectId, current)
            .then((enriched) => {
              emitNotebookTaskEvent(taskId, { type: 'task_update', data: enriched });
            })
            .catch(() => {
              emitNotebookTaskEvent(taskId, payload);
            });
        },
        onDispatched: ({ taskId, runId, requestId, cancel }) => {
          ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(taskId);
          ACTIVE_RUN_CANCEL_BY_TASK.set(taskId, {
            runId,
            requestId,
            cancel: () => {
              ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(taskId, { runId, requestedAt: nowIso() });
              cancel();
            },
          });
        },
        onFinalize: (taskId) => {
          ACTIVE_RUNS_BY_TASK.delete(taskId);
          ACTIVE_RUN_CANCEL_BY_TASK.delete(taskId);
          ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(taskId);
        },
        isCancellationRequested: () => {
          const marker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(route.taskId);
          return !!marker;
        },
        debugLog: debugNotebookExecution,
        taskCollections: {
          tasks: notebookTasksCollection(route.workspaceId),
          messages: notebookTaskMessagesCollection(route.workspaceId),
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
      emitNotebookTaskEvent(route.taskId, {
        type: 'task_update',
        data: await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task),
      });
      json(res, 200, assistantMessage);
      return true;
    }

    emitNotebookTaskEvent(route.taskId, { type: 'message', data: message });
    emitNotebookTaskEvent(route.taskId, {
      type: 'task_update',
      data: await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task),
    });
    json(res, 200, message);
    return true;
  }

  if (route.kind === 'taskCancelRun' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const active = ACTIVE_RUN_CANCEL_BY_TASK.get(route.taskId);
    if (!active) {
      json(res, 409, { error_code: 'TASK_RUN_NOT_ACTIVE', message: 'task_run_not_active' });
      return true;
    }
    active.cancel();
    debugNotebookExecution('task_run_cancel_requested', {
      task_id: route.taskId,
      run_id: active.runId,
      request_id: active.requestId,
      actor_user_id: user.id,
    });
    void writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'notebook.task.run.cancel.requested',
      resourceType: 'notebook_task',
      resourceId: route.taskId,
      metadata: {
        run_id: active.runId,
        request_id: active.requestId,
      },
    });
    json(res, 202, {
      status: 'cancelling',
      task_id: route.taskId,
      run_id: active.runId,
      request_id: active.requestId,
    });
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
    await loadTaskArtifacts(deps, route.taskId);
    const artifact = getTaskArtifacts(route.taskId).find((item) => item.id === route.artifactId);
    if (!artifact) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'artifact_not_found' });
      return true;
    }

    const filename = (artifact.title?.trim() || `${artifact.id}`);
    const contentType = artifact.mime_type?.trim() || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);

    if (typeof artifact.content === 'string' && artifact.content.startsWith('data:')) {
      const match = artifact.content.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
      if (match) {
        const dataMime = match[1]?.trim() || contentType;
        const payload = match[2] ?? '';
        const isBase64 = /;base64,/.test(artifact.content.slice(0, artifact.content.indexOf(',') + 1));
        const body = isBase64
          ? Buffer.from(payload, 'base64')
          : Buffer.from(decodeURIComponent(payload), 'utf8');
        res.setHeader('Content-Type', dataMime);
        res.end(body);
        return true;
      }
    }

    if (typeof artifact.content === 'string') {
      res.setHeader('Content-Type', contentType.includes('charset=') ? contentType : `${contentType}; charset=utf-8`);
      res.end(artifact.content);
      return true;
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('artifact binary download is unavailable: no inline content stored');
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
      const currentTask = findTask(route.workspaceId, route.projectId, route.taskId);
      if (currentTask) {
        writeNotebookTaskSseEvent(res, {
          type: 'task_update',
          data: await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, currentTask),
        });
      }
      for (const traceEvent of await loadTaskTraceEvents(deps, route.workspaceId, route.taskId)) {
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
