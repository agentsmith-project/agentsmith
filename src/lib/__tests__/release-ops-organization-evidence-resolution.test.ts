import { describe, expect, it } from 'vitest';
import { resolveOrganizationEvidence } from '@/lib/release-ops-organization-evidence';

describe('resolveOrganizationEvidence', () => {
  it('uses summary organization evidence as primary source', () => {
    const result = resolveOrganizationEvidence({
      organization_governance_evidence: {
        release_readiness: 'blocked',
        blockers: ['org_blocker_1'],
        warnings: ['org_warning_1'],
      },
      release_policy: {
        blockers: [{ id: 'policy_blocker', source: 'organization_governance' }],
      },
    });

    expect(result.availability).toBe('loaded');
    expect(result.source).toBe('summary');
    expect(result.blockerCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.policyInput?.blockers?.[0]?.id).toBe('org_blocker_1');
  });

  it('falls back to release_policy organization issues when summary evidence is missing', () => {
    const result = resolveOrganizationEvidence({
      release_policy: {
        blockers: [{ id: 'org_policy_blocker', source: 'organization_governance' }],
        warnings: [{ id: 'org_policy_warning', source: 'organization_governance' }],
      },
    });

    expect(result.availability).toBe('loaded');
    expect(result.source).toBe('release_policy');
    expect(result.blockerCount).toBe(1);
    expect(result.warningCount).toBe(1);
    expect(result.policyInput?.release_readiness).toBe('blocked');
    expect(result.policyInput?.blockers?.[0]?.overridable).toBe(false);
  });

  it('ignores non-organization release policy issues in fallback mode', () => {
    const result = resolveOrganizationEvidence({
      release_policy: {
        blockers: [{ id: 'runtime_blocker', source: 'runtime' }],
        warnings: [{ id: 'usage_warning', source: 'usage' }],
      },
    });

    expect(result.availability).toBe('missing');
    expect(result.source).toBe('none');
    expect(result.policyInput).toBeUndefined();
  });

  it('returns missing when no summary is available', () => {
    const result = resolveOrganizationEvidence(undefined);
    expect(result.availability).toBe('missing');
    expect(result.source).toBe('none');
    expect(result.policyInput).toBeUndefined();
  });
});
