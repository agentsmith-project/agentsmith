import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { renderReleaseStatus, type ReleaseSummary } from '../release-summary';
import { CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION } from '../current-release-boundary-schema';

function releaseSummary(overrides: Partial<ReleaseSummary> = {}): ReleaseSummary {
  const campaignRoot = overrides.campaign_root ?? 'artifacts/release-runs/release-ready-test';
  return {
    schema: 'agentsmith_release_summary/v1',
    campaign_id: 'release-full',
    campaign_run_id: 'release-ready-test',
    campaign_root: campaignRoot,
    automated_release_verdict: 'PASSED',
    status: 'passed',
    failure_class: 'none',
    stage: 'aggregate',
    blocked_step: null,
    why: 'Release-full campaign evidence passed aggregate verification.',
    next_action: 'Attach summary.md to the release note and complete the operator sign-off checklist.',
    terminal_result_path: join(campaignRoot, 'gate-release-full', 'result.json'),
    summary_json_path: join(campaignRoot, 'summary.json'),
    summary_md_path: join(campaignRoot, 'summary.md'),
    evidence_package: campaignRoot,
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

function expectCleanDefaultHumanOutput(output: string): void {
  expect(output).not.toContain('Automated release verdict');
  expect(output).not.toMatch(/\bGoal:/);
  expect(output).not.toMatch(/\bPhase:/);
  expect(output).not.toMatch(/\bAuthority:/);
  expect(output).not.toMatch(/\bCampaign:/);
  expect(output).not.toMatch(/\b(?:gate|lane)-[a-z0-9-]+\b/);
  expect(output).not.toMatch(/\bnpm run (?:gate|lane|backend-real|test):[a-z0-9:_-]+/);
}

describe('release human output', () => {
  it('keeps passed release output short while pointing to summary and terminal evidence', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-human-'));
    try {
      const output = renderReleaseStatus({
        kind: 'ready',
        latestPath: 'artifacts/release-runs/latest.json',
        summary: releaseSummary({ campaign_root: campaignRoot, evidence_package: campaignRoot }),
      });

      expect(output).toContain('Status: passed');
      expect(output).toContain(`Summary: ${join(campaignRoot, 'summary.md')}`);
      expect(output).toContain(`Evidence: ${campaignRoot}`);
      expect(output).toContain('Total duration: 1h 2m 0s');
      expect(output).toContain('Slowest steps: Backend real release check 40m 0s; Full visual check 16m 30s');
      expect(output).not.toContain('Transition-only deploy diagnostics');
      expect(output).not.toContain('local-kind');
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
      expect(output).not.toContain('Terminal result:');
      expectCleanDefaultHumanOutput(output);
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('renders release contract references without full digests or absolute paths', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-human-contract-'));
    const digest = `sha256:${'a'.repeat(64)}`;
    const contractPath = join(campaignRoot, 'inputs', 'agentsmith-release-contract.json');
    try {
      const output = renderReleaseStatus({
        kind: 'ready',
        latestPath: 'artifacts/release-runs/latest.json',
        summary: releaseSummary({
          campaign_root: campaignRoot,
          evidence_package: campaignRoot,
          release_contract: {
            schema: CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION,
            path: contractPath,
            digest,
            subject_digest: `sha256:${'b'.repeat(64)}`,
            release_id: 'release-2026.05.23',
            git_sha: '0123456789abcdef0123456789abcdef01234567',
            provenance: {
              producer_repo: 'github.com/agentsmith-project/agentsmith',
              normalized_remote: 'github.com/agentsmith-project/agentsmith',
              commit_sha: '0123456789abcdef0123456789abcdef01234567',
              artifact_uri: 'gh-artifact://agentsmith/release-contract/10001/release-contract.json',
              generated_at: '2026-04-25T12:00:00.000Z',
              generator_version: 'agentsmith-release-contract/1.0.0',
            },
          },
        }),
      });

      expect(output).toContain(`Release contract: release-2026.05.23 ${digest.slice(0, 19)}... (${basename(contractPath)})`);
      expect(output).not.toContain(digest);
      expect(output).not.toContain(contractPath);
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('keeps failed release output focused on blocker plus evidence paths', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-human-failed-'));
    try {
      const output = renderReleaseStatus({
        kind: 'ready',
        latestPath: 'artifacts/release-runs/latest.json',
        summary: releaseSummary({
          campaign_root: campaignRoot,
          evidence_package: campaignRoot,
          automated_release_verdict: 'FAILED',
          status: 'failed',
          failure_class: 'product_regression',
          blocked_step: 'gate-release',
          why: 'Campaign step gate-release did not pass.',
          next_action: 'Inspect campaign evidence for gate-release, fix the owning issue, then rerun npm run release:ready.',
        }),
      });

      expect(output).toContain('Status: failed');
      expect(output).toContain('Blocker: Backend-real check');
      expect(output).toContain('Why: Backend-real check did not pass.');
      expect(output).toContain(`Summary: ${join(campaignRoot, 'summary.md')}`);
      expect(output).toContain('Rerun: npm run release:ready');
      expect(output).not.toContain('Terminal result:');
      expect(output).not.toContain('npm run verify -- --goal=release-real --run');
      expect(output).not.toContain('npm run lane:');
      expectCleanDefaultHumanOutput(output);
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('keeps legacy deploy check snapshots out of default release status output', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-human-snapshot-'));
    try {
      const output = renderReleaseStatus({
        kind: 'ready',
        latestPath: 'artifacts/release-runs/latest.json',
        summary: {
          ...releaseSummary({
            campaign_root: campaignRoot,
            evidence_package: campaignRoot,
          }),
          deploy_check_snapshot: {
            schema: 'agentsmith_release_deploy_check_snapshot/v1',
            generated_at: '2026-04-25T12:00:00.000Z',
            items: [
              {
                id: 'lane-unified-deploy-product-flows',
                label: 'product flows',
                status: 'failed',
                evidence_path: join(campaignRoot, 'unified-deploy', 'product-flows'),
                result_path: join(campaignRoot, 'lane-unified-deploy-product-flows', 'result.json'),
                result_digest: null,
              },
            ],
          },
        } as ReleaseSummary,
      });

      expect(output).not.toContain('Transition-only deploy diagnostics');
      expect(output).not.toContain('- product flows: failed');
      expect(output).not.toContain('- product flows: passed');
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
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
    expectCleanDefaultHumanOutput(output);
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
