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
  {
    id: 'ask_003',
    agent_id: 'agent_002',
    key_prefix: 'ask-***1a4b5c',
    status: 'active',
    created_at: '2026-01-16T11:00:00Z',
    last_used_at: '2026-01-26T10:00:00Z',
  },
  {
    id: 'ask_004',
    agent_id: 'agent_001',
    key_prefix: 'ask-***6d7e8f',
    status: 'revoked',
    created_at: '2026-01-10T08:00:00Z',
    last_used_at: '2026-01-18T12:00:00Z',
  },
];
