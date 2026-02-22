import type http from 'node:http';
import type { AgentRuntimeTraceEventPayload } from './agent-runtime-service.js';
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

interface TaskTraceEventRecord {
  id: string;
  task_id: string;
  message_id: string;
  run_id: string;
  seq: number;
  at: string;
  category: AgentRuntimeTraceEventPayload['category'];
  phase?: AgentRuntimeTraceEventPayload['phase'];
  status?: AgentRuntimeTraceEventPayload['status'];
  name: string;
  summary: string;
  details?: Record<string, unknown>;
}

interface BufferedTaskSseEvent {
  id: string;
  payload: unknown;
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
const TRACE_EVENTS_BY_TASK = new Map<string, TaskTraceEventRecord[]>();
const TASK_EVENT_CLIENTS = new Map<string, Set<http.ServerResponse>>();
const TASK_EVENT_SEQUENCE_BY_TASK = new Map<string, number>();
const TASK_EVENT_HISTORY_BY_TASK = new Map<string, BufferedTaskSseEvent[]>();
const ACTIVE_RUNS_BY_TASK = new Set<string>();
const NOTEBOOK_RUNTIME_METRICS = {
  task_runs_started: 0,
  task_runs_completed: 0,
  task_runs_failed: 0,
  task_runs_terminal_without_done: 0,
  trace_events_recorded: 0,
  trace_events_truncated_records: 0,
  trace_details_truncated: 0,
};
let nextTaskId = 1;
let nextMessageId = 1;
let nextTraceEventId = 1;
const MAX_TRACE_EVENTS_PER_TASK = Math.max(100, Number(process.env.NOTEBOOK_TRACE_MAX_EVENTS ?? '1000') || 1000);
const MAX_TASK_SSE_EVENTS_PER_TASK = Math.max(100, Number(process.env.NOTEBOOK_SSE_HISTORY_MAX_EVENTS ?? '2000') || 2000);
const MAX_TRACE_DETAILS_BYTES = Math.max(512, Number(process.env.NOTEBOOK_TRACE_DETAILS_MAX_BYTES ?? '16384') || 16384);
const TASKS_COLLECTION = 'notebook_tasks';
const TASK_MESSAGES_COLLECTION = 'notebook_task_messages';
const TASK_ARTIFACTS_COLLECTION = 'notebook_task_artifacts';
const TASK_TRACE_EVENTS_COLLECTION = 'notebook_task_trace_events';

function debugNotebookRuntime(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_RUNTIME !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-runtime] ${message}${suffix}\n`);
}

export function getNotebookRuntimeMetricsSnapshot(): Record<string, unknown> {
  const taskCount = [...TASKS_BY_PROJECT.values()].reduce((acc, items) => acc + items.length, 0);
  const messageCount = [...MESSAGES_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
  const artifactCount = [...ARTIFACTS_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
  const traceCount = [...TRACE_EVENTS_BY_TASK.values()].reduce((acc, items) => acc + items.length, 0);
  const sseClients = [...TASK_EVENT_CLIENTS.values()].reduce((acc, set) => acc + set.size, 0);
  return {
    ...NOTEBOOK_RUNTIME_METRICS,
    active_runs: ACTIVE_RUNS_BY_TASK.size,
    task_sse_clients: sseClients,
    in_memory: {
      tasks: taskCount,
      messages: messageCount,
      artifacts: artifactCount,
      traces: traceCount,
      task_event_history_tasks: TASK_EVENT_HISTORY_BY_TASK.size,
    },
    limits: {
      max_trace_events_per_task: MAX_TRACE_EVENTS_PER_TASK,
      max_trace_details_bytes: MAX_TRACE_DETAILS_BYTES,
      max_task_sse_events_per_task: MAX_TASK_SSE_EVENTS_PER_TASK,
    },
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
  const appendGauge = (name: string, value: number, help: string): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
  };
  const appendCounter = (name: string, value: number, help: string): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
  };

  appendCounter('notebook_task_runs_started_total', snapshot.task_runs_started, 'Notebook task runs started');
  appendCounter('notebook_task_runs_completed_total', snapshot.task_runs_completed, 'Notebook task runs completed');
  appendCounter('notebook_task_runs_failed_total', snapshot.task_runs_failed, 'Notebook task runs failed');
  appendCounter(
    'notebook_task_runs_terminal_without_done_total',
    snapshot.task_runs_terminal_without_done,
    'Notebook task run streams finalized without terminal done/error event',
  );
  appendCounter('notebook_trace_events_recorded_total', snapshot.trace_events_recorded, 'Notebook trace events recorded');
  appendCounter(
    'notebook_trace_events_truncated_records_total',
    snapshot.trace_events_truncated_records,
    'Notebook trace records truncated due to retention limits',
  );
  appendCounter(
    'notebook_trace_details_truncated_total',
    snapshot.trace_details_truncated,
    'Notebook trace details payloads truncated due to size limits',
  );

  appendGauge('notebook_active_runs', snapshot.active_runs, 'Current active notebook task runs');
  appendGauge('notebook_task_sse_clients', snapshot.task_sse_clients, 'Current notebook task SSE clients');

  appendGauge('notebook_in_memory_tasks', snapshot.in_memory.tasks, 'In-memory notebook task records');
  appendGauge('notebook_in_memory_messages', snapshot.in_memory.messages, 'In-memory notebook task message records');
  appendGauge('notebook_in_memory_artifacts', snapshot.in_memory.artifacts, 'In-memory notebook task artifact records');
  appendGauge('notebook_in_memory_traces', snapshot.in_memory.traces, 'In-memory notebook task trace records');
  appendGauge(
    'notebook_in_memory_task_event_history_tasks',
    snapshot.in_memory.task_event_history_tasks,
    'Task ids with buffered notebook SSE event history',
  );

  appendGauge(
    'notebook_limit_trace_events_per_task',
    snapshot.limits.max_trace_events_per_task,
    'Configured max trace events retained per task',
  );
  appendGauge(
    'notebook_limit_trace_details_max_bytes',
    snapshot.limits.max_trace_details_bytes,
    'Configured max bytes for trace details payload before truncation',
  );
  appendGauge(
    'notebook_limit_task_sse_events_per_task',
    snapshot.limits.max_task_sse_events_per_task,
    'Configured max buffered notebook SSE events per task',
  );

  return `${lines.join('\n')}\n`;
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

async function loadTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<TaskArtifactRecord[]> {
  const cached = ARTIFACTS_BY_TASK.get(taskId);
  if (cached) return cached;
  const listed = await deps.docStore.list<TaskArtifactRecord>(TASK_ARTIFACTS_COLLECTION, { task_id: taskId });
  const sorted = listed.sort((a, b) => a.created_at.localeCompare(b.created_at));
  ARTIFACTS_BY_TASK.set(taskId, sorted);
  return sorted;
}

function getTaskTraceEvents(taskId: string): TaskTraceEventRecord[] {
  let existing = TRACE_EVENTS_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    TRACE_EVENTS_BY_TASK.set(taskId, existing);
  }
  return existing;
}

async function loadTaskTraceEvents(deps: NodeApiDeps, taskId: string): Promise<TaskTraceEventRecord[]> {
  const cached = TRACE_EVENTS_BY_TASK.get(taskId);
  if (cached && cached.length > 0) return cached;
  const listed = await deps.docStore.list<TaskTraceEventRecord>(TASK_TRACE_EVENTS_COLLECTION, { task_id: taskId });
  const sorted = listed.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at)));
  TRACE_EVENTS_BY_TASK.set(taskId, sorted);
  return sorted;
}

async function listTaskTraceEventsFiltered(
  deps: NodeApiDeps,
  args: {
    taskId: string;
    messageId?: string;
    runId?: string;
  },
): Promise<TaskTraceEventRecord[]> {
  const { taskId, messageId, runId } = args;
  if (!messageId && !runId) {
    return loadTaskTraceEvents(deps, taskId);
  }
  const filter: Record<string, string> = { task_id: taskId };
  if (messageId) filter.message_id = messageId;
  if (runId) filter.run_id = runId;
  const listed = await deps.docStore.list<TaskTraceEventRecord>(TASK_TRACE_EVENTS_COLLECTION, filter);
  return listed.sort((a, b) => (a.seq !== b.seq ? a.seq - b.seq : a.at.localeCompare(b.at)));
}

function findTask(workspaceId: string, projectId: string, taskId: string): TaskRecord | undefined {
  return getTasks(workspaceId, projectId).find((item) => item.id === taskId);
}

function writeDefaultSSE(res: http.ServerResponse, payload: unknown, eventId?: string): void {
  if (eventId) {
    res.write(`id: ${eventId}\n`);
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function getTaskEventHistory(taskId: string): BufferedTaskSseEvent[] {
  let existing = TASK_EVENT_HISTORY_BY_TASK.get(taskId);
  if (!existing) {
    existing = [];
    TASK_EVENT_HISTORY_BY_TASK.set(taskId, existing);
  }
  return existing;
}

function appendTaskEventHistory(taskId: string, event: BufferedTaskSseEvent): void {
  const history = getTaskEventHistory(taskId);
  history.push(event);
  if (history.length <= MAX_TASK_SSE_EVENTS_PER_TASK) return;
  history.splice(0, history.length - MAX_TASK_SSE_EVENTS_PER_TASK);
}

function emitTaskEvent(taskId: string, payload: unknown): void {
  const seq = (TASK_EVENT_SEQUENCE_BY_TASK.get(taskId) ?? 0) + 1;
  TASK_EVENT_SEQUENCE_BY_TASK.set(taskId, seq);
  const sseEventId = `${taskId}:${seq}`;
  appendTaskEventHistory(taskId, { id: sseEventId, payload });
  const clients = TASK_EVENT_CLIENTS.get(taskId);
  if (!clients || clients.size === 0) return;
  for (const client of clients) {
    if (client.writableEnded || client.destroyed) {
      clients.delete(client);
      continue;
    }
    try {
      writeDefaultSSE(client, payload, sseEventId);
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

function replayBufferedTaskEvents(res: http.ServerResponse, taskId: string, lastEventId: string | null): void {
  if (!lastEventId) return;
  const history = TASK_EVENT_HISTORY_BY_TASK.get(taskId);
  if (!history || history.length === 0) return;
  const idx = history.findIndex((item) => item.id === lastEventId);
  const replayItems = idx >= 0 ? history.slice(idx + 1) : history;
  for (const item of replayItems) {
    writeDefaultSSE(res, item.payload, item.id);
  }
}

async function storeTaskTraceEvent(deps: NodeApiDeps, taskId: string, event: TaskTraceEventRecord): Promise<void> {
  const items = getTaskTraceEvents(taskId);
  items.push(event);
  NOTEBOOK_RUNTIME_METRICS.trace_events_recorded += 1;
  await deps.docStore.upsert<TaskTraceEventRecord>(TASK_TRACE_EVENTS_COLLECTION, event.id, event);
  if (items.length <= MAX_TRACE_EVENTS_PER_TASK) return;

  let overflow = items.length - MAX_TRACE_EVENTS_PER_TASK;
  NOTEBOOK_RUNTIME_METRICS.trace_events_truncated_records += overflow;
  const removed = items.splice(0, overflow);
  await Promise.all(removed.map((item) => deps.docStore.delete(TASK_TRACE_EVENTS_COLLECTION, item.id)));
  // Reserve one slot for the truncation notice so the in-memory list does not grow beyond the configured max.
  if (items.length >= MAX_TRACE_EVENTS_PER_TASK) {
    const evicted = items.shift();
      if (evicted) {
        overflow += 1;
        NOTEBOOK_RUNTIME_METRICS.trace_events_truncated_records += 1;
        await deps.docStore.delete(TASK_TRACE_EVENTS_COLLECTION, evicted.id);
      }
  }
  const truncatedNotice: TaskTraceEventRecord = {
    id: buildId('trace', nextTraceEventId++),
    task_id: taskId,
    message_id: event.message_id,
    run_id: event.run_id,
    seq: event.seq,
    at: nowIso(),
    category: 'warning',
    name: 'trace.buffer',
    summary: `trace events truncated (dropped ${overflow})`,
    status: 'running',
    phase: 'update',
  };
  items.push(truncatedNotice);
  await deps.docStore.upsert<TaskTraceEventRecord>(TASK_TRACE_EVENTS_COLLECTION, truncatedNotice.id, truncatedNotice);
}

async function deleteTaskTraceEvents(deps: NodeApiDeps, taskId: string): Promise<void> {
  const existing = await deps.docStore.list<TaskTraceEventRecord>(TASK_TRACE_EVENTS_COLLECTION, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(TASK_TRACE_EVENTS_COLLECTION, item.id)));
}

async function deleteTaskMessages(deps: NodeApiDeps, taskId: string): Promise<void> {
  const existing = await deps.docStore.list<TaskMessageRecord>(TASK_MESSAGES_COLLECTION, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(TASK_MESSAGES_COLLECTION, item.id)));
}

async function deleteTaskArtifacts(deps: NodeApiDeps, taskId: string): Promise<void> {
  const existing = await deps.docStore.list<TaskArtifactRecord>(TASK_ARTIFACTS_COLLECTION, { task_id: taskId });
  await Promise.all(existing.map((item) => deps.docStore.delete(TASK_ARTIFACTS_COLLECTION, item.id)));
}

function buildTaskTraceEvent(args: {
  taskId: string;
  messageId: string;
  runId: string;
  payload: AgentRuntimeTraceEventPayload;
}): TaskTraceEventRecord {
  const { taskId, messageId, runId, payload } = args;
  let details: Record<string, unknown> | undefined;
  if (payload.details) {
    try {
      const serialized = JSON.stringify(payload.details);
      if (serialized && Buffer.byteLength(serialized, 'utf-8') > MAX_TRACE_DETAILS_BYTES) {
        NOTEBOOK_RUNTIME_METRICS.trace_details_truncated += 1;
        details = {
          _truncated: true,
          _reason: 'trace_details_too_large',
          _max_bytes: MAX_TRACE_DETAILS_BYTES,
          _preview: serialized.slice(0, Math.max(64, Math.min(1024, MAX_TRACE_DETAILS_BYTES / 2))),
        };
      } else {
        details = payload.details;
      }
    } catch {
      details = {
        _truncated: true,
        _reason: 'trace_details_not_serializable',
      };
    }
  }
  return {
    id: buildId('trace', nextTraceEventId++),
    task_id: taskId,
    message_id: messageId,
    run_id: runId,
    seq: payload.sequence,
    at: payload.at,
    category: payload.category,
    ...(payload.phase ? { phase: payload.phase } : {}),
    ...(payload.status ? { status: payload.status } : {}),
    name: payload.name,
    summary: payload.summary,
    ...(details ? { details } : {}),
  };
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
    NOTEBOOK_RUNTIME_METRICS.task_runs_started += 1;

    for await (const event of dispatched.stream) {
      if (event.type === 'event' && event.event) {
        const traceEvent = buildTaskTraceEvent({
          taskId: task.id,
          messageId: assistantMessage.id,
          runId,
          payload: event.event,
        });
        await storeTaskTraceEvent(deps, task.id, traceEvent);
        emitTaskEvent(taskId, { type: 'trace_event', data: traceEvent });
        continue;
      }
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
        reachedTerminal = true;
        NOTEBOOK_RUNTIME_METRICS.task_runs_failed += 1;
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
        reachedTerminal = true;
        NOTEBOOK_RUNTIME_METRICS.task_runs_completed += 1;
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
    reachedTerminal = true;
    NOTEBOOK_RUNTIME_METRICS.task_runs_failed += 1;
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
      NOTEBOOK_RUNTIME_METRICS.task_runs_terminal_without_done += 1;
      // Defensive: the run ended without a terminal runtime event. Keep the task editable for follow-up turns,
      // but log it so we can diagnose protocol/runtime issues.
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
    try {
      await deps.docStore.upsert<TaskMessageRecord>(TASK_MESSAGES_COLLECTION, assistantMessage.id, assistantMessage);
      await deps.docStore.upsert<TaskRecord>(TASKS_COLLECTION, task.id, task);
    } catch (error) {
      debugNotebookRuntime('task_run_persist_failed', {
        task_id: task.id,
        run_id: runId,
        message_id: assistantMessage.id,
        error: error instanceof Error ? error.message : 'persist_failed',
      });
    }
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
    TASK_EVENT_CLIENTS.delete(route.taskId);
    MESSAGES_BY_TASK.delete(route.taskId);
    ARTIFACTS_BY_TASK.delete(route.taskId);
    TRACE_EVENTS_BY_TASK.delete(route.taskId);
    TASK_EVENT_HISTORY_BY_TASK.delete(route.taskId);
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
      id: buildId('msg', nextMessageId++),
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
        id: buildId('msg', nextMessageId++),
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
    let clients = TASK_EVENT_CLIENTS.get(route.taskId);
    if (!clients) {
      clients = new Set<http.ServerResponse>();
      TASK_EVENT_CLIENTS.set(route.taskId, clients);
    }
    clients.add(res);
    if (lastEventId) {
      replayBufferedTaskEvents(res, route.taskId, lastEventId);
    } else {
      writeDefaultSSE(res, { type: 'task_update', data: findTask(route.workspaceId, route.projectId, route.taskId) });
      for (const traceEvent of await loadTaskTraceEvents(deps, route.taskId)) {
        writeDefaultSSE(res, { type: 'trace_event', data: traceEvent });
      }
    }
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
