/**
 * Release Ops - Organization Evidence in Live Policy
 *
 * Tests for organization-level governance evidence in live policy evaluation.
 * Part of P2: 修复 Release Ops live policy 接入组织级证据.
 */

import { describe, expect, it } from 'vitest';
import { evaluateReleasePolicy } from '../release-policy';

describe('Release Ops Live Policy - Organization Evidence', () => {
  describe('live policy must include organization evidence', () => {
    it('should evaluate live policy with organization evidence', () => {
      // Simulate live policy construction with organization evidence
      const result = evaluateReleasePolicy({
        runtime: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
        },
        usage: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
          required_schedules: 1,
          unacknowledged_required_deliveries: 0,
          runner_health: {
            enabled: true,
            last_status: 'success',
            run_count: 1,
          },
        },
        governance: {
          open_escalations: 0,
          critical_unassigned: 0,
          critical_overdue: 0,
          due_soon: 0,
        },
        organization: {
          release_readiness: 'ready', // Don't set to 'blocked' to avoid auto-generated blocker
          blockers: [
            {
              id: 'org_compliance_violation',
              message: 'Organization compliance check failed',
              severity: 'blocker',
              source: 'organization_governance',
              overridable: false,
            },
          ],
          warnings: [],
        },
      });

      expect(result.decision).toBe('blocked');
      expect(result.blockers).toHaveLength(1);
      expect(result.blockers[0].source).toBe('organization_governance');
      expect(result.blockers[0].id).toBe('org_compliance_violation');
    });

    it('should show warning when organization has warnings only', () => {
      const result = evaluateReleasePolicy({
        runtime: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
        },
        usage: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
          required_schedules: 1,
          unacknowledged_required_deliveries: 0,
          runner_health: {
            enabled: true,
            last_status: 'success',
            run_count: 1,
          },
        },
        governance: {
          open_escalations: 0,
          critical_unassigned: 0,
          critical_overdue: 0,
          due_soon: 0,
        },
        organization: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [
            {
              id: 'org_review_reminder',
              message: 'Organization-level review recommended',
              severity: 'warning',
              source: 'organization_governance',
              overridable: false,
            },
          ],
        },
      });

      expect(result.decision).toBe('warning');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].source).toBe('organization_governance');
    });

    it('should be ready when no organization issues', () => {
      const result = evaluateReleasePolicy({
        runtime: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
        },
        usage: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
          required_schedules: 1,
          unacknowledged_required_deliveries: 0,
          runner_health: {
            enabled: true,
            last_status: 'success',
            run_count: 1,
          },
        },
        governance: {
          open_escalations: 0,
          critical_unassigned: 0,
          critical_overdue: 0,
          due_soon: 0,
        },
        organization: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
        },
      });

      expect(result.decision).toBe('ready');
      expect(result.blockers).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('organization evidence integration', () => {
    it('should merge organization blockers with other sources', () => {
      const result = evaluateReleasePolicy({
        runtime: {
          release_readiness: 'blocked', // Must be 'blocked' to add blockers
          blockers: ['runtime_terminal_errors'],
          warnings: [],
        },
        usage: {
          release_readiness: 'ready',
          blockers: [],
          warnings: [],
          required_schedules: 1,
          unacknowledged_required_deliveries: 0,
          runner_health: {
            enabled: true,
            last_status: 'success',
            run_count: 1,
          },
        },
        governance: {
          open_escalations: 0,
          critical_unassigned: 0,
          critical_overdue: 0,
          due_soon: 0,
        },
        organization: {
          release_readiness: 'ready',
          blockers: [
            {
              id: 'org_compliance_fail',
              message: 'Organization compliance failure',
              severity: 'blocker',
              source: 'organization_governance',
              overridable: false,
            },
          ],
          warnings: [],
        },
      });

      expect(result.decision).toBe('blocked');
      // When runtime.release_readiness === 'blocked', it adds:
      // 1. 'runtime_runtime_terminal_errors' (prefix 'runtime_' added)
      // Plus the organization blocker = 2 total
      expect(result.blockers).toHaveLength(2);

      const sources = result.blockers.map((b) => b.source);
      expect(sources).toContain('runtime');
      expect(sources).toContain('organization_governance');
    });
  });
});
