import { describe, expect, it } from 'vitest';
import { evaluateReleasePolicy } from '@/lib/release-policy';

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
});
