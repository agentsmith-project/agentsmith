export interface AgentExternalStats {
  source_ip?: string;
  connection_duration_sec?: number;
  qpm?: number;
}

export interface AgentInternalStats {
  pod_count?: number;
  desired_replicas?: number;
}

export interface AgentDiagnostics {
  last_error?: string;
  last_error_at?: string;
  retry_backoff_sec?: number;
  restarts?: number;
  queue_depth?: number;
  cpu_percent?: number;
  memory_mb?: number;
  source_ip?: string;
  connected_at?: string;
  last_pong_at?: string;
  runner_spec_mismatch?: {
    expected_interaction_kind?: AgentInteractionKind;
    actual_runner_spec?: Record<string, unknown>;
  };
  runtime_metadata?: Record<string, unknown>;
}

export type AgentInteractionKind = 'chat' | 'notebook';

export interface Agent {
  id: string;
  project_id: string;
  workspace_id?: string;
  name: string;
  description?: string;
  mode: 'external' | 'internal';
  presence?: 'online' | 'offline' | 'managed';
  status: 'enabled' | 'disabled';
  config?: AgentConfig;
  config_json?: Record<string, unknown>;
  execution_preferences_json?: Record<string, unknown>;
  internal_config_json?: Record<string, unknown>;
  external_stats?: AgentExternalStats;
  internal_stats?: AgentInternalStats;
  owner_id?: string;
  owner_name?: string;
  admin_id?: string;
  admin_name?: string;
  visibility?: 'private' | 'public';
  interaction_kind?: AgentInteractionKind;
  capabilities?: {
    streaming_completion?: boolean;
    multimodal_completion?: boolean;
    accepted_mime_types?: string[];
    max_file_count?: number;
    max_total_bytes?: number;
  };
  created_at: string;
  updated_at: string;
}

export interface AgentConfig {
  image?: string;
  env?: Record<string, string>;
  endpoint_id?: string;
  cpu_request?: string;
  cpu_limit?: string;
  memory_request?: string;
  memory_limit?: string;
  idle_timeout_sec?: number;
  max_lifetime_sec?: number;
  max_concurrent_sessions_override?: number;
}

export interface AgentServiceKey {
  id: string;
  agent_id: string;
  key_prefix: string;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}

export interface CreateAgentKeyResponse extends AgentServiceKey {
  key?: string;
}
