import type http from 'node:http';
import { assertTaskExecutionContext } from '@mbos/agent-runner';
import type { AuthenticatedUser } from './auth.js';
import type { RunnerSessionDispatchAuthority } from './agent-execution-service.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AgentRecord } from './resource-models.js';
import {
  AgentTaskModelResolutionError,
  AgentTaskModelSettingService,
  type AgentTaskModelResolutionErrorCode,
  type AgentTaskModelResolvedTarget,
  type AgentTaskModelSnapshot,
  resolveAgentTaskModelTarget,
} from './agent-task-model-setting-service.js';
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
  projectNotebookTaskSsePayloadForDisplay,
  projectTaskTraceEventForDisplay,
} from './notebook-task-trace-projection.js';
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
import {
  resolveExecutionApiBase,
  resolveManagedExecutionApiBase,
  runNotebookTaskWithExecutionAgent,
} from './notebook-execution-orchestrator.js';
import {
  resolveConfiguredPublicApiBase,
  resolveRequiredConfiguredPublicApiBase,
} from './agent-execution-api-base.js';
import { buildNotebookTaskInputs, type NotebookTaskInputRefRecord } from './notebook-input-refs.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import {
  evaluateProjectPermissions,
  evaluateResourcePolicyAuthorization,
} from './project-authz-engine.js';
import { actorHasProjectPermissions } from './project-permissions.js';
import type { ProjectsRoute } from './projects-route-match.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import {
  resetInternalWorkloadHolderCoordinatorForTests,
  resolveInternalWorkloadCoordinator,
} from './internal-workload-coordinator.js';
import {
  JsonDocProjectFileLibraryCatalogRepo,
  JsonDocProjectTaskFileTemplateRepo,
} from './file-library-persistence.js';
import { guessFileLibraryContentType } from './file-library-content-type.js';
import {
  awaitAbortableOperation,
  createHttpOperationEnvelope,
  pipeObjectDownloadToHttpResponse,
} from './object-stream-bridge.js';
import {
  isDeveloperAgentRunner,
  isManagedAgentRunner,
  usesAgentPresenceScopedTaskRunner,
} from './agent-runner-profile.js';
import {
  asObject,
  buildId,
  findTaskHomeSegmentConflict,
  readTaskInputRefs,
  resolveTaskHomeSegment,
  type TaskListItem,
  type TaskMessageRecord,
  type TaskRecord,
} from './notebook-task/task-models.js';
import {
  isTaskRuntimePathResolutionError,
  resolveTaskRuntimeHomePathsForRunner,
  type TaskRuntimePathResolutionError,
} from './notebook-task/task-runtime-paths.js';
import {
  createAndCloneTaskFileTemplateLibrary,
  createAndProvisionProjectFileLibrary,
  DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
  mapFileLibraryInfraError,
} from './project-file-library-service.js';
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
  type NotebookTaskRunState,
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
import {
  acquireTaskFileLibraryBinding,
  buildBoundTaskSafeFields,
  findTaskFileLibraryBinding,
  hydrateTaskFileLibraryBindingsForProject,
  JsonDocTaskWorkspaceHolderRepo,
  releaseTaskFileLibraryBinding,
  updateTaskFileLibraryBinding,
  type TaskFileLibraryBinding,
} from './notebook-task/task-file-library-bindings.js';
import {
  isTaskWorkspaceBindingGuardError,
  resolveTaskWorkspaceBindingGuard,
  serializeTaskWorkspaceBindingGuardError,
  toTaskWorkspaceBindingGuardException,
  type TaskWorkspaceBindingGuardError,
} from './notebook-task/task-workspace-binding-guard.js';
import {
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
  isDeveloperRunnerTaskHomeBindingAvailable,
} from './developer-runner-workspace-blocker.js';

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

function buildRuntimePathUnavailableResponse(error: unknown): Record<string, unknown> {
  if (!isTaskRuntimePathResolutionError(error)) {
    return {
      error_code: 'runtime_path_unavailable',
      message: 'runtime_path_unavailable',
    };
  }
  const typedError = error as TaskRuntimePathResolutionError & {
    reason?: unknown;
    metadata?: unknown;
  };
  const metadata = (
    typeof typedError.metadata === 'object'
    && typedError.metadata !== null
    && !Array.isArray(typedError.metadata)
  )
    ? typedError.metadata as Record<string, unknown>
    : {};
  return {
    error_code: typedError.code,
    message: typedError.message,
    reason: typeof typedError.reason === 'string' ? typedError.reason : 'runtime_path_unavailable',
    ...(
      Object.keys(metadata).length > 0
        ? { metadata }
        : {}
    ),
  };
}

function buildDeveloperRunnerTaskHomeBindingUnavailableResponse(): Record<string, unknown> {
  return {
    error_code: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
    message: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
    runtime_profile: 'developer',
  };
}

const NOTEBOOK_RUN_LEASE_HEARTBEAT_MS = 15_000;
const NOTEBOOK_RUN_CANCEL_POLL_MS = 1_000;
const NOTEBOOK_RUN_OWNER_STALE_AFTER_MS = (NOTEBOOK_RUN_LEASE_HEARTBEAT_MS * 2) + 5_000;
const TASK_WORKSPACE_ACCESS_LEASE_TTL_MS = 5 * 60 * 1000;

function createTaskRouteRequestAbortSignal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): {
  signal: AbortSignal;
  armPostBodyDisconnects: () => void;
  dispose: () => void;
} {
  const controller = new AbortController();
  let postBodyDisconnectsArmed = false;
  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };
  const abortOnRequestClose = () => {
    if (postBodyDisconnectsArmed || !req.complete) {
      abort();
    }
  };
  const abortOnResponseClose = () => {
    if (!(res as { writableEnded?: boolean }).writableEnded) {
      abort();
    }
  };
  if ((req as { aborted?: boolean }).aborted === true) {
    abort();
  }
  if (typeof req.once === 'function') {
    req.once('aborted', abort);
    req.once('close', abortOnRequestClose);
  }
  if (typeof res.once === 'function') {
    res.once('close', abortOnResponseClose);
  }
  return {
    signal: controller.signal,
    armPostBodyDisconnects: () => {
      postBodyDisconnectsArmed = true;
      if ((req as { aborted?: boolean }).aborted === true) {
        abort();
      }
      const responseState = res as { destroyed?: boolean; writableEnded?: boolean };
      if (responseState.destroyed && !responseState.writableEnded) {
        abort();
      }
    },
    dispose: () => {
      if (typeof req.removeListener === 'function') {
        req.removeListener('aborted', abort);
        req.removeListener('close', abortOnRequestClose);
      }
      if (typeof res.removeListener === 'function') {
        res.removeListener('close', abortOnResponseClose);
      }
    },
  };
}

type AgentRunnerResolutionErrorCode =
  | 'agent_runner_unavailable'
  | 'agent_runner_forbidden'
  | 'agent_runner_runtime_unavailable'
  | 'agent_runner_model_unconfigured'
  | 'agent_runner_capability_mismatch'
  | 'agent_runner_default_conflict'
  | 'invalid_binding_target'
  | typeof DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE;

type AgentRunnerResolutionResult =
  | {
      ok: true;
      runner: AgentRecord;
    }
  | {
      ok: false;
      code: AgentRunnerResolutionErrorCode;
      metadata?: Record<string, unknown>;
    };

type TaskRunnerBindingKind = 'managed' | 'developer';
type TaskRunnerBindingSource = 'default_managed' | 'explicit';

type TaskRunnerBindingResult = Extract<AgentRunnerResolutionResult, { ok: true }> & {
  bindingSource: TaskRunnerBindingSource;
  bindingKind: TaskRunnerBindingKind;
};

type TerminalRunnerResolutionErrorCode =
  | AgentRunnerResolutionErrorCode
  | AgentTaskModelResolutionErrorCode
  | 'agent_runner_not_resolved'
  | 'terminal_runner_unavailable';

type TerminalRunnerResolutionIntent =
  | {
      kind: 'active_run';
      runId: string;
      runnerId: string;
    }
  | {
      kind: 'task_bound';
      runnerId: string;
    };

type TerminalRunnerResolutionResult =
  | {
      ok: true;
      runner: AgentRecord;
      agentTaskModelTarget?: AgentTaskModelResolvedTarget;
      agentTaskModelSnapshot?: AgentTaskModelSnapshot;
      intent: TerminalRunnerResolutionIntent;
      auditResolution: AgentRunnerResolutionResult | null;
    }
  | {
      ok: false;
      code: TerminalRunnerResolutionErrorCode;
      intent: TerminalRunnerResolutionIntent;
      auditResolution: AgentRunnerResolutionResult | null;
    };

type InternalTaskWorkloadIdentity = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  userId: string;
  agentId: string;
  workspaceFileLibraryId?: string | null;
};

type ManagedTerminalRuntimeDispatchContext = {
  managedInternalAgent: {
    workspaceFileLibraryId: string;
    taskHomeSegment?: string;
  };
};

const UNSUPPORTED_TASK_BINDING_FIELDS = [
  'agent_id',
  'agent_name',
  'runner_id',
  'runner_selection',
  'agent_runner_id',
  'is_default',
  'default_endpoint_id',
  'config',
  'capabilities',
  'runner_provider',
] as const;
const UNSUPPORTED_ACTIVE_TASK_BINDING_FIELDS = [
  ...UNSUPPORTED_TASK_BINDING_FIELDS,
  'bound_runner_id',
] as const;
const UNSUPPORTED_PUBLIC_TASK_RUN_FIELDS = [
  'role',
  'content',
  ...UNSUPPORTED_ACTIVE_TASK_BINDING_FIELDS,
] as const;

type TaskActivityItem = {
  id: string;
  task_id: string;
  kind: 'user_intent' | 'runner_output';
  actor: 'user' | 'runner';
  content: string;
  created_at: string;
  run_id?: string;
  source?: 'runner_test';
  runner_test?: true;
};

type TaskRunnerBindingReasonCode =
  | AgentRunnerResolutionErrorCode
  | 'permission_denied'
  | 'agent_runner_disconnected'
  | 'agent_runner_stale';

type TaskRunnerBindingSummary = {
  state: string;
  summary: string;
  reason_code?: TaskRunnerBindingReasonCode;
};

type TaskRunnerBindingAction = {
  operation: 'bind_to_task';
  visible: boolean;
  allowed: boolean;
  reason_code?: TaskRunnerBindingReasonCode;
  required_permissions: string[];
  danger_level: 'none';
};

type TaskRunnerBindingOption = {
  option_id: string;
  label: string;
  bound_runner_kind: TaskRunnerBindingKind;
  runner_binding_source: TaskRunnerBindingSource;
  agent_runner_id?: string;
  readiness: TaskRunnerBindingSummary;
  capability: TaskRunnerBindingSummary;
  freshness?: TaskRunnerBindingSummary;
  disabled_reason_code?: TaskRunnerBindingReasonCode;
  actions: {
    bind_to_task: TaskRunnerBindingAction;
  };
};

type TaskRunnerBindingRowValidation = {
  allowed: boolean;
  reasonCode?: TaskRunnerBindingReasonCode;
  readiness: TaskRunnerBindingSummary;
  capability: TaskRunnerBindingSummary;
  freshness?: TaskRunnerBindingSummary;
};

function collectUnsupportedFields(
  body: Record<string, unknown>,
  fields: readonly string[],
): string[] {
  return fields.filter((field) => Object.prototype.hasOwnProperty.call(body, field));
}

function runnerTestSourceMarker(input?: {
  task?: Pick<TaskRecord, 'source' | 'runner_test'> | null;
  run?: Pick<NotebookTaskRunState, 'runner_test'> | null;
}): Pick<TaskActivityItem, 'source' | 'runner_test'> {
  if (
    input?.task?.source === 'runner_test' ||
    input?.task?.runner_test === true ||
    input?.run?.runner_test === true
  ) {
    return { source: 'runner_test', runner_test: true };
  }
  return {};
}

function mapTaskMessageRecordToActivityItem(
  message: TaskMessageRecord,
  context?: {
    task?: Pick<TaskRecord, 'source' | 'runner_test'> | null;
    run?: Pick<NotebookTaskRunState, 'runner_test'> | null;
  },
): TaskActivityItem {
  return {
    id: message.id,
    task_id: message.task_id,
    kind: message.role === 'user' ? 'user_intent' : 'runner_output',
    actor: message.role === 'user' ? 'user' : 'runner',
    content: message.content,
    created_at: message.created_at,
    ...(message.turn_id ? { run_id: message.turn_id } : {}),
    ...runnerTestSourceMarker(context),
  };
}

function emitNotebookTaskActivityEvent(task: TaskRecord, message: TaskMessageRecord): void {
  emitNotebookTaskEvent(task.id, {
    type: 'activity_item',
    data: mapTaskMessageRecordToActivityItem(message, { task }),
  });
}

function readAgentRunnerStatus(agent: AgentRecord): 'draft' | 'connected' | 'ready' | 'degraded' | 'offline' {
  if (agent.runner_status) return agent.runner_status;
  if (agent.status !== 'enabled') return 'offline';
  if (agent.presence === 'managed' || agent.presence === 'online') return 'ready';
  return 'offline';
}

function runnerSupportsTaskRun(
  agent: AgentRecord,
  task: TaskRecord,
  requestedInputs: ReturnType<typeof readTaskInputRefs>,
  options?: {
    needsTerminal?: boolean;
  },
): boolean {
  const capabilities = agent.capabilities ?? {};
  if (capabilities.task_execution === false) return false;
  if (capabilities.artifacts === false) return false;
  if (options?.needsTerminal && capabilities.terminal === false) return false;
  const allInputs = [...task.attached_inputs, ...requestedInputs];
  if (capabilities.file_inputs === false && allInputs.some((item) => item.kind === 'library_object' || item.kind === 'artifact')) {
    return false;
  }
  if (capabilities.url_inputs === false && allInputs.some((item) => item.kind === 'url')) {
    return false;
  }
  const maxFileCount = typeof capabilities.max_file_count === 'number' && Number.isFinite(capabilities.max_file_count)
    ? Math.max(0, Math.floor(capabilities.max_file_count))
    : undefined;
  if (maxFileCount !== undefined && allInputs.filter((item) => item.kind === 'library_object' || item.kind === 'artifact').length > maxFileCount) {
    return false;
  }
  return true;
}

function buildTaskRunnerBindingSummary(
  state: string,
  reasonCode?: TaskRunnerBindingReasonCode,
): TaskRunnerBindingSummary {
  return {
    state,
    summary: state,
    ...(reasonCode ? { reason_code: reasonCode } : {}),
  };
}

function buildTaskRunnerBindingAction(input: {
  allowed: boolean;
  requiredPermissions: string[];
  reasonCode?: TaskRunnerBindingReasonCode;
}): TaskRunnerBindingAction {
  return {
    operation: 'bind_to_task',
    visible: true,
    allowed: input.allowed,
    ...(input.reasonCode ? { reason_code: input.reasonCode } : {}),
    required_permissions: input.requiredPermissions,
    danger_level: 'none',
  };
}

async function canSeeAgentRunnerBindingRow(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  user: AuthenticatedUser;
  runner: AgentRecord;
  requiredPermissions: string[];
}): Promise<boolean> {
  if (!(await actorHasProjectPermissions({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    actorUserId: args.user.id,
    requiredPermissions: args.requiredPermissions,
  }))) {
    return false;
  }

  const policyDecision = await evaluateResourcePolicyAuthorization({
    docStore: args.deps.docStore,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    resourceType: 'agent',
    resourceId: args.runner.id,
    subjectType: 'user',
    subjectId: args.user.id,
  });
  return policyDecision.allowed;
}

