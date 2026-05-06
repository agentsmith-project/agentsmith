/**
 * Agent Runner fixtures
 *
 * Mock Agent Runner data for development and testing.
 */

import type {
  AgentRunner,
  AgentRunnerActionAffordance,
  AgentRunnerActionOperation,
  AgentRunnerActions,
  AgentRunnerCollectionActions,
  AgentRunnerServiceKey,
} from '@/lib/api/types';

export function agentRunnerAction(
  operation: AgentRunnerActionOperation,
  visible = false,
  allowed = false,
  reason_code?: string,
): AgentRunnerActionAffordance {
  const affordance: AgentRunnerActionAffordance = {
    operation,
    visible,
    allowed,
    required_permissions: [],
    danger_level: operation === 'delete' ? 'high' : 'none',
  };
  return reason_code ? { ...affordance, reason_code } : affordance;
}

export function agentRunnerActions(kind: AgentRunner['kind'], overrides: Partial<AgentRunnerActions> = {}): AgentRunnerActions {
  const isDeveloper = kind === 'developer';
  return {
    set_project_default: agentRunnerAction('set_project_default', kind === 'system_managed', false),
    bind_to_task: agentRunnerAction('bind_to_task'),
    run_test_task: agentRunnerAction('run_test_task', isDeveloper, isDeveloper),
    edit: agentRunnerAction('edit', isDeveloper, isDeveloper),
    disable: agentRunnerAction('disable'),
    delete: agentRunnerAction('delete', isDeveloper, isDeveloper),
    issue_connection_key: agentRunnerAction('issue_connection_key', isDeveloper, isDeveloper),
    revoke_connection_key: agentRunnerAction('revoke_connection_key', isDeveloper, isDeveloper),
    test_connection: agentRunnerAction('test_connection', isDeveloper, isDeveloper),
    view_diagnostics: agentRunnerAction('view_diagnostics', true, true),
    ...overrides,
  };
}

export function agentRunnerCollectionActions(canManage = true): AgentRunnerCollectionActions {
  return {
    create_developer_runner: {
      ...agentRunnerAction(
        'create_developer_runner',
        true,
        canManage,
        canManage ? undefined : 'permission_denied',
      ),
      required_permissions: ['project:agent_runner:manage'],
    },
  };
}

export const agentRunnerFixtures: AgentRunner[] = [
  {
    id: 'agent_001',
    project_id: 'proj_001',
    name: 'SupportRunner',
    description: 'Managed runner backed by GPT-4o endpoint defaults',
    kind: 'system_managed',
    source: 'system',
    read_only: true,
    is_default: true,
    default_endpoint_id: 'ep_001',
    status: 'ready',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      file_inputs: true,
    },
    diagnostics: {
      presence: 'managed',
    },
    actions: agentRunnerActions('system_managed'),
    created_at: '2026-01-15T10:30:00Z',
    updated_at: '2026-01-25T14:20:00Z',
  },
  {
    id: 'agent_002',
    project_id: 'proj_001',
    name: 'ResearchRunner',
    description: 'Research analysis task runner',
    kind: 'system_managed',
    source: 'system',
    read_only: true,
    is_default: false,
    default_endpoint_id: 'ep_002',
    status: 'ready',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      file_inputs: true,
    },
    diagnostics: {
      presence: 'managed',
    },
    actions: agentRunnerActions('system_managed', {
      set_project_default: agentRunnerAction('set_project_default', true, true),
    }),
    created_at: '2026-01-16T11:00:00Z',
    updated_at: '2026-01-26T09:15:00Z',
  },
  {
    id: 'agent_003',
    project_id: 'proj_001',
    name: 'CodeRunner',
    description: 'Code writing and debugging task runner',
    kind: 'developer',
    source: 'developer',
    read_only: false,
    is_default: false,
    status: 'offline',
    capabilities: {
      task_execution: true,
      terminal: true,
      artifacts: true,
      file_inputs: true,
    },
    diagnostics: {
      presence: 'offline',
    },
    actions: agentRunnerActions('developer', {
      test_connection: agentRunnerAction('test_connection', true, true),
      run_test_task: agentRunnerAction('run_test_task', true, false, 'agent_runner_disconnected'),
    }),
    created_at: '2026-01-18T14:00:00Z',
    updated_at: '2026-01-22T10:30:00Z',
  },
  {
    id: 'agent_004',
    project_id: 'proj_002',
    name: 'DataRunner',
    description: 'Data analysis and visualization task runner',
    kind: 'system_managed',
    source: 'system',
    read_only: true,
    is_default: true,
    default_endpoint_id: 'ep_004',
    status: 'ready',
    capabilities: {
      task_execution: true,
      terminal: false,
      artifacts: true,
      file_inputs: true,
    },
    diagnostics: {
      presence: 'managed',
    },
    actions: agentRunnerActions('system_managed'),
    created_at: '2026-01-12T09:00:00Z',
    updated_at: '2026-01-27T16:00:00Z',
  },
];

export const agentRunnerKeyFixtures: AgentRunnerServiceKey[] = [
  {
    id: 'ask_001',
    agent_runner_id: 'agent_001',
    key_prefix: 'ask-***3f7a2b',
    status: 'active',
    created_at: '2026-01-15T10:30:00Z',
    expires_at: '2027-01-15T10:30:00Z',
    last_used_at: '2026-01-28T14:20:00Z',
  },
  {
    id: 'ask_002',
    agent_runner_id: 'agent_001',
    key_prefix: 'ask-***8c9d1e',
    status: 'active',
    created_at: '2026-01-20T11:00:00Z',
    last_used_at: '2026-01-27T09:15:00Z',
  },
  // Managed runner agent_002 cannot have ASK - no keys
  {
    id: 'ask_004',
    agent_runner_id: 'agent_001',
    key_prefix: 'ask-***6d7e8f',
    status: 'revoked',
    created_at: '2026-01-10T08:00:00Z',
    last_used_at: '2026-01-18T12:00:00Z',
  },
];
