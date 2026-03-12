import { describe, expect, it } from 'vitest';
import { enforceGovernance, evaluateGovernance, mergeGovernanceEvaluations } from './governance-evaluation.js';

describe('evaluateGovernance', () => {
  it('returns ready when no issues are present', () => {
    const result = evaluateGovernance({
      configuration: {
        review_status: 'ready',
        blockers: [],
        warnings: [],
        missing_usage_facts: 0,
        missing_price_facts: 0,
      },
    });

    expect(result.decision).toBe('ready');
    expect(result.summary.total_issues).toBe(0);
  });

  it('returns warning for transient-only execution failures', () => {
    const result = evaluateGovernance({
      execution: {
        failed_count: 1,
        transient_acceptance: 'acceptable_with_retry',
      },
    });

    expect(result.decision).toBe('warning');
    expect(result.warnings[0]?.id).toBe('execution_transient_failures_present');
  });

  it('returns blocked for configuration blockers', () => {
    const result = evaluateGovernance({
      configuration: {
        review_status: 'blocked',
        blockers: ['configuration_check_primary_pricing_missing'],
        warnings: ['configuration_check_reroute_pricing_missing'],
        missing_usage_facts: 1,
        missing_price_facts: 1,
        target: {
          status: 'draft',
          approvals_complete: false,
        },
      },
    });

    expect(result.decision).toBe('blocked');
    expect(result.summary.blocker_count).toBeGreaterThan(0);
    expect(result.summary.warning_count).toBeGreaterThan(0);
  });

  it('adds governance blockers and warnings for escalation ownership and sla gaps', () => {
    const result = evaluateGovernance({
      governance: {
        open_escalations: 2,
        critical_unassigned: 1,
        critical_overdue: 1,
        due_soon: 1,
      },
    });

    expect(result.decision).toBe('blocked');
    expect(result.blockers.map((item) => item.id)).toContain('governance_critical_escalations_unassigned');
    expect(result.blockers.map((item) => item.id)).toContain('governance_critical_escalations_overdue');
    expect(result.warnings.map((item) => item.id)).toContain('governance_escalations_due_soon');
    expect(result.warnings.map((item) => item.id)).toContain('governance_open_escalations_present');
  });

  it('adds build blockers when build reliability readiness is blocked', () => {
    const result = evaluateGovernance({
      build: {
        review_status: 'blocked',
        blockers: ['build_chat_recovery_integration_missing'],
        warnings: ['build_cross_surface_diagnostics_degraded'],
      },
    });

    expect(result.decision).toBe('blocked');
    expect(result.blockers.map((item) => item.id)).toContain('build_build_chat_recovery_integration_missing');
    expect(result.warnings.map((item) => item.id)).toContain('build_build_cross_surface_diagnostics_degraded');
  });

  it('merges governance evaluation into an existing governance policy', () => {
    const base = evaluateGovernance({
      configuration: {
        review_status: 'ready',
        blockers: [],
        warnings: [],
        missing_usage_facts: 0,
        missing_price_facts: 0,
      },
    });
    const governance = evaluateGovernance({
      governance: {
        open_escalations: 1,
      },
    });

    const merged = mergeGovernanceEvaluations(base, governance);

    expect(merged.decision).toBe('warning');
    expect(merged.warnings.map((item) => item.id)).toContain('governance_open_escalations_present');
  });

  it('marks the governance decision as pending_override when remaining blockers are waiting for approval', () => {
    const evaluation = evaluateGovernance({
      execution: {
        failed_count: 1,
        transient_acceptance: 'mixed_or_blocking',
      },
    });

    const enforced = enforceGovernance(evaluation, [
      {
        issue_id: 'execution_failures_present',
        status: 'pending',
      },
    ]);

    expect(evaluation.blockers[0]?.overridable).toBe(true);
    expect(enforced.decision).toBe('pending_override');
    expect(enforced.pending_override_count).toBe(1);
  });

  it('marks the governance decision as releasable_with_override when all blockers are approved exceptions', () => {
    const evaluation = evaluateGovernance({
      execution: {
        failed_count: 1,
        transient_acceptance: 'mixed_or_blocking',
      },
    });

    const enforced = enforceGovernance(evaluation, [
      {
        issue_id: 'execution_failures_present',
        status: 'approved',
      },
    ]);

    expect(enforced.decision).toBe('releasable_with_override');
    expect(enforced.approved_override_count).toBe(1);
    expect(enforced.unresolved_blockers).toHaveLength(0);
  });
});
