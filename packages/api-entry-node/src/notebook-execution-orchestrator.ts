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
import { buildThirdPartyCredentialFiles } from './third-party-credential-files.js';

type NotebookTaskRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  title: string;
  agent_name: string;
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

export async function runNotebookTaskWithExecutionAgent(input: {
  deps: NodeApiDeps;
  task: NotebookTaskRecord;
  assistantMessage: NotebookTaskMessageRecord;
  agentId: string;
  user: AuthenticatedUser;
  rawBearerToken: string | null;
  publicBaseUrl: string;
  buildRunId: () => string;
  buildProxyUsername: (user: AuthenticatedUser) => string;
  mapTaskMessagesForExecution: (taskId: string, assistantMessageId: string) => Array<Record<string, unknown>>;
  updateTaskActivity: (task: NotebookTaskRecord) => void;
  emitTaskEvent: (taskId: string, payload: ExecutionEventPayload) => void;
  onDispatched?: (args: { taskId: string; runId: string; requestId: string; cancel: () => void }) => void;
  onFinalize: (taskId: string) => void;
  isCancellationRequested?: () => boolean;
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
    rawBearerToken,
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
  let keepaliveTimer: NodeJS.Timeout | undefined;
  let sawCancelledTerminalTrace = false;

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

    if (!rawBearerToken) {
      throw Object.assign(new Error('user_token_missing'), { code: 'UNAUTHORIZED' });
    }

    const explicitModel = typeof notebookPreferences.model === 'string'
      ? notebookPreferences.model.trim()
      : '';
    let endpointModel = '';
    if (agent.mode !== 'internal') {
      const endpoint = await deps.endpointResourceService.getEndpoint(
        task.workspace_id,
        task.project_id,
        endpointId,
      );
      if (!endpoint || endpoint.status !== 'active') {
        throw Object.assign(new Error('endpoint_not_available'), { code: 'VALIDATION_ERROR' });
      }
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
      endpointModel = endpoint.model?.trim() ?? '';
    }
    const model = explicitModel || endpointModel || 'gpt-5-codex';
    if (agent.mode === 'internal') {
      if (!deps.internalAgentPodManager) {
        throw Object.assign(new Error('agent_sandbox_not_configured'), { code: 'AGENT_SANDBOX_NOT_CONFIGURED' });
      }
      emitTaskEvent(taskId, {
        type: 'trace_event',
        data: buildSandboxStartingEvent(),
      });
      const workloadId = sanitizeWorkloadId(task.id);
      await deps.internalAgentPodManager.ensureAgentReady({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        workloadId,
        agent,
      });
      keepaliveTimer = setInterval(() => {
        void deps.internalAgentPodManager?.keepalive(
          task.workspace_id,
          task.project_id,
          workloadId,
        ).catch(() => undefined);
      }, 60_000);
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
    const thirdPartyCredentialFiles = await buildThirdPartyCredentialFiles(
      deps.docStore,
      user.id,
    );
    const dispatched = await deps.agentExecutionService.dispatchStreamingRequest({
      workspaceId: task.workspace_id,
      projectId: task.project_id,
      sessionId: task.id,
      agentId,
      model,
      messages: mapTaskMessagesForExecution(taskId, assistantMessage.id),
      executionContext: {
        workspace_id: task.workspace_id,
        project_id: task.project_id,
        task_id: task.id,
        run_id: runId,
        username: userHandle,
        endpoint_id: endpointId,
        api_base: publicBaseUrl.replace(/\/+$/, ''),
        user_bearer_token: rawBearerToken,
        wire_api: wireApi,
        model,
        task_inputs: taskInputs,
        credential_files: thirdPartyCredentialFiles,
        notebook_mode: true,
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
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
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
    const cancellationRequested = isCancellationRequested?.() === true;
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
    // Finalize active run before emitting task_update so run_state is authoritative (idle) on the final update.
    onFinalize(taskId);
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
  }
}