async function actorHasAgentRunnerManageAuthority(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
}): Promise<boolean> {
  return actorHasProjectPermissions({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    actorUserId: args.actorUserId,
    requiredPermissions: ['project:agent_runner:manage'],
  });
}

function resolveDeveloperRunnerFreshness(
  deps: NodeApiDeps,
  runner: AgentRecord,
): TaskRunnerBindingSummary {
  const fresh = runner.presence === 'online'
    || readAgentRunnerStatus(runner) === 'ready'
    || deps.agentExecutionService.getAgentOnlineState(runner.id);
  if (fresh) {
    return buildTaskRunnerBindingSummary('fresh');
  }
  return buildTaskRunnerBindingSummary(
    runner.last_seen_at?.trim() ? 'stale' : 'missing',
    runner.last_seen_at?.trim() ? 'agent_runner_stale' : 'agent_runner_disconnected',
  );
}

function buildRunnerBindingValidationSummaries(
  reasonCode?: TaskRunnerBindingReasonCode,
  freshness?: TaskRunnerBindingSummary,
): Pick<TaskRunnerBindingRowValidation, 'readiness' | 'capability' | 'freshness'> {
  const readiness = (
    reasonCode === 'agent_runner_unavailable'
    || reasonCode === 'agent_runner_model_unconfigured'
    || reasonCode === 'agent_runner_default_conflict'
    || reasonCode === 'agent_runner_runtime_unavailable'
    || reasonCode === 'invalid_binding_target'
    || reasonCode === 'agent_runner_disconnected'
    || reasonCode === 'agent_runner_stale'
    || reasonCode === DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE
  )
    ? buildTaskRunnerBindingSummary('unavailable', reasonCode)
    : reasonCode === 'permission_denied'
      || reasonCode === 'agent_runner_forbidden'
      ? buildTaskRunnerBindingSummary('unknown', reasonCode)
      : buildTaskRunnerBindingSummary('ready');
  const capability = reasonCode === 'agent_runner_capability_mismatch'
    || reasonCode === 'invalid_binding_target'
    ? buildTaskRunnerBindingSummary('incompatible', reasonCode)
    : reasonCode === 'permission_denied' || reasonCode === 'agent_runner_forbidden'
      ? buildTaskRunnerBindingSummary('unknown', reasonCode)
      : buildTaskRunnerBindingSummary('compatible');
  return {
    readiness,
    capability,
    ...(freshness ? { freshness } : {}),
  };
}

async function validateAgentRunnerForBindingOption(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  runner: AgentRecord;
  requestedInputs: ReturnType<typeof readTaskInputRefs>;
  requestId?: string | null;
  requiredPermissions: string[];
}): Promise<TaskRunnerBindingRowValidation> {
  if (!(await canSeeAgentRunnerBindingRow({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    user: args.user,
    runner: args.runner,
    requiredPermissions: args.requiredPermissions,
  }))) {
    return {
      allowed: false,
      reasonCode: 'permission_denied',
      ...buildRunnerBindingValidationSummaries('permission_denied'),
    };
  }

  const developerRunner = isDeveloperAgentRunner(args.runner);
  const freshness = developerRunner
    ? resolveDeveloperRunnerFreshness(args.deps, args.runner)
    : buildTaskRunnerBindingSummary('managed');
  const freshnessReason = developerRunner ? freshness.reason_code : undefined;
  if (freshnessReason) {
    return {
      allowed: false,
      reasonCode: freshnessReason,
      ...buildRunnerBindingValidationSummaries(freshnessReason, freshness),
    };
  }

  if (args.runner.status !== 'enabled' || readAgentRunnerStatus(args.runner) !== 'ready') {
    return {
      allowed: false,
      reasonCode: 'agent_runner_unavailable',
      ...buildRunnerBindingValidationSummaries('agent_runner_unavailable', freshness),
    };
  }

  if (!runnerSupportsTaskRun(args.runner, args.task, args.requestedInputs)) {
    return {
      allowed: false,
      reasonCode: 'agent_runner_capability_mismatch',
      ...buildRunnerBindingValidationSummaries('agent_runner_capability_mismatch', freshness),
    };
  }

  if (developerRunner && !isDeveloperRunnerTaskHomeBindingAvailable()) {
    return {
      allowed: false,
      reasonCode: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
      ...buildRunnerBindingValidationSummaries(
        DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
        freshness,
      ),
    };
  }

  return {
    allowed: true,
    ...buildRunnerBindingValidationSummaries(undefined, freshness),
  };
}

function buildTaskRunnerBindingKind(runner: AgentRecord): TaskRunnerBindingKind {
  return isDeveloperAgentRunner(runner) ? 'developer' : 'managed';
}

function buildRunnerBindingProbeTask(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
}): TaskRecord {
  const generatedAt = nowIso();
  const taskId = 'task_runner_binding_options_probe';
  return {
    id: taskId,
    workspace_id: args.workspaceId,
    project_id: args.projectId,
    owner_user_id: args.userId,
    title: 'Runner binding options probe',
    task_home_segment: resolveTaskHomeSegment({
      id: taskId,
      workspace_id: args.workspaceId,
      project_id: args.projectId,
    }),
    status: 'active',
    attached_inputs: [],
    created_at: generatedAt,
    updated_at: generatedAt,
    last_activity_at: generatedAt,
  };
}

async function validateResolvedAgentRunnerForTask(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  runner: AgentRecord;
  requestedInputs: ReturnType<typeof readTaskInputRefs>;
  requestId?: string | null;
  needsTerminal?: boolean;
  source: 'agent_runner_binding' | 'agent_runner_task_run' | 'agent_runner_terminal';
}): Promise<AgentRunnerResolutionResult> {
  if (args.runner.status !== 'enabled' || readAgentRunnerStatus(args.runner) !== 'ready') {
    return {
      ok: false,
      code: 'agent_runner_unavailable',
      metadata: { runner_id: args.runner.id, reason: 'runner_not_ready' },
    };
  }

  if (!runnerSupportsTaskRun(
    args.runner,
    args.task,
    args.requestedInputs,
    { needsTerminal: args.needsTerminal },
  )) {
    return {
      ok: false,
      code: 'agent_runner_capability_mismatch',
      metadata: { runner_id: args.runner.id },
    };
  }

  if (isDeveloperAgentRunner(args.runner) && !isDeveloperRunnerTaskHomeBindingAvailable()) {
    return {
      ok: false,
      code: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
      metadata: {
        runner_id: args.runner.id,
        runtime_profile: 'developer',
      },
    };
  }
  return { ok: true, runner: args.runner };
}

async function resolveDefaultManagedAgentRunnerForTask(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  requestedInputs: ReturnType<typeof readTaskInputRefs>;
  requestId?: string | null;
  needsTerminal?: boolean;
  source: 'agent_runner_binding' | 'agent_runner_task_run' | 'agent_runner_terminal';
}): Promise<AgentRunnerResolutionResult> {
  const projectedRunner = await args.deps.agentResourceService.getDeploymentDefaultManagedAgentRunner(
    args.workspaceId,
    args.projectId,
  );
  if (projectedRunner) {
    if (!isManagedAgentRunner(projectedRunner)) {
      return {
        ok: false,
        code: 'agent_runner_unavailable',
        metadata: { runner_id: projectedRunner.id, reason: 'deployment_default_projection_not_managed' },
      };
    }
    return validateResolvedAgentRunnerForTask({
      ...args,
      runner: projectedRunner,
    });
  }
  return {
    ok: false,
    code: 'agent_runner_unavailable',
    metadata: { reason: 'deployment_default_projection_missing' },
  };
}

async function resolveExplicitDeveloperAgentRunnerForTask(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  requestedInputs: ReturnType<typeof readTaskInputRefs>;
  boundRunnerId: string;
  requestId?: string | null;
  needsTerminal?: boolean;
  source: 'agent_runner_binding' | 'agent_runner_task_run' | 'agent_runner_terminal';
}): Promise<AgentRunnerResolutionResult> {
  const runner = await args.deps.agentResourceService.getAgent(
    args.workspaceId,
    args.projectId,
    args.boundRunnerId,
  );
  if (runner && isManagedAgentRunner(runner)) {
    return {
      ok: false,
      code: 'invalid_binding_target',
      metadata: { runner_id: args.boundRunnerId, reason: 'explicit_managed_runner_not_bindable' },
    };
  }
  if (!runner || runner.status !== 'enabled' || !isDeveloperAgentRunner(runner)) {
    return {
      ok: false,
      code: 'agent_runner_unavailable',
      metadata: { runner_id: args.boundRunnerId, reason: 'runner_not_found_disabled_or_not_developer' },
    };
  }
  if (!(await canUseExplicitAgentRunnerForTaskRun({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    user: args.user,
    runner,
  }))) {
    return {
      ok: false,
      code: 'agent_runner_forbidden',
      metadata: { runner_id: runner.id, reason: 'binding_authority_denied' },
    };
  }
  return validateResolvedAgentRunnerForTask({
    ...args,
    runner,
  });
}

async function bindAgentRunnerForTask(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  requestedInputs: ReturnType<typeof readTaskInputRefs>;
  boundRunnerId?: string | null;
  requestId?: string | null;
}): Promise<TaskRunnerBindingResult | Extract<AgentRunnerResolutionResult, { ok: false }>> {
  const explicitRunnerId = args.boundRunnerId?.trim() ?? '';
  const resolution = explicitRunnerId
    ? await resolveExplicitDeveloperAgentRunnerForTask({
      ...args,
      boundRunnerId: explicitRunnerId,
      source: 'agent_runner_binding',
    })
    : await resolveDefaultManagedAgentRunnerForTask({
      ...args,
      source: 'agent_runner_binding',
    });
  if (!resolution.ok) {
    return resolution;
  }
  return {
    ...resolution,
    bindingSource: explicitRunnerId ? 'explicit' : 'default_managed',
    bindingKind: buildTaskRunnerBindingKind(resolution.runner),
  };
}

async function resolveTaskBoundAgentRunnerForTaskRun(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  requestedInputs: ReturnType<typeof readTaskInputRefs>;
  requestId?: string | null;
  needsTerminal?: boolean;
  source: 'agent_runner_task_run' | 'agent_runner_terminal';
}): Promise<AgentRunnerResolutionResult> {
  const runnerId = args.task.bound_runner_id?.trim() ?? '';
  if (!runnerId) {
    return {
      ok: false,
      code: 'agent_runner_unavailable',
      metadata: { reason: 'task_runner_not_bound' },
    };
  }
  const runner = await args.deps.agentResourceService.getAgent(args.workspaceId, args.projectId, runnerId);
  if (!runner || runner.status !== 'enabled') {
    return {
      ok: false,
      code: 'agent_runner_unavailable',
      metadata: { runner_id: runnerId, reason: 'bound_runner_not_found_or_disabled' },
    };
  }
  if (isDeveloperAgentRunner(runner) && !(await canUseExplicitAgentRunnerForTaskRun({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    user: args.user,
    runner,
  }))) {
    return {
      ok: false,
      code: 'agent_runner_forbidden',
      metadata: { runner_id: runner.id, reason: 'bound_runner_authority_denied' },
    };
  }
  return validateResolvedAgentRunnerForTask({
    ...args,
    runner,
  });
}

async function buildDefaultRunnerBindingOption(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  requestId?: string | null;
}): Promise<TaskRunnerBindingOption> {
  const resolution = await resolveDefaultManagedAgentRunnerForTask({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    task: args.task,
    user: args.user,
    requestedInputs: [],
    requestId: args.requestId,
    source: 'agent_runner_binding',
  });
  const reasonCode: TaskRunnerBindingReasonCode | undefined = resolution.ok
    ? undefined
    : resolution.code;
  return {
    option_id: 'default_managed',
    label: 'Default managed runner',
    bound_runner_kind: 'managed',
    runner_binding_source: 'default_managed',
    ...buildRunnerBindingValidationSummaries(reasonCode),
    ...(reasonCode ? { disabled_reason_code: reasonCode } : {}),
    actions: {
      bind_to_task: buildTaskRunnerBindingAction({
        allowed: resolution.ok,
        requiredPermissions: ['project:agent_task:use'],
        reasonCode,
      }),
    },
  };
}

async function buildAgentRunnerBindingOption(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  runner: AgentRecord;
  requestId?: string | null;
}): Promise<TaskRunnerBindingOption | null> {
  if (!isDeveloperAgentRunner(args.runner)) {
    return null;
  }
  const requiredPermissions = ['project:agent_task:use', 'project:agent_runner:manage'];
  const visible = await canSeeAgentRunnerBindingRow({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    user: args.user,
    runner: args.runner,
    requiredPermissions,
  });
  if (!visible) {
    return null;
  }
  const validation = await validateAgentRunnerForBindingOption({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    task: args.task,
    user: args.user,
    runner: args.runner,
    requestedInputs: [],
    requestId: args.requestId,
    requiredPermissions,
  });
  return {
    option_id: args.runner.id,
    agent_runner_id: args.runner.id,
    label: args.runner.name,
    bound_runner_kind: 'developer',
    runner_binding_source: 'explicit',
    readiness: validation.readiness,
    capability: validation.capability,
    ...(validation.freshness ? { freshness: validation.freshness } : {}),
    ...(validation.reasonCode ? { disabled_reason_code: validation.reasonCode } : {}),
    actions: {
      bind_to_task: buildTaskRunnerBindingAction({
        allowed: validation.allowed,
        requiredPermissions,
        reasonCode: validation.reasonCode,
      }),
    },
  };
}

async function buildTaskRunnerBindingOptions(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  user: AuthenticatedUser;
  requestId?: string | null;
}): Promise<{
  options: TaskRunnerBindingOption[];
  generated_at: string;
}> {
  const probeTask = buildRunnerBindingProbeTask({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.user.id,
  });
  const defaultOption = await buildDefaultRunnerBindingOption({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    task: probeTask,
    user: args.user,
    requestId: args.requestId,
  });
  const canManageRunners = await actorHasAgentRunnerManageAuthority({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    actorUserId: args.user.id,
  });
  if (!canManageRunners) {
    return {
      options: [defaultOption],
      generated_at: nowIso(),
    };
  }
  const runners = await args.deps.agentResourceService.listAgents(args.workspaceId, args.projectId);
  const runnerOptions = await Promise.all(runners.map((runner) => buildAgentRunnerBindingOption({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    task: probeTask,
    user: args.user,
    runner,
    requestId: args.requestId,
  })));
  return {
    options: [
      defaultOption,
      ...runnerOptions.filter((option): option is TaskRunnerBindingOption => option !== null),
    ],
    generated_at: nowIso(),
  };
}

