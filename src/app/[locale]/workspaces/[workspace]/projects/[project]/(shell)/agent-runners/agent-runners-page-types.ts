import type { AgentDiagnostics, AgentRunnerCapabilities, AgentRunnerStatus } from '@/lib/api/types';

export interface ResolvedAgentRunnersPageParams {
  workspace?: string;
  project?: string;
  locale?: string;
}

export interface AgentRunnerStatusUpdateInput {
  name?: string;
  status?: AgentRunnerStatus;
}

export interface AgentRunnerPageRecord {
  id: string;
  project_id?: string;
  workspace_id?: string;
  name: string;
  description?: string;
  status: AgentRunnerStatus;
  is_default?: boolean;
  default_endpoint_id?: string;
  capabilities?: AgentRunnerCapabilities;
  diagnostics?: AgentDiagnostics | null;
  owner_id?: string;
  owner_name?: string;
  admin_id?: string;
  admin_name?: string;
  created_at?: string;
  updated_at?: string;
}
