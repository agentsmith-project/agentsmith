export type AgentInteractionKind = 'chat' | 'notebook';
export const SUPPORTED_AGENT_WIRE_APIS = ['chat', 'responses', 'anthropic_messages'] as const;
export type AgentWireApi = (typeof SUPPORTED_AGENT_WIRE_APIS)[number];

export type AgentExecutionModelCatalog = {
  input_modalities?: string[];
  supports_search_tool?: boolean;
  supports_parallel_tool_calls?: boolean;
};

export type AgentTaskInput = Record<string, unknown>;

export type AgentExecutionContextBase = {
  api_base?: string;
  workspace_id?: string;
  project_id?: string;
  execution_ticket?: string;
  endpoint_id?: string;
  wire_api?: AgentWireApi;
  model?: string;
  username?: string;
  run_id?: string;
  model_context_window?: number;
  model_auto_compact_token_limit?: number;
  model_catalog?: AgentExecutionModelCatalog;
};

export type ChatExecutionContext = AgentExecutionContextBase & {
  interaction_kind: 'chat';
  session_id: string;
  task_id?: never;
};

export type NotebookExecutionContext = AgentExecutionContextBase & {
  interaction_kind: 'notebook';
  task_id: string;
  session_id?: string;
  workspace_path?: string;
  workspace_binding_mode?: 'file_library' | 'pre_mounted';
  workspace_file_library_id?: string | null;
  workspace_file_library_name?: string | null;
  workspace_dir_name?: string | null;
  task_inputs?: AgentTaskInput[];
};

export type AgentExecutionContext = ChatExecutionContext | NotebookExecutionContext;

export type AgentServerStartPayload = {
  model?: string;
  stream?: boolean;
  messages?: Array<{ role?: string; content?: unknown }>;
  execution_context?: AgentExecutionContext;
};

export type AgentServerHelloPayload = {
  protocol_version?: string;
  heartbeat_interval_sec?: number;
  resource_proxy?: {
    base_url?: string;
  };
};

export type AgentEnvelope = {
  type?: string;
  request_id?: string;
  session_id?: string;
  terminal_session_id?: string;
  timestamp?: string;
  payload?: unknown;
};

function isPlainObject(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
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

export function isChatExecutionContext(input: unknown): input is ChatExecutionContext {
  if (!isPlainObject(input)) return false;
  if (input.interaction_kind !== 'chat') return false;
  if (!hasTrimmedStringField(input, 'session_id')) return false;
  if (input.task_id !== undefined) return false;
  if (!hasValidWireApi(input)) return false;
  return true;
}

export function isNotebookExecutionContext(input: unknown): input is NotebookExecutionContext {
  if (!isPlainObject(input)) return false;
  if (input.interaction_kind !== 'notebook') return false;
  if (!hasTrimmedStringField(input, 'task_id')) return false;
  if (!hasValidWireApi(input)) return false;
  return true;
}

export function assertChatExecutionContext(input: unknown): ChatExecutionContext {
  if (!isChatExecutionContext(input)) {
    throw new Error('chat_execution_context_invalid');
  }
  return input;
}

export function assertNotebookExecutionContext(input: unknown): NotebookExecutionContext {
  if (!isNotebookExecutionContext(input)) {
    throw new Error('notebook_execution_context_invalid');
  }
  return input;
}
