import type { AgentRunner, UpdateAgentRunnerRequest } from '@/lib/api/types';

export interface ResolvedAgentRunnersPageParams {
  workspace?: string;
  project?: string;
  locale?: string;
}

export type AgentRunnerStatusUpdateInput = UpdateAgentRunnerRequest;

export type AgentRunnerPageRecord = AgentRunner & {
  workspace_id?: string;
  owner_id?: string;
  owner_name?: string;
  admin_id?: string;
  admin_name?: string;
};
