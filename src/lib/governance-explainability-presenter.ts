const GOVERNANCE_SOURCE_LABELS: Record<string, string> = {
  permission: 'Permission Grant',
  project_default: 'Project Default',
  resource_policy: 'Resource Policy',
};

const GOVERNANCE_REASON_LABELS: Record<string, string> = {
  permission_not_granted: 'Required permission is missing',
  resource_default_allow_all: 'Current resource allows all project members',
  subject_allow_listed: 'Subject is explicitly allowed by policy',
  subject_not_allow_listed: 'Subject is not on the current allow list',
  membership_suspended: 'Member access is suspended',
  membership_pending: 'Membership is still pending approval',
  missing_membership: 'No active project membership',
};

function humanizeToken(token: string): string {
  return token
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getGovernanceSourceLabel(source?: string): string | undefined {
  if (!source) return undefined;
  return GOVERNANCE_SOURCE_LABELS[source.trim()] ?? humanizeToken(source);
}

export function getGovernanceReasonLabel(reason?: string): string | undefined {
  if (!reason) return undefined;
  return GOVERNANCE_REASON_LABELS[reason.trim()] ?? humanizeToken(reason);
}
