export const SUPPORTED_AGENT_WIRE_APIS = [
  'openai_chat_completions',
  'openai_responses',
  'anthropic_messages',
] as const;
export type AgentWireApi = (typeof SUPPORTED_AGENT_WIRE_APIS)[number];
export type AgentExecutionApplyPatchToolType = 'freeform' | 'function';

const SUPPORTED_RUNNER_SESSION_SCOPES = [
  'agent_presence',
  'task_execution',
] as const;
export type RunnerSessionScope = (typeof SUPPORTED_RUNNER_SESSION_SCOPES)[number];

export type AgentExecutionModelCatalog = {
  input_modalities?: string[];
  supports_search_tool?: boolean;
  supports_parallel_tool_calls?: boolean;
  apply_patch_tool_type?: AgentExecutionApplyPatchToolType;
};

export type AgentExecutionModelLimits = {
  context_window?: number;
  max_output_tokens?: number;
};

export type AgentTaskModelSnapshot = {
  endpoint_id: string;
  endpoint_display_name?: string;
  resolved_model: string;
  upstream_protocol?: AgentWireApi;
  setting_revision: string;
  policy_decision_id?: string;
  resolved_at: string;
};

export type AgentExecutionResourceProxy = {
  base_url: string;
};

export type AgentTaskInput = Record<string, unknown>;

export type TaskExecutionContext = {
  api_base?: string;
  workspace_id?: string;
  project_id?: string;
  task_id: string;
  run_id?: string;
  runner_id?: string;
  runner_session_scope?: RunnerSessionScope;
  execution_ticket?: string;
  endpoint_id?: string;
  agent_task_model?: AgentTaskModelSnapshot;
  resource_proxy?: AgentExecutionResourceProxy;
  wire_api?: AgentWireApi;
  model?: string;
  username?: string;
  workspace_path?: string;
  workspace_binding_mode?: 'file_library' | 'pre_mounted';
  workspace_file_library_id?: string | null;
  workspace_file_library_name?: string | null;
  workspace_dir_name?: string | null;
  task_inputs?: AgentTaskInput[];
  model_context_window?: number;
  model_auto_compact_token_limit?: number;
  model_limits?: AgentExecutionModelLimits;
  model_catalog?: AgentExecutionModelCatalog;
};

export type RunnerContext = TaskExecutionContext;

export type TaskRunResult = {
  status: 'success' | 'error' | 'cancelled';
  output_text?: string;
  usage_tokens?: number;
  artifacts?: Array<Record<string, unknown>>;
  error_code?: string;
  error_message?: string;
};

export type TaskRunner = {
  run(context: RunnerContext): Promise<TaskRunResult>;
};

export type AgentServerStartPayload = {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role?: string; content?: unknown }>;
  execution_context?: TaskExecutionContext;
};

export type AgentServerHelloPayload = {
  protocol_version?: string;
  heartbeat_interval_sec?: number;
};

export type AgentEnvelope = {
  type?: string;
  request_id?: string;
  runner_session_id?: string;
  terminal_session_id?: string;
  timestamp?: string;
  payload?: unknown;
};

const TASK_EXECUTION_UNSUPPORTED_FIELDS = new Set([
  'external_agent_id',
  'externalAgentId',
  'transport',
  'internalAgent',
  'interaction_kind',
  'workload',
  'session_id',
  'chat',
  'notebook',
  'chat_runner',
  'notebook_runner',
]);

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function hasOwnField(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function hasTrimmedStringField(input: Record<string, unknown>, key: string): boolean {
  return typeof input[key] === 'string' && input[key].trim().length > 0;
}

function hasValidWireApi(input: Record<string, unknown>): boolean {
  const wireApi = input.wire_api;
  return wireApi === undefined
    || (typeof wireApi === 'string'
      && SUPPORTED_AGENT_WIRE_APIS.includes(wireApi as AgentWireApi));
}

function hasValidRunnerSessionScope(input: Record<string, unknown>): boolean {
  const scope = input.runner_session_scope;
  return scope === undefined
    || (typeof scope === 'string'
      && SUPPORTED_RUNNER_SESSION_SCOPES.includes(scope as RunnerSessionScope));
}

function hasValidResourceProxy(input: Record<string, unknown>): boolean {
  const resourceProxy = input.resource_proxy;
  if (resourceProxy === undefined) return true;
  if (!isPlainObject(resourceProxy)) return false;
  return hasTrimmedStringField(resourceProxy, 'base_url');
}

function hasValidAgentTaskModelSnapshot(input: Record<string, unknown>): boolean {
  const snapshot = input.agent_task_model;
  if (snapshot === undefined) return true;
  if (!isPlainObject(snapshot)) return false;
  if (!hasTrimmedStringField(snapshot, 'endpoint_id')) return false;
  if (!hasTrimmedStringField(snapshot, 'resolved_model')) return false;
  if (!hasTrimmedStringField(snapshot, 'setting_revision')) return false;
  if (!hasTrimmedStringField(snapshot, 'resolved_at')) return false;
  const upstreamProtocol = snapshot.upstream_protocol;
  return upstreamProtocol === undefined
    || (typeof upstreamProtocol === 'string'
      && SUPPORTED_AGENT_WIRE_APIS.includes(upstreamProtocol as AgentWireApi));
}

function hasUnsupportedTaskExecutionField(input: Record<string, unknown>): boolean {
  for (const key of TASK_EXECUTION_UNSUPPORTED_FIELDS) {
    if (hasOwnField(input, key)) return true;
  }
  return false;
}

export function isTaskExecutionContext(input: unknown): input is TaskExecutionContext {
  if (!isPlainObject(input)) return false;
  if (hasUnsupportedTaskExecutionField(input)) return false;
  if (!hasTrimmedStringField(input, 'task_id')) return false;
  if (!hasValidWireApi(input)) return false;
  if (!hasValidRunnerSessionScope(input)) return false;
  if (!hasValidResourceProxy(input)) return false;
  if (!hasValidAgentTaskModelSnapshot(input)) return false;
  if (input.task_inputs !== undefined && !Array.isArray(input.task_inputs)) return false;
  return true;
}

export function assertTaskExecutionContext(input: unknown): TaskExecutionContext {
  if (!isTaskExecutionContext(input)) {
    throw new Error('task_execution_context_invalid');
  }
  return input;
}
