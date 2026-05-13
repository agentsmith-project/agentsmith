import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AgentRecord } from './resource-models.js';
import type { FileLibraryRecord } from './file-library-model.js';
import {
  createAndProvisionProjectFileLibrary,
  DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
  mapFileLibraryInfraError,
} from './project-file-library-service.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';
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
  acquireTaskFileLibraryBinding,
  releaseTaskFileLibraryBinding,
} from './notebook-task/task-file-library-bindings.js';
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
import {
  AgentTaskModelResolutionError,
  type AgentTaskModelResolvedTarget,
  resolveAgentTaskModelTarget,
} from './agent-task-model-setting-service.js';
import {
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
  isDeveloperRunnerTaskHomeBindingAvailable,
} from './developer-runner-workspace-blocker.js';

const RUNNER_TEST_PROMPT = [
  'AgentSmith Developer runner self-check.',
  '',
  'Do not inspect files, do not run shell commands, and do not use tools.',
  'Reply with exactly this text and nothing else:',
  'AGENTSMITH_RUNNER_TEST_OK',
].join('\n');
const RUNNER_TEST_TASK_TITLE = 'Developer runner test task';
const RUNNER_TEST_TASK_WORKSPACE_NAME = 'Developer Runner Test Workspace';
const NOTEBOOK_RUN_LEASE_HEARTBEAT_MS = 15_000;
const RUNNER_TEST_RUN_LEASE_TTL_SECONDS = 5 * 60;

export type RunnerTestTaskRunAccepted = {
  taskId: string;
  runId: string;
  resolvedRunnerId: string;
};

export type RunnerTestTaskRunDispatchResult =
  | { ok: true; accepted: RunnerTestTaskRunAccepted }
  | {
      ok: false;
      errorCode: 'agent_runner_test_task_unavailable' | string;
      message: string;
    };

