import { describe, expect, it } from 'vitest';
import { buildReleaseOpsGovernanceEvidenceSnapshot } from '@/lib/release-ops-governance-evidence';

describe('release-ops-governance-evidence', () => {
  it('builds focus-aware evidence snapshot from live release ops data', () => {
    const snapshot = buildReleaseOpsGovernanceEvidenceSnapshot({
      context: {
        gov_from: 'organization_overview',
        gov_kind: 'project',
        gov_workspace_id: 'ws_1',
        gov_project_id: 'proj_1',
        gov_reason: 'missing_source_library_quota',
        gov_related_signals: 4,
        gov_blocked_signals: 1,
        gov_warning_signals: 3,
      },
      runtime: {
        total_requests: 120,
        total_errors: 12,
        error_rate: 0.1,
        fallback_hops_histogram: {},
        error_class_counts: { provider_retryable: 4, provider_non_retryable: 4, system_error: 4 },
        avg_estimated_cost: 0.2,
        p95_estimated_cost: 0.6,
        health_summary: {
          recovered_requests: 7,
          terminal_error_requests: 5,
          missing_price_facts: 3,
          provider_count: 2,
          model_count: 4,
        },
        request_trend: [],
        latency_distribution_ms: {},
        cost_distribution_usd: {},
        degradation_signals: [],
        provider_breakdown: [],
        model_breakdown: [],
        time_range: { start: '2026-03-01T00:00:00.000Z', end: '2026-03-02T00:00:00.000Z' },
      },
      usageEvidence: {
        source: 'artifact',
        generated_at: '2026-03-02T00:00:00.000Z',
        release_readiness: 'blocked',
        blockers: ['delivery_failed'],
        warnings: ['schedule_missing'],
        active_schedules: 3,
        required_schedules: 2,
        successful_deliveries_last_7d: 12,
        failed_deliveries_last_7d: 2,
        unacknowledged_required_deliveries: 1,
      },
      runs: [
        {
          id: 'run_1',
          incident_id: 'inc_1',
          report_name: 'daily',
          artifact_name: 'daily',
          started_at: '2026-03-02T00:00:00.000Z',
          completed_at: '2026-03-02T00:01:00.000Z',
          duration_ms: 60000,
          trigger: 'manual',
          status: 'fail',
          total_checks: 10,
          passed_checks: 7,
          failed_checks: 3,
          failed_step_name: 'quota_guardrail',
          failed_step_category: 'quota',
        },
        {
          id: 'run_2',
          incident_id: 'inc_1',
          report_name: 'daily',
          artifact_name: 'daily',
          started_at: '2026-03-01T00:00:00.000Z',
          completed_at: '2026-03-01T00:01:00.000Z',
          duration_ms: 60000,
          trigger: 'manual',
          status: 'pass',
          total_checks: 10,
          passed_checks: 10,
          failed_checks: 0,
        },
      ],
      escalations: [
        {
          id: 'esc_1',
          incident_id: 'inc_1',
          report_name: 'daily',
          run_id: 'run_1',
          created_at: '2026-03-02T00:02:00.000Z',
          event_type: 'gate_blocked',
          severity: 'critical',
          status: 'open',
          title: 'Quota failed',
        },
      ],
    });

    expect(snapshot.focus).toBe('quota');
    expect(snapshot.totalSignals).toBe(4);
    expect(snapshot.metrics.find((item) => item.key === 'runtime_terminal_errors')?.value).toBe(5);
    expect(snapshot.metrics.find((item) => item.key === 'usage_failed_deliveries_7d')?.value).toBe(2);
    expect(snapshot.metrics.find((item) => item.key === 'release_fail_runs')?.value).toBe(1);
    expect(snapshot.metrics.find((item) => item.key === 'release_fail_runs_focus_filtered')?.value).toBe(1);
    expect(snapshot.metrics.find((item) => item.key === 'critical_escalations')?.value).toBe(1);
  });

  it('falls back safely with empty live data', () => {
    const snapshot = buildReleaseOpsGovernanceEvidenceSnapshot({
      context: {
        gov_from: 'workspace_settings',
        gov_kind: 'workspace',
        gov_workspace_id: 'ws_1',
      },
    });

    expect(snapshot.focus).toBe('other');
    expect(snapshot.metrics.every((item) => item.value === 0)).toBe(true);
  });
});
