import type { GovernanceDrilldownContext } from '@/lib/governance-drilldown-context';

export type GovernanceEvidenceFocus = 'quota' | 'deny' | 'cost' | 'exposure' | 'membership' | 'other';

export function classifyGovernanceEvidenceFocus(reason: string | undefined): GovernanceEvidenceFocus {
  if (!reason) {
    return 'other';
  }
  const normalized = reason.trim().toLowerCase();
  if (normalized.length === 0) {
    return 'other';
  }

  const matches = (patterns: string[]) => patterns.some((pattern) => normalized.includes(pattern));

  if (matches(['quota', 'limit', 'rate_limit', 'max_total_files', 'max_file_size', 'missing_source_library_quota'])) {
    return 'quota';
  }
  if (matches(['cost', 'billing', 'usage', 'budget', 'token'])) {
    return 'cost';
  }
  if (matches(['deny', 'denied', 'blocked', 'forbidden', 'removed_member_with_project_scope', 'permission'])) {
    return 'deny';
  }
  if (matches(['public', 'open_access', 'visibility', 'exposed'])) {
    return 'exposure';
  }
  if (matches(['member', 'scope', 'role', 'governance'])) {
    return 'membership';
  }
  return 'other';
}

export function getGovernanceEvidenceCount(context: GovernanceDrilldownContext): number | undefined {
  if (typeof context.gov_related_signals === 'number') {
    return context.gov_related_signals;
  }
  const blocked = context.gov_blocked_signals ?? 0;
  const warning = context.gov_warning_signals ?? 0;
  const fallback = blocked + warning;
  return fallback > 0 ? fallback : undefined;
}
