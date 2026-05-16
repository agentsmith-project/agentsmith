import { describe, expect, it } from 'vitest';

import { renderReleaseStatus, type ReleaseSummary } from '../release-summary';

function releaseSummary(overrides: Partial<ReleaseSummary> = {}): ReleaseSummary {
  return {
    schema: 'agentsmith_release_summary/v1',
    campaign_id: 'release-full',
    campaign_run_id: 'release-ready-test',
    campaign_root: 'artifacts/release-runs/release-ready-test',
    automated_release_verdict: 'PASSED',
    status: 'passed',
    failure_class: 'none',
    stage: 'aggregate',
    blocked_step: null,
    why: 'Release-full campaign evidence passed aggregate verification.',
    next_action: 'Attach summary.md to the release note and complete the operator sign-off checklist.',
    terminal_result_path: 'artifacts/release-runs/release-ready-test/gate-release-full/result.json',
    summary_json_path: 'artifacts/release-runs/release-ready-test/summary.json',
    summary_md_path: 'artifacts/release-runs/release-ready-test/summary.md',
    evidence_package: 'artifacts/release-runs/release-ready-test',
    manual_operator_signoff: 'not_covered',
    generated_at: '2026-04-25T12:00:00.000Z',
    run_observability: {
      total_duration_ms: 3_720_000,
      top_slow_stages: [
        {
          id: 'gate-release',
          label: 'Backend real release check',
          duration_ms: 2_400_000,
          status: 'passed',
        },
        {
          id: 'lane-visual',
          label: 'Full visual check',
          duration_ms: 990_000,
          status: 'passed',
        },
      ],
      counts_source: 'parent_flow',
      counts: {
        real_service_start_count: 1,
        api_web_start_count: 1,
        backend_real_check_session_count: 1,
        image_import_count: 1,
      },
      poll_retry_coverage: 'not_covered',
      report_size_bytes: 123_456,
    },
    ...overrides,
  };
}

describe('release human output', () => {
  it('keeps passed release output short while pointing to summary and terminal evidence', () => {
    const output = renderReleaseStatus({
      kind: 'ready',
      latestPath: 'artifacts/release-runs/latest.json',
      summary: releaseSummary(),
    });

    expect(output).toContain('Automated release verdict: PASSED');
    expect(output).toContain('Summary: artifacts/release-runs/release-ready-test/summary.md');
    expect(output).toContain('Evidence: artifacts/release-runs/release-ready-test');
    expect(output).toContain('Terminal result: artifacts/release-runs/release-ready-test/gate-release-full/result.json');
    expect(output).toContain('Total duration: 1h 2m 0s');
    expect(output).toContain('Slowest stages: gate-release 40m 0s; lane-visual 16m 30s');
    expect(output).toContain('Real service starts: 1');
    expect(output).toContain('API/Web starts: 1');
    expect(output).toContain('Backend real sessions: 1');
    expect(output).toContain('Image imports: 1');
    expect(output).toContain('Poll/retry coverage: not covered');
    expect(output).not.toContain('Poll/retry attempts: 0');
    expect(output).toContain('Report size: 123456 bytes');
    expect(output).toContain('common setup warnings (NO_COLOR, already-existing Postgres resources, containerd deprecations) are diagnostic');
    expect(output).not.toContain('Blocked step: <none>');
    expect(output).not.toContain('Evidence package:');
  });

  it('keeps failed release output focused on blocker plus evidence paths', () => {
    const output = renderReleaseStatus({
      kind: 'ready',
      latestPath: 'artifacts/release-runs/latest.json',
      summary: releaseSummary({
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'product_regression',
        blocked_step: 'gate-release',
        why: 'Campaign step gate-release did not pass.',
        next_action: 'Inspect campaign evidence for gate-release, fix the owning issue, then rerun npm run release:ready.',
      }),
    });

    expect(output).toContain('Blocker: gate-release');
    expect(output).toContain('Why: Campaign step gate-release did not pass.');
    expect(output).toContain('Summary: artifacts/release-runs/release-ready-test/summary.md');
    expect(output).toContain('Terminal result: artifacts/release-runs/release-ready-test/gate-release-full/result.json');
    expect(output).toContain('Rerun: npm run release:ready');
    expect(output).not.toContain('npm run verify -- --goal=release-real --run');
    expect(output).not.toContain('npm run lane:');
  });

  it('keeps release failure next actions on public entrypoints instead of owner diagnostics', () => {
    const output = renderReleaseStatus({
      kind: 'ready',
      latestPath: 'artifacts/release-runs/latest.json',
      summary: releaseSummary({
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'product_regression',
        blocked_step: 'gate-release',
        why: 'Campaign step gate-release did not pass.',
        next_action: 'Fix the blocking issue, then rerun npm run release:ready.',
      }),
    });

    expect(output).toContain('Next: Fix the blocking issue, then rerun npm run release:ready.');
    expect(output).toContain('Rerun: npm run release:ready');
    expect(output).not.toMatch(/\bnpm run verify -- --goal=release-real --run\b/);
    expect(output).not.toMatch(/\bnpm run (?:gate|lane|backend-real):[a-z0-9:_-]+/);
  });

  it('keeps sensitive fields out of release status output', () => {
    const output = renderReleaseStatus({
      kind: 'ready',
      latestPath: 'artifacts/release-runs/latest.json',
      summary: releaseSummary({
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'product_regression',
        blocked_step: 'gate-release',
        why: [
          'Campaign step gate-release did not pass.',
          'Authorization: Bearer release-human-raw-token',
          'OPENAI_API_KEY=sk-release-human-raw-value',
          'ticket=release-human-raw-ticket',
          'managed_credentials.feishu=release-human-raw-managed-credential',
        ].join(' '),
      }),
    });

    expect(output).toContain('[redacted]');
    expect(output).not.toContain('release-human-raw-token');
    expect(output).not.toContain('sk-release-human-raw-value');
    expect(output).not.toContain('release-human-raw-ticket');
    expect(output).not.toContain('release-human-raw-managed-credential');
  });
});
