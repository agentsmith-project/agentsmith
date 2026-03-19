import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import {
  observeNotebookTraceQueryLatency,
  type TraceQueryScope,
} from './notebook-task-metrics.js';
import {
  deleteTaskTraceEvents,
  listTaskTraceEventsFiltered,
  loadTaskTraceEvents,
  removeTaskTraceEventsFromMemory,
} from './notebook-trace-store.js';
import {
  clearNotebookTaskEventState,
  emitNotebookTaskEvent,
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
import {
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import { getNotebookTaskMetricsPrometheusText, getNotebookTaskMetricsSnapshot } from './notebook-task/task-metrics-api.js';
import {
  asObject,
  buildId,
  readTaskInputRefs,
  type TaskInputRefRecord,
  type TaskListItem,
  type TaskRecord,
} from './notebook-task/task-models.js';
import {
  buildTaskRealtimeView,
  mapTaskMessagesForExecution,
  resolvePublicBaseUrl,
} from './notebook-task/task-realtime-view.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  clearNotebookTaskRunCoordination,
  getNotebookRunOwnerInstanceId,
  getNotebookTaskRunCancellationRequest,
  getNotebookTaskRunState,
  markNotebookTaskRunDispatched,
  refreshNotebookTaskRunLease,
  requestNotebookTaskRunCancellation,
} from './notebook-task/task-run-coordination.js';
import {
  ACTIVE_RUNS_BY_TASK,
  ACTIVE_RUN_CANCEL_BY_TASK,
  ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK,
  ARTIFACTS_BY_TASK,
  findTask,
  findTaskById,
  getTaskArtifacts,
  getTaskMessages,
  getTasks,
  MESSAGES_BY_TASK,
  nowIso,
  projectKey,
  readSortValue,
  sanitizePathPart,
  updateTaskActivity,
} from './notebook-task/task-runtime-state.js';
import {
  createTaskArtifactRecord,
  deleteTaskArtifacts,
  deleteTaskMessages,
  loadProjectTasks,
  loadTaskArtifacts,
  loadTaskMessages,
  notebookTaskArtifactsCollection,
  notebookTaskMessagesCollection,
  notebookTasksCollection,
} from './notebook-task/task-store.js';

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

function debugNotebookExecution(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_EXECUTION !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-execution] ${message}${suffix}\n`);
}

function sanitizeTaskWorkspaceDirName(title: string, taskId: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (slug) return slug;
  return taskId.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'task-workspace';
}

const NOTEBOOK_RUN_LEASE_HEARTBEAT_MS = 15_000;
const NOTEBOOK_RUN_CANCEL_POLL_MS = 1_000;

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

export async function handleTaskRoute(args: TaskRouteHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, rawBearerToken, json, readBody } = args;
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(deps.docStore);
  const mountAccessRepo = new JsonDocProjectFileLibraryMountAccessRepo(deps.docStore);

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
    const workspaceFileLibraryId = typeof body.workspace_file_library_id === 'string'
      ? body.workspace_file_library_id.trim()
      : '';
    if (!title) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'task_title_required' });
      return true;
    }
    if (!agentId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_id_required' });
      return true;
    }
    if (!workspaceFileLibraryId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'workspace_file_library_id_required' });
      return true;
    }

    const agent = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, agentId);
    if (!agent || agent.status !== 'enabled' || agent.interaction_mode === 'chat') {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found_or_not_notebook_compatible' });
      return true;
    }
    if (agent.mode === 'external' && agent.presence !== 'online') {
      json(res, 409, { error_code: 'AGENT_OFFLINE', message: 'agent_offline' });
      return true;
    }
    const workspaceFileLibrary = await catalogRepo.getById(route.workspaceId, route.projectId, workspaceFileLibraryId);
    if (!workspaceFileLibrary) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
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
      workspace_file_library_id: workspaceFileLibrary.id,
      workspace_file_library_name: workspaceFileLibrary.name,
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
      metadata: {
        agent_id: task.agent_id,
        workspace_file_library_id: task.workspace_file_library_id,
        initial_input_count: task.attached_inputs.length,
      },
    });
    json(res, 201, await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task));
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

  if (route.kind === 'taskWorkspaceAccess' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTask(route.workspaceId, route.projectId, route.taskId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    if (!task.workspace_file_library_id) {
      json(res, 409, { error_code: 'TASK_WORKSPACE_NOT_BOUND', message: 'task_workspace_file_library_not_configured' });
      return true;
    }
    const workspaceFileLibrary = await catalogRepo.getById(
      route.workspaceId,
      route.projectId,
      task.workspace_file_library_id,
    );
    if (!workspaceFileLibrary) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
      return true;
    }
    const mountAccess = await mountAccessRepo.getById(
      route.workspaceId,
      route.projectId,
      task.workspace_file_library_id,
    );
    if (!mountAccess) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_mount_access_not_found' });
      return true;
    }
    json(res, 200, {
      task_id: task.id,
      workspace_binding_mode: 'file_library',
      workspace_dir_name: sanitizeTaskWorkspaceDirName(task.title, task.id),
      file_library_id: workspaceFileLibrary.id,
      file_library_name: workspaceFileLibrary.name,
      filesystem_name: mountAccess.filesystem_name,
      metadata_url: mountAccess.metadata_url,
      recommended_mount_path: mountAccess.recommended_mount_path,
      created_at: mountAccess.created_at,
    });
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
    await clearNotebookTaskRunCoordination(deps.cache, route.taskId);
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
        item.kind === 'library_object'
          ? `library_object:${item.library_id}:${item.key}`
          : item.kind === 'artifact'
              ? `artifact:${item.task_id}:${item.artifact_id}`
            : `url:${item.url}`,
      ),
    );
    for (const inputRef of inputs) {
      const key = inputRef.kind === 'library_object'
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
      workspaceId: route.workspaceId,
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
    let runId: string | null = null;
    let sharedRunState = null as ReturnType<typeof buildNotebookTaskRunState> | null;
    if (role === 'user') {
      runId = buildId('run');
      const startedAt = nowIso();
      sharedRunState = buildNotebookTaskRunState({
        taskId: route.taskId,
        runId,
        startedAt,
        ownerInstanceId: getNotebookRunOwnerInstanceId(),
      });
      const acquired = await acquireNotebookTaskRunLease(deps.cache, sharedRunState);
      if (!acquired) {
        json(res, 409, { error_code: 'TASK_STREAM_CONFLICT', message: 'task_stream_conflict' });
        return true;
      }
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
      let heartbeatTimer: NodeJS.Timeout | undefined;
      let cancelSyncTimer: NodeJS.Timeout | undefined;

      const syncSharedCancellationRequest = async (): Promise<void> => {
        const marker = await getNotebookTaskRunCancellationRequest(deps.cache, route.taskId);
        if (!marker || marker.run_id !== runId) return;
        const active = ACTIVE_RUN_CANCEL_BY_TASK.get(route.taskId);
        if (!active || active.runId !== runId) return;
        if (ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.has(route.taskId)) return;
        ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(route.taskId, {
          runId,
          requestedAt: marker.requested_at,
        });
        active.cancel();
      };

      heartbeatTimer = setInterval(() => {
        sharedRunState = {
          ...sharedRunState,
          heartbeat_at: nowIso(),
        };
        void refreshNotebookTaskRunLease(deps.cache, sharedRunState).catch(() => undefined);
      }, NOTEBOOK_RUN_LEASE_HEARTBEAT_MS);
      cancelSyncTimer = setInterval(() => {
        void syncSharedCancellationRequest().catch(() => undefined);
      }, NOTEBOOK_RUN_CANCEL_POLL_MS);

      void runNotebookTaskWithExecutionAgent({
        deps,
        task,
        assistantMessage,
        agentId: task.agent_id,
        user,
        rawBearerToken,
        publicBaseUrl: resolvePublicBaseUrl(req),
        buildRunId: () => runId ?? buildId('run'),
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
            cancel,
            requestCancel: () => {
              ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(taskId, { runId, requestedAt: nowIso() });
              void requestNotebookTaskRunCancellation(deps.cache, {
                task_id: taskId,
                run_id: runId,
                requested_at: nowIso(),
                actor_user_id: user.id,
              });
              cancel();
            },
          });
          sharedRunState = {
            ...sharedRunState,
            request_id: requestId,
            dispatched_at: nowIso(),
            heartbeat_at: nowIso(),
          };
          void markNotebookTaskRunDispatched(deps.cache, {
            taskId,
            runId,
            requestId,
            dispatchedAt: sharedRunState.dispatched_at ?? sharedRunState.heartbeat_at,
          });
          void syncSharedCancellationRequest();
        },
        onFinalize: async (taskId) => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (cancelSyncTimer) clearInterval(cancelSyncTimer);
          ACTIVE_RUNS_BY_TASK.delete(taskId);
          ACTIVE_RUN_CANCEL_BY_TASK.delete(taskId);
          ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(taskId);
          await clearNotebookTaskRunCoordination(deps.cache, taskId);
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
    const sharedActive = await getNotebookTaskRunState(deps.cache, route.taskId);
    if (!active && !sharedActive) {
      json(res, 409, { error_code: 'TASK_RUN_NOT_ACTIVE', message: 'task_run_not_active' });
      return true;
    }
    const runId = active?.runId ?? sharedActive?.run_id ?? 'unknown';
    const requestId = active?.requestId ?? sharedActive?.request_id ?? null;
    const requestedAt = nowIso();
    ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(route.taskId, { runId, requestedAt });
    await requestNotebookTaskRunCancellation(deps.cache, {
      task_id: route.taskId,
      run_id: runId,
      requested_at: requestedAt,
      actor_user_id: user.id,
    });
    active?.requestCancel();
    debugNotebookExecution('task_run_cancel_requested', {
      task_id: route.taskId,
      run_id: runId,
      request_id: requestId,
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
        run_id: runId,
        request_id: requestId,
      },
    });
    json(res, 202, {
      status: 'cancelling',
      task_id: route.taskId,
      run_id: runId,
      request_id: requestId,
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
