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
  membership: 'Membership',
  project: 'Project',
  agent: 'Agent',
  workspace: 'Workspace',
  organization: 'Organization',
  request: 'Request',
  governance_incident: 'Governance Incident',
};

const ACTION_LABELS: Record<string, string> = {
  'endpoint.invoke': 'Invoked',
  endpoint_invoke: 'Invoked',
  'members.update': 'Updated Member Access',
  members_update: 'Updated Member Access',
  'resource_policy.access_denied': 'Denied Access',
  'resource_policy.access_limited': 'Denied Access',
  'resource_policy.access_blocked': 'Denied Access',
  'resource_policy.rate_limited': 'Rate Limited',
  'resource_policy.spending_limit_exceeded': 'Hit Spending Limit',
  'resource_policy.spending_limited': 'Spending Limited',
  'resource_policy.rate_limit_exceeded': 'Hit Rate Limit',
  'resource_policy.limit_exceeded': 'Spending Limited',
  'resource_policy.updated': 'Updated Resource Policy',
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
  'member.join_request.created': 'Created Join Request',
  'member.join_request.approved': 'Approved Join Request',
  'member.join_request.rejected': 'Rejected Join Request',
  'member.membership.activated': 'Activated Membership',
  'member.membership.suspended': 'Suspended Membership',
  'member.membership.removed': 'Removed Membership',
  'member.permissions.updated': 'Updated Member Permissions',
  member_create: 'Added Member',
  member_delete: 'Removed Member',
  governance_blocked: 'Triggered Governance Block',
};

const ERROR_CODE_LABELS: Record<string, string> = {
  FORBIDDEN: 'Permission Denied',
  VALIDATION_ERROR: 'Validation Error',
  RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED: 'Spending Limit Exceeded',
  RESOURCE_POLICY_RATE_LIMIT_EXCEEDED: 'Rate Limit Exceeded',
  RESOURCE_POLICY_ACCESS_DENIED: 'Access Denied',
  RATE_LIMIT_EXCEEDED: 'Rate Limit Exceeded',
  UPSTREAM_401: 'Upstream Authentication Failed',
  UPSTREAM_403: 'Upstream Access Denied',
  UPSTREAM_404: 'Upstream Resource Missing',
  UPSTREAM_429: 'Upstream Rate Limited',
  UPSTREAM_5XX: 'Upstream Service Error',
  SYSTEM_ERROR: 'System Error',
  blocked: 'Blocked',
  resource_policy_denied: 'Access Denied',
  resource_policy_rate_limited: 'Rate Limit Exceeded',
  resource_policy_spending_limited: 'Spending Limit Exceeded',
  resource_policy_spending_limit_exceeded: 'Spending Limit Exceeded',
};

const ERROR_MESSAGE_LABELS: Record<string, string> = {
  forbidden: 'Permission denied',
  blocked: 'Blocked',
  endpoint_model_conflict: 'Endpoint model already exists',
  endpoint_not_found: 'Endpoint not found',
  credential_not_found: 'Credential not found',
  unsupported_resource_type: 'Unsupported resource type',
  'access_mode and allowed_subjects are required': 'Access mode and allowed subjects are required',
  rate_limits_rule_key_invalid: 'Invalid rate limit rule',
  rate_limits_rule_value_invalid: 'Invalid rate limit value',
  spending_limits_rule_key_invalid: 'Invalid spending limit rule',
  spending_limits_rule_value_invalid: 'Invalid spending limit value',
  resource_policy_denied: 'Access denied by resource policy',
  resource_policy_rate_limited: 'Rate limited by resource policy',
  resource_policy_spending_limited: 'Spending limited by resource policy',
  resource_policy_spending_limit_exceeded: 'Spending limit exceeded',
};

const GOVERNANCE_REASON_LABELS: Record<string, string> = {
  spending_limit_exceeded: 'Spending limit exceeded',
  rate_limit_exceeded: 'Rate limit exceeded',
  resource_policy_denied: 'Access denied by resource policy',
  resource_policy_allowed: 'Allowed by resource policy',
};

const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  pending: 'Pending',
  suspended: 'Suspended',
  none: 'No membership',
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

export function getAuditErrorMessageLabel(errorMessage?: string): string | undefined {
  if (!errorMessage) {
    return undefined;
  }
  const normalized = errorMessage.trim();
  return ERROR_MESSAGE_LABELS[normalized] ?? humanizeAuditToken(errorMessage);
}

export function getAuditGovernanceReasonLabel(reason?: string): string | undefined {
  if (!reason) {
    return undefined;
  }
  const normalized = reason.trim();
  return GOVERNANCE_REASON_LABELS[normalized] ?? humanizeAuditToken(reason);
}

export function getAuditMembershipStatusLabel(status?: string): string | undefined {
  if (!status) {
    return undefined;
  }
  const normalized = status.trim().toLowerCase();
  return MEMBERSHIP_STATUS_LABELS[normalized] ?? humanizeAuditToken(status);
}

export function getAuditResourceTypeLabel(resourceType?: string): string | undefined {
  if (!resourceType) {
    return undefined;
  }
  const normalized = resourceType.trim().toLowerCase();
  return RESOURCE_LABELS[normalized] ?? humanizeAuditToken(resourceType);
}

export function getAuditResourceLabel(event: AuditEvent): string {
  if (
    event.resource_type === 'resource_policy'
    && event.metadata_json
    && typeof event.metadata_json === 'object'
  ) {
    const governedResourceType = typeof event.metadata_json.governed_resource_type === 'string'
      ? getAuditResourceTypeLabel(event.metadata_json.governed_resource_type)
      : undefined;
    const governedResourceId = typeof event.metadata_json.governed_resource_id === 'string'
      ? event.metadata_json.governed_resource_id
      : undefined;
    if (governedResourceType && governedResourceId) {
      return `${governedResourceType} ${governedResourceId}`;
    }
    if (governedResourceId) {
      return governedResourceId;
    }
  }
  if (event.resource_id) {
    return event.resource_id;
  }
  return getAuditResourceTypeLabel(event.resource_type) ?? 'System';
}

export function getAuditResourceIdLabel(event: AuditEvent): string | undefined {
  if (
    event.resource_type === 'resource_policy'
    && event.metadata_json
    && typeof event.metadata_json === 'object'
    && typeof event.metadata_json.governed_resource_id === 'string'
  ) {
    return event.metadata_json.governed_resource_id;
  }
  return event.resource_id;
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