async function canUseExplicitAgentRunnerForTaskRun(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  user: AuthenticatedUser;
  runner: AgentRecord;
}): Promise<boolean> {
  const policyDecision = await evaluateResourcePolicyAuthorization({
    docStore: args.deps.docStore,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    resourceType: 'agent',
    resourceId: args.runner.id,
    subjectType: 'user',
    subjectId: args.user.id,
  });
  if (!policyDecision.allowed) {
    return false;
  }

  if (isManagedAgentRunner(args.runner) && args.runner.is_default === true) {
    return true;
  }

  const runnerPermission = isDeveloperAgentRunner(args.runner)
    ? 'project:agent_runner:manage'
    : 'project:agent_runner:read';
  try {
    const project = await args.deps.getProjectUseCase.execute({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
    });
    const evaluation = await evaluateProjectPermissions({
      docStore: args.deps.docStore,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      projectOwnerId: project.owner_id,
      projectGovernance: project.governance_json,
      actorUserId: args.user.id,
      requiredPermissions: ['project:agent_task:use', runnerPermission],
    });
    return evaluation.decisions.every((decision) => decision.granted);
  } catch {
    return false;
  }
}

async function writeAgentRunnerResolutionAudit(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  user: AuthenticatedUser;
  taskId: string;
  requestId?: string | null;
  result: AgentRunnerResolutionResult;
}): Promise<void> {
  await writeProjectAuditEvent(args.deps, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    actor: { type: 'user', id: args.user.id },
    action: args.result.ok ? 'agent_runner.resolution.succeeded' : 'agent_runner.resolution.failed',
    result: args.result.ok ? 'ok' : 'error',
    requestId: args.requestId,
    resourceType: 'notebook_task',
    resourceId: args.taskId,
    errorCode: args.result.ok ? undefined : args.result.code,
    errorMessage: args.result.ok ? undefined : args.result.code,
    metadata: args.result.ok
      ? {
        runner_id: args.result.runner.id,
      }
      : {
        failure_code: args.result.code,
        ...(args.result.metadata ?? {}),
      },
  });
}

function readActiveRunResolvedRunnerId(
  state: Pick<NotebookTaskRunState, 'resolved_runner_id' | 'runner_id'> | null | undefined,
): string {
  return state?.resolved_runner_id?.trim() ?? '';
}

async function resolveTerminalSessionRunner(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  user: AuthenticatedUser;
  requestId?: string | null;
}): Promise<TerminalRunnerResolutionResult> {
  const activeRun = await getNotebookTaskRunState(args.deps.cache, args.task.id);
  if (activeRun) {
    const runnerId = readActiveRunResolvedRunnerId(activeRun);
    const intent: TerminalRunnerResolutionIntent = {
      kind: 'active_run',
      runId: activeRun.run_id,
      runnerId,
    };
    if (!runnerId) {
      return {
        ok: false,
        code: 'agent_runner_not_resolved',
        intent,
        auditResolution: null,
      };
    }
    const runner = await args.deps.agentResourceService.getAgent(
      args.workspaceId,
      args.projectId,
      runnerId,
    );
    if (
      !runner
      || runner.status !== 'enabled'
      || !runnerSupportsTaskRun(runner, args.task, [], { needsTerminal: true })
    ) {
      return {
        ok: false,
        code: 'terminal_runner_unavailable',
        intent,
        auditResolution: null,
      };
    }
    if (isDeveloperAgentRunner(runner) && !(await canUseExplicitAgentRunnerForTaskRun({
      deps: args.deps,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      user: args.user,
      runner,
    }))) {
      return {
        ok: false,
        code: 'agent_runner_forbidden',
        intent,
        auditResolution: null,
      };
    }
    let agentTaskModelTarget: AgentTaskModelResolvedTarget | undefined;
    let agentTaskModelSnapshot = activeRun.agent_task_model;
    if (!agentTaskModelSnapshot) {
      try {
        agentTaskModelTarget = await resolveAgentTaskModelTarget({
          deps: args.deps,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          actorUserId: args.user.id,
          requestId: args.requestId,
          source: 'agent_task_terminal_recovery',
          contextMetadata: {
            task_id: args.task.id,
            run_id: activeRun.run_id,
            runner_id: runner.id,
          },
        });
        agentTaskModelSnapshot = agentTaskModelTarget.snapshot;
      } catch (error) {
        if (error instanceof AgentTaskModelResolutionError) {
          return {
            ok: false,
            code: error.code,
            intent,
            auditResolution: null,
          };
        }
        throw error;
      }
    }
    return {
      ok: true,
      runner,
      ...(agentTaskModelTarget ? { agentTaskModelTarget } : {}),
      ...(agentTaskModelSnapshot ? { agentTaskModelSnapshot } : {}),
      intent,
      auditResolution: null,
    };
  }

  const auditResolution = await resolveTaskBoundAgentRunnerForTaskRun({
    deps: args.deps,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    task: args.task,
    user: args.user,
    requestedInputs: [],
    requestId: args.requestId,
    needsTerminal: true,
    source: 'agent_runner_terminal',
  });
  const intent: TerminalRunnerResolutionIntent = {
    kind: 'task_bound',
    runnerId: args.task.bound_runner_id?.trim() ?? '',
  };
  if (!auditResolution.ok) {
    return {
      ok: false,
      code: auditResolution.code,
      intent,
      auditResolution,
    };
  }
  try {
    const agentTaskModelTarget = await resolveAgentTaskModelTarget({
      deps: args.deps,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      actorUserId: args.user.id,
      requestId: args.requestId,
      source: 'agent_task_terminal_start',
      contextMetadata: {
        task_id: args.task.id,
        runner_id: auditResolution.runner.id,
      },
    });
    return {
      ok: true,
      runner: auditResolution.runner,
      agentTaskModelTarget,
      agentTaskModelSnapshot: agentTaskModelTarget.snapshot,
      intent,
      auditResolution,
    };
  } catch (error) {
    if (error instanceof AgentTaskModelResolutionError) {
      return {
        ok: false,
        code: error.code,
        intent,
        auditResolution,
      };
    }
    throw error;
  }
}

function parseNotebookRunStopMode(raw: unknown): NotebookTaskRunStopMode | null {
  if (raw === undefined || raw === null || raw === '') {
    return 'cancel';
  }
  return raw === 'terminate' ? 'terminate' : raw === 'cancel' ? 'cancel' : null;
}

const registeredInternalTerminalLifecycleServices = new Set<object>();
const notebookRunHardTeardownInFlight = new Map<string, Promise<void>>();

function isTaskDeletionFenced(task: TaskRecord): boolean {
  return task.deletion_state === 'deleting' || task.deletion_state === 'deleted';
}

function listTasksForOwner(
  workspaceId: string,
  projectId: string,
  ownerUserId: string,
): TaskRecord[] {
  return getTasks(workspaceId, projectId).filter((task) => (
    task.owner_user_id === ownerUserId
    && !isTaskDeletionFenced(task)
  ));
}

function findTaskForOwner(
  workspaceId: string,
  projectId: string,
  taskId: string,
  ownerUserId: string,
): TaskRecord | undefined {
  const task = findTask(workspaceId, projectId, taskId);
  if (!task || task.owner_user_id !== ownerUserId || isTaskDeletionFenced(task)) {
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

function defaultWorkspaceNameFromTaskTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed ? `${trimmed} Workspace` : 'Notebook Workspace';
}

async function compensateAutoCreatedTaskFileLibrary(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  libraryId?: string | null;
  actorUserId: string;
  requestId?: string | null;
}): Promise<void> {
  const libraryId = args.libraryId?.trim();
  if (!libraryId) return;
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(args.deps.docStore);
  if (!args.deps.fileLibraryStorageAdapter?.enabled) {
    await catalogRepo.update(args.workspaceId, args.projectId, libraryId, {
      status: 'failed',
      delete_correlation_id: args.requestId ?? undefined,
    }).catch(() => undefined);
    return;
  }
  try {
    await args.deps.fileLibraryStorageAdapter.deleteRepoForLibrary({
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      libraryId,
      actorUserId: args.actorUserId,
      requestId: args.requestId ?? undefined,
      reason: 'agent_task_create_compensation',
    });
    await catalogRepo.delete(args.workspaceId, args.projectId, libraryId);
  } catch {
    await catalogRepo.update(args.workspaceId, args.projectId, libraryId, {
      status: 'failed',
      delete_correlation_id: args.requestId ?? undefined,
    }).catch(() => undefined);
  }
}

function buildTerminalUsername(user: AuthenticatedUser): string {
  const local = user.email.split('@')[0]?.trim();
  if (local) return local;
  return user.id.trim() || 'unknown_user';
}

function normalizeStorageObjectPath(input?: string | null): string {
  const value = (input ?? '').trim().replace(/^\/+/, '').replace(/\/{2,}/g, '/');
  if (!value) return '';
  const segments = value.split('/').filter(Boolean);
  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error('invalid_file_library_path');
    }
  }
  return segments.join('/');
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
      writeNotebookTaskSseEvent(args.res, {
        type: 'activity_item',
        data: mapTaskMessageRecordToActivityItem(message, { task: currentTask }),
      });
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
      writeNotebookTaskSseEvent(args.res, {
        type: 'trace_event',
        data: projectTaskTraceEventForDisplay(traceEvent),
      });
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
    // Keep deriving the websocket scheme from the configured request base when URL parsing fails.
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

function readTerminalSessionResolvedRunnerId(
  session: { resolvedRunnerId?: string },
): string {
  return session.resolvedRunnerId?.trim() ?? '';
}

function serializeTerminalCloseResult(input: unknown): 'closed' | 'not_found' | null {
  return input === 'closed' || input === 'not_found' ? input : null;
}

function serializeTerminalSessionResponse(input: {
  session: {
    id: string;
    agentId: string;
    resolvedRunnerId?: string;
    runnerSessionId: string;
    status: 'pending' | 'active' | 'disconnected' | 'recovering' | 'closing' | 'closed' | 'failed';
    lifecycleStatus?: 'pending' | 'starting' | 'active' | 'recovering' | 'closing' | 'closed' | 'failed';
    runnerConnectionStatus?: 'dispatching' | 'attached' | 'transport_lost' | 'adopting' | 'missing' | 'closed';
    browserConnectionStatus?: 'attached' | 'browser_disconnected' | 'none';
    inputEnabled?: boolean;
    recoverable?: boolean;
    recoveryDeadlineAt?: string;
    failureKind?: string | null;
    closeState?: 'none' | 'requested' | 'delivered' | 'acked' | 'expired';
    closeResult?: string | null;
    closeDeadlineAt?: string;
    nextOutputSeq?: number;
    outputReplayRing?: Array<{ seq: number }>;
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
  terminal_session_id: string;
  runner_id: string;
  runner_session_id: string;
  status: 'pending' | 'active' | 'disconnected' | 'recovering' | 'closing' | 'closed' | 'failed';
  lifecycle_status: 'pending' | 'starting' | 'active' | 'recovering' | 'closing' | 'closed' | 'failed';
  runner_connection_status: 'dispatching' | 'attached' | 'transport_lost' | 'adopting' | 'missing' | 'closed';
  browser_connection_status: 'attached' | 'browser_disconnected' | 'none';
  input_enabled: boolean;
  recoverable: boolean;
  recovery_deadline_at: string | null;
  failure_kind: string | null;
  close_state: 'none' | 'requested' | 'delivered' | 'acked' | 'expired';
  close_result: 'closed' | 'not_found' | null;
  close_deadline_at: string | null;
  replay_status: 'complete' | 'partial' | 'unavailable';
  replay_gap: boolean;
  latest_seq: number;
  cols: number;
  rows: number;
  created_at: string;
  last_activity_at: string;
  ended_at: string | null;
  close_reason: string | null;
    exit_code: number | null;
    ws_url: string | null;
  } {
  const resolvedRunnerId = readTerminalSessionResolvedRunnerId(input.session);
  const latestSeq = Math.max(0, (input.session.nextOutputSeq ?? 1) - 1);
  const replayRing = input.session.outputReplayRing ?? [];
  const replayGap = latestSeq > 0 && (replayRing.length === 0 || (replayRing[0]?.seq ?? 1) > 1);
  const replayStatus = latestSeq === 0 || !replayGap
    ? 'complete'
    : replayRing.length > 0
      ? 'partial'
      : 'unavailable';
  const lifecycleStatus = input.session.lifecycleStatus ?? (
    input.session.status === 'disconnected' ? 'active' : input.session.status
  );
  return {
    terminal_session_id: input.session.id,
    runner_id: resolvedRunnerId,
    runner_session_id: input.session.runnerSessionId,
    status: input.session.status,
    lifecycle_status: lifecycleStatus,
    runner_connection_status: input.session.runnerConnectionStatus ?? (
      input.session.status === 'failed' ? 'missing' : input.session.status === 'closed' ? 'closed' : 'dispatching'
    ),
    browser_connection_status: input.session.browserConnectionStatus ?? 'none',
    input_enabled: input.session.inputEnabled ?? false,
    recoverable: input.session.recoverable ?? input.session.status === 'recovering',
    recovery_deadline_at: input.session.recoveryDeadlineAt ?? null,
    failure_kind: input.session.failureKind ?? null,
    close_state: input.session.closeState ?? 'none',
    close_result: serializeTerminalCloseResult(input.session.closeResult),
    close_deadline_at: input.session.closeDeadlineAt ?? null,
    replay_status: replayStatus,
    replay_gap: replayGap,
    latest_seq: latestSeq,
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
  agent: AgentRecord;
  agentTaskModelSnapshot?: AgentTaskModelSnapshot;
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
  const executionTicket = await issueInternalTicket(args.deps.cache, {
    purpose: 'agent_execution',
    userId: args.user.id,
    prefix: 'exec',
    workspaceId: args.task.workspace_id,
    projectId: args.task.project_id,
      payload: {
        endpoint_id: args.agentTaskModelSnapshot?.endpoint_id ?? 'terminal',
        task_id: args.task.id,
        runner_session_id: args.task.id,
        agent_runner_id: args.agent.id,
      },
    ttlMs: 8 * 60 * 60 * 1000,
    maxUses: 500,
  });
  const taskRuntimePaths = resolveTaskRuntimeHomePathsForRunner({
    task: args.task,
    runnerProvider: args.agent.runner_provider,
  });

  const executionContext = {
    workspace_id: args.task.workspace_id,
    project_id: args.task.project_id,
    task_id: args.task.id,
    runner_id: args.agent.id,
    username: buildTerminalUsername(args.user),
    ...(args.agentTaskModelSnapshot
      ? {
        endpoint_id: args.agentTaskModelSnapshot.endpoint_id,
        model: args.agentTaskModelSnapshot.resolved_model,
        wire_api: args.agentTaskModelSnapshot.upstream_protocol,
        agent_task_model: args.agentTaskModelSnapshot,
      }
      : {}),
    api_base: resolveExecutionApiBase(args.publicBaseUrl, args.agent),
    execution_ticket: executionTicket.ticket,
    runner_session_scope: usesAgentPresenceScopedTaskRunner(args.agent)
      ? 'agent_presence'
      : 'task_execution',
    workspace_binding_mode: isManagedAgentRunner(args.agent) ? 'pre_mounted' : 'file_library',
    runtime_profile: taskRuntimePaths.runtimeProfile,
    task_home_segment: taskRuntimePaths.taskHomeSegment,
    task_home_path: taskRuntimePaths.taskHomePath,
    workspace_path: taskRuntimePaths.workspacePath,
    artifacts_path: taskRuntimePaths.artifactsPath,
    library_root_path: '.',
    workspace_file_library_id: args.task.workspace_file_library_id ?? null,
    workspace_file_library_name: args.task.workspace_file_library_name ?? null,
    task_inputs: taskInputs,
  };
  assertTaskExecutionContext(executionContext);
  return executionContext;
}

function buildAgentTaskFileLibraryInUseConflict(input: {
  fileLibraryId: string,
  binding: TaskFileLibraryBinding,
  actorUserId: string,
}): Record<string, unknown> {
  return {
    error_code: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
    message: 'workspace_file_library_in_use',
    field: 'workspace_file_library_id',
    file_library_id: input.fileLibraryId,
    ...buildBoundTaskSafeFields({
      binding: input.binding,
      actorUserId: input.actorUserId,
    }),
  };
}

function bindingGenerationToWire(value: number | null | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined;
}

function serializeAgentTaskDeleteBlockers(blockers: AgentTaskDeleteBlocker[]): string[] {
  return [...new Set(blockers.map((blocker) => blocker.type))];
}

function buildWorkspaceAccessHolderFence(input: {
  task: TaskRecord;
  fileLibraryId: string;
  bindingGeneration: number;
  issuedAt?: string;
}): {
  holder_id: string;
  task_id: string;
  file_library_id: string;
  task_home_segment: string;
  binding_generation: string;
  lease_epoch: string;
  holder_kind: 'runner_workspace';
  issued_at: string;
  expires_at: string;
} {
  const issuedAt = input.issuedAt ?? nowIso();
  return {
    holder_id: buildId('holder'),
    task_id: input.task.id,
    file_library_id: input.fileLibraryId,
    task_home_segment: input.task.task_home_segment,
    binding_generation: String(input.bindingGeneration),
    lease_epoch: buildId('lease'),
    holder_kind: 'runner_workspace',
    issued_at: issuedAt,
    expires_at: new Date(Date.parse(issuedAt) + TASK_WORKSPACE_ACCESS_LEASE_TTL_MS).toISOString(),
  };
}

async function writeTaskFileLibraryBindingAcquireAudit(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  fileLibraryId: string;
  taskId?: string;
  binding?: TaskFileLibraryBinding;
  requestId?: string | null;
  result: 'ok' | 'error';
  errorCode?: string;
  errorMessage?: string;
  reason?: string;
}): Promise<void> {
  await writeProjectAuditEvent(input.deps, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorUserId },
    action: 'agent_task.file_library_binding.acquire',
    result: input.result,
    requestId: input.requestId,
    resourceType: 'project_file_library',
    resourceId: input.fileLibraryId,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    metadata: {
      file_library_id: input.fileLibraryId,
      ...(input.taskId ? { task_id: input.taskId } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.binding
        ? {
          binding_generation: String(input.binding.bindingGeneration),
          runtime_writable_affordance: input.binding.runtimeWritableAffordance,
          ...buildBoundTaskSafeFields({
            binding: input.binding,
            actorUserId: input.actorUserId,
          }),
        }
        : {}),
    },
  });
}

