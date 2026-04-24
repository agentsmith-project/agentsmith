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
import { enforceEndpointGovernancePreflight } from './governance-endpoint-preflight.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';
import { isComposeManagedExternalAgent } from './agent-runner-profile.js';
import { issueInternalTicket } from './internal-ticket-store.js';
import {
  resolveInternalWorkloadCoordinator,
  type InternalWorkloadHolderRef,
} from './internal-workload-coordinator.js';
import { markNotebookTaskRunFinalizing } from './notebook-task/task-run-coordination.js';
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
  agent_name: string;
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
  agent_id: string;
};

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

type NotebookTaskMessageRecord = {
  id: string;
  task_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string;
  turn_id?: string;
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
  | { type: 'message'; data: NotebookTaskMessageRecord }
  | { type: 'task_update'; data: NotebookTaskRecord }
  | { type: 'error'; data: { message: string; code: string } };

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
  agent: { mode: 'external' | 'internal'; config?: Record<string, unknown> | null },
): string {
  if (agent.mode === 'external' && isComposeManagedExternalAgent(agent)) {
    return ensureExecutionApiBase(process.env.INTERNAL_API_BASE_URL) ?? 'http://api:20000/api/v1';
  }
  const explicitExternalBase = ensureExecutionApiBase(process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL);
  if (agent.mode === 'external' && explicitExternalBase) {
    return explicitExternalBase;
  }
  if (agent.mode === 'internal') {
    const explicitInternalBase = ensureExecutionApiBase(process.env.AGENT_EXECUTION_HTTP_BASE_URL);
    if (explicitInternalBase) {
      return explicitInternalBase;
    }
    const derivedInternalBase = deriveHttpBaseFromWebSocketBase(process.env.AGENT_EXECUTION_WS_BASE_URL);
    if (derivedInternalBase) {
      return ensureExecutionApiBase(derivedInternalBase) ?? derivedInternalBase;
    }
  }
  return ensureExecutionApiBase(publicBaseUrl) ?? publicBaseUrl;
}

function deriveNotebookModelWindow(profile: { max_context_tokens?: number } | null | undefined): {
  modelContextWindow: number;
  modelAutoCompactTokenLimit: number;
} {
  const rawWindow = profile?.max_context_tokens;
  const modelContextWindow =
    typeof rawWindow === 'number' && Number.isFinite(rawWindow) && rawWindow > 0
      ? Math.floor(rawWindow)
      : null;
  if (!modelContextWindow) {
    throw Object.assign(new Error('endpoint_model_context_window_invalid'), {
      code: 'ENDPOINT_MODEL_CONTEXT_WINDOW_INVALID',
    });
  }
  return {
    modelContextWindow,
    modelAutoCompactTokenLimit: Math.max(1, Math.floor(modelContextWindow * 0.9)),
  };
}

function deriveNotebookCodexModelCatalog(args: {
  capabilities?: Array<{ type?: string; enabled?: boolean }> | null;
}): {
  input_modalities: string[];
  supports_search_tool: boolean;
  supports_parallel_tool_calls: boolean;
} {
  const inputModalities = new Set<string>(['text']);
  if (Array.isArray(args.capabilities)) {
    for (const capability of args.capabilities) {
      if (capability?.enabled !== true) continue;
      if (capability.type === 'multimodal_completion') {
        inputModalities.add('image');
      }
    }
  }
  return {
    input_modalities: [...inputModalities],
    supports_search_tool: false,
    // We only expose parallel tool calling when endpoint truth explicitly models it.
    // `supports_tool_call` alone is not enough, and overclaiming breaks compat upstreams.
    supports_parallel_tool_calls: false,
  };
}

