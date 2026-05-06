import type { components } from '../types.generated';

export type AgentRunnerCapabilities = components['schemas']['AgentRunnerCapabilities'];
export type AgentRunnerStatus = components['schemas']['AgentRunnerStatus'];
export type AgentRunnerKind = components['schemas']['AgentRunnerKind'];
export type AgentRunnerSource = components['schemas']['AgentRunnerSource'];
export type AgentRunnerActionOperation = components['schemas']['AgentRunnerActionOperation'];
export type AgentRunnerActionAffordance = components['schemas']['AgentRunnerActionAffordance'];
export type AgentRunnerActions = components['schemas']['AgentRunnerActions'];
export type AgentRunnerCollectionActions = components['schemas']['AgentRunnerCollectionActions'];
export type AgentRunnerListResponse = components['schemas']['AgentRunnerListResponse'];
export type CreateAgentRunnerRequest = components['schemas']['CreateAgentRunnerRequest'];
export type UpdateAgentRunnerRequest = components['schemas']['UpdateAgentRunnerRequest'];
export type AgentRunnerKeyListResponse = components['schemas']['AgentRunnerKeyListResponse'];
export type AgentRunnerTestConnectionRequest = components['schemas']['AgentRunnerTestConnectionRequest'];
export type AgentRunnerTestConnectionResponse = components['schemas']['AgentRunnerTestConnectionResponse'];
export type AgentRunnerTestConnectionCleanup = components['schemas']['AgentRunnerTestConnectionCleanup'];
export type AgentRunnerKeyExpiryCleanup = components['schemas']['AgentRunnerKeyExpiryCleanup'];
export type AgentRunnerTestTaskRunRequest = components['schemas']['AgentRunnerTestTaskRunRequest'];
export type AgentRunnerTestTaskRunAcceptedResponse = components['schemas']['AgentRunnerTestTaskRunAcceptedResponse'];
export type AgentRunnerTestTaskRunUnavailableResponse = components['schemas']['AgentRunnerTestTaskRunUnavailableResponse'];

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
