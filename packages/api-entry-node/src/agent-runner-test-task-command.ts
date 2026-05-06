import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AgentRecord } from './resource-models.js';
import { createAndProvisionProjectFileLibrary, mapFileLibraryInfraError } from './project-file-library-service.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { runNotebookTaskWithExecutionAgent } from './notebook-execution-orchestrator.js';
import { resolveRequiredConfiguredPublicApiBase } from './agent-execution-api-base.js';
import {
  buildNotebookTaskRunState,
  acquireNotebookTaskRunLease,
  finalizeNotebookTaskRun,
  getNotebookRunOwnerInstanceId,
  markNotebookTaskRunDispatched,
  refreshNotebookTaskRunLease,
  requestNotebookTaskRunStop,
} from './notebook-task/task-run-coordination.js';
import {
  asObject,
  buildId,
  type TaskMessageRecord,
  type TaskRecord,
} from './notebook-task/task-models.js';
import {
  createTaskArtifactRecord,
  loadProjectTasks,
  notebookTaskMessagesCollection,
  notebookTasksCollection,
} from './notebook-task/task-store.js';
import {
  ACTIVE_RUNS_BY_TASK,
  ACTIVE_RUN_CANCEL_BY_TASK,
  ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK,
  getTaskMessages,
  getTasks,
  nowIso,
  sanitizePathPart,
  updateTaskActivity,
} from './notebook-task/task-runtime-state.js';
import {
  buildTaskRealtimeView,
  mapTaskMessagesForExecution,
} from './notebook-task/task-realtime-view.js';
import { emitNotebookTaskEvent } from './notebook-task-sse-broker.js';

const RUNNER_TEST_DEFAULT_INTENT = 'Run a Developer runner self-check.';
const RUNNER_TEST_TASK_TITLE = 'Developer runner test task';
const RUNNER_TEST_TASK_WORKSPACE_NAME = 'Developer Runner Test Workspace';
const NOTEBOOK_RUN_LEASE_HEARTBEAT_MS = 15_000;

export type RunnerTestTaskRunAccepted = {
  taskId: string;
  runId: string;
  resolvedRunnerId: string;
};

export type RunnerTestTaskRunDispatchResult =
  | { ok: true; accepted: RunnerTestTaskRunAccepted }
  | {
      ok: false;
      errorCode: 'agent_runner_test_task_unavailable';
      message: string;
    };

