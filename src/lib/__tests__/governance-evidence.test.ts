import { describe, expect, it } from 'vitest';
import { classifyGovernanceEvidenceFocus, getGovernanceEvidenceCount } from '@/lib/governance-evidence';

describe('governance-evidence', () => {
  it('classifies focus from reason keywords', () => {
    expect(classifyGovernanceEvidenceFocus('missing_source_library_quota')).toBe('limit');
    expect(classifyGovernanceEvidenceFocus('token_usage_budget_alert')).toBe('cost');
    expect(classifyGovernanceEvidenceFocus('permission_denied')).toBe('deny');
    expect(classifyGovernanceEvidenceFocus('public_visibility')).toBe('exposure');
    expect(classifyGovernanceEvidenceFocus('member_scope_review')).toBe('membership');
    expect(classifyGovernanceEvidenceFocus('')).toBe('other');
  });

  it('prefers related signals and falls back to blocked+warning', () => {
    expect(
      getGovernanceEvidenceCount({
        gov_from: 'organization_overview',
        gov_kind: 'project',
        gov_workspace_id: 'ws_1',
        gov_related_signals: 7,
        gov_blocked_signals: 2,
        gov_warning_signals: 3,
      }),
    ).toBe(7);

    expect(
      getGovernanceEvidenceCount({
        gov_from: 'organization_overview',
        gov_kind: 'project',
        gov_workspace_id: 'ws_1',
        gov_blocked_signals: 2,
        gov_warning_signals: 3,
      }),
    ).toBe(5);
  });
});