async function releaseTaskFileLibraryBindingWithAudit(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  fileLibraryId?: string | null;
  taskId: string;
  bindingGeneration?: number | null;
  correlationId: string;
  requestId?: string | null;
  reason: string;
}): Promise<Awaited<ReturnType<typeof releaseTaskFileLibraryBinding>>> {
  const releaseResult = await releaseTaskFileLibraryBinding({
    docStore: input.deps.docStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    fileLibraryId: input.fileLibraryId,
    taskId: input.taskId,
    bindingGeneration: input.bindingGeneration,
    correlationId: input.correlationId,
  });
  const fileLibraryId = input.fileLibraryId?.trim();
  if (fileLibraryId) {
    await writeProjectAuditEvent(input.deps, {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actor: { type: 'user', id: input.actorUserId },
      action: 'agent_task.file_library_binding.release',
      result: releaseResult.ok ? 'ok' : 'error',
      requestId: input.requestId,
      resourceType: 'project_file_library',
      resourceId: fileLibraryId,
      errorCode: releaseResult.ok ? undefined : releaseResult.code,
      errorMessage: releaseResult.ok ? undefined : releaseResult.code,
      metadata: {
        file_library_id: fileLibraryId,
        task_id: input.taskId,
        reason: input.reason,
        ...(bindingGenerationToWire(input.bindingGeneration)
          ? { binding_generation: bindingGenerationToWire(input.bindingGeneration) }
          : {}),
        ...(releaseResult.ok
          ? { released: releaseResult.released }
          : { current_binding_generation: String(releaseResult.binding.bindingGeneration) }),
      },
    });
  }
  return releaseResult;
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
  if (!agent || !isManagedAgentRunner(agent)) return;
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
    const released = await internalWorkloadCoordinator.requestHardTeardown({
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      workloadId: sanitizeWorkloadId(identity.taskId),
    }).then(
      () => true,
      (err: unknown) => {
        console.warn(
          '[sandbox] requestHardTeardown failed for task %s: %s',
          identity.taskId,
          err instanceof Error ? err.message : err,
        );
        return false;
      },
    );
    if (!released) return;
    await maybeReleaseInternalAgentWorkspaceBinding(deps, identity);
    return;
  }
  if (!deps.internalAgentPodManager) return;
  const released = await deps.internalAgentPodManager.releasePod(
    identity.workspaceId,
    identity.projectId,
    sanitizeWorkloadId(identity.taskId),
  ).then(
    () => true,
    (err: unknown) => {
      console.warn('[sandbox] releasePod failed for task %s: %s', identity.taskId, err instanceof Error ? err.message : err);
      return false;
    },
  );
  if (!released) return;
  await maybeReleaseInternalAgentWorkspaceBinding(deps, identity);
}

async function maybeReleaseInternalAgentWorkspaceBinding(
  deps: NodeApiDeps,
  identity: InternalTaskWorkloadIdentity,
): Promise<void> {
  const workspaceFileLibraryId = identity.workspaceFileLibraryId?.trim();
  if (!workspaceFileLibraryId) return;
  if (await hasBlockingTerminalSessionsForTask({
    terminalService: deps.notebookTerminalService,
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    taskId: identity.taskId,
    userId: identity.userId,
  })) {
    return;
  }
  if (await hasBlockingTaskRunForTerminal(deps.cache, identity.taskId)) {
    return;
  }
  const workspaceBindingManager = deps.internalAgentWorkspaceBindingManager
    ?? deps.internalAgentWorkspaceProvisioner;
  if (typeof workspaceBindingManager?.deleteWorkspaceBinding !== 'function') return;
  await workspaceBindingManager.deleteWorkspaceBinding({
    workspaceId: identity.workspaceId,
    fileLibraryId: workspaceFileLibraryId,
  });
}

function readManagedTerminalRuntimeDispatchContext(
  raw: Record<string, unknown> | undefined,
): ManagedTerminalRuntimeDispatchContext | null {
  const managedInternalAgent = raw?.managedInternalAgent;
  if (!managedInternalAgent || typeof managedInternalAgent !== 'object' || Array.isArray(managedInternalAgent)) {
    return null;
  }
  const workspaceFileLibraryId = (managedInternalAgent as Record<string, unknown>).workspaceFileLibraryId;
  if (typeof workspaceFileLibraryId !== 'string' || workspaceFileLibraryId.trim().length === 0) {
    return null;
  }
  return {
    managedInternalAgent: {
      workspaceFileLibraryId: workspaceFileLibraryId.trim(),
      ...(typeof (managedInternalAgent as Record<string, unknown>).taskHomeSegment === 'string'
        && ((managedInternalAgent as Record<string, unknown>).taskHomeSegment as string).trim()
        ? { taskHomeSegment: ((managedInternalAgent as Record<string, unknown>).taskHomeSegment as string).trim() }
        : {}),
    },
  };
}

async function ensureManagedTerminalRuntimeReady(
  deps: NodeApiDeps,
  session: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    userId: string;
    agentId: string;
    runnerSessionId: string;
    runtimeDispatchContext?: Record<string, unknown>;
  },
): Promise<void> {
  const runtimeDispatchContext = readManagedTerminalRuntimeDispatchContext(session.runtimeDispatchContext);
  if (!runtimeDispatchContext) return;
  if (!deps.internalAgentPodManager || !deps.internalAgentWorkspaceBindingManager) {
    throw new Error('task_terminal_internal_runtime_unavailable');
  }
  const agent = await deps.agentResourceService.getAgent(
    session.workspaceId,
    session.projectId,
    session.agentId,
  );
  if (!agent || !isManagedAgentRunner(agent)) {
    throw new Error('task_agent_not_available');
  }
  const tasks = await loadProjectTasks(deps, session.workspaceId, session.projectId);
  const task = tasks.find((item) => item.id === session.taskId && item.owner_user_id === session.userId);
  if (!task) {
    throw new Error('task_not_found');
  }
  if (task.workspace_file_library_id?.trim() !== runtimeDispatchContext.managedInternalAgent.workspaceFileLibraryId) {
    throw Object.assign(new Error('agent_task_workspace_binding_conflict'), {
      code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
    });
  }
  try {
    await resolveTaskWorkspaceBindingGuard({
      deps,
      task,
      actorUserId: session.userId,
      canUpdateProjectFiles: () => actorHasProjectPermissions({
        deps,
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        actorUserId: session.userId,
        requiredPermissions: ['project:files:update'],
      }),
    });
  } catch (error) {
    if (isTaskWorkspaceBindingGuardError(error)) {
      throw toTaskWorkspaceBindingGuardException(error);
    }
    throw error;
  }
  const workspaceBinding = await deps.internalAgentWorkspaceBindingManager.ensureWorkspaceBinding({
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    fileLibraryId: runtimeDispatchContext.managedInternalAgent.workspaceFileLibraryId,
    taskId: session.taskId,
    taskHomeSegment: runtimeDispatchContext.managedInternalAgent.taskHomeSegment ?? resolveTaskHomeSegment({
      id: session.taskId,
      workspace_id: session.workspaceId,
      project_id: session.projectId,
    }),
    actorUserId: session.userId,
    requestId: session.runnerSessionId,
  });
  await deps.internalAgentPodManager.ensureAgentReady({
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    workloadId: sanitizeWorkloadId(session.taskId),
    sessionId: session.runnerSessionId,
    agent,
    workspaceMount: workspaceBinding.workspaceMount,
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

function buildTaskRunnerEvidenceMissingResponse(input: {
  taskId: string;
  runId?: string | null;
}): {
  error_code: 'TASK_RUNNER_EVIDENCE_MISSING';
  message: 'task_runner_evidence_missing';
  task_id: string;
  run_id?: string;
} {
  return {
    error_code: 'TASK_RUNNER_EVIDENCE_MISSING',
    message: 'task_runner_evidence_missing',
    task_id: input.taskId,
    ...(input.runId ? { run_id: input.runId } : {}),
  };
}

type AgentTaskDeleteBlocker =
  | {
      type: 'active_run';
      run_id: string;
      phase?: string;
    }
  | {
      type: 'active_terminal';
    }
  | {
      type: 'hard_teardown';
      run_id: string;
      status: string;
    }
  | {
      type: 'workspace_holder';
      holder: string;
    };

async function collectAgentTaskDeleteBlockers(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  task: TaskRecord;
  userId: string;
}): Promise<AgentTaskDeleteBlocker[]> {
  const blockers: AgentTaskDeleteBlocker[] = [];
  const activeRun = await getNotebookTaskRunState(args.deps.cache, args.task.id);
  if (activeRun) {
    blockers.push({
      type: 'active_run',
      run_id: activeRun.run_id,
      phase: activeRun.phase,
    });
  }
  const hardTeardownDebt = await getNotebookTaskRunHardTeardownDebt(args.deps.cache, args.task.id);
  if (hardTeardownDebt) {
    blockers.push({
      type: 'hard_teardown',
      run_id: hardTeardownDebt.run_id,
      status: hardTeardownDebt.status,
    });
  }
  if (await hasBlockingTerminalSessionsForTask({
    terminalService: args.deps.notebookTerminalService,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.task.id,
    userId: args.userId,
  })) {
    blockers.push({ type: 'active_terminal' });
  }
  const workloadId = sanitizeWorkloadId(args.task.id);
  const coordinator = resolveInternalWorkloadCoordinator(args.deps);
  const snapshotReader = coordinator as {
    readSnapshotForTests?: () => Array<{
      workspaceId: string;
      projectId: string;
      workloadId: string;
      holders: string[];
    }>;
  } | undefined;
  const holderSnapshots = typeof snapshotReader?.readSnapshotForTests === 'function'
    ? snapshotReader.readSnapshotForTests().filter((snapshot) => (
      snapshot.workspaceId === args.workspaceId
      && snapshot.projectId === args.projectId
      && snapshot.workloadId === workloadId
    ))
    : [];
  for (const snapshot of holderSnapshots) {
    for (const holder of snapshot.holders) {
      blockers.push({
        type: 'workspace_holder',
        holder,
      });
    }
  }
  const liveWorkspaceHolders = await new JsonDocTaskWorkspaceHolderRepo(args.deps.docStore).listLiveByTask({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    taskId: args.task.id,
    bindingGeneration: args.task.file_library_binding_generation,
  });
  for (const holder of liveWorkspaceHolders) {
    blockers.push({
      type: 'workspace_holder',
      holder: `${holder.holderKind}:${holder.holderId}`,
    });
  }
  return blockers;
}

async function markTaskDeletingFence(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  task: TaskRecord;
  correlationId: string;
}): Promise<TaskRecord> {
  if (input.task.deletion_state === 'deleting') {
    return input.task;
  }
  const now = nowIso();
  const result = await input.deps.docStore.updateIfMatch<TaskRecord>(
    notebookTasksCollection(input.workspaceId),
    input.task.id,
    {
      expected: {
        workspace_id: input.task.workspace_id,
        project_id: input.task.project_id,
        owner_user_id: input.task.owner_user_id,
        status: input.task.status,
      },
      patch: {
        deletion_state: 'deleting',
        deleting_started_at: now,
        delete_correlation_id: input.correlationId,
        updated_at: now,
      },
    },
  );
  if (result.ok) {
    Object.assign(input.task, result.doc);
    return input.task;
  }
  const current = result.current;
  if (current?.deletion_state === 'deleting') {
    Object.assign(input.task, current);
    return input.task;
  }
  throw Object.assign(new Error('agent_task_delete_conflict'), {
    code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
  });
}

async function rollbackTaskDeletingFence(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  task: TaskRecord;
  correlationId: string;
}): Promise<void> {
  const current = await input.deps.docStore.get<TaskRecord>(
    notebookTasksCollection(input.workspaceId),
    input.task.id,
  );
  if (
    !current
    || current.deletion_state !== 'deleting'
    || current.delete_correlation_id !== input.correlationId
  ) {
    return;
  }
  const rollback: TaskRecord = {
    ...current,
    updated_at: nowIso(),
  };
  delete rollback.deletion_state;
  delete rollback.deleting_started_at;
  delete rollback.delete_correlation_id;
  await input.deps.docStore.updateIfMatch<TaskRecord>(
    notebookTasksCollection(input.workspaceId),
    input.task.id,
    {
      expected: {
        deletion_state: 'deleting',
        delete_correlation_id: input.correlationId,
      },
      replace: rollback,
    },
  );
  Object.assign(input.task, rollback);
}

