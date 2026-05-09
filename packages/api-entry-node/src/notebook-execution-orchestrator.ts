import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AgentExecutionArtifactPayload, AgentExecutionTraceEventPayload } from './agent-execution-service.js';
import {
  recordNotebookTaskRunCompleted,
  recordNotebookTaskRunFailed,
  recordNotebookTaskRunStarted,
  recordNotebookTaskRunTerminalWithoutDone,
} from './notebook-task-metrics.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { buildNotebookTaskInputs, type NotebookTaskInputRefRecord } from './notebook-input-refs.js';
import { buildTaskTraceEvent, storeTaskTraceEvent } from './notebook-trace-store.js';
import { buildSandboxStartingEvent, sanitizeWorkloadId } from './internal-agent-pod-manager.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';
import {
  isManagedAgentRunner,
  usesAgentPresenceScopedTaskRunner,
  usesInternalApiBaseForTaskRunner,
} from './agent-runner-profile.js';
import { issueInternalTicket } from './internal-ticket-store.js';
import {
  resolveInternalWorkloadCoordinator,
  type InternalWorkloadHolderRef,
} from './internal-workload-coordinator.js';
import { markNotebookTaskRunFinalizing } from './notebook-task/task-run-coordination.js';
import { deriveEndpointEffectiveModelRuntimeConfig } from './universal-proxy-service.js';
import type { AgentRecord } from './resource-models.js';
import {
  type AgentTaskModelResolvedTarget,
  resolveAgentTaskModelTarget,
} from './agent-task-model-setting-service.js';
import { resolveTaskRuntimeHomePathsForRunner } from './notebook-task/task-runtime-paths.js';
export {
  readInternalWorkloadHolderSnapshotForTests,
  resetInternalWorkloadHolderCoordinatorForTests,
} from './internal-workload-coordinator.js';

type NotebookTaskRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  task_home_segment?: string;
  source?: 'runner_test';
  runner_test?: true;
  workspace_file_library_id?: string;
  workspace_file_library_name?: string;
  status: 'active' | 'archived';
  attached_inputs: Array<
    | { id: string; kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
    | { id: string; kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
    | { id: string; kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number }
  >;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
};

function runnerTestSourceMarker(task: Pick<NotebookTaskRecord, 'source' | 'runner_test'>): Pick<TaskActivityItem, 'source' | 'runner_test'> {
  return task.source === 'runner_test' || task.runner_test === true
    ? { source: 'runner_test', runner_test: true }
    : {};
}

function mapNotebookTaskMessageRecordToActivityItem(
  message: NotebookTaskMessageRecord,
  task: Pick<NotebookTaskRecord, 'source' | 'runner_test'>,
): TaskActivityItem {
  return {
    id: message.id,
    task_id: message.task_id,
    kind: message.role === 'user' ? 'user_intent' : 'runner_output',
    actor: message.role === 'user' ? 'user' : 'runner',
    content: message.content,
    created_at: message.created_at,
    ...(message.turn_id ? { run_id: message.turn_id } : {}),
    ...runnerTestSourceMarker(task),
  };
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

function buildTerminalAssistantFallbackContent(args: {
  terminalResult: 'ok' | 'error';
  terminalErrorCode?: string;
  existingContent: string;
}): string {
  if (args.existingContent.trim().length > 0) return args.existingContent;
  if (args.terminalResult === 'ok') return args.existingContent;
  const code = (args.terminalErrorCode ?? 'AGENT_UPSTREAM_ERROR').trim() || 'AGENT_UPSTREAM_ERROR';
  return `Execution failed before any visible output was produced.\nError code: ${code}`;
}

function buildAgentCancelledError(reason?: unknown): Error {
  const error = new Error(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string' && reason.trim().length > 0
        ? reason
        : 'user_cancel_requested',
  ) as Error & { code: string; cause?: unknown };
  error.name = 'AbortError';
  error.code = 'AGENT_CANCELLED';
  if (reason instanceof Error) {
    error.cause = reason;
  }
  return error;
}

type NotebookTaskMessageRecord = {
  id: string;
  task_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string;
  turn_id?: string;
};

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

type NotebookTaskArtifactRecord = {
  id: string;
  task_id: string;
  type: 'text' | 'image' | 'file' | 'other';
  title?: string;
  content?: string;
  thumbnail_url?: string;
  file_size?: number;
  mime_type?: string;
  created_at: string;
};

type ExecutionEventPayload =
  | { type: 'trace_event'; data: unknown }
  | { type: 'artifact'; data: NotebookTaskArtifactRecord }
  | { type: 'activity_item'; data: TaskActivityItem }
  | { type: 'task_update'; data: NotebookTaskRecord }
  | { type: 'error'; data: { message: string; code: string } };

type TaskRunDispatchResult = Awaited<ReturnType<NodeApiDeps['agentExecutionService']['dispatchStreamingRequest']>>;

type TaskRunnerProvider = {
  dispatchTaskRun(input: {
    deps: NodeApiDeps;
    workspaceId: string;
    projectId: string;
    sessionId: string;
    runnerId: string;
    model: string;
    messages: Array<Record<string, unknown>>;
    executionContext: Record<string, unknown>;
  }): Promise<TaskRunDispatchResult>;
};

const taskOnlyRunnerProvider: TaskRunnerProvider = {
  dispatchTaskRun(input) {
    return input.deps.agentExecutionService.dispatchStreamingRequest({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      agentId: input.runnerId,
      model: input.model,
      messages: input.messages,
      executionContext: input.executionContext,
    });
  },
};

function sanitizeBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, '');
}

