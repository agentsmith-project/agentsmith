import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { renderReleaseStatus, type ReleaseSummary } from '../release-summary';
import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';

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
    deploy_check_snapshot: {
      schema: 'agentsmith_release_deploy_check_snapshot/v1',
      generated_at: '2026-04-25T12:00:00.000Z',
      items: [
        {
          id: 'lane-unified-deploy-substrate',
          label: 'dependencies',
          status: 'passed',
          evidence_path: join(campaignRoot, 'unified-deploy', 'substrate'),
          result_path: join(campaignRoot, 'lane-unified-deploy-substrate', 'result.json'),
          result_digest: null,
        },
        {
          id: 'lane-unified-deploy-local-kind-images',
          label: 'images',
          status: 'passed',
          evidence_path: join(campaignRoot, 'unified-deploy', 'local-kind-images'),
          result_path: join(campaignRoot, 'lane-unified-deploy-local-kind-images', 'result.json'),
          result_digest: null,
        },
        {
          id: 'lane-unified-deploy-local-kind',
          label: 'rollout',
          status: 'passed',
          evidence_path: join(campaignRoot, 'unified-deploy', 'local-kind'),
          result_path: join(campaignRoot, 'lane-unified-deploy-local-kind', 'result.json'),
          result_digest: null,
        },
        {
          id: 'lane-unified-deploy-product-flows',
          label: 'product flows',
          status: 'passed',
          evidence_path: join(campaignRoot, 'unified-deploy', 'product-flows'),
          result_path: join(campaignRoot, 'lane-unified-deploy-product-flows', 'result.json'),
          result_digest: null,
        },
      ],
    },
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

function writeDeployResult(campaignRoot: string, stepId: string, status: 'passed' | 'failed'): void {
  const resultPath = join(campaignRoot, stepId, 'result.json');
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify({
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: stepId,
    gate_adapter: {
      npm_script: stepId.replace(/^lane-/, 'lane:').replaceAll('-', ':'),
      ci_job: null,
    },
    status,
    failure_class: status === 'passed' ? 'none' : 'product_regression',
    stage: 'verify',
    line_kind: 'release_campaign_step',
    evidence_dir: join(campaignRoot, stepId),
    summary: `${stepId} ${status}.`,
    generated_at: '2026-04-25T12:00:00.000Z',
  }, null, 2)}\n`);
}

function writeDeployResults(campaignRoot: string): void {
  writeDeployResult(campaignRoot, 'lane-unified-deploy-substrate', 'passed');
  writeDeployResult(campaignRoot, 'lane-unified-deploy-local-kind-images', 'passed');
  writeDeployResult(campaignRoot, 'lane-unified-deploy-local-kind', 'passed');
  writeDeployResult(campaignRoot, 'lane-unified-deploy-product-flows', 'passed');
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
      expect(output).toContain('Deploy check / 部署检查:');
      expect(output).toContain('- dependencies: passed');
      expect(output).toContain('- images: passed');
      expect(output).toContain('- rollout: passed');
      expect(output).toContain('- product flows: passed');
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

  it('renders deploy check from the frozen summary snapshot instead of live step files', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-human-snapshot-'));
    try {
      writeDeployResult(campaignRoot, 'lane-unified-deploy-product-flows', 'passed');
      const output = renderReleaseStatus({
        kind: 'ready',
        latestPath: 'artifacts/release-runs/latest.json',
        summary: releaseSummary({
          campaign_root: campaignRoot,
          evidence_package: campaignRoot,
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
        }),
      });

      expect(output).toContain('Deploy check / 部署检查:');
      expect(output).toContain('- product flows: failed');
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
