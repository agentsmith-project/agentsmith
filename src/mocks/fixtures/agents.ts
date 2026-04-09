/**
 * Agent Fixtures
 *
 * Mock agent data for development and testing.
 */

import type { Agent, AgentServiceKey } from '@/lib/api/types';

export const agentFixtures: Agent[] = [
  {
    id: 'agent_001',
    project_id: 'proj_001',
    name: 'AgentA',
    description: 'LLM chat agent powered by GPT-4o',
    mode: 'external',
    presence: 'online',
    status: 'enabled',
    config: {
      image: 'agenta:latest',
      env: {
        MODEL: 'gpt-4o',
        TEMPERATURE: '0.7',
      },
      max_concurrent_sessions_override: 50,
    },
    external_stats: {
      source_ip: '192.168.1.42',
      connection_duration_sec: 1847,
      qpm: 12,
    },
    owner_id: 'user_001',
    owner_name: 'Alice',
    admin_id: 'user_001',
    admin_name: 'Alice',
    interaction_kind: 'chat',
    created_at: '2026-01-15T10:30:00Z',
    updated_at: '2026-01-25T14:20:00Z',
  },
  {
    id: 'agent_002',
    project_id: 'proj_001',
    name: 'ResearchAgent',
    description: 'Internal research analysis agent',
    mode: 'internal',
    presence: 'managed',
    status: 'enabled',
    config: {
      image: 'research-agent:v1.2.0',
      env: {
        MAX_TURNS: '100',
        TIMEOUT: '300',
      },
      max_concurrent_sessions_override: 10,
    },
    internal_stats: {
      pod_count: 2,
      desired_replicas: 2,
    },
    owner_id: 'user_002',
    owner_name: 'Bob',
    admin_id: 'user_002',
    admin_name: 'Bob',
    interaction_kind: 'notebook',
    created_at: '2026-01-16T11:00:00Z',
    updated_at: '2026-01-26T09:15:00Z',
  },
  {
    id: 'agent_003',
    project_id: 'proj_001',
    name: 'CodeAssistant',
    description: 'Code writing and debugging assistant',
    mode: 'external',
    presence: 'offline',
    status: 'disabled',
    external_stats: {},
    owner_id: 'user_001',
    owner_name: 'Alice',
    admin_id: 'user_003',
    admin_name: 'Carol',
    interaction_kind: 'chat',
    created_at: '2026-01-18T14:00:00Z',
    updated_at: '2026-01-22T10:30:00Z',
  },
  {
    id: 'agent_004',
    project_id: 'proj_002',
    name: 'DataAnalyst',
    description: 'Data analysis and visualization agent',
    mode: 'internal',
    presence: 'managed',
    status: 'enabled',
    internal_stats: {
      pod_count: 1,
      desired_replicas: 1,
    },
    owner_id: 'user_002',
    owner_name: 'Bob',
    interaction_kind: 'notebook',
    created_at: '2026-01-12T09:00:00Z',
    updated_at: '2026-01-27T16:00:00Z',
  },
];

export const agentServiceKeyFixtures: AgentServiceKey[] = [
  {
    id: 'ask_001',
    agent_id: 'agent_001',
    key_prefix: 'ask-***3f7a2b',
    status: 'active',
    created_at: '2026-01-15T10:30:00Z',
    expires_at: '2027-01-15T10:30:00Z',
    last_used_at: '2026-01-28T14:20:00Z',
  },
  {
    id: 'ask_002',
    agent_id: 'agent_001',
    key_prefix: 'ask-***8c9d1e',
    status: 'active',
    created_at: '2026-01-20T11:00:00Z',
    last_used_at: '2026-01-27T09:15:00Z',
  },
  // Internal agents (agent_002) cannot have ASK - no keys
  {
    id: 'ask_004',
    agent_id: 'agent_001',
    key_prefix: 'ask-***6d7e8f',
    status: 'revoked',
    created_at: '2026-01-10T08:00:00Z',
    last_used_at: '2026-01-18T12:00:00Z',
  },
];
