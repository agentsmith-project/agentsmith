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
        next_action: 'Fix the product regression, run npm run verify -- --goal=release-real --run, then rerun npm run release:ready.',
      }),
    });

    expect(output).toContain('Blocker: gate-release');
    expect(output).toContain('Why: Campaign step gate-release did not pass.');
    expect(output).toContain('Summary: artifacts/release-runs/release-ready-test/summary.md');
    expect(output).toContain('Terminal result: artifacts/release-runs/release-ready-test/gate-release-full/result.json');
    expect(output).toContain('Rerun: npm run release:ready');
    expect(output).not.toContain('npm run lane:');
  });
});