function ensureExecutionApiBase(value: string | undefined | null): string | null {
  const sanitized = sanitizeBaseUrl(value);
  if (!sanitized) return null;
  try {
    const parsed = new URL(sanitized);
    if (parsed.pathname === '' || parsed.pathname === '/') {
      parsed.pathname = '/api/v1';
      return parsed.toString().replace(/\/+$/, '');
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return sanitized.endsWith('/api/v1') ? sanitized : `${sanitized}/api/v1`;
  }
}

function deriveHttpBaseFromWebSocketBase(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'ws:') {
      parsed.protocol = 'http:';
    } else if (parsed.protocol === 'wss:') {
      parsed.protocol = 'https:';
    }
    parsed.pathname = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function resolveExecutionApiBase(
  publicBaseUrl: string,
  agent: Pick<AgentRecord, 'runner_provider'>,
): string {
  if (usesInternalApiBaseForTaskRunner(agent)) {
    const internalBase = resolveManagedExecutionApiBase();
    if (internalBase) return internalBase;
    throw Object.assign(new Error('managed_runner_internal_api_base_not_configured'), {
      code: 'AGENT_RUNTIME_UNAVAILABLE',
      reason: 'internal_api_base_not_configured',
    });
  }
  const developerBase = ensureExecutionApiBase(process.env.AGENT_RUNNER_DEVELOPER_EXECUTION_HTTP_BASE_URL);
  if (developerBase) return developerBase;
  return ensureExecutionApiBase(publicBaseUrl) ?? publicBaseUrl;
}

export function resolveManagedExecutionApiBase(): string | null {
  const explicitInternalBase = ensureExecutionApiBase(process.env.AGENT_EXECUTION_HTTP_BASE_URL);
  if (explicitInternalBase) {
    return explicitInternalBase;
  }
  const derivedInternalBase = deriveHttpBaseFromWebSocketBase(process.env.AGENT_EXECUTION_WS_BASE_URL);
  if (derivedInternalBase) {
    return ensureExecutionApiBase(derivedInternalBase) ?? derivedInternalBase;
  }
  const internalBase = ensureExecutionApiBase(process.env.INTERNAL_API_BASE_URL);
  if (internalBase) return internalBase;
  return null;
}

function buildRequestScopedResourceProxyBaseUrl(input: {
  executionApiBase: string;
  workspaceId: string;
  projectId: string;
  endpointId: string;
}): string {
  return `${input.executionApiBase.replace(/\/+$/, '')}`
    + `/workspaces/${encodeURIComponent(input.workspaceId)}`
    + `/projects/${encodeURIComponent(input.projectId)}`
    + `/endpoints/${encodeURIComponent(input.endpointId)}/proxy/openai`;
}

function requireNotebookModelContextWindow(contextWindow: number | undefined): number {
  if (!contextWindow) {
    throw Object.assign(new Error('endpoint_model_context_window_invalid'), {
      code: 'ENDPOINT_MODEL_CONTEXT_WINDOW_INVALID',
    });
  }
  return contextWindow;
}

function deriveNotebookAutoCompactTokenLimit(contextWindow: number, maxOutputTokens: number | undefined): number {
  if (typeof maxOutputTokens === 'number') {
    return Math.max(1, contextWindow - maxOutputTokens);
  }
  return Math.max(1, Math.floor(contextWindow * 0.9));
}

const MAX_TRACE_DETAIL_SANITIZE_DEPTH = 24;

function normalizeTraceDetailKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveTraceDetailKey(key: string): boolean {
  const normalized = normalizeTraceDetailKey(key);
  if (!normalized) return false;
  if (
    normalized === 'arguments'
    || normalized.endsWith('arguments')
    || normalized === 'args'
    || normalized.endsWith('args')
  ) {
    return true;
  }
  if (normalized === 'token' || normalized.endsWith('token')) return true;
  return (
    normalized === 'apikey'
    || normalized.endsWith('apikey')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('credential')
    || normalized.includes('authorization')
    || normalized.includes('privatekey')
    || normalized.includes('accesskey')
    || normalized === 'cookie'
    || normalized.endsWith('cookie')
  );
}

function isAuthorizationNarrativeBoundary(value: string, index: number): boolean {
  const rest = value.slice(index);
  return /^\s+(?:and|but|for|then|while|with)\b/i.test(rest)
    || /^\s+https?:\/\//i.test(rest);
}

function findDigestAuthorizationValueEnd(value: string, start: number): number {
  let index = start;
  let quote: '"' | "'" | null = null;
  while (index < value.length) {
    const char = value[index];
    if (char === '\r' || char === '\n' || char === ';' || char === '`') break;
    if (quote) {
      if (char === quote) quote = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      index += 1;
      continue;
    }
    if (/\s/.test(char) && isAuthorizationNarrativeBoundary(value, index)) break;
    index += 1;
  }
  return index;
}

function redactDigestAuthorizationHeaderValues(value: string): string {
  const digestHeaderPattern = /\b(Authorization["']?\s*[:=]\s*["']?Digest\s+)/gi;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = digestHeaderPattern.exec(value)) !== null) {
    const prefix = match[1];
    const valueStart = match.index + prefix.length;
    const valueEnd = findDigestAuthorizationValueEnd(value, valueStart);
    if (valueEnd <= valueStart) {
      continue;
    }
    result += `${value.slice(lastIndex, valueStart)}[redacted]`;
    lastIndex = valueEnd;
    digestHeaderPattern.lastIndex = valueEnd;
  }
  return result + value.slice(lastIndex);
}

function redactAuthorizationHeaderValues(value: string): string {
  return redactDigestAuthorizationHeaderValues(value)
    .replace(
      /\b(Authorization["']?\s*[:=]\s*)(["']?)(?!Digest\b)([A-Za-z][A-Za-z0-9._~-]*)(\s+)([^"'\s`;,&}]+)(\2?)/gi,
      (_match, prefix: string, quote: string, scheme: string, separator: string) => (
        `${prefix}${quote}${scheme}${separator}[redacted]${quote}`
      ),
    );
}

function trySanitizeJsonTraceText(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const sanitized = sanitizeTracePayloadValue(parsed, new WeakSet<object>(), 0);
    if (sanitized === undefined) return null;
    return JSON.stringify(sanitized);
  } catch {
    return null;
  }
}

const SENSITIVE_TRACE_TEXT_KEY_SOURCE = [
  String.raw`api[_-]?key`,
  String.raw`access[_-]?token`,
  String.raw`refresh[_-]?token`,
  String.raw`client[_-]?secret`,
  'token',
  'secret',
  'password',
  'credential',
].join('|');
const SENSITIVE_TRACE_DOUBLE_QUOTED_VALUE_PATTERN = new RegExp(
  String.raw`((?:["']?)\b(?:${SENSITIVE_TRACE_TEXT_KEY_SOURCE})\b(?:["']?)\s*[:=]\s*)"[^"\r\n]*"`,
  'gi',
);
const SENSITIVE_TRACE_SINGLE_QUOTED_VALUE_PATTERN = new RegExp(
  String.raw`((?:["']?)\b(?:${SENSITIVE_TRACE_TEXT_KEY_SOURCE})\b(?:["']?)\s*[:=]\s*)'[^'\r\n]*'`,
  'gi',
);
const SENSITIVE_TRACE_UNQUOTED_VALUE_PATTERN = new RegExp(
  String.raw`((?:["']?)\b(?:${SENSITIVE_TRACE_TEXT_KEY_SOURCE})\b(?:["']?)\s*[:=]\s*)[^'"\s&;,}\]]+`,
  'gi',
);

function redactSensitiveKeyValueTraceText(value: string): string {
  return value
    .replace(SENSITIVE_TRACE_DOUBLE_QUOTED_VALUE_PATTERN, '$1"[redacted]"')
    .replace(SENSITIVE_TRACE_SINGLE_QUOTED_VALUE_PATTERN, "$1'[redacted]'")
    .replace(SENSITIVE_TRACE_UNQUOTED_VALUE_PATTERN, '$1[redacted]');
}

function redactSensitiveTraceText(value: string): string {
  const jsonSanitized = trySanitizeJsonTraceText(value);
  const authorizationSanitized = redactAuthorizationHeaderValues(jsonSanitized ?? value)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/gi, '$1[redacted]');
  return redactSensitiveKeyValueTraceText(authorizationSanitized)
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}\b/g, 'sk-[redacted]');
}

function sanitizeTracePayloadValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'string') return redactSensitiveTraceText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_TRACE_DETAIL_SANITIZE_DEPTH) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    const sanitizedItems = value.map((item) => {
      const sanitized = sanitizeTracePayloadValue(item, seen, depth + 1);
      return sanitized === undefined ? null : sanitized;
    });
    seen.delete(value);
    return sanitizedItems;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (isSensitiveTraceDetailKey(key)) continue;
    const sanitizedChild = sanitizeTracePayloadValue(childValue, seen, depth + 1);
    if (sanitizedChild !== undefined) {
      sanitized[key] = sanitizedChild;
    }
  }
  seen.delete(value);
  return sanitized;
}

function sanitizeTraceDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const sanitized = sanitizeTracePayloadValue(details, new WeakSet<object>(), 0);
  if (typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }
  return undefined;
}

