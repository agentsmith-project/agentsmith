import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { RunnerSessionDispatchAuthority } from './agent-execution-service.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { buildAttachmentContentDisposition } from './http-utils.js';
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
  activateNotebookTaskEventSubscription,
  clearNotebookTaskEventState,
  emitNotebookTaskEvent,
  replayBufferedNotebookTaskEvents,
  subscribeNotebookTaskEvents,
  unsubscribeNotebookTaskEvents,
  writeNotebookTaskSseEvent,
} from './notebook-task-sse-broker.js';
import { resolveNotebookTaskInputDetails, type NotebookTaskInputRefRecord as SharedNotebookTaskInputRefRecord } from './notebook-input-refs.js';
import { resolveExecutionApiBase, runNotebookTaskWithExecutionAgent } from './notebook-execution-orchestrator.js';
import {
  resolveConfiguredPublicApiBase,
  resolveRequiredConfiguredPublicApiBase,
} from './agent-execution-api-base.js';
import { buildNotebookTaskInputs, type NotebookTaskInputRefRecord } from './notebook-input-refs.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import type { ProjectsRoute } from './projects-route-match.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import {
  resetInternalWorkloadHolderCoordinatorForTests,
  resolveInternalWorkloadCoordinator,
} from './internal-workload-coordinator.js';
import {
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectFileLibraryMountAccessRepo,
} from './file-library-persistence.js';
import {
  createFileLibraryGatewayClient,
  fileLibraryBucketName,
  getProjectFileLibraryRecord,
  guessFileLibraryContentType,
  normalizeFileLibraryPath,
} from './file-library-gateway-client.js';
import {
  awaitAbortableOperation,
  createHttpOperationEnvelope,
  openGatewayObjectDownload,
  pipeGatewayDownloadToHttpResponse,
} from './object-stream-bridge.js';
import {
  resolveFileLibraryMetadataUrlForDockerManualExternalExecution,
  resolveFileLibraryMetadataUrlForComposeManagedExternalExecution,
  resolveFileLibraryMetadataUrlForExternalExecution,
  resolveFileLibraryMetadataUrlForInternalExecution,
  resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution,
  resolveFileLibraryStorageBucketUrlForComposeManagedExternalExecution,
  resolveFileLibraryStorageBucketUrlForExternalExecution,
  resolveFileLibraryStorageBucketUrlForInternalExecution,
} from './file-library-runtime.js';
import { isComposeManagedExternalAgent, isExternalRunnerRuntime } from './agent-runner-profile.js';
import {
  asObject,
  buildId,
  readTaskInputRefs,
  type TaskListItem,
  type TaskRecord,
} from './notebook-task/task-models.js';
import { createAndProvisionProjectFileLibrary, mapFileLibraryInfraError } from './project-file-library-service.js';
import { isAgentExecutionTicket, issueInternalTicket, type ResolvedInternalTicket } from './internal-ticket-store.js';
import {
  buildNotebookRunStopEscalationUnavailableResponse,
  buildNotebookRunStopTruthResponse,
  buildTaskRealtimeView,
  canRequestNotebookRunHardTerminate,
  mapTaskMessagesForExecution,
  type NotebookRunStopEscalationReason,
  resolvePublicBaseUrl,
} from './notebook-task/task-realtime-view.js';
import {
  acquireNotebookTaskRunLease,
  buildNotebookTaskRunState,
  clearNotebookTaskRunCoordination,
  finalizeNotebookTaskRun,
  getNotebookRunOwnerInstanceId,
  getNotebookTaskRunStopRequestForRun,
  getNotebookTaskRunState,
  getNotebookTaskRunHardTeardownDebt,
  hasIncompleteNotebookTaskRunHardTeardown,
  isNotebookTaskRunOwnerHeartbeatFresh,
  markNotebookTaskRunDispatched,
  markNotebookTaskRunHardTeardownFailed,
  markNotebookTaskRunHardTeardownRequested,
  markNotebookTaskRunHardTeardownReleased,
  refreshNotebookTaskRunLease,
  requestNotebookTaskRunStop,
  requestNotebookTaskRunStopTransition,
  type NotebookTaskRunHardTeardownDebtRecord,
  type NotebookTaskRunStopMode,
} from './notebook-task/task-run-coordination.js';
import {
  ACTIVE_RUNS_BY_TASK,
  ACTIVE_RUN_CANCEL_BY_TASK,
  ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK,
  ARTIFACTS_BY_TASK,
  findTask,
  getTaskArtifacts,
  getTaskMessages,
  getTasks,
  MESSAGES_BY_TASK,
  nowIso,
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
  internalTicket?: ResolvedInternalTicket | null;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

function debugNotebookExecution(message: string, extra?: Record<string, unknown>): void {
  if (process.env.DEBUG_NOTEBOOK_EXECUTION !== '1') return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  process.stdout.write(`[notebook-execution] ${message}${suffix}\n`);
}

const NOTEBOOK_RUN_LEASE_HEARTBEAT_MS = 15_000;
const NOTEBOOK_RUN_CANCEL_POLL_MS = 1_000;
const NOTEBOOK_RUN_OWNER_STALE_AFTER_MS = (NOTEBOOK_RUN_LEASE_HEARTBEAT_MS * 2) + 5_000;

type InternalTaskWorkloadIdentity = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
  agentId: string;
};

function parseNotebookRunStopMode(raw: unknown): NotebookTaskRunStopMode | null {
  if (raw === undefined || raw === null || raw === '') {
    return 'cancel';
  }
  return raw === 'terminate' ? 'terminate' : raw === 'cancel' ? 'cancel' : null;
}

const registeredInternalTerminalLifecycleServices = new Set<object>();
const notebookRunHardTeardownInFlight = new Map<string, Promise<void>>();

function listTasksForOwner(
  workspaceId: string,
  projectId: string,
  ownerUserId: string,
): TaskRecord[] {
  return getTasks(workspaceId, projectId).filter((task) => task.owner_user_id === ownerUserId);
}

function findTaskForOwner(
  workspaceId: string,
  projectId: string,
  taskId: string,
  ownerUserId: string,
): TaskRecord | undefined {
  const task = findTask(workspaceId, projectId, taskId);
  if (!task || task.owner_user_id !== ownerUserId) {
    return undefined;
  }
  return task;
}

async function ensureOwnedLibraryObjectInputs(args: {
  catalogRepo: JsonDocProjectFileLibraryCatalogRepo;
  workspaceId: string;
  projectId: string;
  ownerUserId: string;
  inputs: ReturnType<typeof readTaskInputRefs>;
  json: TaskRouteHandlerArgs['json'];
  res: http.ServerResponse;
}): Promise<boolean> {
  for (const inputRef of args.inputs) {
    if (inputRef.kind !== 'library_object') continue;
    const library = await args.catalogRepo.getById(
      args.workspaceId,
      args.projectId,
      inputRef.library_id,
    );
    if (!library || library.created_by_user_id !== args.ownerUserId) {
      args.json(args.res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'library_object_input_not_found',
        field: 'inputs',
      });
      return false;
    }
  }
  return true;
}