function buildNotebookHardTeardownDebtStopResponse(input: {
  deps: NodeApiDeps;
  agent: AgentRecord | null | undefined;
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
      : input.agent && isManagedAgentRunner(input.agent) ? 'unmanaged_runner' : 'unsupported_runner',
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
      beforeSessionRuntimeDispatch?: (session: {
        workspaceId: string;
        projectId: string;
        taskId: string;
        userId: string;
        agentId: string;
        runnerSessionId: string;
        runtimeDispatchContext?: Record<string, unknown>;
      }) => void | Promise<void>;
      onSessionClosed?: (session: {
        workspaceId: string;
        projectId: string;
        taskId: string;
        userId: string;
        agentId: string;
        runtimeDispatchContext?: Record<string, unknown>;
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
    beforeSessionRuntimeDispatch: async (session) => {
      await ensureManagedTerminalRuntimeReady(deps, session);
    },
    onSessionClosed: async (session) => {
      const runtimeDispatchContext = readManagedTerminalRuntimeDispatchContext(session.runtimeDispatchContext);
      await maybeReleaseInternalAgentWorkload(deps, {
        workspaceId: session.workspaceId,
        projectId: session.projectId,
        taskId: session.taskId,
        userId: session.userId,
        agentId: session.agentId,
        workspaceFileLibraryId: runtimeDispatchContext?.managedInternalAgent.workspaceFileLibraryId ?? null,
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

function mapTaskArtifactMetadataPathToWorkspaceObjectKey(relativePath: string): string | null {
  let normalized: string;
  try {
    normalized = normalizeStorageObjectPath(relativePath);
  } catch {
    return null;
  }
  if (normalized !== '.artifacts' && !normalized.startsWith('.artifacts/')) {
    return null;
  }
  return `workspace/${normalized}`;
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
  const library = await new JsonDocProjectFileLibraryCatalogRepo(args.deps.docStore)
    .getById(args.workspaceId, args.projectId, libraryId);
  if (!library || library.created_by_user_id !== args.task.owner_user_id) {
    return false;
  }
  if (!args.deps.fileLibraryStorageAdapter?.enabled) {
    return false;
  }
  const objectPath = mapTaskArtifactMetadataPathToWorkspaceObjectKey(relativePath);
  if (!objectPath) {
    return false;
  }
  const operation = createHttpOperationEnvelope({
    req: args.req,
    res: args.res,
  });
  let handedOffToStream = false;
  try {
    const { meta, download } = await awaitAbortableOperation(
      args.deps.fileLibraryStorageAdapter.downloadObject({
        workspaceId: args.workspaceId,
        projectId: args.projectId,
        libraryId,
        objectPath,
        signal: operation.signal,
      }),
      {
        signal: operation.signal,
        abortMessage: 'task_artifact_download_aborted',
        onLateResolve: async (lateResult, reason) => {
          await lateResult.download.cancel(reason);
        },
      },
    );
    if (operation.signal.aborted) {
      await download.cancel(operation.signal.reason);
      return true;
    }
    const filename = (args.artifact.title?.trim() || objectPath.split('/').at(-1) || 'artifact');
    args.res.statusCode = 200;
    args.res.setHeader(
      'Content-Type',
      meta.content_type ?? args.artifact.mime_type?.trim() ?? guessFileLibraryContentType(objectPath) ?? 'application/octet-stream',
    );
    args.res.setHeader('Content-Length', String(meta.size_bytes));
    args.res.setHeader('Content-Disposition', buildAttachmentContentDisposition(filename));
    pipeObjectDownloadToHttpResponse({
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

async function ensureTaskRunnerSessionDispatchable(args: {
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

async function preflightManagedRunnerRuntimeForTask(args: {
  deps: NodeApiDeps;
  task: TaskRecord;
  runner: AgentRecord;
  requiresWorkloadCoordinator?: boolean;
}): Promise<Extract<AgentRunnerResolutionResult, { ok: false }> | null> {
  if (!isManagedAgentRunner(args.runner)) {
    return null;
  }
  const fail = (reason: string, extra?: Record<string, unknown>): Extract<AgentRunnerResolutionResult, { ok: false }> => ({
    ok: false,
    code: 'agent_runner_runtime_unavailable',
    metadata: {
      runner_id: args.runner.id,
      reason,
      ...(extra ?? {}),
    },
  });

  if (!resolveManagedExecutionApiBase()) {
    return fail('internal_api_base_not_configured');
  }
  if (!args.deps.internalAgentPodManager) {
    return fail('asbcp_not_configured');
  }
  if (!args.deps.internalAgentWorkspaceBindingManager && !args.deps.internalAgentWorkspaceProvisioner) {
    return fail('workspace_binding_manager_not_configured');
  }
  if (args.requiresWorkloadCoordinator && !resolveInternalWorkloadCoordinator(args.deps)) {
    return fail('internal_workload_coordinator_not_configured');
  }
  if (!args.task.workspace_file_library_id?.trim()) {
    return fail('workspace_file_library_id_required');
  }
  const checkReady = (args.deps.internalAgentPodManager as {
    checkReady?: () => Promise<void>;
  }).checkReady;
  if (typeof checkReady === 'function') {
    try {
      await checkReady.call(args.deps.internalAgentPodManager);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
      return fail('sandbox_unavailable', {
        sandbox_error_code: typeof code === 'string' ? code : 'AGENT_SANDBOX_UNAVAILABLE',
      });
    }
  }
  return null;
}

function buildTaskWorkspaceBindingGuardHttpResponse(error: TaskWorkspaceBindingGuardError): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (error.errorCode === 'FILE_LIBRARY_NOT_FOUND') {
    return {
      statusCode: 404,
      body: {
        error_code: 'FILE_LIBRARY_NOT_FOUND',
        message: 'file_library_not_found',
        ...(error.metadata.fileLibraryId ? { file_library_id: error.metadata.fileLibraryId } : {}),
      },
    };
  }
  return {
    statusCode: error.statusCode,
    body: serializeTaskWorkspaceBindingGuardError(error),
  };
}

async function preflightManagedTaskWorkspaceBindingGuard(args: {
  deps: NodeApiDeps;
  task: TaskRecord;
  runner: AgentRecord;
  actorUserId: string;
}): Promise<{
  ok: true;
} | {
  ok: false;
  statusCode: number;
  body: Record<string, unknown>;
}> {
  if (!isManagedAgentRunner(args.runner)) {
    return { ok: true };
  }
  try {
    await resolveTaskWorkspaceBindingGuard({
      deps: args.deps,
      task: args.task,
      actorUserId: args.actorUserId,
      canUpdateProjectFiles: () => actorHasProjectPermissions({
        deps: args.deps,
        workspaceId: args.task.workspace_id,
        projectId: args.task.project_id,
        actorUserId: args.actorUserId,
        requiredPermissions: ['project:files:update'],
      }),
    });
    return { ok: true };
  } catch (error) {
    if (!isTaskWorkspaceBindingGuardError(error)) {
      throw error;
    }
    return {
      ok: false,
      ...buildTaskWorkspaceBindingGuardHttpResponse(error),
    };
  }
}

function readTaskWorkspaceAccessReleaseRequest(raw: unknown): {
  ok: true;
  holderId: string;
  fileLibraryId: string;
  bindingGeneration: number;
  bindingGenerationWire: string;
  leaseEpoch: string;
} | {
  ok: false;
  field: string;
} {
  const body = asObject(raw);
  const holderId = typeof body.holder_id === 'string' ? body.holder_id.trim() : '';
  if (!holderId) return { ok: false, field: 'holder_id' };
  const fileLibraryId = typeof body.file_library_id === 'string' ? body.file_library_id.trim() : '';
  if (!fileLibraryId) return { ok: false, field: 'file_library_id' };
  const bindingGenerationWire = typeof body.binding_generation === 'string' ? body.binding_generation.trim() : '';
  if (!/^\d+$/.test(bindingGenerationWire)) return { ok: false, field: 'binding_generation' };
  const bindingGeneration = Number(bindingGenerationWire);
  if (!Number.isSafeInteger(bindingGeneration) || bindingGeneration <= 0) {
    return { ok: false, field: 'binding_generation' };
  }
  const leaseEpoch = typeof body.lease_epoch === 'string' ? body.lease_epoch.trim() : '';
  if (!leaseEpoch) return { ok: false, field: 'lease_epoch' };
  return {
    ok: true,
    holderId,
    fileLibraryId,
    bindingGeneration,
    bindingGenerationWire,
    leaseEpoch,
  };
}

export async function handleTaskRoute(args: TaskRouteHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, internalTicket, json, readBody } = args;
  ensureInternalTerminalLifecycleIntegration(deps);
  const catalogRepo = new JsonDocProjectFileLibraryCatalogRepo(deps.docStore);

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
    const requestAbort = createTaskRouteRequestAbortSignal(req, res);
    try {
    const existingTasks = await loadProjectTasks(deps, route.workspaceId, route.projectId);
    await hydrateTaskFileLibraryBindingsForProject({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      tasks: existingTasks,
    });
    const body = asObject(await readBody(req));
    requestAbort.armPostBodyDisconnects();
    const requestId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
    const unsupportedFields = collectUnsupportedFields(body, UNSUPPORTED_TASK_BINDING_FIELDS);
    if (unsupportedFields.length > 0) {
      json(res, 400, {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      });
      return true;
    }
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const workspaceMode = typeof body.workspace_mode === 'string' ? body.workspace_mode.trim() : '';
    const workspaceFileLibraryId = typeof body.workspace_file_library_id === 'string'
      ? body.workspace_file_library_id.trim()
      : '';
    const taskFileTemplateId = typeof body.task_file_template_id === 'string'
      ? body.task_file_template_id.trim()
      : '';
    const effectiveWorkspaceMode = workspaceMode || 'create_new';
    const createsNewTaskFileLibrary = effectiveWorkspaceMode === 'create_new'
      || effectiveWorkspaceMode === 'use_template';
    const requestedWorkspaceName = typeof body.workspace_name === 'string' ? body.workspace_name.trim() : '';
    if (!title) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'task_title_required' });
      return true;
    }
    if (
      (workspaceMode !== '' && workspaceMode !== 'create_new' && workspaceMode !== 'use_existing' && workspaceMode !== 'use_template')
      || (effectiveWorkspaceMode === 'create_new' && (workspaceFileLibraryId || taskFileTemplateId))
      || (effectiveWorkspaceMode === 'use_existing' && taskFileTemplateId)
      || (effectiveWorkspaceMode === 'use_template' && workspaceFileLibraryId)
    ) {
      json(res, 422, {
        error_code: 'AGENT_TASK_WORKSPACE_MODE_INVALID',
        message: 'agent_task_workspace_mode_invalid',
        field: 'workspace_mode',
        workspace_mode: effectiveWorkspaceMode,
      });
      return true;
    }
    if (effectiveWorkspaceMode === 'use_existing' && !workspaceFileLibraryId) {
      json(res, 422, {
        error_code: 'AGENT_TASK_WORKSPACE_FILE_LIBRARY_REQUIRED',
        message: 'agent_task_workspace_file_library_required',
        field: 'workspace_file_library_id',
      });
      return true;
    }
    if (effectiveWorkspaceMode === 'use_template' && !taskFileTemplateId) {
      json(res, 422, {
        error_code: 'AGENT_TASK_FILE_TEMPLATE_REQUIRED',
        message: 'agent_task_file_template_required',
        field: 'task_file_template_id',
      });
      return true;
    }

    const initialInputs = readTaskInputRefs(body.input_refs ?? body.initial_inputs);
    const requestedBoundRunnerId = typeof body.bound_runner_id === 'string' ? body.bound_runner_id.trim() : '';
    if (requestedBoundRunnerId) {
      const probeTask: TaskRecord = {
        ...buildRunnerBindingProbeTask({
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          userId: user.id,
        }),
        attached_inputs: initialInputs,
      };
      const explicitRunnerResolution = await resolveExplicitDeveloperAgentRunnerForTask({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        task: probeTask,
        user,
        requestedInputs: initialInputs,
        boundRunnerId: requestedBoundRunnerId,
        requestId,
        source: 'agent_runner_binding',
      });
      if (!explicitRunnerResolution.ok) {
        if (explicitRunnerResolution.code === DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE) {
          json(res, 409, buildDeveloperRunnerTaskHomeBindingUnavailableResponse());
          return true;
        }
        json(res, 409, {
          error_code: explicitRunnerResolution.code,
          message: explicitRunnerResolution.code,
        });
        return true;
      }
      if (!isDeveloperRunnerTaskHomeBindingAvailable()) {
        json(res, 409, buildDeveloperRunnerTaskHomeBindingUnavailableResponse());
        return true;
      }
    }

    let workspaceFileLibrary = workspaceFileLibraryId
      ? await catalogRepo.getById(route.workspaceId, route.projectId, workspaceFileLibraryId)
      : null;
    const templateRepo = new JsonDocProjectTaskFileTemplateRepo(deps.docStore);
    const taskFileTemplate = effectiveWorkspaceMode === 'use_template'
      ? await templateRepo.getById(route.workspaceId, route.projectId, taskFileTemplateId)
      : null;
    if (effectiveWorkspaceMode === 'use_template' && !taskFileTemplate) {
      json(res, 404, {
        error_code: 'TASK_FILE_TEMPLATE_NOT_FOUND',
        message: 'task_file_template_not_found',
        task_file_template_id: taskFileTemplateId,
      });
      return true;
    }
    if (effectiveWorkspaceMode === 'use_template' && taskFileTemplate?.status !== 'published') {
      json(res, 409, {
        error_code: 'TASK_FILE_TEMPLATE_UNPUBLISHED',
        message: 'task_file_template_unpublished',
        task_file_template_id: taskFileTemplateId,
      });
      return true;
    }
    if (effectiveWorkspaceMode === 'create_new') {
      try {
        workspaceFileLibrary = await createAndProvisionProjectFileLibrary({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          userId: user.id,
          name: requestedWorkspaceName || defaultWorkspaceNameFromTaskTitle(title),
          description: `Auto-initialized workspace for notebook task "${title}".`,
          requestId,
          projectStorageReadyWait: {
            ...DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
            signal: requestAbort.signal,
          },
        });
      } catch (error) {
        const mapped = mapFileLibraryInfraError(error);
        json(res, mapped.statusCode, {
          error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
            ? 'FILE_LIBRARY_PROVISIONING_FAILED'
            : mapped.errorCode,
          message: mapped.message,
          ...(mapped.context ?? {}),
        });
        return true;
      }
    }
    if (effectiveWorkspaceMode === 'use_template' && taskFileTemplate) {
      try {
        workspaceFileLibrary = await createAndCloneTaskFileTemplateLibrary({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          userId: user.id,
          template: taskFileTemplate,
          name: requestedWorkspaceName || defaultWorkspaceNameFromTaskTitle(title),
          description: `Auto-initialized workspace for notebook task "${title}" from template "${taskFileTemplate.name}".`,
          requestId,
          projectStorageReadyWait: {
            ...DEFAULT_FILE_LIBRARY_PROJECT_STORAGE_READY_WAIT,
            signal: requestAbort.signal,
          },
        });
      } catch (error) {
        const mapped = mapFileLibraryInfraError(error);
        json(res, mapped.statusCode, {
          error_code: mapped.errorCode === 'FILE_LIBRARY_OPERATION_FAILED'
            ? 'FILE_LIBRARY_PROVISIONING_FAILED'
            : mapped.errorCode,
          message: mapped.message,
          ...(mapped.context ?? {}),
        });
        return true;
      }
    }
    if (!workspaceFileLibrary) {
      json(res, 404, {
        error_code: 'FILE_LIBRARY_NOT_FOUND',
        message: 'file_library_not_found',
        file_library_id: workspaceFileLibraryId,
      });
      return true;
    }
    if (workspaceFileLibrary.created_by_user_id !== user.id) {
      json(res, 403, {
        error_code: 'FILE_LIBRARY_FORBIDDEN',
        message: 'file_library_forbidden',
        file_library_id: workspaceFileLibrary.id,
      });
      return true;
    }
    if (workspaceFileLibrary.status !== 'ready') {
      json(res, 409, {
        error_code: workspaceFileLibrary.status === 'deleting' || workspaceFileLibrary.status === 'deleted'
          ? 'FILE_LIBRARY_DELETING'
          : 'FILE_LIBRARY_NOT_READY',
        message: workspaceFileLibrary.status === 'deleting' || workspaceFileLibrary.status === 'deleted'
          ? 'file_library_deleting'
          : 'file_library_not_ready',
        file_library_id: workspaceFileLibrary.id,
        file_library_status: workspaceFileLibrary.status,
      });
      return true;
    }
    const existingBinding = await findTaskFileLibraryBinding({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      fileLibraryId: workspaceFileLibrary.id,
    });
    if (existingBinding) {
      await writeTaskFileLibraryBindingAcquireAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        fileLibraryId: workspaceFileLibrary.id,
        binding: existingBinding,
        requestId,
        result: 'error',
        errorCode: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
        errorMessage: 'workspace_file_library_in_use',
        reason: 'current_binding_exists',
      });
      json(res, 409, {
        ...buildAgentTaskFileLibraryInUseConflict({
          fileLibraryId: workspaceFileLibrary.id,
          binding: existingBinding,
          actorUserId: user.id,
        }),
      });
      return true;
    }

    const createdAt = nowIso();
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
      ...(prompt ? { prompt } : {}),
      task_home_segment: '',
      workspace_file_library_id: workspaceFileLibrary.id,
      workspace_file_library_name: workspaceFileLibrary.name,
      file_library_binding_generation: undefined,
      runtime_writable_affordance: 'task_internal_home',
      status: 'active',
      attached_inputs: initialInputs,
      created_at: createdAt,
      updated_at: createdAt,
      last_activity_at: createdAt,
    };
    task.task_home_segment = workspaceFileLibrary.file_library_home_segment;
    const taskHomeSegmentConflict = findTaskHomeSegmentConflict(
      getTasks(route.workspaceId, route.projectId),
      {
        taskId: task.id,
        taskHomeSegment: task.task_home_segment,
      },
    );
    if (taskHomeSegmentConflict) {
      json(res, 409, {
        error_code: 'AGENT_TASK_HOME_SEGMENT_CONFLICT',
        message: 'task_home_segment_conflict',
        task_home_segment: task.task_home_segment,
        conflicting_task_id: taskHomeSegmentConflict.id,
      });
      return true;
    }
    const lifecycleFence = await catalogRepo.acquireReadyLifecycleFence({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: workspaceFileLibrary.id,
      expectedVersion: workspaceFileLibrary.version,
      taskId: task.id,
      correlationId: requestId ?? task.id,
      now: createdAt,
    });
    if (!lifecycleFence.ok) {
      if (createsNewTaskFileLibrary) {
        await compensateAutoCreatedTaskFileLibrary({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          libraryId: workspaceFileLibrary.id,
          actorUserId: user.id,
          requestId,
        });
      }
      await writeTaskFileLibraryBindingAcquireAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        fileLibraryId: workspaceFileLibrary.id,
        taskId: task.id,
        requestId,
        result: 'error',
        errorCode: lifecycleFence.code,
        errorMessage: lifecycleFence.code === 'FILE_LIBRARY_DELETING'
          ? 'file_library_deleting'
          : lifecycleFence.code === 'FILE_LIBRARY_NOT_FOUND'
            ? 'file_library_not_found'
            : 'file_library_not_ready',
        reason: 'library_lifecycle_fence_unavailable',
      });
      json(res, lifecycleFence.code === 'FILE_LIBRARY_NOT_FOUND' ? 404 : 409, {
        error_code: lifecycleFence.code,
        message: lifecycleFence.code === 'FILE_LIBRARY_DELETING'
          ? 'file_library_deleting'
          : lifecycleFence.code === 'FILE_LIBRARY_NOT_FOUND'
            ? 'file_library_not_found'
            : 'file_library_not_ready',
        file_library_id: workspaceFileLibrary.id,
        ...(lifecycleFence.library ? { file_library_status: lifecycleFence.library.status } : {}),
      });
      return true;
    }
    workspaceFileLibrary = lifecycleFence.fence.library;
    const taskFileLibraryBinding = await acquireTaskFileLibraryBinding({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      fileLibraryId: workspaceFileLibrary.id,
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
      ownerUserId: task.owner_user_id,
      runtimeWritableAffordance: task.runtime_writable_affordance ?? 'task_internal_home',
      correlationId: requestId ?? task.id,
      now: createdAt,
    });
    if (!taskFileLibraryBinding.ok) {
      await catalogRepo.releaseReadyLifecycleFence({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: workspaceFileLibrary.id,
        expectedVersion: lifecycleFence.fence.version,
        token: lifecycleFence.fence.token,
      });
      if (createsNewTaskFileLibrary) {
        await compensateAutoCreatedTaskFileLibrary({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          libraryId: workspaceFileLibrary.id,
          actorUserId: user.id,
          requestId,
        });
      }
      await writeTaskFileLibraryBindingAcquireAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        fileLibraryId: workspaceFileLibrary.id,
        binding: taskFileLibraryBinding.binding,
        requestId,
        result: 'error',
        errorCode: 'AGENT_TASK_FILE_LIBRARY_IN_USE',
        errorMessage: 'workspace_file_library_in_use',
        reason: 'durable_binding_exists',
      });
      json(res, 409, buildAgentTaskFileLibraryInUseConflict({
        fileLibraryId: workspaceFileLibrary.id,
        binding: taskFileLibraryBinding.binding,
        actorUserId: user.id,
      }));
      return true;
    }
    const acquiredGeneration = taskFileLibraryBinding.binding.bindingGeneration;
    const lifecycleFenceVerified = await catalogRepo.verifyReadyLifecycleFence({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: workspaceFileLibrary.id,
      expectedVersion: lifecycleFence.fence.version,
      token: lifecycleFence.fence.token,
    });
    const verifiedCurrentBinding = await findTaskFileLibraryBinding({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      fileLibraryId: workspaceFileLibrary.id,
    });
    const currentBindingStillOwned = verifiedCurrentBinding?.taskId === task.id
      && verifiedCurrentBinding.bindingGeneration === acquiredGeneration;
    if (!lifecycleFenceVerified.ok || !currentBindingStillOwned) {
      await releaseTaskFileLibraryBindingWithAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        fileLibraryId: workspaceFileLibrary.id,
        taskId: task.id,
        bindingGeneration: acquiredGeneration,
        correlationId: requestId ?? task.id,
        requestId,
        reason: !lifecycleFenceVerified.ok ? 'library_lifecycle_fence_changed_after_acquire' : 'binding_changed_after_acquire',
      });
      await catalogRepo.releaseReadyLifecycleFence({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        libraryId: workspaceFileLibrary.id,
        expectedVersion: lifecycleFence.fence.version,
        token: lifecycleFence.fence.token,
      });
      if (createsNewTaskFileLibrary) {
        await compensateAutoCreatedTaskFileLibrary({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          libraryId: workspaceFileLibrary.id,
          actorUserId: user.id,
          requestId,
        });
      }
      await writeTaskFileLibraryBindingAcquireAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        fileLibraryId: workspaceFileLibrary.id,
        taskId: task.id,
        requestId,
        result: 'error',
        errorCode: lifecycleFenceVerified.ok
          ? 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT'
          : lifecycleFenceVerified.code === 'FILE_LIBRARY_DELETING'
          ? 'FILE_LIBRARY_DELETING'
          : lifecycleFenceVerified.code === 'FILE_LIBRARY_NOT_FOUND'
            ? 'FILE_LIBRARY_NOT_FOUND'
            : 'FILE_LIBRARY_NOT_READY',
        errorMessage: lifecycleFenceVerified.ok
          ? 'agent_task_workspace_binding_conflict'
          : lifecycleFenceVerified.code === 'FILE_LIBRARY_DELETING'
          ? 'file_library_deleting'
          : lifecycleFenceVerified.code === 'FILE_LIBRARY_NOT_FOUND'
            ? 'file_library_not_found'
            : 'file_library_not_ready',
        reason: !lifecycleFenceVerified.ok ? 'library_lifecycle_fence_changed_after_acquire' : 'binding_changed_after_acquire',
      });
      if (!lifecycleFenceVerified.ok && lifecycleFenceVerified.code === 'FILE_LIBRARY_NOT_FOUND') {
        json(res, 404, {
          error_code: 'FILE_LIBRARY_NOT_FOUND',
          message: 'file_library_not_found',
          file_library_id: workspaceFileLibrary.id,
        });
      } else if (!lifecycleFenceVerified.ok && lifecycleFenceVerified.code === 'FILE_LIBRARY_DELETING') {
        json(res, 409, {
          error_code: 'FILE_LIBRARY_DELETING',
          message: 'file_library_deleting',
          file_library_id: workspaceFileLibrary.id,
          file_library_status: lifecycleFenceVerified.library?.status ?? 'deleting',
        });
      } else if (!currentBindingStillOwned) {
        json(res, 409, {
          error_code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
          message: 'agent_task_workspace_binding_conflict',
          task_id: task.id,
          file_library_id: workspaceFileLibrary.id,
          ...(bindingGenerationToWire(verifiedCurrentBinding?.bindingGeneration)
            ? { binding_generation: bindingGenerationToWire(verifiedCurrentBinding?.bindingGeneration) }
            : {}),
        });
      } else {
        json(res, 409, {
          error_code: 'FILE_LIBRARY_NOT_READY',
          message: 'file_library_not_ready',
          file_library_id: workspaceFileLibrary.id,
          file_library_status: lifecycleFenceVerified.library?.status ?? workspaceFileLibrary.status,
        });
      }
      return true;
    }
    const releasedLifecycleFence = await catalogRepo.releaseReadyLifecycleFence({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      libraryId: workspaceFileLibrary.id,
      expectedVersion: lifecycleFence.fence.version,
      token: lifecycleFence.fence.token,
    });
    if (!releasedLifecycleFence.ok) {
      await releaseTaskFileLibraryBindingWithAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        fileLibraryId: workspaceFileLibrary.id,
        taskId: task.id,
        bindingGeneration: acquiredGeneration,
        correlationId: requestId ?? task.id,
        requestId,
        reason: 'library_lifecycle_fence_release_failed',
      });
      if (createsNewTaskFileLibrary) {
        await compensateAutoCreatedTaskFileLibrary({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          libraryId: workspaceFileLibrary.id,
          actorUserId: user.id,
          requestId,
        });
      }
      json(res, releasedLifecycleFence.code === 'FILE_LIBRARY_NOT_FOUND' ? 404 : 409, {
        error_code: releasedLifecycleFence.code,
        message: releasedLifecycleFence.code === 'FILE_LIBRARY_DELETING'
          ? 'file_library_deleting'
          : releasedLifecycleFence.code === 'FILE_LIBRARY_NOT_FOUND'
            ? 'file_library_not_found'
            : 'file_library_not_ready',
        file_library_id: workspaceFileLibrary.id,
        ...(releasedLifecycleFence.library ? { file_library_status: releasedLifecycleFence.library.status } : {}),
      });
      return true;
    }
    workspaceFileLibrary = releasedLifecycleFence.library;
    await writeTaskFileLibraryBindingAcquireAudit({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorUserId: user.id,
      fileLibraryId: workspaceFileLibrary.id,
      taskId: task.id,
      binding: taskFileLibraryBinding.binding,
      requestId,
      result: 'ok',
    });
    task.file_library_binding_generation = taskFileLibraryBinding.binding.bindingGeneration;

    let taskPersisted = false;
    try {
      const binding = await bindAgentRunnerForTask({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        task,
        user,
        requestedInputs: initialInputs,
        boundRunnerId: typeof body.bound_runner_id === 'string' ? body.bound_runner_id : null,
        requestId,
      });
      if (!binding.ok) {
        await releaseTaskFileLibraryBindingWithAudit({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actorUserId: user.id,
          fileLibraryId: task.workspace_file_library_id,
          taskId: task.id,
          bindingGeneration: task.file_library_binding_generation,
          correlationId: requestId ?? task.id,
          requestId,
          reason: 'agent_runner_binding_failed',
        });
        if (createsNewTaskFileLibrary) {
          await compensateAutoCreatedTaskFileLibrary({
            deps,
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            libraryId: task.workspace_file_library_id,
            actorUserId: user.id,
            requestId,
          });
        }
        await writeProjectAuditEvent(deps, {
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actor: { type: 'user', id: user.id },
          action: 'agent_runner.binding.failed',
          result: 'error',
          requestId,
          resourceType: 'notebook_task',
          resourceId: task.id,
          errorCode: binding.code,
          errorMessage: binding.code,
          metadata: {
            failure_code: binding.code,
            workspace_file_library_id: task.workspace_file_library_id,
            ...(binding.metadata ?? {}),
          },
        });
        json(res, 409, {
          error_code: binding.code,
          message: binding.code,
        });
        return true;
      }
      const modelReadiness = await new AgentTaskModelSettingService(deps).getReadiness({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
      });
      if (modelReadiness.state !== 'ready') {
        await releaseTaskFileLibraryBindingWithAudit({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actorUserId: user.id,
          fileLibraryId: task.workspace_file_library_id,
          taskId: task.id,
          bindingGeneration: task.file_library_binding_generation,
          correlationId: requestId ?? task.id,
          requestId,
          reason: 'agent_task_model_not_ready',
        });
        if (createsNewTaskFileLibrary) {
          await compensateAutoCreatedTaskFileLibrary({
            deps,
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            libraryId: task.workspace_file_library_id,
            actorUserId: user.id,
            requestId,
          });
        }
        json(res, 409, {
          error_code: modelReadiness.reason_code ?? 'agent_task_model_setting_missing',
          message: modelReadiness.reason_code ?? 'agent_task_model_setting_missing',
          readiness: {
            state: modelReadiness.state,
            display_summary: modelReadiness.display_summary,
          },
        });
        return true;
      }
      task.bound_runner_id = binding.runner.id;
      task.bound_runner_kind = binding.bindingKind;
      task.runner_binding_source = binding.bindingSource;
      task.bound_at = createdAt;
      task.bound_by_user_id = user.id;
      await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
      taskPersisted = true;
      getTasks(route.workspaceId, route.projectId).unshift(task);
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'notebook.task.created',
        resourceType: 'notebook_task',
        resourceId: task.id,
        requestId,
        metadata: {
          workspace_file_library_id: task.workspace_file_library_id,
          task_home_binding_status: 'bound',
          initial_input_count: task.attached_inputs.length,
          bound_runner_id: task.bound_runner_id,
          bound_runner_kind: task.bound_runner_kind,
          runner_binding_source: task.runner_binding_source,
        },
      });
      json(res, 201, await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task));
      return true;
    } catch (error) {
      if (!taskPersisted) {
        await releaseTaskFileLibraryBindingWithAudit({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actorUserId: user.id,
          fileLibraryId: task.workspace_file_library_id,
          taskId: task.id,
          bindingGeneration: task.file_library_binding_generation,
          correlationId: requestId ?? task.id,
          requestId,
          reason: 'task_create_exception',
        });
        if (createsNewTaskFileLibrary) {
          await compensateAutoCreatedTaskFileLibrary({
            deps,
            workspaceId: route.workspaceId,
            projectId: route.projectId,
            libraryId: task.workspace_file_library_id,
            actorUserId: user.id,
            requestId,
          });
        }
      }
      throw error;
    }
    } finally {
      requestAbort.dispose();
    }
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
    const body = asObject(await readBody(req));
    const cols = typeof body.cols === 'number' && Number.isFinite(body.cols) ? Math.floor(body.cols) : 120;
    const rows = typeof body.rows === 'number' && Number.isFinite(body.rows) ? Math.floor(body.rows) : 30;
    const shell = typeof body.shell === 'string' ? body.shell.trim() : '';
    const terminalRunnerResolution = await resolveTerminalSessionRunner({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      task,
      user,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
    });
    if (!terminalRunnerResolution.ok) {
      if (terminalRunnerResolution.auditResolution) {
        await writeAgentRunnerResolutionAudit({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          user,
          taskId: route.taskId,
          requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
          result: terminalRunnerResolution.auditResolution,
        });
      }
      if (terminalRunnerResolution.code === DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE) {
        json(res, 409, buildDeveloperRunnerTaskHomeBindingUnavailableResponse());
        return true;
      }
      json(res, 409, {
        error_code: terminalRunnerResolution.code,
        message: terminalRunnerResolution.code,
      });
      return true;
    }
    const agent = terminalRunnerResolution.runner;
    if (terminalRunnerResolution.auditResolution) {
      await writeAgentRunnerResolutionAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        user,
        taskId: route.taskId,
        requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
        result: terminalRunnerResolution.auditResolution,
      });
    }
    if (!agent || agent.status !== 'enabled') {
      json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'task_agent_not_available' });
      return true;
    }
    if (isDeveloperAgentRunner(agent) && !isDeveloperRunnerTaskHomeBindingAvailable()) {
      json(res, 409, buildDeveloperRunnerTaskHomeBindingUnavailableResponse());
      return true;
    }

    if (isManagedAgentRunner(agent)) {
      const runtimePreflight = await preflightManagedRunnerRuntimeForTask({
        deps,
        task,
        runner: agent,
      });
      if (runtimePreflight) {
        json(res, 409, {
          error_code: runtimePreflight.code,
          message: runtimePreflight.code,
        });
        return true;
      }
      const workspaceGuard = await preflightManagedTaskWorkspaceBindingGuard({
        deps,
        task,
        runner: agent,
        actorUserId: user.id,
      });
      if (!workspaceGuard.ok) {
        json(res, workspaceGuard.statusCode, workspaceGuard.body);
        return true;
      }
    } else if (!(await ensureTaskRunnerSessionDispatchable({
      deps,
      agentId: agent.id,
      sessionId: task.id,
      json,
      res,
    }))) {
      return true;
    }

    let executionContext: Record<string, unknown>;
    try {
      executionContext = await buildTaskTerminalExecutionContext({
        deps,
        task,
        user,
        agent,
        agentTaskModelSnapshot: terminalRunnerResolution.agentTaskModelSnapshot,
        publicBaseUrl: resolveRequiredConfiguredPublicApiBase(),
      });
    } catch (error) {
      if (isTaskRuntimePathResolutionError(error)) {
        json(res, 409, buildRuntimePathUnavailableResponse(error));
        return true;
      }
      throw error;
    }
    let created: Awaited<ReturnType<typeof deps.notebookTerminalService.createSession>>;
    try {
      created = await deps.notebookTerminalService.createSession({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        taskId: task.id,
        agentId: agent.id,
        resolvedRunnerId: agent.id,
        runnerSessionId: task.id,
        userId: user.id,
        cols,
        rows,
        ...(shell ? { shell } : {}),
        executionContext,
        ...(isManagedAgentRunner(agent) && task.workspace_file_library_id
          ? {
            runtimeDispatchContext: {
              managedInternalAgent: {
                workspaceFileLibraryId: task.workspace_file_library_id,
                taskHomeSegment: resolveTaskHomeSegment(task),
              },
            },
          }
          : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'task_terminal_session_create_failed';
      if (message === 'task_terminal_session_limit_reached') {
        json(res, 409, { error_code: 'RESOURCE_CONFLICT', message });
        return true;
      }
      if (message === 'agent_runner_not_resolved' || message === 'terminal_runner_unavailable') {
        json(res, 409, { error_code: message, message });
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
        runner_id: agent.id,
        runner_session_id: task.id,
        runner_provider: agent.runner_provider ?? 'managed',
        cols,
        rows,
        ...(shell ? { shell } : {}),
      },
    });
    const createdSession = await deps.notebookTerminalService.getSession(created.sessionId);
    json(res, 201, serializeTerminalSessionResponse({
      session: createdSession ?? {
        id: created.sessionId,
        agentId: agent.id,
        resolvedRunnerId: agent.id,
        runnerSessionId: task.id,
        status: 'pending',
        lifecycleStatus: 'pending',
        runnerConnectionStatus: 'dispatching',
        browserConnectionStatus: 'none',
        inputEnabled: false,
        recoverable: false,
        failureKind: null,
        closeState: 'none',
        cols,
        rows,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      },
      wsUrl: `${resolveTerminalWebSocketBaseUrl(req)}${created.wsPath}`,
    }));
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
    if (sessions.some((session) => !readTerminalSessionResolvedRunnerId(session))) {
      json(res, 409, { error_code: 'terminal_runner_unavailable', message: 'terminal_runner_unavailable' });
      return true;
    }
    const items = await Promise.all(sessions.map(async (session) => {
      const reconnectIssued = (
        session.status === 'pending'
        || session.status === 'active'
        || session.status === 'disconnected'
        || session.status === 'recovering'
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
    if (!readTerminalSessionResolvedRunnerId(session)) {
      json(res, 409, { error_code: 'terminal_runner_unavailable', message: 'terminal_runner_unavailable' });
      return true;
    }
    const reconnectIssued = (
      session.status === 'pending'
      || session.status === 'active'
      || session.status === 'disconnected'
      || session.status === 'recovering'
    )
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
    const existingSession = await deps.notebookTerminalService.getSessionWithinScope({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: route.taskId,
      userId: user.id,
      sessionId: route.terminalSessionId,
    });
    if (!existingSession) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_terminal_session_not_found' });
      return true;
    }
    if (!readTerminalSessionResolvedRunnerId(existingSession)) {
      json(res, 409, { error_code: 'terminal_runner_unavailable', message: 'terminal_runner_unavailable' });
      return true;
    }
    const deleted = await deps.notebookTerminalService.deleteSession({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: route.taskId,
      userId: user.id,
      sessionId: route.terminalSessionId,
      waitForFinalization: true,
    });
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_terminal_session_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (route.kind === 'taskWorkspaceAccessRelease' && method === 'POST') {
    if (!isAgentExecutionTicket(internalTicket)) {
      json(res, 403, {
        error_code: 'INTERNAL_TICKET_REQUIRED',
        message: 'internal_ticket_required',
      });
      return true;
    }
    const projectTasks = await loadProjectTasks(deps, route.workspaceId, route.projectId);
    await hydrateTaskFileLibraryBindingsForProject({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      tasks: projectTasks,
    });
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, internalTicket.user_id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
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
    const parsed = readTaskWorkspaceAccessReleaseRequest(await readBody(req));
    if (!parsed.ok) {
      json(res, 400, {
        error_code: 'VALIDATION_ERROR',
        message: 'invalid_workspace_access_release_request',
        field: parsed.field,
      });
      return true;
    }
    const taskFileLibraryId = task.workspace_file_library_id?.trim() ?? '';
    if (parsed.fileLibraryId !== taskFileLibraryId) {
      json(res, 409, {
        error_code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
        message: 'agent_task_workspace_binding_conflict',
        task_id: task.id,
        file_library_id: parsed.fileLibraryId,
        holder_id: parsed.holderId,
        binding_generation: parsed.bindingGenerationWire,
        lease_epoch: parsed.leaseEpoch,
      });
      return true;
    }
    const holderRelease = await new JsonDocTaskWorkspaceHolderRepo(deps.docStore).release({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: task.id,
      fileLibraryId: parsed.fileLibraryId,
      holderId: parsed.holderId,
      bindingGeneration: parsed.bindingGeneration,
      leaseEpoch: parsed.leaseEpoch,
      releasedAt: nowIso(),
    });
    if (!holderRelease.ok) {
      json(res, 409, {
        error_code: holderRelease.code,
        message: 'agent_task_workspace_binding_conflict',
        task_id: task.id,
        file_library_id: holderRelease.holder?.fileLibraryId ?? parsed.fileLibraryId,
        holder_id: parsed.holderId,
        binding_generation: parsed.bindingGenerationWire,
        lease_epoch: parsed.leaseEpoch,
      });
      return true;
    }
    json(res, 200, {
      released: holderRelease.released,
    });
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
    const projectTasks = await loadProjectTasks(deps, route.workspaceId, route.projectId);
    await hydrateTaskFileLibraryBindingsForProject({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      tasks: projectTasks,
    });
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
    let guardedWorkspace: Awaited<ReturnType<typeof resolveTaskWorkspaceBindingGuard>>;
    try {
      guardedWorkspace = await resolveTaskWorkspaceBindingGuard({
        deps,
        task,
        actorUserId: effectiveUserId,
        canUpdateProjectFiles: () => actorHasProjectPermissions({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actorUserId: effectiveUserId,
          requiredPermissions: ['project:files:update'],
        }),
      });
    } catch (error) {
      if (!isTaskWorkspaceBindingGuardError(error)) {
        throw error;
      }
      const payload = serializeTaskWorkspaceBindingGuardError(error);
      if (error.errorCode === 'FILE_LIBRARY_NOT_FOUND') {
        json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'file_library_not_found' });
        return true;
      }
      json(res, error.statusCode, payload);
      return true;
    }
    const workspaceFileLibrary = guardedWorkspace.library;
    const currentBinding = guardedWorkspace.binding;
    const ticketAgentRunnerId = isAgentExecutionTicket(internalTicket)
      && typeof internalTicket.payload.agent_runner_id === 'string'
      ? internalTicket.payload.agent_runner_id.trim()
      : '';
    const agent = ticketAgentRunnerId
      ? await deps.agentResourceService.getAgent(
        route.workspaceId,
        route.projectId,
        ticketAgentRunnerId,
      )
      : null;
    const boundAgentForPath = !agent && task.bound_runner_id?.trim()
      ? await deps.agentResourceService.getAgent(
        route.workspaceId,
        route.projectId,
        task.bound_runner_id.trim(),
      )
      : null;
    const runtimePathAgent = agent ?? boundAgentForPath;
    const runtimePathRunnerProvider = runtimePathAgent?.runner_provider
      ?? task.bound_runner_kind
      ?? null;
    if (runtimePathRunnerProvider === 'developer' && !isDeveloperRunnerTaskHomeBindingAvailable()) {
      json(res, 409, {
        ...buildDeveloperRunnerTaskHomeBindingUnavailableResponse(),
        task_id: task.id,
        file_library_id: workspaceFileLibrary.id,
      });
      return true;
    }
    let taskRuntimePaths: ReturnType<typeof resolveTaskRuntimeHomePathsForRunner>;
    try {
      taskRuntimePaths = resolveTaskRuntimeHomePathsForRunner({
        task,
        runnerProvider: runtimePathRunnerProvider,
      });
    } catch (error) {
      if (isTaskRuntimePathResolutionError(error)) {
        json(res, 409, buildRuntimePathUnavailableResponse(error));
        return true;
      }
      throw error;
    }
    const holderFence = buildWorkspaceAccessHolderFence({
      task,
      fileLibraryId: workspaceFileLibrary.id,
      bindingGeneration: currentBinding.bindingGeneration,
    });
    const workspaceHolderRepo = new JsonDocTaskWorkspaceHolderRepo(deps.docStore);
    const holderAcquire = await workspaceHolderRepo.acquire({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      taskId: task.id,
      fileLibraryId: workspaceFileLibrary.id,
      taskHomeSegment: taskRuntimePaths.taskHomeSegment,
      bindingGeneration: currentBinding.bindingGeneration,
      holderId: holderFence.holder_id,
      holderKind: holderFence.holder_kind,
      leaseEpoch: holderFence.lease_epoch,
      issuedAt: holderFence.issued_at,
      expiresAt: holderFence.expires_at,
    });
    if (!holderAcquire.ok) {
      json(res, 409, {
        error_code: holderAcquire.code,
        message: 'agent_task_workspace_binding_conflict',
        task_id: task.id,
        file_library_id: workspaceFileLibrary.id,
        holder_id: holderFence.holder_id,
        binding_generation: String(currentBinding.bindingGeneration),
        lease_epoch: holderFence.lease_epoch,
      });
      return true;
    }
    const revalidatedBinding = await findTaskFileLibraryBinding({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      fileLibraryId: workspaceFileLibrary.id,
    });
    if (
      !revalidatedBinding
      || revalidatedBinding.bindingState !== 'bound'
      || revalidatedBinding.taskId !== task.id
      || revalidatedBinding.bindingGeneration !== currentBinding.bindingGeneration
    ) {
      await workspaceHolderRepo.release({
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        taskId: task.id,
        fileLibraryId: workspaceFileLibrary.id,
        holderId: holderFence.holder_id,
        bindingGeneration: currentBinding.bindingGeneration,
        leaseEpoch: holderFence.lease_epoch,
        releasedAt: nowIso(),
      });
      json(res, 409, {
        error_code: 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
        message: 'agent_task_workspace_binding_conflict',
        task_id: task.id,
        file_library_id: workspaceFileLibrary.id,
        holder_id: holderFence.holder_id,
        binding_generation: String(revalidatedBinding?.bindingGeneration ?? currentBinding.bindingGeneration),
        lease_epoch: holderFence.lease_epoch,
      });
      return true;
    }
    json(res, 200, {
      task_id: task.id,
      file_library_id: workspaceFileLibrary.id,
      file_library_name: workspaceFileLibrary.name,
      runtime_profile: taskRuntimePaths.runtimeProfile,
      task_home_binding: {
        binding_id: `${workspaceFileLibrary.id}:${currentBinding.bindingGeneration}`,
        provider: 'afscp',
        mode: 'pre_mounted',
        task_id: task.id,
        file_library_id: workspaceFileLibrary.id,
        task_home_segment: taskRuntimePaths.taskHomeSegment,
        generation: String(currentBinding.bindingGeneration),
        holder: {
          holder_id: holderFence.holder_id,
          holder_kind: holderFence.holder_kind,
          binding_generation: String(currentBinding.bindingGeneration),
          lease_epoch: holderFence.lease_epoch,
          issued_at: holderFence.issued_at,
          expires_at: holderFence.expires_at,
        },
        paths: {
          task_home_path: taskRuntimePaths.taskHomePath,
          workspace_path: taskRuntimePaths.workspacePath,
          artifacts_path: taskRuntimePaths.artifactsPath,
          library_root_path: taskRuntimePaths.libraryRootPath,
        },
      },
    });
    return true;
  }

  if (route.kind === 'taskItem' && method === 'PATCH') {
    const projectTasks = await loadProjectTasks(deps, route.workspaceId, route.projectId);
    await hydrateTaskFileLibraryBindingsForProject({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      tasks: projectTasks,
    });
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const unsupportedFields = collectUnsupportedFields(body, UNSUPPORTED_ACTIVE_TASK_BINDING_FIELDS);
    if (unsupportedFields.length > 0) {
      json(res, 400, {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      });
      return true;
    }
    const previousStatus = task.status;
    const sharedActive = await getNotebookTaskRunState(deps.cache, route.taskId);
    if (
      previousStatus === 'active'
      && body.status === 'archived'
      && sharedActive
      && !readActiveRunResolvedRunnerId(sharedActive)
    ) {
      json(res, 409, buildTaskRunnerEvidenceMissingResponse({
        taskId: route.taskId,
        runId: sharedActive.run_id,
      }));
      return true;
    }
    if (typeof body.title === 'string' && body.title.trim()) {
      task.title = body.title.trim();
    }
    if (body.status === 'active' || body.status === 'archived') {
      task.status = body.status;
    }
    task.updated_at = nowIso();
    await deps.docStore.upsert<TaskRecord>(notebookTasksCollection(route.workspaceId), task.id, task);
    await updateTaskFileLibraryBinding({
      docStore: deps.docStore,
      task,
    });
    if (
      previousStatus === 'active'
      && task.status === 'archived'
      && readActiveRunResolvedRunnerId(sharedActive)
    ) {
      await maybeReleaseInternalAgentWorkload(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        taskId: task.id,
        userId: task.owner_user_id,
        agentId: readActiveRunResolvedRunnerId(sharedActive),
      }, {
        force: true,
      });
    }
    json(res, 200, await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task));
    return true;
  }

  if (route.kind === 'taskItem' && method === 'DELETE') {
    const tasks = await loadProjectTasks(deps, route.workspaceId, route.projectId);
    await hydrateTaskFileLibraryBindingsForProject({
      docStore: deps.docStore,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      tasks,
    });
    const index = tasks.findIndex((item) => item.id === route.taskId && item.owner_user_id === user.id);
    if (index < 0) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const task = tasks[index];
    const deleteCorrelationId = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : task.id;
    const blockers = await collectAgentTaskDeleteBlockers({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      task,
      userId: user.id,
    });
    if (blockers.length > 0) {
      await writeProjectAuditEvent(deps, {
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actor: { type: 'user', id: user.id },
        action: 'notebook.task.delete.blocked',
        result: 'error',
        resourceType: 'notebook_task',
        resourceId: task.id,
        errorCode: 'AGENT_TASK_DELETE_BLOCKED',
        errorMessage: 'agent_task_delete_blocked',
        metadata: {
          workspace_file_library_id: task.workspace_file_library_id,
          blocker_count: blockers.length,
          blocker_types: blockers.map((blocker) => blocker.type),
        },
      });
      json(res, 409, {
        error_code: 'AGENT_TASK_DELETE_BLOCKED',
        message: 'agent_task_delete_blocked',
        task_id: task.id,
        blockers: serializeAgentTaskDeleteBlockers(blockers),
      });
      return true;
    }
    try {
      tasks[index] = await markTaskDeletingFence({
        deps,
        workspaceId: route.workspaceId,
        task,
        correlationId: deleteCorrelationId,
      });
    } catch (error) {
      const code = error instanceof Error && typeof (error as Error & { code?: unknown }).code === 'string'
        ? (error as Error & { code: string }).code
        : 'AGENT_TASK_WORKSPACE_BINDING_CONFLICT';
      json(res, 409, {
        error_code: code,
        message: 'agent_task_workspace_binding_conflict',
        task_id: task.id,
        file_library_id: task.workspace_file_library_id,
      });
      return true;
    }
    const releaseResult = await releaseTaskFileLibraryBindingWithAudit({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorUserId: user.id,
      fileLibraryId: task.workspace_file_library_id,
      taskId: task.id,
      bindingGeneration: task.file_library_binding_generation,
      correlationId: deleteCorrelationId,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
      reason: 'task_delete',
    });
    if (!releaseResult.ok) {
      await rollbackTaskDeletingFence({
        deps,
        workspaceId: route.workspaceId,
        task,
        correlationId: deleteCorrelationId,
      });
      json(res, 409, {
        error_code: releaseResult.code,
        message: 'agent_task_workspace_binding_conflict',
        task_id: task.id,
        file_library_id: task.workspace_file_library_id,
        binding_generation: String(releaseResult.binding.bindingGeneration),
      });
      return true;
    }
    await deleteTaskMessages(deps, route.taskId);
    await deleteTaskArtifacts(deps, route.taskId);
    await deleteTaskTraceEvents(deps, route.workspaceId, route.taskId);
    tasks.splice(index, 1);
    ACTIVE_RUNS_BY_TASK.delete(route.taskId);
    ACTIVE_RUN_CANCEL_BY_TASK.delete(route.taskId);
    ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(route.taskId);
    await clearNotebookTaskRunCoordination(deps.cache, route.taskId);
    clearNotebookTaskEventState(route.taskId);
    MESSAGES_BY_TASK.delete(route.taskId);
    ARTIFACTS_BY_TASK.delete(route.taskId);
    removeTaskTraceEventsFromMemory(route.taskId);
    await deps.docStore.delete(notebookTasksCollection(route.workspaceId), route.taskId);
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'notebook.task.deleted',
      resourceType: 'notebook_task',
      resourceId: task.id,
      metadata: {
        workspace_file_library_id: task.workspace_file_library_id,
        task_home_binding_status: task.workspace_file_library_id ? 'released' : 'unbound',
      },
    });
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

  if (route.kind === 'taskActivity' && method === 'GET') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    await loadTaskMessages(deps, route.taskId);
    json(res, 200, getTaskMessages(route.taskId).map((message) =>
      mapTaskMessageRecordToActivityItem(message, { task }),
    ));
    return true;
  }

  if (route.kind === 'taskRunnerBindingOptions' && method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    json(res, 200, await buildTaskRunnerBindingOptions({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      user,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
    }));
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
    const projectedItems = items.map(projectTaskTraceEventForDisplay);
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
    json(res, 200, { items: projectedItems, total, has_more: hasMore, next_after_id: nextAfterId });
    return true;
  }

  if (route.kind === 'taskRuns' && method === 'POST') {
    await loadProjectTasks(deps, route.workspaceId, route.projectId);
    await loadTaskMessages(deps, route.taskId);
    const task = findTaskForOwner(route.workspaceId, route.projectId, route.taskId, user.id);
    if (!task) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'task_not_found' });
      return true;
    }
    const body = asObject(await readBody(req));
    const unsupportedFields = collectUnsupportedFields(body, UNSUPPORTED_PUBLIC_TASK_RUN_FIELDS);
    if (unsupportedFields.length > 0) {
      json(res, 400, {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      });
      return true;
    }
    const content = typeof body.intent === 'string' ? body.intent : '';
    if (!content.trim()) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: 'task_run_intent_required',
        field: 'intent',
      });
      return true;
    }
    const role = 'user' as const;
    let runId: string | null = null;
    let resolvedRunner: Extract<AgentRunnerResolutionResult, { ok: true }> | null = null;
    let agentTaskModelTarget: AgentTaskModelResolvedTarget | null = null;
    let sharedRunState: NotebookTaskRunState | null = null;
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
      if (await getNotebookTaskRunState(deps.cache, route.taskId)) {
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
      const requestedInputs = readTaskInputRefs(body.input_refs);
      const resolution = await resolveTaskBoundAgentRunnerForTaskRun({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        task,
        user,
        requestedInputs,
        requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
        source: 'agent_runner_task_run',
      });
      if (!resolution.ok) {
        await writeAgentRunnerResolutionAudit({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          user,
          taskId: route.taskId,
          requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
          result: resolution,
        });
        json(res, 409, {
          error_code: resolution.code,
          message: resolution.code,
        });
        return true;
      }
      const runtimePreflight = await preflightManagedRunnerRuntimeForTask({
        deps,
        task,
        runner: resolution.runner,
        requiresWorkloadCoordinator: true,
      });
      if (runtimePreflight) {
        await writeAgentRunnerResolutionAudit({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          user,
          taskId: route.taskId,
          requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
          result: runtimePreflight,
        });
        json(res, 409, {
          error_code: runtimePreflight.code,
          message: runtimePreflight.code,
        });
        return true;
      }
      const workspaceGuard = await preflightManagedTaskWorkspaceBindingGuard({
        deps,
        task,
        runner: resolution.runner,
        actorUserId: user.id,
      });
      if (!workspaceGuard.ok) {
        json(res, workspaceGuard.statusCode, workspaceGuard.body);
        return true;
      }
      resolvedRunner = resolution;
      await writeAgentRunnerResolutionAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        user,
        taskId: route.taskId,
        requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
        result: resolution,
      });
      if (requestedInputs.length > 0) {
        task.attached_inputs = [...task.attached_inputs, ...requestedInputs];
      }
      runId = buildId('run');
      const startedAt = nowIso();
      try {
        agentTaskModelTarget = await resolveAgentTaskModelTarget({
          deps,
          workspaceId: route.workspaceId,
          projectId: route.projectId,
          actorUserId: user.id,
          requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
          source: 'agent_task_run_start',
          contextMetadata: {
            task_id: route.taskId,
            run_id: runId,
            runner_id: resolution.runner.id,
          },
        });
      } catch (error) {
        if (error instanceof AgentTaskModelResolutionError) {
          json(res, error.statusCode, {
            error_code: error.code,
            message: error.code,
          });
          return true;
        }
        throw error;
      }
      sharedRunState = buildNotebookTaskRunState({
        taskId: route.taskId,
        runId,
        runnerId: resolution.runner.id,
        resolvedRunnerId: resolution.runner.id,
        agentTaskModel: agentTaskModelTarget.snapshot,
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
          ...(runId ? { turn_id: runId } : {}),
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
        const activeRunId = runId;
        if (!activeRunId || !sharedRunState) {
          throw new Error('notebook_run_state_missing');
        }

        const abortStartupRun = (): void => {
          if (!startupAbortController?.signal.aborted) {
            startupAbortController?.abort('user_cancel_requested');
          }
          clearLocalRunHandle({ preserveCancelMarker: true });
        };

        ACTIVE_RUN_CANCEL_BY_TASK.set(route.taskId, {
          runId: activeRunId,
          requestId: null,
          cancel: abortStartupRun,
          requestCancel: () => {
            const requestedAt = nowIso();
            ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.set(route.taskId, {
              runId: activeRunId,
              requestedAt,
            });
            void requestNotebookTaskRunStop(deps.cache, {
              taskId: route.taskId,
              runId: activeRunId,
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
            runId: activeRunId,
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
              runId: activeRunId,
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
          if (!sharedRunState) {
            return;
          }
          const refreshedRunState: NotebookTaskRunState = {
            ...sharedRunState,
            heartbeat_at: nowIso(),
          };
          sharedRunState = refreshedRunState;
          void refreshNotebookTaskRunLease(deps.cache, refreshedRunState).catch(() => undefined);
        }, NOTEBOOK_RUN_LEASE_HEARTBEAT_MS);
        cancelSyncTimer = setInterval(() => {
          void syncSharedStopRequest().catch(() => undefined);
        }, NOTEBOOK_RUN_CANCEL_POLL_MS);

        if (!resolvedRunner) {
          throw new Error('agent_runner_resolution_missing');
        }
        const runPromise = runNotebookTaskWithExecutionAgent({
          deps,
          task,
          assistantMessage,
          agentId: resolvedRunner.runner.id,
          agentTaskModelTarget: agentTaskModelTarget ?? undefined,
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
            if (!sharedRunState) {
              cancel();
              return false;
            }
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

        emitNotebookTaskActivityEvent(task, message);
        emitNotebookTaskActivityEvent(task, assistantMessage);
        emitNotebookTaskEvent(route.taskId, {
          type: 'task_update',
          data: await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task),
        });
        json(res, 200, mapTaskMessageRecordToActivityItem(assistantMessage, { task }));
        return true;
      }

      emitNotebookTaskActivityEvent(task, message);
      emitNotebookTaskEvent(route.taskId, {
        type: 'task_update',
        data: await buildTaskRealtimeView(deps, route.workspaceId, route.projectId, task),
      });
      json(res, 200, mapTaskMessageRecordToActivityItem(message, { task }));
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
    if (active && !sharedActive && !hasTerminalHardTeardownDebt) {
      ACTIVE_RUN_CANCEL_BY_TASK.delete(route.taskId);
      ACTIVE_RUN_CANCEL_REQUESTED_BY_TASK.delete(route.taskId);
      ACTIVE_RUNS_BY_TASK.delete(route.taskId);
      json(res, 409, { error_code: 'TASK_RUN_NOT_ACTIVE', message: 'task_run_not_active' });
      return true;
    }
    if (sharedActive?.phase === 'finalizing' && !hasSharedHardTeardownDebt) {
      json(res, 409, { error_code: 'TASK_RUN_FINALIZING', message: 'task_run_finalizing' });
      return true;
    }
    const activeRunnerId = readActiveRunResolvedRunnerId(sharedActive) || hardTeardownDebt?.runner_id?.trim() || '';
    if ((sharedActive || hasTerminalHardTeardownDebt) && !activeRunnerId) {
      json(res, 409, buildTaskRunnerEvidenceMissingResponse({
        taskId: route.taskId,
        runId: sharedActive?.run_id ?? hardTeardownDebt?.run_id,
      }));
      return true;
    }
    const agent = activeRunnerId
      ? await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, activeRunnerId)
      : null;
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
        agent && isManagedAgentRunner(agent) ? 'unmanaged_runner' : 'unsupported_runner'
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
        agent && isManagedAgentRunner(agent) ? 'unmanaged_runner' : 'unsupported_runner'
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
      && Boolean(agent && isManagedAgentRunner(agent))
      && canHardTerminate,
    );
    const resolvedMode: NotebookTaskRunStopMode = (
      requestedMode === 'terminate'
      || shouldAutoTerminateStaleInternal
      || hasHardTeardownDebt
        ? 'terminate'
        : 'cancel'
    );
    if (!active && sharedActive && !ownerFresh && agent && isManagedAgentRunner(agent) && !canHardTerminate) {
      json(res, 409, buildNotebookRunStopEscalationUnavailableResponse({
        taskId: route.taskId,
        state: sharedActive,
        requestId,
        reason: 'unmanaged_runner',
      }));
      return true;
    }
    if (!active && sharedActive && !ownerFresh && (!agent || !isManagedAgentRunner(agent))) {
      json(res, 409, {
        error_code: 'TASK_RUN_OWNER_UNAVAILABLE',
        message: 'task_run_owner_unavailable',
      });
      return true;
    }
    const requestedAt = nowIso();
    const useLocalStartupAbortOnly = Boolean(
      resolvedMode === 'terminate'
      && Boolean(agent && isManagedAgentRunner(agent))
      && active?.runId === runId
      && requestId === null
    );
    const delivery = resolvedMode === 'terminate' && agent && isManagedAgentRunner(agent) && !useLocalStartupAbortOnly
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
    subscribeNotebookTaskEvents(route.taskId, res, {
      buffered: true,
      projectPayload: projectNotebookTaskSsePayloadForDisplay,
    });
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
        const replay = replayBufferedNotebookTaskEvents(res, route.taskId, lastEventId, {
          projectPayload: projectNotebookTaskSsePayloadForDisplay,
        });
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