function debugRunnerTestTask(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_EXECUTION !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[runner-test-task] ${message}${suffix}\n`);
}

function normalizeRunnerTestIntent(intent: string | undefined): string {
  const trimmed = intent?.trim();
  return trimmed || RUNNER_TEST_DEFAULT_INTENT;
}

function mapTaskMessageRecordToActivityItem(message: TaskMessageRecord): {
  id: string;
  task_id: string;
  kind: 'user_intent' | 'runner_output';
  actor: 'user' | 'runner';
  content: string;
  created_at: string;
  run_id?: string;
  source?: 'runner_test';
  runner_test?: true;
} {
  return {
    id: message.id,
    task_id: message.task_id,
    kind: message.role === 'user' ? 'user_intent' : 'runner_output',
    actor: message.role === 'user' ? 'user' : 'runner',
    content: message.content,
    created_at: message.created_at,
    ...(message.turn_id ? { run_id: message.turn_id } : {}),
    source: 'runner_test',
    runner_test: true,
  };
}

function emitTaskActivityEvent(task: TaskRecord, message: TaskMessageRecord): void {
  emitNotebookTaskEvent(task.id, {
    type: 'activity_item',
    data: mapTaskMessageRecordToActivityItem(message),
  });
}

async function persistTaskMessage(
  deps: NodeApiDeps,
  workspaceId: string,
  message: TaskMessageRecord,
): Promise<void> {
  await deps.docStore.upsert<TaskMessageRecord>(
    notebookTaskMessagesCollection(workspaceId),
    message.id,
    message,
  );
  getTaskMessages(message.task_id).push(message);
}

function clearRunnerTestLocalRunHandle(taskId: string, runId: string, input?: { preserveCancelMarker?: boolean }): void {
  const active = ACTIVE_RUN_CANCEL_BY_TASK.get(taskId);
  if (!active || active.runId === runId) {
    ACTIVE_RUN_CANCEL_BY_TASK.delete(taskId);
  }
  if (!input?.preserveCancelMarker) {
    const localMarker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(taskId);
    if (!localMarker || localMarker.runId === runId) {
      ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(taskId);
    }
  }
  ACTIVE_RUNS_BY_TASK.delete(taskId);
}

async function createRunnerTestWorkspace(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
}): Promise<{
  id: string;
  name: string;
} | null> {
  try {
    return await createAndProvisionProjectFileLibrary({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      userId: input.userId,
      name: RUNNER_TEST_TASK_WORKSPACE_NAME,
      description: 'Auto-initialized workspace for Developer runner test task evidence.',
    });
  } catch (error) {
    const mapped = mapFileLibraryInfraError(error);
    debugRunnerTestTask('workspace_create_failed', {
      project_id: input.projectId,
      error_code: mapped.errorCode,
      message: mapped.message,
    });
    return null;
  }
}

export async function dispatchDeveloperRunnerTestTaskRun(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  user: AuthenticatedUser;
  runner: AgentRecord;
  intent?: string;
  requestId?: string | null;
}): Promise<RunnerTestTaskRunDispatchResult> {
  await loadProjectTasks(input.deps, input.workspaceId, input.projectId);
  let publicBaseUrl: string;
  try {
    publicBaseUrl = resolveRequiredConfiguredPublicApiBase();
  } catch {
    return {
      ok: false,
      errorCode: 'agent_runner_test_task_unavailable',
      message: 'agent_execution_api_base_not_configured',
    };
  }

  const workspaceFileLibrary = await createRunnerTestWorkspace({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    userId: input.user.id,
  });
  if (!workspaceFileLibrary) {
    return {
      ok: false,
      errorCode: 'agent_runner_test_task_unavailable',
      message: 'runner_test_task_workspace_unavailable',
    };
  }

  const createdAt = nowIso();
  const task: TaskRecord = {
    id: buildId('task'),
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    owner_user_id: input.user.id,
    title: RUNNER_TEST_TASK_TITLE,
    prompt: normalizeRunnerTestIntent(input.intent),
    source: 'runner_test',
    runner_test: true,
    workspace_file_library_id: workspaceFileLibrary.id,
    workspace_file_library_name: workspaceFileLibrary.name,
    bound_runner_id: input.runner.id,
    bound_runner_kind: 'developer',
    runner_binding_source: 'explicit',
    bound_at: createdAt,
    bound_by_user_id: input.user.id,
    status: 'active',
    attached_inputs: [],
    created_at: createdAt,
    updated_at: createdAt,
    last_activity_at: createdAt,
  };
  getTasks(input.workspaceId, input.projectId).unshift(task);
  await input.deps.docStore.upsert<TaskRecord>(notebookTasksCollection(input.workspaceId), task.id, task);
  await writeProjectAuditEvent(input.deps, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actor: { type: 'user', id: input.user.id },
    action: 'notebook.task.created',
    resourceType: 'notebook_task',
    resourceId: task.id,
    requestId: input.requestId,
    metadata: {
      runner_test: true,
      source: 'runner_test',
      workspace_file_library_id: task.workspace_file_library_id,
      bound_runner_id: task.bound_runner_id,
      bound_runner_kind: task.bound_runner_kind,
      runner_binding_source: task.runner_binding_source,
    },
  });

  const runId = buildId('run');
  const startedAt = nowIso();
  let sharedRunState = buildNotebookTaskRunState({
    taskId: task.id,
    runId,
    runnerId: input.runner.id,
    resolvedRunnerId: input.runner.id,
    runnerTest: true,
    startedAt,
    ownerInstanceId: getNotebookRunOwnerInstanceId(),
  });
  const acquired = await acquireNotebookTaskRunLease(input.deps.cache, sharedRunState);
  if (!acquired) {
    return {
      ok: false,
      errorCode: 'agent_runner_test_task_unavailable',
      message: 'runner_test_task_run_conflict',
    };
  }

  let heartbeatTimer: NodeJS.Timeout | undefined;
  let localRunTrackingReleased = false;
  let sharedRunControlCleared = false;
  const releaseLocalRunTracking = (releaseInput?: { preserveCancelMarker?: boolean }): void => {
    if (localRunTrackingReleased) return;
    localRunTrackingReleased = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    clearRunnerTestLocalRunHandle(task.id, runId, releaseInput);
  };
  const finalizeAcquiredRun = async (finalizeInput?: { clearSharedControl?: boolean }): Promise<void> => {
    releaseLocalRunTracking();
    if (!finalizeInput?.clearSharedControl || sharedRunControlCleared) {
      return;
    }
    sharedRunControlCleared = true;
    await finalizeNotebookTaskRun(input.deps.cache, {
      taskId: task.id,
      runId,
    });
  };

  const userMessage: TaskMessageRecord = {
    id: buildId('msg'),
    task_id: task.id,
    role: 'user',
    content: normalizeRunnerTestIntent(input.intent),
    created_at: nowIso(),
  };
  const assistantMessage: TaskMessageRecord = {
    id: buildId('msg'),
    task_id: task.id,
    role: 'agent',
    content: '',
    created_at: nowIso(),
    turn_id: runId,
  };
  await persistTaskMessage(input.deps, input.workspaceId, userMessage);
  await persistTaskMessage(input.deps, input.workspaceId, assistantMessage);
  updateTaskActivity(task);
  await input.deps.docStore.upsert<TaskRecord>(notebookTasksCollection(input.workspaceId), task.id, task);

  ACTIVE_RUNS_BY_TASK.add(task.id);
  const startupAbortController = new AbortController();
  ACTIVE_RUN_CANCEL_BY_TASK.set(task.id, {
    runId,
    requestId: null,
    cancel: () => {
      if (!startupAbortController.signal.aborted) {
        startupAbortController.abort('user_cancel_requested');
      }
      clearRunnerTestLocalRunHandle(task.id, runId, { preserveCancelMarker: true });
    },
    requestCancel: () => {
      const requestedAt = nowIso();
      ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(task.id, { runId, requestedAt });
      void requestNotebookTaskRunStop(input.deps.cache, {
        taskId: task.id,
        runId,
        mode: 'cancel',
        requestedAt,
        actorUserId: input.user.id,
        delivery: 'owner_attached',
      });
      if (!startupAbortController.signal.aborted) {
        startupAbortController.abort('user_cancel_requested');
      }
    },
  });

  heartbeatTimer = setInterval(() => {
    sharedRunState = {
      ...sharedRunState,
      heartbeat_at: nowIso(),
    };
    void refreshNotebookTaskRunLease(input.deps.cache, sharedRunState).catch(() => undefined);
  }, NOTEBOOK_RUN_LEASE_HEARTBEAT_MS);

  const runPromise = runNotebookTaskWithExecutionAgent({
    deps: input.deps,
    task,
    assistantMessage,
    agentId: input.runner.id,
    user: input.user,
    publicBaseUrl,
    buildRunId: () => runId,
    buildProxyUsername: (user) => sanitizePathPart(user.email || user.name || user.id),
    mapTaskMessagesForExecution,
    updateTaskActivity,
    emitTaskEvent: (taskId, payload) => {
      if (payload.type !== 'task_update') {
        emitNotebookTaskEvent(taskId, payload);
        return;
      }
      void buildTaskRealtimeView(input.deps, input.workspaceId, input.projectId, task)
        .then((enriched) => {
          emitNotebookTaskEvent(taskId, { type: 'task_update', data: enriched });
        })
        .catch(() => {
          emitNotebookTaskEvent(taskId, payload);
        });
    },
    onDispatched: ({ taskId, requestId, cancel }) => {
      const dispatchedAt = nowIso();
      sharedRunState = {
        ...sharedRunState,
        request_id: requestId,
        dispatched_at: dispatchedAt,
        heartbeat_at: dispatchedAt,
      };
      ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(taskId);
      ACTIVE_RUN_CANCEL_BY_TASK.set(taskId, {
        runId,
        requestId,
        cancel,
        requestCancel: () => {
          const requestedAt = nowIso();
          ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(taskId, { runId, requestedAt });
          void requestNotebookTaskRunStop(input.deps.cache, {
            taskId,
            runId,
            mode: 'cancel',
            requestedAt,
            actorUserId: input.user.id,
            delivery: 'owner_attached',
          });
          cancel();
        },
      });
      void markNotebookTaskRunDispatched(input.deps.cache, {
        taskId,
        runId,
        requestId,
        dispatchedAt,
      });
      return true;
    },
    onFinalize: async (_taskId, finalizedRunId, summary) => {
      if (finalizedRunId !== runId) return;
      await finalizeAcquiredRun({ clearSharedControl: summary.durableTerminalTruth });
    },
    startupSignal: startupAbortController.signal,
    isCancellationRequested: async () => {
      const marker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(task.id);
      return marker?.runId === runId;
    },
    debugLog: debugRunnerTestTask,
    taskCollections: {
      tasks: notebookTasksCollection(input.workspaceId),
      messages: notebookTaskMessagesCollection(input.workspaceId),
    },
    createTaskArtifact: async ({ taskId, payload }) => createTaskArtifactRecord(input.deps, {
      taskId,
      payload: {
        ...asObject(payload),
        artifact_type: payload.artifact_type,
        task_relative_path: payload.task_relative_path,
        filename: payload.filename,
      },
    }),
  });
  void runPromise.catch(async (error) => {
    debugRunnerTestTask('run_promise_rejected', {
      task_id: task.id,
      run_id: runId,
      error: error instanceof Error ? error.message : 'run_promise_rejected',
    });
    await finalizeAcquiredRun({ clearSharedControl: true });
  });

  emitTaskActivityEvent(task, userMessage);
  emitTaskActivityEvent(task, assistantMessage);
  emitNotebookTaskEvent(task.id, {
    type: 'task_update',
    data: await buildTaskRealtimeView(input.deps, input.workspaceId, input.projectId, task),
  });

  return {
    ok: true,
    accepted: {
      taskId: task.id,
      runId,
      resolvedRunnerId: input.runner.id,
    },
  };
}
