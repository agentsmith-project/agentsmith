/**
 * Governance evaluation - organization-level evidence tests.
 *
 * Tests for organization-level governance evidence in review acceptance.
 * Part of WP-02: 组织级证据进入治理评估链.
 */

import { describe, expect, it } from 'vitest';
import {
  evaluateGovernance,
  enforceGovernance,
  type OrganizationEvidenceInput,
  type EvaluateGovernanceInput,
} from './governance-evaluation.js';

describe('Governance evaluation - organization-level evidence', () => {
  describe('organization review status blocked', () => {
    it('should block review acceptance when organization review status is blocked', () => {
      const input: OrganizationEvidenceInput = {
        review_status: 'blocked',
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({
        id: 'organization_review_status_blocked',
        severity: 'blocker',
        source: 'organization_governance',
        overridable: false,
      });
    });
  });

  describe('organization blockers', () => {
    it('should add organization blockers as non-overridable hard fails', () => {
      const input: OrganizationEvidenceInput = {
        blockers: [
          {
            id: 'org_compliance_violation',
            message: 'Organization has unresolved compliance violations',
            severity: 'blocker',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({
        id: 'org_compliance_violation',
        severity: 'blocker',
        source: 'organization_governance',
        overridable: false,
      });
    });

    it('should add multiple organization blockers', () => {
      const input: OrganizationEvidenceInput = {
        blockers: [
          {
            id: 'org_security_hard_fail',
            message: 'Organization has security hard fails',
            severity: 'blocker',
            source: 'organization_governance',
            overridable: false,
          },
          {
            id: 'org_compliance_blocker',
            message: 'Organization compliance check failed',
            severity: 'blocker',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(2);
      expect(result.summary.blocker_count).toBe(2);
    });
  });

  describe('organization warnings', () => {
    it('should add organization warnings', () => {
      const input: OrganizationEvidenceInput = {
        warnings: [
          {
            id: 'org_review_reminder',
            message: 'Organization-level review recommended',
            severity: 'warning',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('warning');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatchObject({
        id: 'org_review_reminder',
        severity: 'warning',
        source: 'organization_governance',
        overridable: false,
      });
    });

    it('should have warning decision when only warnings present', () => {
      const input: OrganizationEvidenceInput = {
        warnings: [
          {
            id: 'org_review_reminder',
            message: 'Organization-level review recommended',
            severity: 'warning',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('warning');
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('organization critical escalations', () => {
    it('should block when organization has critical escalations', () => {
      const input: OrganizationEvidenceInput = {
        critical_escalations: 2,
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({
        id: 'organization_critical_escalations_present',
        severity: 'blocker',
        source: 'organization_governance',
        overridable: false,
      });
    });

    it('should block when organization has unassigned critical escalations', () => {
      const input: OrganizationEvidenceInput = {
        critical_unassigned: 1,
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({
        id: 'organization_critical_escalations_unassigned',
        severity: 'blocker',
        source: 'organization_governance',
        overridable: false,
      });
    });
  });

  describe('organization compliance hard fails', () => {
    it('should block when organization has compliance hard fails', () => {
      const input: OrganizationEvidenceInput = {
        compliance_hard_fails: 1,
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0]).toMatchObject({
        id: 'organization_compliance_hard_fails_present',
        severity: 'blocker',
        source: 'organization_governance',
        overridable: false,
      });
    });
  });

  describe('hard fail - non-overridable blockers', () => {
    it('should not allow overriding organization-level blockers', () => {
      const input: OrganizationEvidenceInput = {
        blockers: [
          {
            id: 'org_hard_fail',
            message: 'Organization hard fail',
            severity: 'blocker',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      };

      const evaluation = evaluateGovernance({ organization: input });

      // Attempt to override the organization blocker - should still be blocked
      const enforcement = enforceGovernance(evaluation, [
        { issue_id: 'org_hard_fail', status: 'approved' },
      ]);

      expect(enforcement.decision).toBe('blocked');
      expect(enforcement.unresolved_blockers).toHaveLength(1);
      expect(enforcement.overridden_blockers).toHaveLength(0);
    });
  });

  describe('combined with other sources', () => {
    it('should merge organization blockers with project-level blockers', () => {
      const input: EvaluateGovernanceInput = {
        configuration: {
          review_status: 'blocked',
          blockers: ['configuration_blocker_1'],
        },
        organization: {
          blockers: [
            {
              id: 'org_blocker_1',
              message: 'Organization blocker',
              severity: 'blocker',
              source: 'organization_governance',
              overridable: false,
            },
          ],
        },
      };

      const result = evaluateGovernance(input);

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(2);
      expect(result.blockers.some(b => b.source === 'organization_governance')).toBe(true);
      expect(result.blockers.some(b => b.source === 'configuration')).toBe(true);
    });

    it('should show warning when only organization warnings exist', () => {
      const input: OrganizationEvidenceInput = {
        warnings: [
          {
            id: 'org_warning',
            message: 'Organization warning',
            severity: 'warning',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('warning');
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
    });

    it('should prioritize organization blockers over warnings', () => {
      const input: OrganizationEvidenceInput = {
        blockers: [
          {
            id: 'org_blocker',
            message: 'Organization blocker',
            severity: 'blocker',
            source: 'organization_governance',
            overridable: false,
          },
        ],
        warnings: [
          {
            id: 'org_warning',
            message: 'Organization warning',
            severity: 'warning',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      };

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(1);
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe('empty organization input', () => {
    it('should return ready decision when no organization issues', () => {
      const input: OrganizationEvidenceInput = {};

      const result = evaluateGovernance({ organization: input });

      expect(result.decision).toBe('ready');
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should return ready decision when organization input is undefined', () => {
      const result = evaluateGovernance({});

      expect(result.decision).toBe('ready');
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});

describe('Governance enforcement - organization hard fail', () => {
  it('should block review acceptance regardless of override attempts for organization blockers', () => {
    const input: EvaluateGovernanceInput = {
      organization: {
        blockers: [
          {
            id: 'org_compliance',
            message: 'Organization compliance violation',
            severity: 'blocker',
            source: 'organization_governance',
            overridable: false,
          },
        ],
      },
    };

    const evaluation = evaluateGovernance(input);

    // Try multiple override attempts - all should fail
    const enforcement = enforceGovernance(evaluation, [
      { issue_id: 'org_compliance', status: 'approved' },
      { issue_id: 'org_compliance', status: 'approved' },
    ]);

    expect(enforcement.decision).toBe('blocked');
    expect(enforcement.unresolved_blockers).toHaveLength(1);
    expect(enforcement.overridden_blockers).toHaveLength(0);
    expect(enforcement.pending_override_issues).toHaveLength(0);
  });

  it('should show blocker source as organization_governance in unresolved blockers', () => {
    const input: EvaluateGovernanceInput = {
      organization: {
        compliance_hard_fails: 1,
      },
    };

    const evaluation = evaluateGovernance(input);
    const enforcement = enforceGovernance(evaluation, []);

    expect(enforcement.decision).toBe('blocked');
    expect(enforcement.unresolved_blockers[0]).toMatchObject({
      source: 'organization_governance',
    });
  });
});
