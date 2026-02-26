import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AgentRuntimeArtifactPayload, AgentRuntimeTraceEventPayload } from './agent-runtime-service.js';
import {
  recordNotebookTaskRunCompleted,
  recordNotebookTaskRunFailed,
  recordNotebookTaskRunStarted,
  recordNotebookTaskRunTerminalWithoutDone,
} from './notebook-runtime-metrics.js';
import { writeProjectAuditEvent, writeProjectUsageFact } from './audit-usage-recorders.js';
import { buildNotebookRuntimeTaskInputs, type NotebookTaskInputRefRecord } from './notebook-input-refs.js';
import { buildTaskTraceEvent, storeTaskTraceEvent } from './notebook-trace-store.js';
import { isProjectResourceAccessAllowedForUser } from './project-resource-policy-store.js';
import {
  checkAndConsumeProjectResourceRateLimitsForUser,
  checkProjectResourceQuotaLimitsForUser,
} from './project-resource-policy-enforcer.js';

type NotebookTaskRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  agent_name: string;
  status: 'active' | 'closed' | 'archived';
  attached_inputs: Array<
    | { id: string; kind: 'source'; source_id: string }
    | { id: string; kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
    | { id: string; kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
    | { id: string; kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number }
  >;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  agent_id: string;
};

type NotebookTaskMessageRecord = {
  id: string;
  task_id: string;
  role: 'user' | 'agent';
  content: string;
  created_at: string;
  referenced_source_ids?: string[];
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

type RuntimeEventPayload =
  | { type: 'trace_event'; data: unknown }
  | { type: 'artifact'; data: NotebookTaskArtifactRecord }
  | { type: 'message'; data: NotebookTaskMessageRecord }
  | { type: 'task_update'; data: NotebookTaskRecord }
  | { type: 'error'; data: { message: string; code: string } };

export async function runNotebookTaskWithExternalAgent(input: {
  deps: NodeApiDeps;
  task: NotebookTaskRecord;
  assistantMessage: NotebookTaskMessageRecord;
  agentId: string;
  user: AuthenticatedUser;
  rawBearerToken: string | null;
  publicBaseUrl: string;
  buildRunId: () => string;
  buildProxyUsername: (user: AuthenticatedUser) => string;
  mapTaskMessagesForRuntime: (taskId: string, assistantMessageId: string) => Array<Record<string, unknown>>;
  updateTaskActivity: (task: NotebookTaskRecord) => void;
  emitTaskEvent: (taskId: string, payload: RuntimeEventPayload) => void;
  onFinalize: (taskId: string) => void;
  debugLog: (message: string, extra?: Record<string, unknown>) => void;
  taskCollections: {
    tasks: string;
    messages: string;
  };
  createTaskArtifact: (args: {
    taskId: string;
    runId: string;
    payload: AgentRuntimeArtifactPayload;
  }) => Promise<NotebookTaskArtifactRecord>;
}): Promise<void> {
  const {
    deps,
    task,
    assistantMessage,
    agentId,
    user,
    rawBearerToken,
    publicBaseUrl,
    buildRunId,
    buildProxyUsername,
    mapTaskMessagesForRuntime,
    updateTaskActivity,
    emitTaskEvent,
    onFinalize,
    debugLog,
    taskCollections,
    createTaskArtifact,
  } = input;
  const taskId = task.id;
  const runId = buildRunId();
  let reachedTerminal = false;
  let endpointIdForLog: string | null = null;
  const startedAtMs = Date.now();
  let terminalResult: 'ok' | 'error' = 'ok';
  let terminalErrorCode: string | undefined;
  let usageTokensTotal: number | undefined;
  let runtimeRequestId: string | undefined;

  try {
    const agent = await deps.agentResourceService.getAgent(task.workspace_id, task.project_id, agentId);
    if (!agent || agent.status !== 'enabled') {
      throw Object.assign(new Error('agent_not_available'), { code: 'AGENT_OFFLINE' });
    }

    const runtimePreferences =
      typeof agent.runtime_preferences_json === 'object' && agent.runtime_preferences_json !== null
        ? (agent.runtime_preferences_json as Record<string, unknown>)
        : {};
    const notebookPreferences =
      typeof runtimePreferences.notebook === 'object' && runtimePreferences.notebook !== null
        ? (runtimePreferences.notebook as Record<string, unknown>)
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

    const endpoint = await deps.endpointResourceService.getEndpoint(
      task.workspace_id,
      task.project_id,
      endpointId,
    );
    if (!endpoint || endpoint.status !== 'active') {
      throw Object.assign(new Error('endpoint_not_available'), { code: 'VALIDATION_ERROR' });
    }
    const endpointPolicyCheck = isProjectResourceAccessAllowedForUser({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      resourceType: 'endpoint',
      resourceId: endpointId,
      userId: user.id,
    });
    if (!endpointPolicyCheck.allowed) {
      throw Object.assign(new Error('resource_policy_denied_endpoint'), { code: 'RESOURCE_POLICY_DENIED' });
    }
    const agentPolicyCheck = isProjectResourceAccessAllowedForUser({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      resourceType: 'agent',
      resourceId: agentId,
      userId: user.id,
    });
    if (!agentPolicyCheck.allowed) {
      throw Object.assign(new Error('resource_policy_denied_agent'), { code: 'RESOURCE_POLICY_DENIED' });
    }
    const agentRateCheck = checkAndConsumeProjectResourceRateLimitsForUser({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      resourceType: 'agent',
      resourceId: agentId,
      userId: user.id,
      policy: agentPolicyCheck.policy,
    });
    if (!agentRateCheck.allowed) {
      await writeProjectAuditEvent(deps, {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        actor: { type: 'user', id: user.id },
        action: 'resource_policy.rate_limited',
        result: 'error',
        resourceType: 'agent',
        resourceId: agentId,
        errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
        errorMessage: 'resource_policy_rate_limited',
        metadata: {
          governance_kind: 'resource_policy',
          enforcement_kind: 'rate_limit',
          effective_limit_per_minute: agentRateCheck.effective_limit_per_minute,
          retry_after_seconds: agentRateCheck.retry_after_seconds,
          scope: agentRateCheck.scope,
          rate_key: 'agent.requests_per_minute',
          task_id: task.id,
        },
      });
      await writeProjectUsageFact(deps, {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        resourceType: 'agent',
        resourceId: agentId,
        endUserId: user.id,
        requests: 1,
        result: 'error',
        errorCode: 'RESOURCE_POLICY_RATE_LIMITED',
        metadata: {
          stage: 'preflight',
          governance_kind: 'resource_policy',
          enforcement_kind: 'rate_limit',
          effective_limit_per_minute: agentRateCheck.effective_limit_per_minute,
          retry_after_seconds: agentRateCheck.retry_after_seconds,
          scope: agentRateCheck.scope,
          rate_key: 'agent.requests_per_minute',
          task_id: task.id,
        },
      });
      throw Object.assign(new Error('resource_policy_rate_limited_agent'), { code: 'RESOURCE_POLICY_RATE_LIMITED' });
    }
    const agentQuotaCheck = await checkProjectResourceQuotaLimitsForUser({
      docStore: deps.docStore,
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      resourceType: 'agent',
      resourceId: agentId,
      userId: user.id,
      policy: agentPolicyCheck.policy,
    });
    if (!agentQuotaCheck.allowed) {
      await writeProjectAuditEvent(deps, {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        actor: { type: 'user', id: user.id },
        action: 'resource_policy.quota_exceeded',
        result: 'error',
        resourceType: 'agent',
        resourceId: agentId,
        errorCode: 'RESOURCE_POLICY_QUOTA_EXCEEDED',
        errorMessage: 'resource_policy_quota_exceeded',
        metadata: {
          governance_kind: 'resource_policy',
          enforcement_kind: 'quota_limit',
          effective_daily_token_limit: agentQuotaCheck.effective_daily_token_limit,
          current_tokens_today: agentQuotaCheck.current_tokens_today,
          retry_after_seconds: agentQuotaCheck.retry_after_seconds,
          scope: agentQuotaCheck.scope,
          quota_key: 'agent.daily_token_limit',
          task_id: task.id,
        },
      });
      await writeProjectUsageFact(deps, {
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        resourceType: 'agent',
        resourceId: agentId,
        endUserId: user.id,
        requests: 1,
        result: 'error',
        errorCode: 'RESOURCE_POLICY_QUOTA_EXCEEDED',
        metadata: {
          stage: 'preflight',
          governance_kind: 'resource_policy',
          enforcement_kind: 'quota_limit',
          effective_daily_token_limit: agentQuotaCheck.effective_daily_token_limit,
          current_tokens_today: agentQuotaCheck.current_tokens_today,
          retry_after_seconds: agentQuotaCheck.retry_after_seconds,
          scope: agentQuotaCheck.scope,
          quota_key: 'agent.daily_token_limit',
          task_id: task.id,
        },
      });
      throw Object.assign(new Error('resource_policy_quota_exceeded_agent'), { code: 'RESOURCE_POLICY_QUOTA_EXCEEDED' });
    }
    if (!rawBearerToken) {
      throw Object.assign(new Error('user_token_missing'), { code: 'UNAUTHORIZED' });
    }

    const explicitModel = typeof notebookPreferences.model === 'string'
      ? notebookPreferences.model.trim()
      : '';
    const model = explicitModel || endpoint.openai_model || 'gpt-5-codex';
    const wireApi = notebookPreferences.wire_api === 'responses' ? 'responses' : 'chat';
    const userHandle = buildProxyUsername(user);
    const taskInputs = await buildNotebookRuntimeTaskInputs({
      deps,
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      taskId: task.id,
      attachedInputs: task.attached_inputs as NotebookTaskInputRefRecord[],
      debugLog,
    });
    const proxyBase = `${publicBaseUrl.replace(/\/+$/, '')}`
      + `/api/v1/workspaces/${encodeURIComponent(task.workspace_id)}`
      + `/projects/${encodeURIComponent(task.project_id)}`
      + `/endpoints/${encodeURIComponent(endpointId)}/proxy`;

    const dispatched = await deps.agentRuntimeService.dispatchStreamingRequest({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      sessionId: task.id,
      agentId,
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
        api_base: publicBaseUrl.replace(/\/+$/, ''),
        user_bearer_token: rawBearerToken,
        wire_api: wireApi,
        model,
        task_inputs: taskInputs,
        notebook_mode: true,
      },
    });
    runtimeRequestId = dispatched.requestId;
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
        const traceEvent = buildTaskTraceEvent({
          taskId: task.id,
          messageId: assistantMessage.id,
          runId,
          payload: event.event as AgentRuntimeTraceEventPayload,
        });
        await storeTaskTraceEvent(deps, task.id, traceEvent);
        emitTaskEvent(taskId, { type: 'trace_event', data: traceEvent });
        continue;
      }
      if (event.type === 'artifact' && event.artifact) {
        const artifact = await createTaskArtifact({
          taskId: task.id,
          runId,
          payload: event.artifact as AgentRuntimeArtifactPayload,
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
        debugLog('runtime_event_delta', {
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
        recordNotebookTaskRunFailed();
        debugLog('runtime_event_error', {
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
        terminalResult = 'ok';
        usageTokensTotal = event.usage_tokens;
        recordNotebookTaskRunCompleted();
        debugLog('runtime_event_done', {
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
    const codeCandidate = error instanceof Error
      ? (error as Error & { code?: unknown }).code
      : undefined;
    const code = typeof codeCandidate === 'string'
      ? codeCandidate
      : 'AGENT_UPSTREAM_ERROR';
    terminalErrorCode = code;
    debugLog('runtime_dispatch_exception', {
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
      terminalResult = 'error';
      terminalErrorCode = terminalErrorCode ?? 'AGENT_STREAM_TERMINAL_MISSING';
      recordNotebookTaskRunTerminalWithoutDone();
      debugLog('runtime_stream_finalized_without_terminal', {
        task_id: task.id,
        run_id: runId,
        agent_id: agentId,
        endpoint_id: endpointIdForLog,
        agent_chars: assistantMessage.content.length,
      });
    }
    const durationMs = Math.max(0, Date.now() - startedAtMs);
    await writeProjectAuditEvent(deps, {
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      actor: { type: 'agent', id: agentId },
      action:
        terminalResult === 'ok'
          ? 'notebook.task.run.completed'
          : 'notebook.task.run.failed',
      result: terminalResult,
      requestId: runtimeRequestId,
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
    await writeProjectUsageFact(deps, {
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      resourceType: 'notebook_task',
      resourceId: task.id,
      requestId: runtimeRequestId,
      durationMs,
      tokensTotal: usageTokensTotal,
      result: terminalResult,
      errorCode: terminalErrorCode,
      metadata: { run_id: runId, agent_id: agentId, endpoint_id: endpointIdForLog },
    });
    await writeProjectUsageFact(deps, {
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      resourceType: 'agent',
      resourceId: agentId,
      endUserId: user.id,
      requestId: runtimeRequestId,
      durationMs,
      tokensTotal: usageTokensTotal,
      result: terminalResult,
      errorCode: terminalErrorCode,
      metadata: { run_id: runId, task_id: task.id, endpoint_id: endpointIdForLog },
    });
    updateTaskActivity(task);
    debugLog('task_run_finalized', {
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
      await deps.docStore.upsert(taskCollections.messages, assistantMessage.id, assistantMessage);
      await deps.docStore.upsert(taskCollections.tasks, task.id, task);
    } catch (error) {
      debugLog('task_run_persist_failed', {
        task_id: task.id,
        run_id: runId,
        message_id: assistantMessage.id,
        error: error instanceof Error ? error.message : 'persist_failed',
      });
    }
    onFinalize(taskId);
  }
}