export function resolveTaskWorkspaceMountAccess(input: {
  agentMode: 'external' | 'internal' | null;
  agentConfig?: Record<string, unknown> | null;
  metadataUrl: string;
  storageBucketUrl?: string;
}): {
  metadataUrl: string;
  storageBucketUrl?: string;
} {
  if (input.agentMode === 'external') {
    if (isComposeManagedExternalAgent({ mode: 'external', config: input.agentConfig })) {
      return {
        metadataUrl: resolveFileLibraryMetadataUrlForComposeManagedExternalExecution(input.metadataUrl),
        storageBucketUrl: resolveFileLibraryStorageBucketUrlForComposeManagedExternalExecution(input.storageBucketUrl),
      };
    }
    if (isExternalRunnerRuntime({ mode: 'external', config: input.agentConfig }, 'docker_manual')) {
      return {
        metadataUrl: resolveFileLibraryMetadataUrlForDockerManualExternalExecution(input.metadataUrl),
        storageBucketUrl: resolveFileLibraryStorageBucketUrlForDockerManualExternalExecution(input.storageBucketUrl),
      };
    }
    return {
      metadataUrl: resolveFileLibraryMetadataUrlForExternalExecution(input.metadataUrl),
      storageBucketUrl: resolveFileLibraryStorageBucketUrlForExternalExecution(input.storageBucketUrl),
    };
  }
  if (input.agentMode === 'internal') {
    return {
      metadataUrl: resolveFileLibraryMetadataUrlForInternalExecution(input.metadataUrl),
      storageBucketUrl: resolveFileLibraryStorageBucketUrlForInternalExecution(input.storageBucketUrl),
    };
  }
  return {
    metadataUrl: input.metadataUrl,
    storageBucketUrl: input.storageBucketUrl,
  };
}

function defaultWorkspaceNameFromTaskTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed ? `${trimmed} Workspace` : 'Notebook Workspace';
}