function debugRunnerTestTask(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_EXECUTION !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[runner-test-task] ${message}${suffix}\n`);
}

function runnerTestRunLockKey(workspaceId: string, projectId: string, runnerId: string): string {
  return `agent:runner-test:${workspaceId}:${projectId}:${runnerId}:run`;
}

function buildRunnerTestPrompt(_intent: string | undefined): string {
  return RUNNER_TEST_PROMPT;
}

function parseRunnerTestRunLease(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    return asObject(JSON.parse(raw));
  } catch {
    return {};
  }
}

async function acquireRunnerTestRunLease(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  runnerId: string;
  taskId: string;
  runId: string;
  startedAt: string;
}): Promise<boolean> {
  const key = runnerTestRunLockKey(input.workspaceId, input.projectId, input.runnerId);
  const value = JSON.stringify({
    task_id: input.taskId,
    run_id: input.runId,
    runner_id: input.runnerId,
    started_at: input.startedAt,
  });
  if (typeof input.deps.cache.compareAndSet === 'function') {
    return input.deps.cache.compareAndSet(key, null, value, RUNNER_TEST_RUN_LEASE_TTL_SECONDS);
  }
  if (await input.deps.cache.get(key)) return false;
  await input.deps.cache.set(key, value, RUNNER_TEST_RUN_LEASE_TTL_SECONDS);
  return true;
}

async function refreshRunnerTestRunLease(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  runnerId: string;
  runId: string;
  heartbeatAt: string;
}): Promise<void> {
  const key = runnerTestRunLockKey(input.workspaceId, input.projectId, input.runnerId);
  const raw = await input.deps.cache.get(key);
  const current = parseRunnerTestRunLease(raw);
  if (current.run_id !== input.runId) return;
  await input.deps.cache.set(
    key,
    JSON.stringify({
      ...current,
      heartbeat_at: input.heartbeatAt,
    }),
    RUNNER_TEST_RUN_LEASE_TTL_SECONDS,
  );
}

async function releaseRunnerTestRunLease(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  runnerId: string;
  runId: string;
}): Promise<void> {
  const key = runnerTestRunLockKey(input.workspaceId, input.projectId, input.runnerId);
  const raw = await input.deps.cache.get(key);
  if (!raw) return;
  const current = parseRunnerTestRunLease(raw);
  if (current.run_id !== input.runId) return;
  if (typeof input.deps.cache.compareAndSet === 'function') {
    await input.deps.cache.compareAndSet(key, raw, null);
    return;
  }
  await input.deps.cache.del(key);
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
  requestId?: string | null;
}): Promise<FileLibraryRecord | null> {
  try {
    return await createAndProvisionProjectFileLibrary({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      userId: input.userId,
      name: RUNNER_TEST_TASK_WORKSPACE_NAME,
      description: 'Auto-initialized workspace for Developer runner test task evidence.',
      requestId: input.requestId,
      projectStorageReadyWait: DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
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
  if (!isDeveloperRunnerTaskHomeBindingAvailable()) {
    return {
      ok: false,
      errorCode: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
      message: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
    };
  }

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

  let agentTaskModelTarget: AgentTaskModelResolvedTarget;
  try {
    agentTaskModelTarget = await resolveAgentTaskModelTarget({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorUserId: input.user.id,
      requestId: input.requestId,
      source: 'agent_runner_test_task',
      contextMetadata: {
        runner_id: input.runner.id,
        runner_test: true,
      },
    });
  } catch (error) {
    if (error instanceof AgentTaskModelResolutionError) {
      return {
        ok: false,
        errorCode: error.code,
        message: error.code,
      };
    }
    throw error;
  }

  const taskId = buildId('task');
  const runId = buildId('run');
  const startedAt = nowIso();
  const runnerTestLeaseAcquired = await acquireRunnerTestRunLease({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    runnerId: input.runner.id,
    taskId,
    runId,
    startedAt,
  });
  if (!runnerTestLeaseAcquired) {
    return {
      ok: false,
      errorCode: 'agent_runner_test_task_unavailable',
      message: 'runner_test_task_run_conflict',
    };
  }
  let runnerTestLeaseReleased = false;
  const releaseRunnerTestLease = async (): Promise<void> => {
    if (runnerTestLeaseReleased) return;
    runnerTestLeaseReleased = true;
    await releaseRunnerTestRunLease({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      runnerId: input.runner.id,
      runId,
    });
  };

  let workspaceFileLibrary = await createRunnerTestWorkspace({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    userId: input.user.id,
    requestId: input.requestId,
  });
  if (!workspaceFileLibrary) {
    await releaseRunnerTestLease();
    return {
      ok: false,
      errorCode: 'agent_runner_test_task_unavailable',
      message: 'runner_test_task_workspace_unavailable',
    };
  }
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(input.deps.docStore);

  const createdAt = nowIso();
  const runnerTestPrompt = buildRunnerTestPrompt(input.intent);
  const lifecycleFence = await catalogRepo.acquireReadyLifecycleFence({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: workspaceFileLibrary.id,
    expectedVersion: workspaceFileLibrary.version,
    taskId,
    correlationId: input.requestId ?? taskId,
    now: createdAt,
  });
  if (!lifecycleFence.ok) {
    await releaseRunnerTestLease();
    return {
      ok: false,
      errorCode: lifecycleFence.code,
      message: lifecycleFence.code === 'FILE_LIBRARY_DELETING'
        ? 'file_library_deleting'
        : lifecycleFence.code === 'FILE_LIBRARY_NOT_FOUND'
          ? 'file_library_not_found'
          : 'file_library_not_ready',
    };
  }
  workspaceFileLibrary = lifecycleFence.fence.library;
  const task: TaskRecord = {
    id: taskId,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    owner_user_id: input.user.id,
    title: RUNNER_TEST_TASK_TITLE,
    prompt: runnerTestPrompt,
    task_home_segment: workspaceFileLibrary.file_library_home_segment,
    source: 'runner_test',
    runner_test: true,
    workspace_file_library_id: workspaceFileLibrary.id,
    workspace_file_library_name: workspaceFileLibrary.name,
    runtime_writable_affordance: 'task_internal_home',
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
  const taskFileLibraryBinding = await acquireTaskFileLibraryBinding({
    docStore: input.deps.docStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: workspaceFileLibrary.id,
    taskId: task.id,
    taskTitle: task.title,
    taskStatus: task.status,
    ownerUserId: task.owner_user_id,
    runtimeWritableAffordance: 'task_internal_home',
    correlationId: input.requestId ?? task.id,
    now: createdAt,
  });
  if (!taskFileLibraryBinding.ok) {
    await catalogRepo.releaseReadyLifecycleFence({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: workspaceFileLibrary.id,
      expectedVersion: lifecycleFence.fence.version,
      token: lifecycleFence.fence.token,
    });
    await releaseRunnerTestLease();
    return {
      ok: false,
      errorCode: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
      message: 'workspace_file_library_in_use',
    };
  }
  const lifecycleFenceVerified = await catalogRepo.verifyReadyLifecycleFence({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: workspaceFileLibrary.id,
    expectedVersion: lifecycleFence.fence.version,
    token: lifecycleFence.fence.token,
  });
  if (!lifecycleFenceVerified.ok) {
    await releaseTaskFileLibraryBinding({
      docStore: input.deps.docStore,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fileLibraryId: workspaceFileLibrary.id,
      taskId: task.id,
      bindingGeneration: taskFileLibraryBinding.binding.bindingGeneration,
      correlationId: input.requestId ?? task.id,
    });
    await catalogRepo.releaseReadyLifecycleFence({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      libraryId: workspaceFileLibrary.id,
      expectedVersion: lifecycleFence.fence.version,
      token: lifecycleFence.fence.token,
    });
    await releaseRunnerTestLease();
    return {
      ok: false,
      errorCode: lifecycleFenceVerified.code,
      message: lifecycleFenceVerified.code === 'FILE_LIBRARY_DELETING'
        ? 'file_library_deleting'
        : lifecycleFenceVerified.code === 'FILE_LIBRARY_NOT_FOUND'
          ? 'file_library_not_found'
          : 'file_library_not_ready',
    };
  }
  const releasedLifecycleFence = await catalogRepo.releaseReadyLifecycleFence({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    libraryId: workspaceFileLibrary.id,
    expectedVersion: lifecycleFence.fence.version,
    token: lifecycleFence.fence.token,
  });
  if (!releasedLifecycleFence.ok) {
    await releaseTaskFileLibraryBinding({
      docStore: input.deps.docStore,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      fileLibraryId: workspaceFileLibrary.id,
      taskId: task.id,
      bindingGeneration: taskFileLibraryBinding.binding.bindingGeneration,
      correlationId: input.requestId ?? task.id,
    });
    await releaseRunnerTestLease();
    return {
      ok: false,
      errorCode: releasedLifecycleFence.code,
      message: releasedLifecycleFence.code === 'FILE_LIBRARY_DELETING'
        ? 'file_library_deleting'
        : releasedLifecycleFence.code === 'FILE_LIBRARY_NOT_FOUND'
          ? 'file_library_not_found'
          : 'file_library_not_ready',
    };
  }
  workspaceFileLibrary = releasedLifecycleFence.library;
  task.file_library_binding_generation = taskFileLibraryBinding.binding.bindingGeneration;
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

  let sharedRunState = buildNotebookTaskRunState({
    taskId: task.id,
    runId,
    runnerId: input.runner.id,
    resolvedRunnerId: input.runner.id,
    agentTaskModel: agentTaskModelTarget.snapshot,
    runnerTest: true,
    startedAt,
    ownerInstanceId: getNotebookRunOwnerInstanceId(),
  });
  const acquired = await acquireNotebookTaskRunLease(input.deps.cache, sharedRunState);
  if (!acquired) {
    await releaseRunnerTestLease();
    return {
      ok: false,
      errorCode: 'agent_runner_test_task_unavailable',
      message: 'runner_test_task_run_conflict',
    };
  }

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
    await releaseRunnerTestLease();
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
    content: runnerTestPrompt,
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

  const heartbeatTimer = setInterval(() => {
    const heartbeatAt = nowIso();
    sharedRunState = {
      ...sharedRunState,
      heartbeat_at: heartbeatAt,
    };
    void refreshNotebookTaskRunLease(input.deps.cache, sharedRunState).catch(() => undefined);
    void refreshRunnerTestRunLease({
      deps: input.deps,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      runnerId: input.runner.id,
      runId,
      heartbeatAt,
    }).catch(() => undefined);
  }, NOTEBOOK_RUN_LEASE_HEARTBEAT_MS);

  const runPromise = runNotebookTaskWithExecutionAgent({
    deps: input.deps,
    task,
    assistantMessage,
    agentId: input.runner.id,
    agentTaskModelTarget,
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
