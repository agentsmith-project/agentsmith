import type { AuditEvent } from '@/lib/api/types';

export const docAuditEvents: AuditEvent[] = [
  {
    id: 'audit_doc_001',
    timestamp: '2026-03-17T08:55:00Z',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    actor_type: 'user',
    actor_id: 'user_001',
    action: 'resource_policy.update',
    resource_type: 'resource_policy',
    resource_id: 'endpoint:endpoint_001',
    end_user_id: 'user_001',
    result: 'ok',
    request_id: 'req-doc-001',
    metadata_json: {
      endpoint_name: 'GLM-5 主生产',
      changed_fields: ['requests_per_minute', 'usd_spending_per_day'],
      reason: '应对 Notebook 批处理峰值和成本抬升',
    },
  },
  {
    id: 'audit_doc_002',
    timestamp: '2026-03-17T08:40:00Z',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    actor_type: 'agent',
    actor_id: 'agent_001',
    action: 'endpoint.invoke',
    resource_type: 'endpoint',
    resource_id: 'endpoint_001',
    end_user_id: 'user_001',
    result: 'ok',
    request_id: 'req-doc-002',
    metadata_json: {
      endpoint_name: 'GLM-5 主生产',
      model: 'GLM-5',
      tokens_used: 16840,
      duration_ms: 4820,
      task_id: 'task_doc_001',
    },
  },
  {
    id: 'audit_doc_003',
    timestamp: '2026-03-17T08:18:00Z',
    workspace_id: 'ws_default',
    project_id: 'proj_001',
    actor_type: 'user',
    actor_id: 'user_002',
    action: 'agent.key.create',
    resource_type: 'agent',
    resource_id: 'agent_001',
    end_user_id: 'user_002',
    result: 'ok',
    request_id: 'req-doc-003',
    metadata_json: {
      agent_name: '运营审计助手',
      interaction_mode: 'both',
    },
  },
];

export const docUsageTopResources = [
  {
    resource_id: 'endpoint_001',
    resource_name: 'GLM-5 主生产',
    resource_type: 'endpoint',
    requests: 18420,
  },
  {
    resource_id: 'endpoint_002',
    resource_name: 'Claude 复杂推理',
    resource_type: 'endpoint',
    requests: 4180,
  },
];