function sanitizeFileLibraryWorkspaceDirName(fileLibraryName: string | undefined, fileLibraryId: string | undefined): string {
  const slug = (fileLibraryName ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (slug) return slug;
  return (fileLibraryId ?? '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48) || 'file-library-workspace';
}

function buildTerminalUsername(user: AuthenticatedUser): string {
  const local = user.email.split('@')[0]?.trim();
  if (local) return local;
  return user.id.trim() || 'unknown_user';
}

async function writeNotebookTaskSseSnapshot(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
  res: http.ServerResponse;
  includeMessages: boolean;
  includeArtifacts: boolean;
  includeTraces: boolean;
}): Promise<void> {
  const currentTask = findTaskForOwner(args.workspaceId, args.projectId, args.taskId, args.userId);
  if (currentTask) {
    writeNotebookTaskSseEvent(args.res, {
      type: 'task_update',
      data: await buildTaskRealtimeView(args.deps, args.workspaceId, args.projectId, currentTask),
    });
  }
  if (args.includeMessages) {
    await loadTaskMessages(args.deps, args.taskId);
    for (const message of getTaskMessages(args.taskId)) {
      writeNotebookTaskSseEvent(args.res, { type: 'message', data: message });
    }
  }
  if (args.includeArtifacts) {
    await loadTaskArtifacts(args.deps, args.taskId);
    for (const artifact of getTaskArtifacts(args.taskId)) {
      writeNotebookTaskSseEvent(args.res, { type: 'artifact', data: artifact });
    }
  }
  if (args.includeTraces) {
    for (const traceEvent of await loadTaskTraceEvents(args.deps, args.workspaceId, args.taskId)) {
      writeNotebookTaskSseEvent(args.res, { type: 'trace_event', data: traceEvent });
    }
  }
}

export async function hasBlockingTaskRunForTerminal(
  cache: NodeApiDeps['cache'],
  taskId: string,
): Promise<boolean> {
  const sharedState = await getNotebookTaskRunState(cache, taskId);
  if (!sharedState) {
    ACTIVE_RUNS_BY_TASK.delete(taskId);
    return false;
  }
  return true;
}

export async function hasBlockingTerminalSessionsForTask(args: {
  terminalService: NodeApiDeps['notebookTerminalService'];
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
}): Promise<boolean> {
  const liveSessionLookup = args.terminalService as NodeApiDeps['notebookTerminalService'] & {
    hasLiveSessionsForTask?: (input: {
      workspaceId: string;
      projectId: string;
      taskId: string;
      userId: string;
    }) => Promise<boolean>;
  };
  if (typeof liveSessionLookup.hasLiveSessionsForTask === 'function') {
    return liveSessionLookup.hasLiveSessionsForTask({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      taskId: args.taskId,
      userId: args.userId,
    });
  }
  const sessions = await args.terminalService.listSessionsForTask({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.taskId,
    userId: args.userId,
  });
  return sessions.some((session) => (
    session.status === 'pending' || session.status === 'active' || session.status === 'disconnected'
  ));
}

export function resolveTerminalWebSocketBaseUrl(req: http.IncomingMessage): string {
  const configuredApiBase = resolveConfiguredPublicApiBase();
  const requestUrl = configuredApiBase ?? resolvePublicBaseUrl(req).replace(/\/+$/, '');
  try {
    const parsed = new URL(requestUrl);
    if (parsed.protocol === 'https:') {
      return `wss://${parsed.host}`;
    }
    if (parsed.protocol === 'http:') {
      return `ws://${parsed.host}`;
    }
  } catch {
    // fall through to legacy string handling below
  }
  if (requestUrl.startsWith('https://')) {
    return `wss://${requestUrl.slice('https://'.length)}`;
  }
  if (requestUrl.startsWith('http://')) {
    return `ws://${requestUrl.slice('http://'.length)}`;
  }
  return requestUrl;
}

export function mapRunnerSessionAuthorityToTaskRouteError(
  authority: RunnerSessionDispatchAuthority,
): string | null {
  return authority === 'remote_owned_not_local_dispatchable' ? 'task_runner_remote_owned' : null;
}

function serializeTerminalSessionResponse(input: {
  session: {
    id: string;
    status: 'pending' | 'active' | 'disconnected' | 'closed' | 'failed';
    cols: number;
    rows: number;
    createdAt: string;
    lastActivityAt: string;
    endedAt?: string;
    closeReason?: string;
    exitCode?: number | null;
  };
  wsUrl: string | null;
}): {
  id: string;
  status: 'pending' | 'active' | 'disconnected' | 'closed' | 'failed';
  cols: number;
  rows: number;
  created_at: string;
  last_activity_at: string;
  ended_at: string | null;
  close_reason: string | null;
  exit_code: number | null;
  ws_url: string | null;
} {
  return {
    id: input.session.id,
    status: input.session.status,
    cols: input.session.cols,
    rows: input.session.rows,
    created_at: input.session.createdAt,
    last_activity_at: input.session.lastActivityAt,
    ended_at: input.session.endedAt ?? null,
    close_reason: input.session.closeReason ?? null,
    exit_code: input.session.exitCode ?? null,
    ws_url: input.wsUrl,
  };
}

async function buildTaskTerminalExecutionContext(args: {
  deps: NodeApiDeps;
  task: TaskRecord;
  user: AuthenticatedUser;
  agent: { mode: 'external' | 'internal'; config?: Record<string, unknown> | null };
  publicBaseUrl: string;
}): Promise<Record<string, unknown>> {
  const taskInputs = await buildNotebookTaskInputs({
    deps: args.deps,
    workspaceId: args.task.workspace_id,
    projectId: args.task.project_id,
    taskId: args.task.id,
    attachedInputs: args.task.attached_inputs as NotebookTaskInputRefRecord[],
    debugLog: debugNotebookExecution,
  });
  const workspaceLibrary = args.task.workspace_file_library_id
    ? await new JsonDocProjectFileLibraryCatalogRepo(args.deps.docStore).getById(
      args.task.workspace_id,
      args.task.project_id,
      args.task.workspace_file_library_id,
    )
    : null;
  const executionTicket = await issueInternalTicket(args.deps.cache, {
    purpose: 'agent_execution',
    userId: args.user.id,
    prefix: 'exec',
    workspaceId: args.task.workspace_id,
    projectId: args.task.project_id,
    payload: {
      endpoint_id: 'terminal',
      task_id: args.task.id,
      session_id: args.task.id,
      agent_id: args.task.agent_id,
      mode: 'notebook',
    },
    ttlMs: 8 * 60 * 60 * 1000,
    maxUses: 500,
  });

  return {
    interaction_kind: 'notebook',
    workspace_id: args.task.workspace_id,
    project_id: args.task.project_id,
    task_id: args.task.id,
    session_id: args.task.id,
    username: buildTerminalUsername(args.user),
    api_base: resolveExecutionApiBase(args.publicBaseUrl, args.agent),
    execution_ticket: executionTicket.ticket,
    workspace_binding_mode: args.agent.mode === 'internal' ? 'pre_mounted' : 'file_library',
    workspace_path: args.agent.mode === 'internal' ? `/workspace/${args.task.id}` : undefined,
    workspace_file_library_id: args.task.workspace_file_library_id ?? null,
    workspace_file_library_name: args.task.workspace_file_library_name ?? null,
    workspace_dir_name: workspaceLibrary?.filesystem_name
      ?? sanitizeFileLibraryWorkspaceDirName(args.task.workspace_file_library_name, args.task.workspace_file_library_id),
    task_inputs: taskInputs,
  };
}

function findActiveTaskUsingWorkspace(
  workspaceId: string,
  projectId: string,
  fileLibraryId: string,
): TaskRecord | undefined {
  return getTasks(workspaceId, projectId).find((task) => (
    task.status === 'active' && task.workspace_file_library_id === fileLibraryId
  ));
}

async function maybeReleaseInternalAgentWorkload(
  deps: NodeApiDeps,
  identity: InternalTaskWorkloadIdentity,
  options?: {
    force?: boolean;
  },
): Promise<void> {
  const agent = await deps.agentResourceService.getAgent(
    identity.workspaceId,
    identity.projectId,
    identity.agentId,
  );
  if (!agent || agent.mode !== 'internal') return;
  if (!options?.force) {
    const hasLiveTerminalHolders = await hasBlockingTerminalSessionsForTask({
      terminalService: deps.notebookTerminalService,
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      taskId: identity.taskId,
      userId: identity.userId,
    });
    if (hasLiveTerminalHolders) {
      return;
    }
    if (await hasBlockingTaskRunForTerminal(deps.cache, identity.taskId)) {
      return;
    }
  }
  const internalWorkloadCoordinator = resolveInternalWorkloadCoordinator(deps);
  if (internalWorkloadCoordinator) {
    await internalWorkloadCoordinator.requestHardTeardown({
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      workloadId: sanitizeWorkloadId(identity.taskId),
    }).catch((err: unknown) => {
      console.warn(
        '[sandbox] requestHardTeardown failed for task %s: %s',
        identity.taskId,
        err instanceof Error ? err.message : err,
      );
    });
    return;
  }
  if (!deps.internalAgentPodManager) return;
  await deps.internalAgentPodManager.releasePod(
    identity.workspaceId,
    identity.projectId,
    sanitizeWorkloadId(identity.taskId),
  ).catch((err: unknown) => {
    console.warn('[sandbox] releasePod failed for task %s: %s', identity.taskId, err instanceof Error ? err.message : err);
  });
}

async function requestNotebookRunHardTeardown(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  const workloadId = sanitizeWorkloadId(input.taskId);
  const key = `${input.workspaceId}/${input.projectId}/${workloadId}/${input.runId}`;
  let promise = notebookRunHardTeardownInFlight.get(key);
  if (!promise) {
    const internalWorkloadCoordinator = resolveInternalWorkloadCoordinator(input.deps);
    promise = internalWorkloadCoordinator
      ? internalWorkloadCoordinator.requestHardTeardown({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        workloadId,
        epoch: input.runId,
      })
      : Promise.resolve();
    notebookRunHardTeardownInFlight.set(key, promise);
    void promise.then(
      () => {
        if (notebookRunHardTeardownInFlight.get(key) === promise) {
          notebookRunHardTeardownInFlight.delete(key);
        }
      },
      () => {
        if (notebookRunHardTeardownInFlight.get(key) === promise) {
          notebookRunHardTeardownInFlight.delete(key);
        }
      },
    );
  }
  await promise;
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildNotebookHardTeardownDebtStopResponse(input: {
  deps: NodeApiDeps;
  agent: { mode?: 'external' | 'internal' } | null | undefined;
  taskId: string;
  debt: NotebookTaskRunHardTeardownDebtRecord;
}): {
  status: 'terminating';
  task_id: string;
  run_id: string;
  request_id: string | null;
  stop_mode: 'terminate';
  can_escalate: false;
  escalation_reason: NotebookRunStopEscalationReason;
} {
  return {
    status: 'terminating',
    task_id: input.taskId,
    run_id: input.debt.run_id,
    request_id: input.debt.request_id ?? null,
    stop_mode: 'terminate',
    can_escalate: false,
    escalation_reason: canRequestNotebookRunHardTerminate(input.deps, input.agent)
      ? 'already_terminating'
      : input.agent?.mode === 'internal' ? 'unmanaged_runner' : 'unsupported_runner',
  };
}

async function dispatchNotebookRunHardTeardown(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  taskId: string;
  runId: string;
}): Promise<void> {
  const attemptedAt = nowIso();
  await markNotebookTaskRunHardTeardownRequested(input.deps.cache, {
    taskId: input.taskId,
    runId: input.runId,
    requestedAt: attemptedAt,
  });
  const claimedDebt = await getNotebookTaskRunHardTeardownDebt(input.deps.cache, input.taskId);
  const claimedState = await getNotebookTaskRunState(input.deps.cache, input.taskId);
  const claimedHardTeardown = claimedState?.run_id === input.runId
    ? claimedState.stop?.hard_teardown
    : undefined;
  const attemptId = claimedDebt?.run_id === input.runId
    ? claimedDebt.attempt_id ?? claimedHardTeardown?.attempt_id
    : claimedHardTeardown?.attempt_id;
  const generation = claimedDebt?.run_id === input.runId
    ? claimedDebt.attempt_count ?? claimedHardTeardown?.attempt_count
    : claimedHardTeardown?.attempt_count;
  if (!attemptId) {
    return;
  }
  try {
    await requestNotebookRunHardTeardown(input);
    await markNotebookTaskRunHardTeardownReleased(input.deps.cache, {
      taskId: input.taskId,
      runId: input.runId,
      releasedAt: nowIso(),
      attemptId,
      ...(typeof generation === 'number' ? { generation } : {}),
    });
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    await markNotebookTaskRunHardTeardownFailed(input.deps.cache, {
      taskId: input.taskId,
      runId: input.runId,
      attemptedAt,
      errorMessage,
      attemptId,
      ...(typeof generation === 'number' ? { generation } : {}),
    });
    console.warn(
      '[sandbox] requestHardTeardown failed for task %s: %s',
      input.taskId,
      errorMessage,
    );
  }
}

function ensureInternalTerminalLifecycleIntegration(deps: NodeApiDeps): void {
  if (!deps.notebookTerminalService) {
    return;
  }
  const service = deps.notebookTerminalService as NodeApiDeps['notebookTerminalService'] & {
    registerLifecycleHooks?: (key: string, hooks: {
      onSessionCreated?: (session: {
        workspaceId: string;
        projectId: string;
        taskId: string;
        userId: string;
        agentId: string;
      }) => void | Promise<void>;
      onSessionClosed?: (session: {
        workspaceId: string;
        projectId: string;
        taskId: string;
        userId: string;
        agentId: string;
      }) => void | Promise<void>;
    }) => void;
  };
  if (typeof service.registerLifecycleHooks !== 'function') {
    return;
  }
  if (registeredInternalTerminalLifecycleServices.has(service)) {
    return;
  }
  service.registerLifecycleHooks('task_route_handler_internal_terminal_workload', {
    onSessionClosed: async (session) => {
      await maybeReleaseInternalAgentWorkload(deps, {
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        taskId: session.taskId,
        userId: session.userId,
        agentId: session.agentId,
      });
    },
  });
  registeredInternalTerminalLifecycleServices.add(service);
}

export function __resetInternalTerminalWorkloadLifecycleForTests(): void {
  registeredInternalTerminalLifecycleServices.clear();
  notebookRunHardTeardownInFlight.clear();
  resetInternalWorkloadHolderCoordinatorForTests();
}

async function streamTaskArtifactFromWorkspaceLibrary(args: {
  deps: NodeApiDeps;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  artifact: {
    title?: string;
    task_relative_path?: string;
    mime_type?: string;
  };
}): Promise<boolean> {
  const libraryId = args.task.workspace_file_library_id?.trim();
  const relativePath = args.artifact.task_relative_path?.trim();
  if (!libraryId || !relativePath) {
    return false;
  }
  const library = await getProjectFileLibraryRecord({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    libraryId,
  });
  if (!library || library.created_by_user_id !== args.task.owner_user_id) {
    return false;
  }
  const objectPath = normalizeFileLibraryPath(relativePath);
  if (!objectPath) {
    return false;
  }
  const operation = createHttpOperationEnvelope({
    req: args.req,
    res: args.res,
  });
  let handedOffToStream = false;
  try {
    const client = await awaitAbortableOperation(
      createFileLibraryGatewayClient({
        deps: args.deps,
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        libraryId,
        filesystemName: library.filesystem_name,
        signal: operation.signal,
      }),
      {
        signal: operation.signal,
        abortMessage: 'task_artifact_download_aborted',
      },
    );
    const bucket = fileLibraryBucketName(library.filesystem_name);
    const stat = await awaitAbortableOperation(
      client.statObject(bucket, objectPath),
      {
        signal: operation.signal,
        abortMessage: 'task_artifact_download_aborted',
      },
    );
    const download = await openGatewayObjectDownload(client, bucket, objectPath, {
      signal: operation.signal,
    });
    if (operation.signal.aborted) {
      await download.cancel(operation.signal.reason);
      return true;
    }
    const filename = (args.artifact.title?.trim() || objectPath.split('/').at(-1) || 'artifact');
    args.res.statusCode = 200;
    args.res.setHeader(
      'Content-Type',
      stat.metaData?.['content-type'] ?? args.artifact.mime_type?.trim() ?? guessFileLibraryContentType(objectPath) ?? 'application/octet-stream',
    );
    args.res.setHeader('Content-Length', String(stat.size));
    args.res.setHeader('Content-Disposition', buildAttachmentContentDisposition(filename));
    pipeGatewayDownloadToHttpResponse({
      req: args.req,
      res: args.res,
      download,
      streamErrorMessage: 'task_artifact_download_stream_failed',
    });
    handedOffToStream = true;
    return true;
  } catch (error) {
    if (operation.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return true;
    }
    throw error;
  } finally {
    if (!handedOffToStream) {
      operation.cleanup();
    }
  }
}

async function ensureExternalTaskRunnerSessionDispatchable(args: {
  deps: NodeApiDeps;
  agentId: string;
  sessionId: string;
  json: TaskRouteHandlerArgs['json'];
  res: http.ServerResponse;
}): Promise<boolean> {
  const authority = await args.deps.agentExecutionService.getAgentSessionDispatchAuthority(args.agentId, args.sessionId);
  const authorityError = mapRunnerSessionAuthorityToTaskRouteError(authority);
  if (authorityError) {
    args.json(args.res, 409, { error_code: 'RESOURCE_CONFLICT', message: authorityError });
    return false;
  }
  if (
    authority === 'offline'
    && !args.deps.agentExecutionService.getAgentSessionOnlineState(args.agentId, args.sessionId)
    && !args.deps.agentExecutionService.getAgentOnlineState(args.agentId)
  ) {
    args.json(args.res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'task_runner_offline' });
    return false;
  }
  return true;
}

