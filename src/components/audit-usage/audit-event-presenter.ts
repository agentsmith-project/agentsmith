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
  workspace: 'Workspace',
  organization: 'Organization',
  request: 'Request',
  usage_report: 'Usage Report',
  governance_incident: 'Governance Incident',
};

const ACTION_LABELS: Record<string, string> = {
  'endpoint.invoke': 'Invoked',
  endpoint_invoke: 'Invoked',
  'members.update': 'Updated Member Access',
  members_update: 'Updated Member Access',
  'resource_policy.spending_limit_exceeded': 'Hit Spending Limit',
  'resource_policy.rate_limit_exceeded': 'Hit Rate Limit',
  'resource_policy.update': 'Updated Resource Policy',
  resource_policy_update: 'Updated Resource Policy',
  credential_create: 'Created Credential',
  credential_update: 'Updated Credential',
  credential_delete: 'Deleted Credential',
  credential_rotate: 'Rotated Credential',
  'project.create': 'Created Project',
  project_create: 'Created Project',
  'project.update': 'Updated Project',
  project_update: 'Updated Project',
  'project.delete': 'Deleted Project',
  project_delete: 'Deleted Project',
  'agent.create': 'Created Agent',
  agent_create: 'Created Agent',
  'agent.update': 'Updated Agent',
  agent_update: 'Updated Agent',
  'agent.delete': 'Deleted Agent',
  agent_delete: 'Deleted Agent',
  'endpoint.create': 'Created Endpoint',
  endpoint_create: 'Created Endpoint',
  'endpoint.update': 'Updated Endpoint',
  endpoint_update: 'Updated Endpoint',
  'endpoint.delete': 'Deleted Endpoint',
  endpoint_delete: 'Deleted Endpoint',
  member_create: 'Added Member',
  member_delete: 'Removed Member',
  usage_report_delivery_failed: 'Failed Usage Report Delivery',
  usage_report_delivery_succeeded: 'Delivered Usage Report',
  governance_blocked: 'Triggered Governance Block',
};

const ERROR_CODE_LABELS: Record<string, string> = {
  FORBIDDEN: 'Permission Denied',
  RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED: 'Spending Limit Exceeded',
  RESOURCE_POLICY_RATE_LIMIT_EXCEEDED: 'Rate Limit Exceeded',
  UPSTREAM_401: 'Upstream Authentication Failed',
  UPSTREAM_403: 'Upstream Access Denied',
  UPSTREAM_404: 'Upstream Resource Missing',
  UPSTREAM_429: 'Upstream Rate Limited',
  UPSTREAM_5XX: 'Upstream Service Error',
  SYSTEM_ERROR: 'System Error',
  blocked: 'Blocked',
};

const ACTOR_LABEL_KEYS: Record<string, string> = {
  user: 'summary.user_actor',
  agent: 'summary.agent_actor',
  plugin: 'summary.plugin_actor',
  system: 'summary.system_actor',
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
  const normalized = errorCode.trim();
  return ERROR_CODE_LABELS[normalized] ?? humanizeAuditToken(errorCode);
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

export function getAuditActorLabel(actorType: string | undefined, t: AuditSummaryTranslator): string {
  if (!actorType) {
    return t('summary.system_actor');
  }
  const normalized = actorType.trim().toLowerCase();
  const key = ACTOR_LABEL_KEYS[normalized];
  if (key) {
    return t(key);
  }
  return humanizeAuditToken(actorType);
}

export function getAuditSummary(event: AuditEvent, t: AuditSummaryTranslator) {
  const actor = getAuditActorLabel(event.actor_type, t);
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
