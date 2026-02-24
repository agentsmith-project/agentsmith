import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AgentRuntimeArtifactPayload, AgentRuntimeTraceEventPayload } from './agent-runtime-service.js';
import {
  recordNotebookTaskRunCompleted,
  recordNotebookTaskRunFailed,
  recordNotebookTaskRunStarted,
  recordNotebookTaskRunTerminalWithoutDone,
} from './notebook-runtime-metrics.js';
import { buildTaskTraceEvent, storeTaskTraceEvent } from './notebook-trace-store.js';

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

type RuntimeTaskInput =
  | {
      kind: 'source';
      source_id: string;
      filename: string;
      file_type?: string;
      file_size?: number;
      ai_ready_status?: string;
    }
  | {
      kind: 'library_object';
      library_id: string;
      key: string;
      filename: string;
      file_type?: string;
      file_size?: number;
    };

function asObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
}

function readString(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim().length > 0 ? input.trim() : undefined;
}

function readNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

async function buildRuntimeTaskInputs(
  deps: NodeApiDeps,
  task: NotebookTaskRecord,
  debugLog: (message: string, extra?: Record<string, unknown>) => void,
): Promise<RuntimeTaskInput[]> {
  if (task.attached_inputs.length === 0) return [];
  const inputs = await Promise.all(task.attached_inputs.map(async (inputRef) => {
    if (inputRef.kind === 'library_object') {
      try {
        const meta = await deps.getSourceObjectMetaUseCase.execute({
          workspaceId: task.workspace_id,
          projectId: task.project_id,
          libraryId: inputRef.library_id,
          key: inputRef.key,
        });
        return {
          kind: 'library_object',
          library_id: inputRef.library_id,
          key: inputRef.key,
          filename: inputRef.name || meta.key.split('/').pop() || inputRef.key,
          file_type: meta.content_type,
          file_size: meta.size_bytes,
        } satisfies RuntimeTaskInput;
      } catch (error) {
        debugLog('task_input_library_object_lookup_failed', {
          task_id: task.id,
          library_id: inputRef.library_id,
          key: inputRef.key,
          error: error instanceof Error ? error.message : 'object_lookup_failed',
        });
        return {
          kind: 'library_object',
          library_id: inputRef.library_id,
          key: inputRef.key,
          filename: inputRef.name || inputRef.key.split('/').pop() || inputRef.key,
          ...(inputRef.content_type ? { file_type: inputRef.content_type } : {}),
          ...(typeof inputRef.size_bytes === 'number' ? { file_size: inputRef.size_bytes } : {}),
        } satisfies RuntimeTaskInput;
      }
    }
    const sourceId = inputRef.source_id;
    try {
      const source = await deps.getSourceUseCase.execute({
        workspaceId: task.workspace_id,
        projectId: task.project_id,
        sourceId,
      });
      const src = asObject(source);
      const aiReady = asObject(src.ai_ready);
      return {
        kind: 'source',
        source_id: sourceId,
        filename: readString(src.filename) ?? readString(src.name) ?? sourceId,
        ...(readString(src.file_type) ?? readString(src.content_type)
          ? { file_type: readString(src.file_type) ?? readString(src.content_type) }
          : {}),
        ...(readNumber(src.file_size) !== undefined ? { file_size: readNumber(src.file_size) } : {}),
        ...(readString(aiReady.status) ? { ai_ready_status: readString(aiReady.status) } : {}),
      } satisfies RuntimeTaskInput;
    } catch (error) {
      debugLog('task_input_source_lookup_failed', {
        task_id: task.id,
        source_id: sourceId,
        error: error instanceof Error ? error.message : 'source_lookup_failed',
      });
      return {
        kind: 'source',
        source_id: sourceId,
        filename: sourceId,
      } satisfies RuntimeTaskInput;
    }
  }));
  return inputs;
}

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
    if (!rawBearerToken) {
      throw Object.assign(new Error('user_token_missing'), { code: 'UNAUTHORIZED' });
    }

    const explicitModel = typeof notebookPreferences.model === 'string'
      ? notebookPreferences.model.trim()
      : '';
    const model = explicitModel || endpoint.openai_model || 'gpt-5-codex';
    const wireApi = notebookPreferences.wire_api === 'responses' ? 'responses' : 'chat';
    const userHandle = buildProxyUsername(user);
    const taskInputs = await buildRuntimeTaskInputs(deps, task, debugLog);
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
    recordNotebookTaskRunFailed();
    const codeCandidate = error instanceof Error
      ? (error as Error & { code?: unknown }).code
      : undefined;
    const code = typeof codeCandidate === 'string'
      ? codeCandidate
      : 'AGENT_UPSTREAM_ERROR';
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
      recordNotebookTaskRunTerminalWithoutDone();
      debugLog('runtime_stream_finalized_without_terminal', {
        task_id: task.id,
        run_id: runId,
        agent_id: agentId,
        endpoint_id: endpointIdForLog,
        agent_chars: assistantMessage.content.length,
      });
    }
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
