import type { AuditEvent } from '@/lib/api/types';

export type AuditEventCategory = 'change' | 'event' | 'anomaly';

export type AuditSummaryTranslator = (key: string, values?: Record<string, string>) => string;

const RESOURCE_LABELS: Record<string, string> = {
  endpoint: 'Model Endpoint',
  source_library: 'Source Library',
  source_file: 'Source File',
  resource_policy: 'Resource Policy',
  credential: 'Credential',
  member: 'Member',
  project: 'Project',
  agent: 'Agent',
};

const ACTION_LABELS: Record<string, string> = {
  'endpoint.invoke': 'Invoked',
  'members.update': 'Updated Member Access',
  'resource_policy.spending_limit_exceeded': 'Hit Spending Limit',
  'resource_policy.rate_limit_exceeded': 'Hit Rate Limit',
  credential_create: 'Created Credential',
  credential_update: 'Updated Credential',
  credential_delete: 'Deleted Credential',
  project_create: 'Created Project',
  project_update: 'Updated Project',
  project_delete: 'Deleted Project',
  agent_create: 'Created Agent',
  agent_update: 'Updated Agent',
  agent_delete: 'Deleted Agent',
  endpoint_create: 'Created Endpoint',
  endpoint_update: 'Updated Endpoint',
  endpoint_delete: 'Deleted Endpoint',
  governance_blocked: 'Triggered Governance Block',
};

const ERROR_CODE_LABELS: Record<string, string> = {
  FORBIDDEN: 'Permission Denied',
  RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED: 'Spending Limit Exceeded',
  RESOURCE_POLICY_RATE_LIMIT_EXCEEDED: 'Rate Limit Exceeded',
  blocked: 'Blocked',
};

export function isConfigurationChangeAction(action: string): boolean {
  const normalized = action.trim().toLowerCase();
  return [
    'create',
    'update',
    'delete',
    'activate',
    'deactivate',
    'save',
    'rotate',
    'policy',
    'pricing',
    'member',
    'credential',
  ].some((keyword) => normalized.includes(keyword));
}

export function getAuditEventCategory(event: AuditEvent): AuditEventCategory {
  if (event.result === 'error') {
    return 'anomaly';
  }
  if (isConfigurationChangeAction(event.action)) {
    return 'change';
  }
  return 'event';
}

export function humanizeAuditToken(value: string): string {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getAuditActionLabel(action: string): string {
  const normalized = action.trim().toLowerCase();
  return ACTION_LABELS[normalized] ?? humanizeAuditToken(action);
}

export function getAuditErrorLabel(errorCode?: string): string | undefined {
  if (!errorCode) {
    return undefined;
  }
  return ERROR_CODE_LABELS[errorCode] ?? humanizeAuditToken(errorCode);
}

export function getAuditResourceTypeLabel(resourceType?: string): string | undefined {
  if (!resourceType) {
    return undefined;
  }
  const normalized = resourceType.trim().toLowerCase();
  return RESOURCE_LABELS[normalized] ?? humanizeAuditToken(resourceType);
}

export function getAuditResourceLabel(event: AuditEvent): string {
  if (event.resource_id) {
    return event.resource_id;
  }
  return getAuditResourceTypeLabel(event.resource_type) ?? 'System';
}

export function getAuditSummary(event: AuditEvent, t: AuditSummaryTranslator) {
  const actor =
    event.actor_type === 'user'
      ? t('summary.user_actor')
      : event.actor_type === 'agent'
        ? t('summary.agent_actor')
        : t('summary.plugin_actor');
  const action = getAuditActionLabel(event.action);
  const resource = getAuditResourceLabel(event);
  const result = event.result === 'ok' ? t('summary.result_ok') : t('summary.result_error');
  return t('summary.line', {
    actor,
    action,
    resource,
    result,
  });
}