export async function runNotebookTaskWithExecutionAgent(input: {
  deps: NodeApiDeps;
  task: NotebookTaskRecord;
  assistantMessage: NotebookTaskMessageRecord;
  agentId: string;
  user: AuthenticatedUser;
  publicBaseUrl: string;
  buildRunId: () => string;
  buildProxyUsername: (user: AuthenticatedUser) => string;
  mapTaskMessagesForExecution: (taskId: string, assistantMessageId: string) => Array<Record<string, unknown>>;
  updateTaskActivity: (task: NotebookTaskRecord) => void;
  emitTaskEvent: (taskId: string, payload: ExecutionEventPayload) => void;
  onDispatched?: (args: { taskId: string; runId: string; requestId: string; cancel: () => void }) => void;
  onFinalize: (
    taskId: string,
    runId: string,
    summary: { durableTerminalTruth: boolean },
  ) => void | Promise<void>;
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
    user,
    publicBaseUrl,
    buildRunId,
    buildProxyUsername,
    mapTaskMessagesForExecution,
    updateTaskActivity,
    emitTaskEvent,
    onDispatched,
    onFinalize,
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
  const throwIfCancellationRequested = async (): Promise<void> => {
    if (await isCancellationRequested?.() !== true) {
      return;
    }
    throw Object.assign(new Error('user_cancel_requested'), {
      code: 'AGENT_CANCELLED',
    });
  };

  try {
    const agent = await deps.agentResourceService.getAgent(task.workspace_id, task.project_id, agentId);
    if (!agent || agent.status !== 'enabled') {
      throw Object.assign(new Error('agent_not_available'), { code: 'AGENT_OFFLINE' });
    }

    const executionPreferences =
      typeof agent.execution_preferences_json === 'object' && agent.execution_preferences_json !== null
        ? (agent.execution_preferences_json as Record<string, unknown>)
        : {};
    const notebookPreferences =
      typeof executionPreferences.notebook === 'object' && executionPreferences.notebook !== null
        ? (executionPreferences.notebook as Record<string, unknown>)
        : {};
    const endpointId = typeof notebookPreferences.endpoint_id === 'string'
      ? notebookPreferences.endpoint_id.trim()
      : '';
    endpointIdForLog = endpointId || null;
    if (!endpointId) {
      throw Object.assign(new Error('task_agent_endpoint_not_configured'), {
        code: 'TASK_AGENT_ENDPOINT_NOT_CONFIGURED',
      });
    }

    const explicitModel = typeof notebookPreferences.model === 'string'
      ? notebookPreferences.model.trim()
      : '';
    const endpoint = await deps.endpointResourceService.getEndpoint(
      task.workspace_id,
      task.project_id,
      endpointId,
    );
    if (!endpoint || endpoint.status !== 'active') {
      throw Object.assign(new Error('endpoint_not_available'), { code: 'VALIDATION_ERROR' });
    }
    const endpointModel = endpoint.model?.trim() ?? '';
    const modelWindow = deriveNotebookModelWindow(endpoint.model_profile);
    const modelContextWindow = modelWindow.modelContextWindow;
    const modelAutoCompactTokenLimit = modelWindow.modelAutoCompactTokenLimit;
    const modelCatalog = deriveNotebookCodexModelCatalog({
      capabilities: endpoint.capabilities,
    });
    if (agent.mode !== 'internal') {
      const preflight = await enforceEndpointGovernancePreflight({
        deps,
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        endpoint,
        userId: user.id,
        source: 'notebook_execution_preflight',
        contextMetadata: {
          task_id: task.id,
          run_id: runId,
        },
      });
      if (!preflight.allowed) {
        throw Object.assign(new Error(preflight.responseBody.message), {
          code: preflight.responseBody.error_code,
        });
      }
    }
    const model = explicitModel || endpointModel || 'gpt-5-codex';
    let internalWorkspacePath: string | undefined;
    if (agent.mode === 'internal') {
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
      });
      internalWorkspacePath = workspaceBinding.workspaceMount.mountPath;
      await deps.internalAgentPodManager.ensureAgentReady({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        workloadId,
        sessionId: task.id,
        agent,
        workspaceMount: workspaceBinding.workspaceMount,
      });
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
    const wireApi = notebookPreferences.wire_api === 'responses' ? 'responses' : 'chat';
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
        session_id: task.id,
        agent_id: agentId,
        mode: 'notebook',
      },
      ttlMs: 8 * 60 * 60 * 1000,
      maxUses: 500,
    });
    await throwIfCancellationRequested();
    const dispatched = await deps.agentExecutionService.dispatchStreamingRequest({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      sessionId: task.id,
      agentId,
      model,
      messages: mapTaskMessagesForExecution(taskId, assistantMessage.id),
      executionContext: {
        interaction_kind: 'notebook',
        workspace_id: task.workspace_id,
        project_id: task.project_id,
        task_id: task.id,
        run_id: runId,
        username: userHandle,
        endpoint_id: endpointId,
        api_base: resolveExecutionApiBase(publicBaseUrl, agent),
        execution_ticket: issuedExecutionTicket.ticket,
        wire_api: wireApi,
        model,
        model_context_window: modelContextWindow,
        model_auto_compact_token_limit: modelAutoCompactTokenLimit,
        model_catalog: modelCatalog,
        runner_session_scope:
          agent.mode === 'external' && isComposeManagedExternalAgent(agent)
            ? 'agent_presence'
            : 'task_execution',
        workspace_binding_mode: agent.mode === 'internal' ? 'pre_mounted' : 'file_library',
        workspace_path: agent.mode === 'internal' ? internalWorkspacePath : undefined,
        workspace_file_library_id: task.workspace_file_library_id ?? null,
        workspace_file_library_name: task.workspace_file_library_name ?? null,
        workspace_dir_name: workspaceLibrary?.filesystem_name
          ?? sanitizeFileLibraryWorkspaceDirName(task.workspace_file_library_name, task.workspace_file_library_id),
        task_inputs: taskInputs,
      },
    });
    requestExecutionId = dispatched.requestId;
    onDispatched?.({
      taskId: task.id,
      runId,
      requestId: dispatched.requestId,
      cancel: dispatched.cancel,
    });
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
      metadata: { run_id: runId, endpoint_id: endpointId, model, wire_api: wireApi },
    });

    for await (const event of dispatched.stream) {
      if (event.type === 'event' && event.event) {
        if (event.event.status === 'cancelled') {
          sawCancelledTerminalTrace = true;
        }
        const traceEvent = buildTaskTraceEvent({
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
        emitTaskEvent(taskId, { type: 'message', data: assistantMessage });
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
    const code = typeof codeCandidate === 'string'
      ? codeCandidate
      : message === 'agent_offline'
        ? 'AGENT_OFFLINE'
      : 'AGENT_UPSTREAM_ERROR';
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
      const fallbackTrace = buildTaskTraceEvent({
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
    const cancellationRequested = await isCancellationRequested?.() === true;
    if (cancellationRequested && !sawCancelledTerminalTrace) {
      const userCancelledTrace = buildTaskTraceEvent({
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
      emitTaskEvent(taskId, { type: 'message', data: assistantMessage });
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
        metadata: { run_id: runId, agent_id: agentId, endpoint_id: endpointIdForLog },
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
        metadata: { run_id: runId, task_id: task.id, endpoint_id: endpointIdForLog },
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
