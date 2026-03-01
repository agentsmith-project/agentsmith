import { describe, expect, it } from 'vitest';
import { enforceReleasePolicy, evaluateReleasePolicy, mergeReleasePolicyEvaluations } from '@/lib/release-policy';

describe('evaluateReleasePolicy', () => {
  it('returns ready when no issues are present', () => {
    const result = evaluateReleasePolicy({
      runtime: {
        release_readiness: 'ready',
        blockers: [],
        warnings: [],
        missing_usage_facts: 0,
        missing_price_facts: 0,
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
          run_count: 2,
        },
      },
    });

    expect(result.decision).toBe('ready');
    expect(result.summary.total_issues).toBe(0);
  });

  it('returns warning for transient-only execution failures', () => {
    const result = evaluateReleasePolicy({
      execution: {
        failed_count: 1,
        transient_acceptance: 'acceptable_with_retry',
      },
    });

    expect(result.decision).toBe('warning');
    expect(result.warnings[0]?.id).toBe('execution_transient_failures_present');
  });

  it('returns blocked for runtime and usage blockers', () => {
    const result = evaluateReleasePolicy({
      runtime: {
        release_readiness: 'blocked',
        blockers: ['runtime_guardrail_primary_pricing_missing'],
        warnings: ['runtime_guardrail_fallback_pricing_missing'],
        missing_usage_facts: 1,
        missing_price_facts: 1,
        release_candidate: {
          release_status: 'draft',
          approvals_complete: false,
        },
      },
      usage: {
        release_readiness: 'blocked',
        blockers: ['usage_report_runner_not_yet_executed'],
        warnings: ['usage_report_webhook_signature_recommended'],
        required_schedules: 0,
        unacknowledged_required_deliveries: 1,
        runner_health: {
          enabled: false,
          last_status: 'failed',
          run_count: 0,
        },
      },
    });

    expect(result.decision).toBe('blocked');
    expect(result.summary.blocker_count).toBeGreaterThan(0);
    expect(result.summary.warning_count).toBeGreaterThan(0);
  });

  it('adds governance blockers and warnings for escalation ownership and sla gaps', () => {
    const result = evaluateReleasePolicy({
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

  it('merges governance evaluation into an existing release policy', () => {
    const base = evaluateReleasePolicy({
      runtime: {
        release_readiness: 'ready',
        blockers: [],
        warnings: [],
        missing_usage_facts: 0,
        missing_price_facts: 0,
      },
    });
    const governance = evaluateReleasePolicy({
      governance: {
        open_escalations: 1,
      },
    });

    const merged = mergeReleasePolicyEvaluations(base, governance);

    expect(merged.decision).toBe('warning');
    expect(merged.warnings.map((item) => item.id)).toContain('governance_open_escalations_present');
  });

  it('marks a gate as pending_override when remaining blockers are waiting for approval', () => {
    const evaluation = evaluateReleasePolicy({
      execution: {
        failed_count: 1,
        transient_acceptance: 'mixed_or_blocking',
      },
    });

    const enforced = enforceReleasePolicy(evaluation, [
      {
        issue_id: 'execution_failures_present',
        status: 'pending',
      },
    ]);

    expect(evaluation.blockers[0]?.overridable).toBe(true);
    expect(enforced.decision).toBe('pending_override');
    expect(enforced.pending_override_count).toBe(1);
  });

  it('marks a gate as releasable_with_override when all blockers are approved exceptions', () => {
    const evaluation = evaluateReleasePolicy({
      execution: {
        failed_count: 1,
        transient_acceptance: 'mixed_or_blocking',
      },
    });

    const enforced = enforceReleasePolicy(evaluation, [
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
