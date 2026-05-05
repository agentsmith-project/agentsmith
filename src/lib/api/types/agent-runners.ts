import type { components } from '../types.generated';

export type AgentRunnerCapabilities = components['schemas']['AgentRunnerCapabilities'];
export type AgentRunnerStatus = components['schemas']['AgentRunnerStatus'];

export type AgentDiagnostics = components['schemas']['AgentRunnerDiagnostics'] & {
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
    actual_runner_spec?: Record<string, unknown>;
  };
  runtime_metadata?: Record<string, unknown>;
};

export type AgentRunner = components['schemas']['AgentRunner'];

export type AgentRunnerServiceKey = components['schemas']['AgentRunnerKey'] & {
  agent_runner_id?: string;
  expires_at?: string;
  last_used_at?: string;
};

export type CreateAgentRunnerKeyResponse = components['schemas']['CreateAgentRunnerKeyResponse'] & {
  agent_runner_id?: string;
  status?: AgentRunnerServiceKey['status'];
  created_at?: string;
  expires_at?: string;
  last_used_at?: string;
};