export async function handleTaskRoute(args: TaskRouteHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, internalTicket, json, readBody } = args;
  ensureInternalTerminalLifecycleIntegration(deps);
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

    const all = listTasksForOwner(route.workspaceId, route.projectId, user.id)
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
    const workspaceMode = typeof body.workspace_mode === 'string' ? body.workspace_mode.trim() : '';
    const workspaceFileLibraryId = typeof body.workspace_file_library_id === 'string'
      ? body.workspace_file_library_id.trim()
      : '';
    const requestedWorkspaceName = typeof body.workspace_name === 'string' ? body.workspace_name.trim() : '';
    if (!title) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'task_title_required' });
      return true;
    }
    if (!agentId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_id_required' });
      return true;
    }
    if (workspaceMode !== 'create_new' && !workspaceFileLibraryId) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'workspace_file_library_id_required' });
      return true;
    }

    const agent = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, agentId);
    if (!agent || agent.status !== 'enabled' || agent.interaction_kind === 'chat') {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found_or_not_notebook_compatible' });
      return true;
    }
    if (agent.mode === 'external' && agent.presence !== 'online') {
      json(res, 409, { error_code: 'AGENT_OFFLINE', message: 'agent_offline' });
      return true;
    }
    let workspaceFileLibrary = workspaceFileLibraryId
      ? await catalogRepo.getById(route.workspaceId, route.projectId, workspaceFileLibraryId)
      : null;
    if (workspaceMode === 'create_new') {
      try {
        workspaceFileLibrary = await createAndProvisionProjectFileLibrary({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          userId: user.id,
          name: requestedWorkspaceName || defaultWorkspaceNameFromTaskTitle(title),
          description: `Auto-initialized workspace for notebook task "${title}".`,
        });
      } catch (error) {
        const mapped = mapFileLibraryInfraError(error);
        json(res, mapped.statusCode, {
          error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
            ? 'FILE_LIBRARY_PROVISIONING_FAILED'
            : mapped.errorCode,
          message: mapped.message,
        });
        return true;
      }
    }
    if (!workspaceFileLibrary) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
      return true;
    }
    if (workspaceFileLibrary.created_by_user_id !== user.id) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
      return true;
    }
    if (workspaceFileLibrary.status !== 'ready') {
      json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'file_library_not_ready' });
      return true;
    }
    const activeTask = findActiveTaskUsingWorkspace(
      route.workspaceId,
      route.projectId,
      workspaceFileLibrary.id,
    );
    if (activeTask) {
      json(res, 409, {
        error_code: 'RESOURCE_CONFLICT',
        message: 'workspace_file_library_in_use',
      });
      return true;
    }

    const createdAt = nowIso();
    const initialInputs = readTaskInputRefs(body.initial_inputs);
    if (!(await ensureOwnedLibraryObjectInputs({
      catalogRepo,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      ownerUserId: user.id,
      inputs: initialInputs,
      json,
      res,
    }))) {
      return true;
    }
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
      attached_inputs: initialInputs,
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
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    json(res, 200, await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task));
    return true;
  }

  if (route.kind === 'taskTerminalSessions' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    if (task.status !== 'active') {
      json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'task_not_active' });
      return true;
    }
    if (await getNotebookTaskRunHardTeardownDebt(deps.cache, task.id)) {
      json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'task_run_hard_teardown_pending' });
      return true;
    }
    if (await hasBlockingTaskRunForTerminal(deps.cache, task.id)) {
      json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'task_run_in_progress' });
      return true;
    }
    const body = asObject(await readBody(req));
    const cols = typeof body.cols === 'number' && Number.isFinite(body.cols) ? Math.floor(body.cols) : 120;
    const rows = typeof body.rows === 'number' && Number.isFinite(body.rows) ? Math.floor(body.rows) : 30;
    const shell = typeof body.shell === 'string' ? body.shell.trim() : '';
    const agent = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, task.agent_id);
    if (!agent || agent.status !== 'enabled') {
      json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'task_agent_not_available' });
      return true;
    }
    if (agent.mode === 'internal') {
      if (!deps.internalAgentPodManager || !deps.internalAgentWorkspaceBindingManager || !task.workspace_file_library_id) {
        json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'task_terminal_internal_runtime_unavailable' });
        return true;
      }
      const workspaceBinding = await deps.internalAgentWorkspaceBindingManager.ensureWorkspaceBinding({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        fileLibraryId: task.workspace_file_library_id,
        taskId: task.id,
      });
      await deps.internalAgentPodManager.ensureAgentReady({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        workloadId: sanitizeWorkloadId(task.id),
        sessionId: task.id,
        agent,
        workspaceMount: workspaceBinding.workspaceMount,
      });
    } else if (!(await ensureExternalTaskRunnerSessionDispatchable({
      deps,
      agentId: agent.id,
      sessionId: task.id,
      json,
      res,
    }))) {
      return true;
    }

    const executionContext = await buildTaskTerminalExecutionContext({
      deps,
      task,
      user,
      agent,
      publicBaseUrl: resolveRequiredConfiguredPublicApiBase(),
    });
    let created: Awaited<ReturnType<typeof deps.notebookTerminalService.createSession>>;
    try {
      created = await deps.notebookTerminalService.createSession({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        taskId: task.id,
        agentId: task.agent_id,
        runnerSessionId: task.id,
        userId: user.id,
        cols,
        rows,
        ...(shell ? { shell } : {}),
        executionContext,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'task_terminal_session_create_failed';
      if (message === 'task_terminal_session_limit_reached') {
        json(res, 409, { error_code: 'RESOURCE_CONFLICT', message });
        return true;
      }
      throw error;
    }
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'notebook.task.terminal.opened',
      resourceType: 'notebook_task_terminal_session',
      resourceId: created.sessionId,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
      metadata: {
        task_id: task.id,
        agent_id: task.agent_id,
        runner_mode: agent.mode,
        cols,
        rows,
        ...(shell ? { shell } : {}),
      },
    });
    json(res, 201, {
      session_id: created.sessionId,
      status: 'pending',
      ws_url: `${resolveTerminalWebSocketBaseUrl(req)}${created.wsPath}`,
    });
    return true;
  }

  if (route.kind === 'taskTerminalSessions' && method === 'GET') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const sessions = await deps.notebookTerminalService.listSessionsForTask({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: route.taskId,
      userId: user.id,
    });
    const items = await Promise.all(sessions.map(async (session) => {
      const reconnectIssued = (
        session.status === 'pending'
        || session.status === 'active'
        || session.status === 'disconnected'
      ) ? await deps.notebookTerminalService.issueReconnectTicket(session.id) : null;
      return serializeTerminalSessionResponse({
        session,
        wsUrl: reconnectIssued ? `${resolveTerminalWebSocketBaseUrl(req)}${reconnectIssued.wsPath}` : null,
      });
    }));
    res.setHeader('Cache-Control', 'no-store');
    json(res, 200, {
      total: items.length,
      items,
    });
    return true;
  }

  if (route.kind === 'taskTerminalSession' && method === 'GET') {
    const session = await deps.notebookTerminalService.getSessionWithinScope({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: route.taskId,
      userId: user.id,
      sessionId: route.terminalSessionId,
    });
    if (!session) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_terminal_session_not_found' });
      return true;
    }
    const reconnectIssued = (session.status === 'pending' || session.status === 'active' || session.status === 'disconnected')
      ? await deps.notebookTerminalService.issueReconnectTicket(session.id)
      : null;
    res.setHeader('Cache-Control', 'no-store');
    json(res, 200, serializeTerminalSessionResponse({
      session,
      wsUrl: reconnectIssued ? `${resolveTerminalWebSocketBaseUrl(req)}${reconnectIssued.wsPath}` : null,
    }));
    return true;
  }

  if (route.kind === 'taskTerminalSession' && method === 'DELETE') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const deleted = await deps.notebookTerminalService.deleteSession({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: route.taskId,
      userId: user.id,
      sessionId: route.terminalSessionId,
    });
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_terminal_session_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'taskWorkspaceAccess' && method === 'POST') {
    if (internalTicket && !isAgentExecutionTicket(internalTicket)) {
      json(res, 403, {
        error_code: 'INTERNAL_TICKET_PURPOSE_MISMATCH',
        message: 'internal_ticket_purpose_mismatch',
      });
      return true;
    }
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const effectiveUserId = isAgentExecutionTicket(internalTicket) ? internalTicket.user_id : user.id;
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, effectiveUserId);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    if (isAgentExecutionTicket(internalTicket)) {
      const payload = internalTicket.payload;
      if (
        internalTicket.workspace_id !== route.workspaceId
        || internalTicket.project_id !== route.projectId
        || payload.task_id !== route.taskId
        || internalTicket.user_id !== task.owner_user_id
      ) {
        json(res, 403, {
          error_code: 'INTERNAL_TICKET_SCOPE_MISMATCH',
          message: 'internal_ticket_scope_mismatch',
        });
        return true;
      }
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
    if (!workspaceFileLibrary || workspaceFileLibrary.created_by_user_id !== effectiveUserId) {
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
    const agent = await deps.agentResourceService.getAgent(
      route.workspaceId,
      route.projectId,
      task.agent_id,
    );
    const executionMountAccess = resolveTaskWorkspaceMountAccess({
      agentMode: agent?.mode ?? null,
      agentConfig: agent?.config,
      metadataUrl: mountAccess.metadata_url,
      storageBucketUrl: mountAccess.storage_bucket_url,
    });
    json(res, 200, {
      task_id: task.id,
      workspace_binding_mode: 'file_library',
      container_workspace_path: agent?.mode === 'internal' ? `/workspace/${task.id}` : null,
      library_root_path: '.',
      workspace_dir_name: workspaceFileLibrary.filesystem_name,
      file_library_id: workspaceFileLibrary.id,
      file_library_name: workspaceFileLibrary.name,
      filesystem_name: mountAccess.filesystem_name,
      metadata_url: executionMountAccess.metadataUrl,
      storage_bucket_url: executionMountAccess.storageBucketUrl,
      recommended_mount_path: mountAccess.recommended_mount_path,
      created_at: mountAccess.created_at,
    });
    return true;
  }

  if (route.kind === 'taskItem' && method === 'PATCH') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
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
      await maybeReleaseInternalAgentWorkload(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        taskId: task.id,
        userId: task.owner_user_id,
        agentId: task.agent_id,
      }, {
        force: true,
      });
    }
    json(res, 200, task);
    return true;
  }

  if (route.kind === 'taskItem' && method === 'DELETE') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const tasks = getTasks(route.workspaceId, route.projectId);
    const index = tasks.findIndex((item) => item.id === route.taskId && item.owner_user_id === user.id);
    if (index < 0) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    if (await getNotebookTaskRunState(deps.cache, route.taskId)) {
      json(res, 409, {
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_run_in_progress',
      });
      return true;
    }
    if (await hasBlockingTerminalSessionsForTask({
      terminalService: deps.notebookTerminalService,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: route.taskId,
      userId: user.id,
    })) {
      json(res, 409, {
        error_code: 'RESOURCE_CONFLICT',
        message: 'task_terminal_sessions_active',
      });
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
      await maybeReleaseInternalAgentWorkload(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        taskId: removedTask.id,
        userId: removedTask.owner_user_id,
        agentId: removedTask.agent_id,
      }, {
        force: true,
      });
    }
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'taskInputs' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const inputs = readTaskInputRefs(body.inputs);
    if (!(await ensureOwnedLibraryObjectInputs({
      catalogRepo,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      ownerUserId: user.id,
      inputs,
      json,
      res,
    }))) {
      return true;
    }
    for (const inputRef of inputs) {
      if (inputRef.kind !== 'artifact') continue;
      const sourceTask = findTaskForOwner(route.workspaceId, route.projectId, inputRef.task_id, user.id);
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
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
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
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
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
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    json(res, 200, getTaskMessages(route.taskId));
    return true;
  }

  if (route.kind === 'taskTraces' && method === 'GET') {
    const traceQueryStart = Date.now();
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
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
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const content = typeof body.content === 'string' ? body.content : '';
    const role = body.role === 'agent' ? 'agent' : 'user';
    let runId: string | null = null;
    let sharedRunState = null as ReturnType<typeof buildNotebookTaskRunState> | null;
    let runLaunchCommitted = false;
    let localRunTrackingReleased = false;
    let sharedRunControlCleared = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let cancelSyncTimer: NodeJS.Timeout | undefined;
    let startupAbortController: AbortController | undefined;
    const clearLocalRunHandle = (input?: { preserveCancelMarker?: boolean }): void => {
      const active = ACTIVE_RUN_CANCEL_BY_TASK.get(route.taskId);
      if (!active || active.runId === runId) {
        ACTIVE_RUN_CANCEL_BY_TASK.delete(route.taskId);
      }
      if (!input?.preserveCancelMarker) {
        const localMarker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(route.taskId);
        if (!localMarker || localMarker.runId === runId) {
          ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(route.taskId);
        }
      }
      ACTIVE_RUNS_BY_TASK.delete(route.taskId);
    };
    const releaseLocalRunTracking = (input?: { preserveCancelMarker?: boolean }): void => {
      if (role !== 'user' || localRunTrackingReleased) return;
      localRunTrackingReleased = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (cancelSyncTimer) clearInterval(cancelSyncTimer);
      clearLocalRunHandle(input);
    };
    const finalizeAcquiredRun = async (input?: {
      clearSharedControl?: boolean;
    }): Promise<void> => {
      if (role !== 'user' || !runId) return;
      releaseLocalRunTracking();
      if (!input?.clearSharedControl || sharedRunControlCleared) {
        return;
      }
      sharedRunControlCleared = true;
      try {
        await finalizeNotebookTaskRun(deps.cache, {
          taskId: route.taskId,
          runId,
        });
      } catch (error) {
        debugNotebookExecution('task_run_finalize_cleanup_failed', {
          task_id: route.taskId,
          run_id: runId,
          error: error instanceof Error ? error.message : 'finalize_failed',
        });
      }
    };
    if (role === 'user') {
      const hardTeardownDebt = await getNotebookTaskRunHardTeardownDebt(deps.cache, route.taskId);
      if (hardTeardownDebt) {
        json(res, 409, {
          error_code: 'TASK_STREAM_CONFLICT',
          message: 'task_stream_conflict',
          reason: 'hard_teardown_pending',
          hard_teardown_status: hardTeardownDebt.status,
        });
        return true;
      }
      if (await hasBlockingTerminalSessionsForTask({
        terminalService: deps.notebookTerminalService,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        taskId: route.taskId,
        userId: user.id,
      })) {
        json(res, 409, {
          error_code: 'RESOURCE_CONFLICT',
          message: 'task_terminal_sessions_active',
        });
        return true;
      }
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
        const blockingDebt = await getNotebookTaskRunHardTeardownDebt(deps.cache, route.taskId);
        json(res, 409, {
          error_code: 'TASK_STREAM_CONFLICT',
          message: 'task_stream_conflict',
          ...(blockingDebt
            ? {
                reason: 'hard_teardown_pending',
                hard_teardown_status: blockingDebt.status,
              }
            : {}),
        });
        return true;
      }
    }
    try {
      const message: TaskMessageRecord = {
        id: buildId('msg'),
        task_id: route.taskId,
        role,
        content,
        created_at: nowIso(),
      };
      await deps.docStore.upsert<TaskMessageRecord>(notebookTaskMessagesCollection(route.workspaceId), message.id, message);
      getTaskMessages(route.taskId).push(message);
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
        await deps.docStore.upsert<TaskMessageRecord>(notebookTaskMessagesCollection(route.workspaceId), assistantMessage.id, assistantMessage);
        getTaskMessages(route.taskId).push(assistantMessage);
        updateTaskActivity(task);
        await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
        ACTIVE_RUNS_BY_TASK.add(route.taskId);
        const previousActive = ACTIVE_RUN_CANCEL_BY_TASK.get(route.taskId);
        if (previousActive && previousActive.runId !== runId) {
          ACTIVE_RUN_CANCEL_BY_TASK.delete(route.taskId);
        }
        const previousMarker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(route.taskId);
        if (previousMarker && previousMarker.runId !== runId) {
          ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(route.taskId);
        }
        startupAbortController = new AbortController();

        const abortStartupRun = (): void => {
          if (!startupAbortController?.signal.aborted) {
            startupAbortController?.abort('user_cancel_requested');
          }
          clearLocalRunHandle({ preserveCancelMarker: true });
        };

        ACTIVE_RUN_CANCEL_BY_TASK.set(route.taskId, {
          runId,
          requestId: null,
          cancel: abortStartupRun,
          requestCancel: () => {
            const requestedAt = nowIso();
            ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(route.taskId, {
              runId,
              requestedAt,
            });
            void requestNotebookTaskRunStop(deps.cache, {
              taskId: route.taskId,
              runId,
              mode: 'cancel',
              requestedAt,
              actorUserId: user.id,
              delivery: 'owner_attached',
            });
            abortStartupRun();
          },
        });

        const syncSharedStopRequest = async (): Promise<boolean> => {
          const marker = await getNotebookTaskRunStopRequestForRun(deps.cache, {
            taskId: route.taskId,
            runId,
          });
          if (!marker) {
            return false;
          }
          const localMarker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(route.taskId);
          const alreadyDelivered = (
            localMarker?.runId === runId
            && localMarker.requestedAt === marker.requested_at
          );
          if (!alreadyDelivered) {
            ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(route.taskId, {
              runId,
              requestedAt: marker.requested_at,
            });
            const active = ACTIVE_RUN_CANCEL_BY_TASK.get(route.taskId);
            if (active && active.runId === runId) {
              active.cancel();
            }
          }
          return true;
        };

        heartbeatTimer = setInterval(() => {
          sharedRunState = {
            ...sharedRunState,
            heartbeat_at: nowIso(),
          };
          void refreshNotebookTaskRunLease(deps.cache, sharedRunState).catch(() => undefined);
        }, NOTEBOOK_RUN_LEASE_HEARTBEAT_MS);
        cancelSyncTimer = setInterval(() => {
          void syncSharedStopRequest().catch(() => undefined);
        }, NOTEBOOK_RUN_CANCEL_POLL_MS);

        const runPromise = runNotebookTaskWithExecutionAgent({
          deps,
          task,
          assistantMessage,
          agentId: task.agent_id,
          user,
          publicBaseUrl: resolveRequiredConfiguredPublicApiBase(),
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
            const currentActive = ACTIVE_RUN_CANCEL_BY_TASK.get(taskId);
            const currentMarker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(taskId);
            if (
              startupAbortController?.signal.aborted
              || (currentActive && currentActive.runId !== runId)
              || (currentMarker && currentMarker.runId !== runId)
            ) {
              cancel();
              return false;
            }
            ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(taskId);
            ACTIVE_RUN_CANCEL_BY_TASK.set(taskId, {
              runId,
              requestId,
              cancel,
              requestCancel: () => {
                const requestedAt = nowIso();
                ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(taskId, { runId, requestedAt });
                void requestNotebookTaskRunStop(deps.cache, {
                  taskId,
                  runId,
                  mode: 'cancel',
                  requestedAt,
                  actorUserId: user.id,
                  delivery: 'owner_attached',
                });
                cancel();
              },
            });
            const dispatchedAt = nowIso();
            sharedRunState = {
              ...sharedRunState,
              request_id: requestId,
              dispatched_at: dispatchedAt,
              heartbeat_at: dispatchedAt,
            };
            void markNotebookTaskRunDispatched(deps.cache, {
              taskId,
              runId,
              requestId,
              dispatchedAt,
            });
            void syncSharedStopRequest();
            return true;
          },
          onFinalize: async (_taskId, finalizedRunId, summary) => {
            if (finalizedRunId !== runId) return;
            if (summary.durableTerminalTruth) {
              await finalizeAcquiredRun({ clearSharedControl: true });
              return;
            }
            await finalizeAcquiredRun({ clearSharedControl: false });
          },
          startupSignal: startupAbortController.signal,
          isCancellationRequested: async () => {
            const marker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(route.taskId);
            if (marker?.runId === runId) {
              return true;
            }
            try {
              return await syncSharedStopRequest();
            } catch {
              return false;
            }
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
        runLaunchCommitted = true;
        void runPromise.catch(async (error) => {
          debugNotebookExecution('task_run_promise_rejected', {
            task_id: route.taskId,
            run_id: runId,
            error: error instanceof Error ? error.message : 'run_promise_rejected',
          });
          const currentRunState = runId
            ? await getNotebookTaskRunState(deps.cache, route.taskId)
            : null;
          const shouldClearSharedControl = Boolean(
            runId
            && !sharedRunState?.request_id
            && currentRunState
            && currentRunState.run_id === runId
            && currentRunState.phase !== 'finalizing',
          );
          await finalizeAcquiredRun({ clearSharedControl: shouldClearSharedControl });
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
    } catch (error) {
      if (!runLaunchCommitted) {
        await finalizeAcquiredRun({ clearSharedControl: true });
      }
      throw error;
    }
  }

  if (route.kind === 'taskCancelRun' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const requestedMode = parseNotebookRunStopMode(body.mode);
    if (!requestedMode) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'task_run_stop_mode_invalid',
        field: 'mode',
      });
      return true;
    }
    const active = ACTIVE_RUN_CANCEL_BY_TASK.get(route.taskId);
    const sharedActive = await getNotebookTaskRunState(deps.cache, route.taskId);
    const hardTeardownDebt = await getNotebookTaskRunHardTeardownDebt(deps.cache, route.taskId);
    const hasTerminalHardTeardownDebt = Boolean(
      hardTeardownDebt
      && (
        hardTeardownDebt.status === 'pending'
        || hardTeardownDebt.status === 'failed'
        || hardTeardownDebt.status === 'requested'
      ),
    );
    const hasSharedHardTeardownDebt = hasIncompleteNotebookTaskRunHardTeardown(sharedActive);
    const hasHardTeardownDebt = hasSharedHardTeardownDebt || hasTerminalHardTeardownDebt;
    if (!active && !sharedActive && !hasTerminalHardTeardownDebt) {
      json(res, 409, { error_code: 'TASK_RUN_NOT_ACTIVE', message: 'task_run_not_active' });
      return true;
    }
    if (sharedActive?.phase === 'finalizing' && !hasSharedHardTeardownDebt) {
      json(res, 409, { error_code: 'TASK_RUN_FINALIZING', message: 'task_run_finalizing' });
      return true;
    }
    const agent = await deps.agentResourceService.getAgent(
      route.workspaceId,
      route.projectId,
      task.agent_id,
    );
    const canHardTerminate = canRequestNotebookRunHardTerminate(deps, agent);
    const runId = active?.runId ?? sharedActive?.run_id ?? hardTeardownDebt?.run_id ?? 'unknown';
    const requestId = active?.requestId ?? sharedActive?.request_id ?? hardTeardownDebt?.request_id ?? null;
    if (
      requestedMode === 'terminate'
      && !canHardTerminate
      && sharedActive?.stop?.mode !== 'terminate'
      && !hasTerminalHardTeardownDebt
    ) {
      const reason: Exclude<NotebookRunStopEscalationReason, 'already_terminating'> = (
        agent?.mode === 'internal' ? 'unmanaged_runner' : 'unsupported_runner'
      );
      json(res, 409, buildNotebookRunStopEscalationUnavailableResponse({
        taskId: route.taskId,
        state: sharedActive,
        requestId,
        reason,
      }));
      return true;
    }
    if (hasHardTeardownDebt && !canHardTerminate) {
      const reason: Exclude<NotebookRunStopEscalationReason, 'already_terminating'> = (
        agent?.mode === 'internal' ? 'unmanaged_runner' : 'unsupported_runner'
      );
      if (sharedActive) {
        json(res, 409, buildNotebookRunStopEscalationUnavailableResponse({
          taskId: route.taskId,
          state: sharedActive,
          requestId,
          reason,
        }));
      } else if (hardTeardownDebt) {
        json(res, 409, {
          ...buildNotebookHardTeardownDebtStopResponse({
            deps,
            agent,
            taskId: route.taskId,
            debt: hardTeardownDebt,
          }),
          error_code: 'STOP_ESCALATION_UNAVAILABLE',
          message: 'stop_escalation_unavailable',
          escalation_reason: reason,
        });
      }
      return true;
    }
    const ownerFresh = sharedActive
      ? isNotebookTaskRunOwnerHeartbeatFresh(sharedActive, {
        maxAgeMs: NOTEBOOK_RUN_OWNER_STALE_AFTER_MS,
      })
      : true;
    const shouldAutoTerminateStaleInternal = Boolean(
      !active
      && sharedActive
      && !ownerFresh
      && agent?.mode === 'internal'
      && canHardTerminate,
    );
    const resolvedMode: NotebookTaskRunStopMode = (
      requestedMode === 'terminate'
      || shouldAutoTerminateStaleInternal
      || hasHardTeardownDebt
        ? 'terminate'
        : 'cancel'
    );
    if (!active && sharedActive && !ownerFresh && agent?.mode === 'internal' && !canHardTerminate) {
      json(res, 409, buildNotebookRunStopEscalationUnavailableResponse({
        taskId: route.taskId,
        state: sharedActive,
        requestId,
        reason: 'unmanaged_runner',
      }));
      return true;
    }
    if (!active && sharedActive && !ownerFresh && agent?.mode !== 'internal') {
      json(res, 409, {
        error_code: 'TASK_RUN_OWNER_UNAVAILABLE',
        message: 'task_run_owner_unavailable',
      });
      return true;
    }
    const requestedAt = nowIso();
    const useLocalStartupAbortOnly = Boolean(
      resolvedMode === 'terminate'
      && agent?.mode === 'internal'
      && active?.runId === runId
      && requestId === null
    );
    const delivery = resolvedMode === 'terminate' && agent?.mode === 'internal' && !useLocalStartupAbortOnly
      ? 'internal_teardown_requested'
      : active
        ? 'owner_attached'
        : 'shared_owner';
    if (
      hardTeardownDebt
      && hasTerminalHardTeardownDebt
      && (!sharedActive || sharedActive.run_id !== hardTeardownDebt.run_id)
    ) {
      await dispatchNotebookRunHardTeardown({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        taskId: route.taskId,
        runId: hardTeardownDebt.run_id,
      });
      json(res, 202, buildNotebookHardTeardownDebtStopResponse({
        deps,
        agent,
        taskId: route.taskId,
        debt: hardTeardownDebt,
      }));
      return true;
    }
    const transition = await requestNotebookTaskRunStopTransition(deps.cache, {
      taskId: route.taskId,
      runId,
      mode: resolvedMode,
      requestedAt,
      actorUserId: user.id,
      delivery,
    });
    const stopTruth = transition.state?.stop ?? null;
    if (!transition.state || transition.state.run_id !== runId || !stopTruth) {
      json(res, 409, { error_code: 'TASK_RUN_NOT_ACTIVE', message: 'task_run_not_active' });
      return true;
    }
    const localMarker = ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.get(route.taskId);
    const hasDeliveredLocalStop = (
      localMarker?.runId === runId
      && localMarker.requestedAt === stopTruth.requested_at
    );
    if (active?.runId === runId && !hasDeliveredLocalStop) {
      ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(route.taskId, {
        runId,
        requestedAt: stopTruth.requested_at,
      });
      active.cancel();
    }
    if (
      transition.hardTeardownDispatchRequired
      && stopTruth.mode === 'terminate'
      && stopTruth.delivery === 'internal_teardown_requested'
      && canHardTerminate
    ) {
      await dispatchNotebookRunHardTeardown({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        taskId: route.taskId,
        runId,
      });
    }
    debugNotebookExecution('task_run_cancel_requested', {
      task_id: route.taskId,
      run_id: runId,
      request_id: requestId,
      stop_mode: stopTruth.mode,
      actor_user_id: user.id,
      transition_changed: transition.changed,
    });
    if (transition.changed) {
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
          stop_mode: stopTruth.mode,
        },
      });
    }
    json(res, 202, buildNotebookRunStopTruthResponse({
      deps,
      agent,
      taskId: route.taskId,
      state: transition.state,
      requestId,
    }));
    return true;
  }

  if (route.kind === 'taskArtifacts' && method === 'GET') {
    await loadTaskArtifacts(deps, route.taskId);
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    json(res, 200, getTaskArtifacts(route.taskId));
    return true;
  }

  if (route.kind === 'taskEvents' && method === 'GET') {
    // handled below (kept here only to make route ordering explicit)
  }

  if (route.kind === 'taskArtifactDownload' && method === 'GET') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    await loadTaskArtifacts(deps, route.taskId);
    const artifact = getTaskArtifacts(route.taskId).find((item) => item.id === route.artifactId);
    if (!artifact) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'artifact_not_found' });
      return true;
    }

    const filename = (artifact.title?.trim() || `${artifact.id}`);
    const contentType = artifact.mime_type?.trim() || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Disposition', buildAttachmentContentDisposition(filename));

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

    try {
      if (await streamTaskArtifactFromWorkspaceLibrary({
        deps,
        req,
        res,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        task,
        artifact,
      })) {
        return true;
      }
    } catch {
      // Fall through to the existing explicit unavailable message so callers get a deterministic response.
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('artifact binary download is unavailable: no inline content stored');
    return true;
  }

  if (route.kind === 'taskEvents' && method === 'GET') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const requestUrl = new URL(req.url ?? '', 'http://localhost');
    const lastEventId = requestUrl.searchParams.get('last_event_id')?.trim() || null;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }
    subscribeNotebookTaskEvents(route.taskId, res, { buffered: true });
    const timer = setInterval(() => {
      res.write('event: ping\n');
      res.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
    }, 15_000);
    req.on('close', () => {
      clearInterval(timer);
      unsubscribeNotebookTaskEvents(route.taskId, res);
    });
    try {
      if (lastEventId) {
        const replay = replayBufferedNotebookTaskEvents(res, route.taskId, lastEventId);
        if (replay.status === 'missing') {
          await writeNotebookTaskSseSnapshot({
            deps,
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            taskId: route.taskId,
            userId: user.id,
            res,
            includeMessages: true,
            includeArtifacts: true,
            includeTraces: true,
          });
        }
      } else {
        await writeNotebookTaskSseSnapshot({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          taskId: route.taskId,
          userId: user.id,
          res,
          includeMessages: false,
          includeArtifacts: false,
          includeTraces: true,
        });
      }
      activateNotebookTaskEventSubscription(route.taskId, res);
    } catch (error) {
      clearInterval(timer);
      unsubscribeNotebookTaskEvents(route.taskId, res);
      throw error;
    }
    return true;
  }

  return false;
}
