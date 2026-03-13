import type { Agent } from '@/lib/api/types';

export interface ResolvedAgentsPageParams {
  workspace?: string;
  project?: string;
  locale?: string;
}

export interface AgentStatusUpdateInput {
  name?: string;
  status?: 'enabled' | 'disabled';
}

export type AgentsPageAgent = Agent;