function sanitizeTracePayload(payload: AgentExecutionTraceEventPayload): AgentExecutionTraceEventPayload {
  const sanitizedPayload: AgentExecutionTraceEventPayload = {
    ...payload,
    summary: redactSensitiveTraceText(payload.summary),
  };
  const sanitizedDetails = sanitizeTraceDetails(payload.details);
  if (sanitizedDetails) {
    sanitizedPayload.details = sanitizedDetails;
  } else {
    delete sanitizedPayload.details;
  }
  if (typeof sanitizedPayload.raw === 'string') {
    sanitizedPayload.raw = redactSensitiveTraceText(sanitizedPayload.raw);
  }
  return sanitizedPayload;
}

function buildSanitizedTaskTraceEvent(args: {
  taskId: string;
  messageId: string;
  runId: string;
  payload: AgentExecutionTraceEventPayload;
}) {
  return buildTaskTraceEvent({
    ...args,
    payload: sanitizeTracePayload(args.payload),
  });
}

export async function runNotebookTaskWithExecutionAgent(input: {
  deps: NodeApiDeps;
  task: NotebookTaskRecord;
  assistantMessage: NotebookTaskMessageRecord;
  agentId: string;
  agentTaskModelTarget?: AgentTaskModelResolvedTarget;
  user: AuthenticatedUser;
  publicBaseUrl: string;
  buildRunId: () => string;
  buildProxyUsername: (user: AuthenticatedUser) => string;
  mapTaskMessagesForExecution: (taskId: string, assistantMessageId: string) => Array<Record<string, unknown>>;
  updateTaskActivity: (task: NotebookTaskRecord) => void;
  emitTaskEvent: (taskId: string, payload: ExecutionEventPayload) => void;
  onDispatched?: (args: { taskId: string; runId: string; requestId: string; cancel: () => void }) => boolean | void;
  onFinalize: (
    taskId: string,
    runId: string,
    summary: { durableTerminalTruth: boolean },
  ) => void | Promise<void>;
  startupSignal?: AbortSignal;
  isCancellationRequested?: () => boolean | Promise<boolean>;
  debugLog: (message: string, extra?: Record<string, unknown>) => void;
  taskCollections: {
    tasks: string;
    messages: string;
  };
  createTaskArtifact: (args: {
    taskId: string;
    runId: string;
    payload: AgentExecutionArtifactPayload;
  }) => Promise<NotebookTaskArtifactRecord>;
}): Promise<void> {
  const {
    deps,
    task,
    assistantMessage,
    agentId,
    agentTaskModelTarget,
    user,
    publicBaseUrl,
    buildRunId,
    buildProxyUsername,
    mapTaskMessagesForExecution,
    updateTaskActivity,
    emitTaskEvent,
    onDispatched,
    onFinalize,
    startupSignal,
    isCancellationRequested,
    debugLog,
    taskCollections,
    createTaskArtifact,
  } = input;
  const taskId = task.id;
  const runId = buildRunId();
  let reachedTerminal = false;
  let traceEventCount = 0;
  let maxTraceSequence = 0;
  let endpointIdForLog: string | null = null;
  const startedAtMs = Date.now();
  let terminalResult: 'ok' | 'error' = 'ok';
  let terminalErrorCode: string | undefined;
  let usageTokensTotal: number | undefined;
  let requestExecutionId: string | undefined;
  let internalWorkloadHolder: InternalWorkloadHolderRef | undefined;
  let sawCancelledTerminalTrace = false;
  let dispatchRejectedAsCancelled = false;
  const isCancellationObserved = async (): Promise<boolean> => (
    startupSignal?.aborted === true
    || dispatchRejectedAsCancelled
    || await isCancellationRequested?.() === true
  );
  const throwIfCancellationRequested = async (): Promise<void> => {
    if (!(await isCancellationObserved())) {
      return;
    }
    throw buildAgentCancelledError(startupSignal?.reason);
  };

  try {
    const agent = await deps.agentResourceService.getAgent(task.workspace_id, task.project_id, agentId);
    if (!agent || agent.status !== 'enabled') {
      throw Object.assign(new Error('agent_not_available'), { code: 'AGENT_OFFLINE' });
    }

    const resolvedTarget = agentTaskModelTarget ?? await resolveAgentTaskModelTarget({
      deps,
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      actorUserId: user.id,
      source: 'agent_task_execution_preflight',
      contextMetadata: {
        task_id: task.id,
        run_id: runId,
        runner_id: agentId,
      },
    });
    const endpointId = resolvedTarget.endpoint.id;
    endpointIdForLog = endpointId || null;

    const endpoint = resolvedTarget.endpoint;
    const effectiveModelConfig = deriveEndpointEffectiveModelRuntimeConfig(endpoint);
    const modelContextWindow = requireNotebookModelContextWindow(effectiveModelConfig.limits?.context_window);
    const maxOutputTokens = effectiveModelConfig.limits?.max_output_tokens;
    const modelAutoCompactTokenLimit = deriveNotebookAutoCompactTokenLimit(modelContextWindow, maxOutputTokens);
    const modelLimits = {
      context_window: modelContextWindow,
      ...(typeof maxOutputTokens === 'number' ? { max_output_tokens: maxOutputTokens } : {}),
    };
    const modelCatalog = effectiveModelConfig.model_catalog;
    const model = resolvedTarget.resolvedModel;
    const taskRuntimePaths = resolveTaskRuntimeHomePathsForRunner({
      task,
      runnerProvider: agent.runner_provider,
    });
    const taskHomeSegment = taskRuntimePaths.taskHomeSegment;
    if (isManagedAgentRunner(agent)) {
      await throwIfCancellationRequested();
      if (!deps.internalAgentPodManager) {
        throw Object.assign(new Error('agent_sandbox_not_configured'), { code: 'AGENT_SANDBOX_NOT_CONFIGURED' });
      }
      const workspaceBindingManager = deps.internalAgentWorkspaceBindingManager ?? deps.internalAgentWorkspaceProvisioner;
      if (!workspaceBindingManager) {
        throw Object.assign(new Error('internal_agent_workspace_not_configured'), {
          code: 'AGENT_SANDBOX_NOT_CONFIGURED',
        });
      }
      if (!task.workspace_file_library_id) {
        throw Object.assign(new Error('workspace_file_library_id_required'), {
          code: 'WORKSPACE_FILE_LIBRARY_ID_REQUIRED',
        });
      }
      emitTaskEvent(taskId, {
        type: 'trace_event',
        data: buildSandboxStartingEvent(),
      });
      const workloadId = sanitizeWorkloadId(task.id);
      const workspaceBinding = await workspaceBindingManager.ensureWorkspaceBinding({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        fileLibraryId: task.workspace_file_library_id,
        taskId: task.id,
        taskHomeSegment,
      });
      await throwIfCancellationRequested();
      await deps.internalAgentPodManager.ensureAgentReady({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        workloadId,
        sessionId: task.id,
        agent,
        workspaceMount: workspaceBinding.workspaceMount,
        signal: startupSignal,
      });
      await throwIfCancellationRequested();
      const internalWorkloadCoordinator = resolveInternalWorkloadCoordinator(deps);
      const workloadHolder: InternalWorkloadHolderRef = {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        workloadId,
        holderKind: 'notebook_run',
        holderId: runId,
        epoch: runId,
      };
      if (!internalWorkloadCoordinator) {
        throw Object.assign(new Error('internal_workload_coordinator_not_configured'), {
          code: 'AGENT_SANDBOX_NOT_CONFIGURED',
        });
      }
      await internalWorkloadCoordinator.acquireHolder(workloadHolder);
      internalWorkloadHolder = workloadHolder;
    }
    const wireApi = resolvedTarget.upstreamProtocol;
    const userHandle = buildProxyUsername(user);
    const taskInputs = await buildNotebookTaskInputs({
      deps,
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      taskId: task.id,
      attachedInputs: task.attached_inputs as NotebookTaskInputRefRecord[],
      debugLog,
    });
    const workspaceLibrary = task.workspace_file_library_id
      ? await new JsonDocProjectFileLibraryCatalogRepo(deps.docStore).getById(
        task.workspace_id,
        task.project_id,
        task.workspace_file_library_id,
      )
      : null;
    const issuedExecutionTicket = await issueInternalTicket(deps.cache, {
      purpose: 'agent_execution',
      userId: user.id,
      prefix: 'exec',
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      payload: {
        endpoint_id: endpointId,
        task_id: task.id,
        runner_session_id: task.id,
        agent_runner_id: agentId,
      },
      ttlMs: 8 * 60 * 60 * 1000,
      maxUses: 500,
    });
    await throwIfCancellationRequested();
    const executionApiBase = resolveExecutionApiBase(publicBaseUrl, agent);
    const dispatched = await taskOnlyRunnerProvider.dispatchTaskRun({
      deps,
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      sessionId: task.id,
      runnerId: agentId,
      model,
      messages: mapTaskMessagesForExecution(taskId, assistantMessage.id),
      executionContext: {
        workspace_id: task.workspace_id,
        project_id: task.project_id,
        task_id: task.id,
        run_id: runId,
        runner_id: agentId,
        username: userHandle,
        endpoint_id: endpointId,
        agent_task_model: resolvedTarget.snapshot,
        resource_proxy: {
          base_url: buildRequestScopedResourceProxyBaseUrl({
            executionApiBase,
            workspaceId: task.workspace_id,
            projectId: task.project_id,
            endpointId,
          }),
        },
        api_base: executionApiBase,
        execution_ticket: issuedExecutionTicket.ticket,
        wire_api: wireApi,
        model,
        model_context_window: modelContextWindow,
        model_auto_compact_token_limit: modelAutoCompactTokenLimit,
        model_limits: modelLimits,
        model_catalog: modelCatalog,
        runner_session_scope:
          usesAgentPresenceScopedTaskRunner(agent)
            ? 'agent_presence'
            : 'task_execution',
        workspace_binding_mode: isManagedAgentRunner(agent) ? 'pre_mounted' : 'file_library',
        runtime_profile: taskRuntimePaths.runtimeProfile,
        task_home_segment: taskRuntimePaths.taskHomeSegment,
        task_home_path: taskRuntimePaths.taskHomePath,
        workspace_path: taskRuntimePaths.workspacePath,
        artifacts_path: taskRuntimePaths.artifactsPath,
        workspace_file_library_id: task.workspace_file_library_id ?? null,
        workspace_file_library_name: task.workspace_file_library_name ?? null,
        workspace_dir_name: workspaceLibrary?.filesystem_name
          ?? sanitizeFileLibraryWorkspaceDirName(task.workspace_file_library_name, task.workspace_file_library_id),
        task_inputs: taskInputs,
      },
    });
    requestExecutionId = dispatched.requestId;
    const dispatchAccepted = onDispatched?.({
      taskId: task.id,
      runId,
      requestId: dispatched.requestId,
      cancel: dispatched.cancel,
    }) !== false;
    if (!dispatchAccepted) {
      dispatchRejectedAsCancelled = true;
      dispatched.cancel();
      throw buildAgentCancelledError(startupSignal?.reason);
    }
    await throwIfCancellationRequested();
    debugLog('dispatch_streaming_request', {
      task_id: task.id,
      run_id: runId,
      agent_id: agentId,
      endpoint_id: endpointId,
      request_id: dispatched.requestId,
      model,
      wire_api: wireApi,
    });
    recordNotebookTaskRunStarted();
    await writeProjectAuditEvent(deps, {
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      actor: { type: 'agent', id: agentId },
      action: 'notebook.task.run.started',
      requestId: dispatched.requestId,
      resourceType: 'notebook_task',
      resourceId: task.id,
      metadata: {
        run_id: runId,
        runner_id: agentId,
        endpoint_id: endpointId,
        model,
        wire_api: wireApi,
        setting_revision: resolvedTarget.snapshot.setting_revision,
        policy_decision_id: resolvedTarget.snapshot.policy_decision_id,
      },
    });

    for await (const event of dispatched.stream) {
      if (event.type === 'event' && event.event) {
        if (event.event.status === 'cancelled') {
          sawCancelledTerminalTrace = true;
        }
        const traceEvent = buildSanitizedTaskTraceEvent({
          taskId: task.id,
          messageId: assistantMessage.id,
          runId,
          payload: event.event as AgentExecutionTraceEventPayload,
        });
        await storeTaskTraceEvent(deps, task.workspace_id, task.id, traceEvent);
        traceEventCount += 1;
        maxTraceSequence = Math.max(maxTraceSequence, traceEvent.seq);
        emitTaskEvent(taskId, { type: 'trace_event', data: traceEvent });
        continue;
      }
      if (event.type === 'artifact' && event.artifact) {
        const artifact = await createTaskArtifact({
          taskId: task.id,
          runId,
          payload: event.artifact as AgentExecutionArtifactPayload,
        });
        await writeProjectAuditEvent(deps, {
          workspaceId: task.workspace_id,
          projectId: task.project_id,
          actor: { type: 'agent', id: agentId },
          action: 'notebook.task.artifact.created',
          requestId: dispatched.requestId,
          resourceType: 'notebook_artifact',
          resourceId: artifact.id,
          metadata: {
            task_id: task.id,
            run_id: runId,
            artifact_type: artifact.type,
            task_relative_path: event.artifact.task_relative_path,
            title: artifact.title,
          },
        });
        emitTaskEvent(taskId, { type: 'artifact', data: artifact });
        continue;
      }
      if (event.type === 'delta' && event.delta) {
        assistantMessage.content += event.delta;
        debugLog('execution_event_delta', {
          task_id: task.id,
          run_id: runId,
          request_id: dispatched.requestId,
          delta_chars: event.delta.length,
          total_agent_chars: assistantMessage.content.length,
        });
        emitTaskEvent(taskId, {
          type: 'activity_item',
          data: mapNotebookTaskMessageRecordToActivityItem(assistantMessage, task),
        });
        continue;
      }
      if (event.type === 'error') {
        reachedTerminal = true;
        terminalResult = 'error';
        terminalErrorCode = event.error_code ?? 'AGENT_UPSTREAM_ERROR';
        if (terminalErrorCode === 'AGENT_CANCELLED') {
          sawCancelledTerminalTrace = true;
        }
        recordNotebookTaskRunFailed();
        debugLog('execution_event_error', {
          task_id: task.id,
          run_id: runId,
          request_id: dispatched.requestId,
          code: event.error_code ?? 'AGENT_UPSTREAM_ERROR',
          message: event.error_message ?? 'agent_execution_error',
          agent_chars: assistantMessage.content.length,
        });
        emitTaskEvent(taskId, {
          type: 'error',
          data: {
            message: event.error_message ?? 'agent_execution_error',
            code: event.error_code ?? 'AGENT_UPSTREAM_ERROR',
          },
        });
        break;
      }
      if (event.type === 'done') {
        reachedTerminal = true;
        terminalResult = 'ok';
        usageTokensTotal = event.usage_tokens;
        recordNotebookTaskRunCompleted();
        debugLog('execution_event_done', {
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
    terminalResult = 'error';
    recordNotebookTaskRunFailed();
    const message = error instanceof Error ? error.message : 'agent_execution_error';
    const codeCandidate = error instanceof Error
      ? (error as Error & { code?: unknown }).code
      : undefined;
    const rawCode = typeof codeCandidate === 'string'
      ? codeCandidate
      : message === 'agent_offline'
        ? 'AGENT_OFFLINE'
      : 'AGENT_UPSTREAM_ERROR';
    const code = rawCode === 'AGENT_SANDBOX_NOT_CONFIGURED'
      ? 'AGENT_RUNTIME_UNAVAILABLE'
      : rawCode;
    terminalErrorCode = code;
    debugLog('execution_dispatch_exception', {
      task_id: task.id,
      run_id: runId,
      agent_id: agentId,
      endpoint_id: endpointIdForLog,
      code,
      message,
    });
    emitTaskEvent(taskId, {
      type: 'error',
      data: {
        message,
        code,
      },
    });
  } finally {
    const internalWorkloadCoordinator = resolveInternalWorkloadCoordinator(deps);
    if (internalWorkloadHolder && internalWorkloadCoordinator) {
      await internalWorkloadCoordinator.releaseHolder(internalWorkloadHolder).catch((error: unknown) => {
        console.warn(
          '[sandbox] releaseHolder failed for notebook task %s: %s',
          task.id,
          error instanceof Error ? error.message : String(error),
        );
      });
    }
    if (!reachedTerminal) {
      terminalResult = 'error';
      terminalErrorCode = terminalErrorCode ?? 'AGENT_STREAM_TERMINAL_MISSING';
      recordNotebookTaskRunTerminalWithoutDone();
      debugLog('execution_stream_finalized_without_terminal', {
        task_id: task.id,
        run_id: runId,
        agent_id: agentId,
        endpoint_id: endpointIdForLog,
        agent_chars: assistantMessage.content.length,
      });
    }
    const missingExecutionTrace = traceEventCount === 0;
    if (missingExecutionTrace) {
      const fallbackStatus = terminalResult === 'ok' ? 'success' : 'error';
      const fallbackTrace = buildSanitizedTaskTraceEvent({
        taskId: task.id,
        messageId: assistantMessage.id,
        runId,
        payload: {
          sequence: Math.max(1, maxTraceSequence + 1),
          at: new Date().toISOString(),
          category: fallbackStatus === 'success' ? 'lifecycle' : 'error',
          phase: 'end',
          status: fallbackStatus,
          name: 'execution.terminal',
          summary: fallbackStatus === 'success'
            ? 'execution terminal synthesized: stream completed without trace events'
            : `execution terminal synthesized: ${terminalErrorCode ?? 'AGENT_UPSTREAM_ERROR'}`,
          details: {
            synthesized: true,
            reason: 'missing_execution_trace',
            terminal_result: terminalResult,
            error_code: terminalErrorCode ?? null,
          },
        },
      });
      await storeTaskTraceEvent(deps, task.workspace_id, task.id, fallbackTrace);
      traceEventCount += 1;
      maxTraceSequence = Math.max(maxTraceSequence, fallbackTrace.seq);
      emitTaskEvent(taskId, { type: 'trace_event', data: fallbackTrace });
      debugLog('execution_fallback_terminal_trace_emitted', {
        task_id: task.id,
        run_id: runId,
        trace_id: fallbackTrace.id,
        terminal_result: terminalResult,
        error_code: terminalErrorCode ?? null,
      });
    }
    const cancellationRequested = await isCancellationObserved();
    if (cancellationRequested && !sawCancelledTerminalTrace) {
      const userCancelledTrace = buildSanitizedTaskTraceEvent({
        taskId: task.id,
        messageId: assistantMessage.id,
        runId,
        payload: {
          sequence: Math.max(1, maxTraceSequence + 1),
          at: new Date().toISOString(),
          category: 'warning',
          phase: 'end',
          status: 'cancelled',
          name: 'run.user_cancel',
          summary: 'Run interrupted by user request',
          details: {
            synthesized: true,
            reason: 'user_cancel_requested',
            terminal_result: terminalResult,
            error_code: terminalErrorCode ?? null,
          },
        },
      });
      await storeTaskTraceEvent(deps, task.workspace_id, task.id, userCancelledTrace);
      traceEventCount += 1;
      maxTraceSequence = Math.max(maxTraceSequence, userCancelledTrace.seq);
      emitTaskEvent(taskId, { type: 'trace_event', data: userCancelledTrace });
      debugLog('execution_user_cancel_trace_emitted', {
        task_id: task.id,
        run_id: runId,
        trace_id: userCancelledTrace.id,
        terminal_result: terminalResult,
        error_code: terminalErrorCode ?? null,
      });
    }
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    updateTaskActivity(task);
    assistantMessage.content = buildTerminalAssistantFallbackContent({
      terminalResult,
      terminalErrorCode,
      existingContent: assistantMessage.content,
    });
    debugLog('task_run_finalized', {
      task_id: task.id,
      run_id: runId,
      agent_id: agentId,
      endpoint_id: endpointIdForLog,
      status: task.status,
      agent_chars: assistantMessage.content.length,
      reached_terminal: reachedTerminal,
    });
    await markNotebookTaskRunFinalizing(deps.cache, {
      taskId: task.id,
      runId,
      updatedAt: new Date().toISOString(),
    });
    let persistedFinalState = false;
    try {
      await deps.docStore.upsert(taskCollections.messages, assistantMessage.id, assistantMessage);
      await deps.docStore.upsert(taskCollections.tasks, task.id, task);
      persistedFinalState = true;
    } catch (error) {
      debugLog('task_run_persist_failed', {
        task_id: task.id,
        run_id: runId,
        message_id: assistantMessage.id,
        error: error instanceof Error ? error.message : 'persist_failed',
      });
      await markNotebookTaskRunFinalizing(deps.cache, {
        taskId: task.id,
        runId,
        updatedAt: new Date().toISOString(),
        errorCode: 'AGENT_FINALIZE_PERSIST_FAILED',
      });
    }
    // Keep run_state authoritative until the terminal assistant/task truth is durably written.
    await onFinalize(taskId, runId, {
      durableTerminalTruth: persistedFinalState,
    });
    if (persistedFinalState) {
      emitTaskEvent(taskId, {
        type: 'activity_item',
        data: mapNotebookTaskMessageRecordToActivityItem(assistantMessage, task),
      });
      emitTaskEvent(taskId, { type: 'task_update', data: task });
    }
    try {
      await writeProjectAuditEvent(deps, {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        actor: { type: 'agent', id: agentId },
        action:
          terminalResult === 'ok'
            ? 'notebook.task.run.completed'
            : 'notebook.task.run.failed',
        result: terminalResult,
        requestId: requestExecutionId,
        resourceType: 'notebook_task',
        resourceId: task.id,
        errorCode: terminalErrorCode,
        metadata: {
          run_id: runId,
          runner_id: agentId,
          endpoint_id: endpointIdForLog,
          duration_ms: durationMs,
          usage_tokens: usageTokensTotal,
        },
      });
    } catch (error) {
      debugLog('task_run_completion_audit_failed', {
        task_id: task.id,
        run_id: runId,
        error: error instanceof Error ? error.message : 'audit_failed',
      });
    }
    try {
      await writeProjectUsageFact(deps, {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        resourceType: 'notebook_task',
        resourceId: task.id,
        requestId: requestExecutionId,
        durationMs,
        tokensTotal: usageTokensTotal,
        result: terminalResult,
        errorCode: terminalErrorCode,
        metadata: { run_id: runId, runner_id: agentId, endpoint_id: endpointIdForLog },
      });
    } catch (error) {
      debugLog('task_run_usage_failed', {
        task_id: task.id,
        run_id: runId,
        resource_type: 'notebook_task',
        error: error instanceof Error ? error.message : 'usage_failed',
      });
    }
    try {
      await writeProjectUsageFact(deps, {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        resourceType: 'agent',
        resourceId: agentId,
        endUserId: user.id,
        requestId: requestExecutionId,
        durationMs,
        result: terminalResult,
        errorCode: terminalErrorCode,
        metadata: { run_id: runId, task_id: task.id, runner_id: agentId, endpoint_id: endpointIdForLog },
      });
    } catch (error) {
      debugLog('task_run_usage_failed', {
        task_id: task.id,
        run_id: runId,
        resource_type: 'agent',
        error: error instanceof Error ? error.message : 'usage_failed',
      });
    }
  }
}
