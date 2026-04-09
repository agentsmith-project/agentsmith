export type AgentInteractionKind = 'chat' | 'notebook';

export type AgentExecutionContext = {
  interaction_kind?: AgentInteractionKind;
  api_base?: string;
  workspace_id?: string;
  project_id?: string;
  task_id?: string;
  session_id?: string;
  execution_ticket?: string;
  endpoint_id?: string;
  wire_api?: 'chat' | 'responses';
  model?: string;
  username?: string;
  run_id?: string;
  workspace_path?: string;
  workspace_binding_mode?: 'file_library' | 'pre_mounted';
  workspace_file_library_id?: string | null;
  workspace_file_library_name?: string | null;
  workspace_dir_name?: string | null;
  model_context_window?: number;
  model_auto_compact_token_limit?: number;
  model_catalog?: {
    input_modalities?: string[];
    supports_search_tool?: boolean;
    supports_parallel_tool_calls?: boolean;
  };
  task_inputs?: Array<Record<string, unknown>>;
};

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
