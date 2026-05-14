import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  readReleaseStatus,
  renderReleaseStatus,
  writeReleaseSummaryForCampaign,
} from '../release-summary';
import {
  createReleaseCleanupFinalizer,
} from '../release-cleanup-finalizer';
import { runReleaseReady } from '../release-ready';
import {
  READINESS_STATE_ENV,
  validateRunReadinessStateForConsumer,
} from '../run-readiness-state';
import type { ResourceOwnerPreflightResult } from '../resource-owner-preflight';

function readPackageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
}

const RELEASE_HUMAN_DOC_FORBIDDEN_COPYABLE_PATTERNS = [
  /\bnpm run gate:[a-z0-9:_-]+/,
  /\bnpm run lane:[a-z0-9:_-]+/,
  /\bnpm run backend-real:[a-z0-9:_-]+/,
  /\bnpm run release:campaign:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/,
] as const;

const VALID_TEST_GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const VALID_RELEASE_READY_GIT_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const SENTINEL_PASS_ENV = {
  NEXT_PUBLIC_API_BASE: 'http://localhost:20000/api/v1',
  INTERNAL_EXECUTION_WS_BASE_URL: 'ws://localhost:20000/api/v1/execution/ws',
  PROXY_DATA_TOKEN: 'test-proxy-token',
  RUNNER_TICKET: 'test-runner-ticket',
  KEYCLOAK_REDIRECT_BASE_URL: 'http://localhost:3000',
  DNS_GATEWAY_REACHABLE: 'true',
  PROVIDER_PROFILE: 'test-provider-profile',
  SECRET_PROFILE: 'test-secret-profile',
} as const;

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeTerminalResult(campaignRoot: string, overrides: Partial<{
  status: string;
  failure_class: string;
  stage: string;
  summary: string;
}> = {}): void {
  writeJson(join(campaignRoot, 'gate-release-full', 'result.json'), {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: 'gate-release-full',
    gate_adapter: {
      npm_script: 'gate:release:full',
      ci_job: null,
    },
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: overrides.stage ?? 'aggregate',
    line_kind: 'release_full_verdict',
    evidence_dir: join(campaignRoot, 'gate-release-full'),
    summary: overrides.summary ?? 'Release-full campaign evidence passed aggregate verification.',
    generated_at: '2026-04-25T12:00:00.000Z',
  });
}

function writeSummaryCache(campaignRoot: string, overrides: Partial<Record<string, unknown>> = {}): void {
  writeJson(join(campaignRoot, 'summary.json'), {
    schema: 'agentsmith_release_summary/v1',
    campaign_id: 'release-full',
    campaign_run_id: overrides.campaign_run_id ?? basename(campaignRoot),
    campaign_root: overrides.campaign_root ?? campaignRoot,
    automated_release_verdict: overrides.automated_release_verdict ?? 'PASSED',
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: overrides.stage ?? 'aggregate',
    blocked_step: overrides.blocked_step ?? null,
    why: overrides.why ?? 'Release-full campaign evidence passed aggregate verification.',
    next_action: overrides.next_action ?? 'Attach summary.md to the release note and complete the operator sign-off checklist.',
    terminal_result_path: overrides.terminal_result_path ?? join(campaignRoot, 'gate-release-full', 'result.json'),
    summary_json_path: overrides.summary_json_path ?? join(campaignRoot, 'summary.json'),
    summary_md_path: overrides.summary_md_path ?? join(campaignRoot, 'summary.md'),
    evidence_package: overrides.evidence_package ?? campaignRoot,
    manual_operator_signoff: overrides.manual_operator_signoff ?? 'not_covered',
    generated_at: overrides.generated_at ?? '2026-04-25T12:00:00.000Z',
  });
}

function writeLatestPointer(latestPath: string, campaignRoot: string): void {
  writeJson(latestPath, {
    schema: 'agentsmith_release_latest/v1',
    campaign_id: 'release-full',
    campaign_run_id: basename(campaignRoot),
    campaign_root: campaignRoot,
    git_sha: VALID_TEST_GIT_SHA,
    summary_json: join(campaignRoot, 'summary.json'),
    summary_md: join(campaignRoot, 'summary.md'),
    terminal_result_path: join(campaignRoot, 'gate-release-full', 'result.json'),
    generated_at: '2026-04-25T12:00:00.000Z',
    updated_at: '2026-04-25T12:00:00.000Z',
  });
}

function writeFakeNpm(dir: string, script: string): void {
  const path = join(dir, 'npm');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  const dockerPath = join(dir, 'docker');
  writeFileSync(dockerPath, '#!/usr/bin/env bash\nset -euo pipefail\nif [[ "$1" == "ps" ]]; then exit 0; fi\nexit 1\n');
  chmodSync(dockerPath, 0o755);
  const lsofPath = join(dir, 'lsof');
  writeFileSync(lsofPath, '#!/usr/bin/env bash\nexit 1\n');
  chmodSync(lsofPath, 0o755);
  const gitPath = join(dir, 'git');
  writeFileSync(gitPath, [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'if [[ "$1" == "rev-parse" ]]; then',
    `  printf '%s\\n' "${VALID_RELEASE_READY_GIT_SHA}"`,
    '  exit 0',
    'fi',
    'if [[ "$1" == "status" ]]; then',
    '  exit 0',
    'fi',
    'exit 1',
    '',
  ].join('\n'));
  chmodSync(gitPath, 0o755);
}

function writeBackendRealStyleEnv(root: string): void {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'infra', 'runtime'), { recursive: true });
  writeFileSync(join(root, 'infra', 'runtime', 'backend-real.env'), [
    'INTEGRATION_API_PORT=20040',
    'INTEGRATION_WEB_PORT=3041',
    '',
  ].join('\n'));
  writeFileSync(join(root, '.env.backend-real'), [
    'PRESET_ENDPOINT_API_KEY=sk-test-release-ready-file-value',
    'PRESET_ENDPOINT_MODEL=test-release-ready-model',
    'PRESET_OPENAI_ENDPOINT_BASE_URL=https://provider.example.test/v1',
    '',
  ].join('\n'));
}

function passingSentinelResult() {
  return {
    exitCode: 0 as const,
    output: {
      presence: {},
      profile_digest: 'sha256:test-profile-digest',
      public_endpoint: null,
      port_family: 'unknown',
    },
  };
}

function failingSentinelResult() {
  return {
    exitCode: 1 as const,
    output: {
      presence: {
        'probe.secret_profile_present': false,
      },
      profile_digest: 'sha256:redacted-failing-profile-digest',
      public_endpoint: null,
      port_family: 'unknown',
    },
  };
}

function passingGitGuard() {
  return {
    ok: true as const,
    headSha: VALID_RELEASE_READY_GIT_SHA,
  };
}

function passingReusableResourceReadiness() {
  return {
    runnerImage: {
      imageRef: 'agentsmith-agent-task-runner:local',
      imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
    localKind: {
      context: 'kind-agentsmith',
      clusterUid: 'cluster-uid-release-ready',
      controlPlaneContainerId: 'kind-control-plane-container',
    },
  };
}

function unifiedSubstrateConflictPreflight(evidencePath: string): ResourceOwnerPreflightResult {
  return {
    ok: false,
    evidencePath,
    evidence: {
      schema: 'agentsmith_resource_owner_preflight/v1',
      target: 'release-ready',
      status: 'failed',
      generated_at: '2026-04-27T12:00:00.000Z',
      lock_id: 'fixed-local-ports',
      checked_ports: [27027],
      conflicts: [],
      blocker: null,
    },
    blocker: {
      port: 27027,
      label: 'Mongo unified substrate database port',
      owner_kind: 'unified-deploy-substrate',
      owner_label: 'agentsmith-unified-substrate-mongodb-1',
      detail: 'agentsmith-unified-substrate/mongodb publishes host port 27027',
      recovery: {
        kind: 'fix',
        command: 'npx tsx scripts/unified-deploy/substrate-lifecycle.ts down',
      },
    },
    conflicts: [],
  };
}

function passingOwnerPreflight(evidencePath: string): ResourceOwnerPreflightResult {
  return {
    ok: true,
    evidencePath,
    evidence: {
      schema: 'agentsmith_resource_owner_preflight/v1',
      target: 'release-ready',
      status: 'passed',
      generated_at: '2026-04-27T12:00:00.000Z',
      lock_id: 'fixed-local-ports',
      checked_ports: [],
      conflicts: [],
      blocker: null,
    },
    conflicts: [],
  };
}

function expectCanonicalNotStartedBlocker(output: string, blocker: string): void {
  expect(output).toContain('AgentSmith Release Readiness');
  expect(output).toContain(`Blocker: ${blocker}`);
  expect(output).toContain('Stage: preflight');
  expect(output).toContain('Rerun: npm run release:ready');
  expect(output).toContain('Evidence: no campaign evidence was produced; no release verdict was written.');
  expect(output).not.toContain('Automated release verdict: NOT STARTED');
  expect(output).not.toContain('Blocked before:');
  expect(output).not.toContain('Next:');
  expect(output).not.toContain('Logs:');
  expect(output.match(/^Blocker:/gm) ?? []).toHaveLength(1);
}

describe('release readiness human entrypoints', () => {
  it('exposes clean release aliases and unified deploy lanes', () => {
    const scripts = readPackageScripts();

    expect(scripts['release:ready']).toContain('scripts/governance/release-ready.ts');
    expect(scripts['release:status']).toContain('scripts/governance/release-status.ts');
    expect(scripts['release:aggregate']).toContain('scripts/governance/run-release-aggregate.ts');

    expect(scripts['release:campaign:full']).toBeTruthy();
    expect(scripts['gate:release:full']).toBeTruthy();
    expect(scripts['lane:unified-deploy:substrate']).toBeTruthy();
    expect(scripts['lane:unified-deploy:local-kind:images']).toBeTruthy();
    expect(scripts['lane:unified-deploy:local-kind']).toBeTruthy();
    expect(scripts['lane:unified-deploy:product-flows']).toBeTruthy();
  });

  it('keeps the release readiness checklist centered on clean human entrypoints', () => {
    const checklist = readFileSync('docs/user-guides/release-readiness-checklist.md', 'utf8');

    expect(checklist).toContain('npm run release:ready');
    expect(checklist).toContain('npm run release:status');
    expect(checklist).toContain('internal adapter');

    for (const pattern of RELEASE_HUMAN_DOC_FORBIDDEN_COPYABLE_PATTERNS) {
      expect(checklist, `release checklist must not expose internal adapter as copyable human path: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('writes release summary from the campaign-scoped terminal result without rereading upstream evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-summary-terminal-only-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root, {
        status: 'failed',
        failure_class: 'evidence_missing',
        summary: 'Campaign step lane-visual did not pass.',
      });

      const summary = writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      expect(summary.automated_release_verdict).toBe('FAILED');
      expect(summary.failure_class).toBe('evidence_missing');
      expect(summary.blocked_step).toBe('lane-visual');
      expect(summary.terminal_result_path).toBe(join(root, 'gate-release-full', 'result.json'));
      expect(existsSync(join(root, 'summary.json'))).toBe(true);
      expect(existsSync(join(root, 'summary.md'))).toBe(true);
      const latest = JSON.parse(readFileSync(latestPath, 'utf8')) as Record<string, unknown>;
      expect(latest).toMatchObject({
        campaign_root: root,
        campaign_run_id: summary.campaign_run_id,
        git_sha: VALID_TEST_GIT_SHA,
        generated_at: summary.generated_at,
        updated_at: summary.generated_at,
        summary_json: join(root, 'summary.json'),
        summary_md: join(root, 'summary.md'),
      });
      expect(latest.automated_release_verdict).toBeUndefined();
      expect(latest.status).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the governed release-real run command in release summary next actions', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-summary-release-real-command-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-release did not pass.',
      });

      const summary = writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      expect(summary.blocked_step).toBe('gate-release');
      expect(summary.next_action).toContain('npm run verify -- --goal=release-real --run');
      expect(summary.next_action).not.toContain('npm run verify:release-real');
      expect(readFileSync(join(root, 'summary.md'), 'utf8')).not.toContain('npm run verify:release-real');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps release summary next actions on clean commands for unified deploy blockers', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-summary-clean-unified-next-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step lane-unified-deploy-product-flows did not pass.',
      });

      const summary = writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });
      const rendered = renderReleaseStatus({
        kind: 'ready',
        latestPath,
        summary,
      });

      expect(summary.next_action).toContain('npm run release:ready');
      expect(summary.next_action).not.toContain('npm run lane:');
      expect(rendered).toContain('Read-only: release:status does not rerun checks or revalidate evidence.');
      expect(rendered).toContain('Blocker: lane-unified-deploy-product-flows');
      expect(rendered).toContain('Stage: aggregate');
      expect(rendered).toContain('Why: Campaign step lane-unified-deploy-product-flows did not pass.');
      expect(rendered).toContain('Inspect:');
      expect(rendered).toContain('Rerun: npm run release:ready');
      expect(rendered).toContain(`Evidence: ${root}`);
      expect(rendered).not.toContain('npm run lane:');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed instead of rendering stale release-real summary next actions', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-stale-release-real-command-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-release did not pass.',
      });
      writeSummaryCache(root, {
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'product_regression',
        blocked_step: 'gate-release',
        why: 'Campaign step gate-release did not pass.',
        next_action: 'Fix the product regression, run npm run verify:release-real, then rerun npm run release:ready.',
      });
      writeLatestPointer(latestPath, root);

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).toBe('malformed');

      const output = renderReleaseStatus(status);
      expect(output).toContain('Automated release verdict: UNKNOWN');
      expect(output).toContain('next_action');
      expect(output).not.toContain('npm run verify:release-real');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders release status from latest summary only and gives a next action when latest is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-'));
    const latestPath = join(root, 'missing-latest.json');
    try {
      const missing = readReleaseStatus({ latestPath });
      expect(missing.kind).toBe('missing_latest');

      const output = renderReleaseStatus(missing);
      expect(output).toContain('Automated release verdict: MISSING');
      expect(output).toContain('Read-only: release:status does not rerun checks or revalidate evidence.');
      expect(output).toContain('Blocker: release_status_missing_latest');
      expect(output).toContain('Rerun: npm run release:ready');
      expect(output).toContain('Next: run npm run release:ready');
      expect(output).not.toContain('gate:release:full');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when latest pointer is missing required provenance fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-weak-latest-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root);
      writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      const completePointer = JSON.parse(readFileSync(latestPath, 'utf8')) as Record<string, unknown>;
      for (const field of ['campaign_run_id', 'git_sha', 'generated_at'] as const) {
        const weakPointer = { ...completePointer };
        delete weakPointer[field];
        writeJson(latestPath, weakPointer);

        const status = readReleaseStatus({ latestPath });
        expect(status.kind).toBe('malformed');
        if (status.kind !== 'malformed') {
          throw new Error(`Expected weak latest pointer without ${field} to fail closed.`);
        }
        expect(status.error).toContain(field);

        const output = renderReleaseStatus(status);
        expect(output).toContain('Automated release verdict: UNKNOWN');
        expect(output).not.toContain('Automated release verdict: PASSED');
        expect(output).not.toContain('Campaign:');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when latest pointer provenance is invalid or polluted', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-invalid-latest-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root);
      writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      const completePointer = JSON.parse(readFileSync(latestPath, 'utf8')) as Record<string, unknown>;
      const cases: Array<{ label: string; patch: Record<string, unknown>; expectedError: string }> = [
        {
          label: 'wrong run id',
          patch: { campaign_run_id: 'not-the-summary-run-id' },
          expectedError: 'campaign_run_id',
        },
        {
          label: 'invalid generated_at',
          patch: { generated_at: 'not-an-iso-time' },
          expectedError: 'generated_at',
        },
        {
          label: 'nonexistent generated_at calendar date',
          patch: { generated_at: '2026-02-31T12:00:00.000Z' },
          expectedError: 'generated_at',
        },
        {
          label: 'invalid git_sha',
          patch: { git_sha: 'not-a-real-git-sha' },
          expectedError: 'git_sha',
        },
        {
          label: 'wrong campaign id',
          patch: { campaign_id: 'release-lite' },
          expectedError: 'campaign_id',
        },
        {
          label: 'polluted verdict fields',
          patch: {
            automated_release_verdict: 'PASSED',
            status: 'passed',
          },
          expectedError: 'unexpected field',
        },
      ];

      for (const testCase of cases) {
        writeJson(latestPath, {
          ...completePointer,
          ...testCase.patch,
        });

        const status = readReleaseStatus({ latestPath });
        expect(status.kind, testCase.label).toBe('malformed');
        if (status.kind !== 'malformed') {
          throw new Error(`Expected invalid latest pointer case to fail closed: ${testCase.label}.`);
        }
        expect(status.error).toContain(testCase.expectedError);

        const output = renderReleaseStatus(status);
        expect(output).toContain('Automated release verdict: UNKNOWN');
        expect(output).not.toContain('Automated release verdict: PASSED');
        expect(output).not.toContain('Campaign:');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when latest summary exists but the campaign terminal result is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-missing-terminal-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeSummaryCache(root);
      writeLatestPointer(latestPath, root);

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).not.toBe('ready');

      const output = renderReleaseStatus(status);
      expect(output).toContain('Automated release verdict: UNKNOWN');
      expect(output).toContain('terminal result');
      expect(output).not.toContain('Automated release verdict: PASSED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when summary cache disagrees with the campaign-scoped terminal result', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-mismatch-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root, {
        status: 'passed',
        failure_class: 'none',
        summary: 'Release-full campaign evidence passed aggregate verification.',
      });
      writeSummaryCache(root, {
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'evidence_missing',
        why: 'stale summary cache says failed',
      });
      writeLatestPointer(latestPath, root);

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).not.toBe('ready');

      const output = renderReleaseStatus(status);
      expect(output).toContain('summary cache');
      expect(output).toContain('terminal result');
      expect(output).not.toContain('Automated release verdict: FAILED');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when summary cache is missing required presentation fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-summary-shape-'));
    const latestPath = join(root, 'latest.json');
    try {
      writeTerminalResult(root);
      writeJson(join(root, 'summary.json'), {
        schema: 'agentsmith_release_summary/v1',
        campaign_id: 'release-full',
      });
      writeLatestPointer(latestPath, root);

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).not.toBe('ready');

      const output = renderReleaseStatus(status);
      expect(output).toContain('summary cache');
      expect(output).toContain('required');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops before the campaign when release precheck fails and does not write a release verdict', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-precheck-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 9
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(9);
      const output = `${result.stdout}\n${result.stderr}`;
      expectCanonicalNotStartedBlocker(output, 'release_precheck');
      expect(output).toContain('Inspect: see the release precheck output above.');
      expect(output).toContain('no release verdict');
      expect(readFileSync(logPath, 'utf8')).toBe('run test:release:precheck\n');
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
      expect(existsSync(join(root, 'summary.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('does not run sentinel when release precheck fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-precheck-no-sentinel-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script) => {
          scripts.push(script);
          return script === 'test:release:precheck'
            ? { status: 9, signal: null }
            : { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
        reusableResourceReadiness: () => ({
          runnerImage: {
            imageRef: 'agentsmith-agent-task-runner:local',
            imageId: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          },
          localKind: {
            context: 'kind-agentsmith',
            clusterUid: 'cluster-uid-release-ready',
            controlPlaneContainerId: 'kind-control-plane-container',
          },
        }),
      });

      expect(exitCode).toBe(9);
      expect(scripts).toEqual(['test:release:precheck']);
      expect(sentinelProfiles).toEqual([]);
      const output = `${stdout.join('')}\n${stderr.join('')}`;
      expectCanonicalNotStartedBlocker(output, 'release_precheck');
      expect(output).toContain('Inspect: see the release precheck output above.');
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
      expect(existsSync(join(root, 'summary.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast on fixed-port owner conflicts before release precheck, sentinel, or campaign', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-owner-preflight-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    try {
      const evidencePath = join(root, 'preflight', 'evidence.json');
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script) => {
          scripts.push(script);
          return { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        ownerPreflight: () => unifiedSubstrateConflictPreflight(evidencePath),
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

      expect(exitCode).toBe(1);
      expect(scripts).toEqual([]);
      expect(sentinelProfiles).toEqual([]);
      expect(combinedOutput.trim().split('\n')).toHaveLength(8);
      expect(combinedOutput).toContain('AgentSmith Release Readiness');
      expect(combinedOutput).toContain('Blocker: environment_conflict');
      expect(combinedOutput).toContain('Stage: preflight');
      expect(combinedOutput).toContain('Why: port 27027 is owned by agentsmith-unified-substrate-mongodb-1');
      expect(combinedOutput).toContain('Fix: npx tsx scripts/unified-deploy/substrate-lifecycle.ts down');
      expect(combinedOutput).toContain('Rerun: npm run release:ready');
      expect(combinedOutput).toContain(`Evidence: ${evidencePath}`);
      expect(combinedOutput).not.toContain('Automated release verdict: PASSED');
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast on dirty git state before owner preflight, release precheck, sentinel, or campaign', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-dirty-git-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    const ownerPreflightCalls: string[] = [];
    const cleanupReasons: string[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: () => ({
          ok: false,
          blocker: 'release_git_clean_guard',
          why: 'release:ready requires a clean git worktree before release sign-off.',
          inspectCommand: 'git status --short',
        }),
        runNpmScript: (script) => {
          scripts.push(script);
          return { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        ownerPreflight: (evidencePath) => {
          ownerPreflightCalls.push(evidencePath);
          return passingOwnerPreflight(evidencePath);
        },
        createCleanupFinalizer: () => ({
          finalize: (reason) => cleanupReasons.push(reason),
        }),
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

      expect(exitCode).toBe(1);
      expect(scripts).toEqual([]);
      expect(sentinelProfiles).toEqual([]);
      expect(ownerPreflightCalls).toEqual([]);
      expect(cleanupReasons).toEqual([]);
      expectCanonicalNotStartedBlocker(combinedOutput, 'release_git_clean_guard');
      expect(combinedOutput).toContain('Inspect: git status --short');
      expect(combinedOutput).toContain('release:ready requires a clean git worktree');
      expect(existsSync(join(root, 'state', 'readiness.json'))).toBe(false);
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops after precheck when release-ready sentinel fails without writing a release verdict', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-sentinel-fail-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script) => {
          scripts.push(script);
          return { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return failingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

      expect(exitCode).toBe(1);
      expect(scripts).toEqual(['test:release:precheck']);
      expect(sentinelProfiles).toEqual(['release-ready']);
      expectCanonicalNotStartedBlocker(combinedOutput, 'sentinel_preflight');
      expect(combinedOutput).toContain('sentinel preflight failed');
      expect(combinedOutput).toContain('"probe.secret_profile_present": false');
      expect(combinedOutput).not.toContain('Automated release verdict: PASSED');
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
      expect(existsSync(join(root, 'summary.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs release-ready sentinel from a backend-real env file in cwd after precheck passes', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-sentinel-env-file-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const parentEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      RELEASE_CAMPAIGN_ROOT: root,
    };
    try {
      writeBackendRealStyleEnv(root);

      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        cwd: root,
        env: parentEnv,
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script) => {
          scripts.push(script);
          return script === 'release:campaign:full'
            ? { status: 7, signal: null }
            : { status: 0, signal: null };
        },
        ownerPreflight: passingOwnerPreflight,
      });

      expect(exitCode).toBe(7);
      expect(scripts).toEqual(['test:release:precheck', 'release:campaign:full']);
      expect(parentEnv.PRESET_ENDPOINT_API_KEY).toBeUndefined();
      expect(parentEnv.PRESET_ENDPOINT_MODEL).toBeUndefined();
      expect(`${stdout.join('')}\n${stderr.join('')}`).not.toContain('sentinel preflight failed');
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
      expect(existsSync(join(root, 'summary.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects unsafe release campaign run ids before starting the campaign', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-unsafe-run-id-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_RUNS_ROOT: root,
          RELEASE_CAMPAIGN_RUN_ID: '../escaped-campaign',
        },
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script) => {
          scripts.push(script);
          return { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
        reusableResourceReadiness: passingReusableResourceReadiness,
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;
      expect(exitCode).toBe(1);
      expect(scripts).toEqual([]);
      expect(sentinelProfiles).toEqual([]);
      expect(combinedOutput).toContain('invalid RELEASE_CAMPAIGN_RUN_ID');
      expectCanonicalNotStartedBlocker(combinedOutput, 'release_campaign_context');
      expect(existsSync(join(root, '..', 'escaped-campaign'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked default campaign root before starting the campaign', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-symlink-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-outside-root-'));
    const runId = 'release-ready-safe-id';
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    try {
      symlinkSync(outsideRoot, join(root, runId), 'dir');

      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_RUNS_ROOT: root,
          RELEASE_CAMPAIGN_RUN_ID: runId,
        },
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script) => {
          scripts.push(script);
          return { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
        reusableResourceReadiness: passingReusableResourceReadiness,
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;
      expect(exitCode).toBe(1);
      expect(scripts).toEqual([]);
      expect(sentinelProfiles).toEqual([]);
      expect(combinedOutput).toContain('symlink');
      expectCanonicalNotStartedBlocker(combinedOutput, 'release_campaign_context');
      expect(existsSync(join(outsideRoot, 'gate-release-full', 'result.json'))).toBe(false);
      expect(existsSync(join(outsideRoot, 'summary.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked parent segment for default release-runs before starting the campaign', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-parent-symlink-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-parent-outside-'));
    const originalCwd = process.cwd();
    const runId = 'release-ready-safe-id';
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    try {
      symlinkSync(outsideRoot, join(root, 'artifacts'), 'dir');
      process.chdir(root);

      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_RUN_ID: runId,
        },
        cwd: root,
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script) => {
          scripts.push(script);
          return { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;
      expect(exitCode).toBe(1);
      expect(scripts).toEqual([]);
      expect(sentinelProfiles).toEqual([]);
      expect(combinedOutput).toContain('symlink');
      expect(existsSync(join(outsideRoot, 'release-runs', runId))).toBe(false);
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not assume the release precheck child env mutates the parent sentinel env', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-child-env-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const parentEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH ?? '',
      RELEASE_CAMPAIGN_ROOT: root,
    };
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        cwd: root,
        env: parentEnv,
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script, _args, env) => {
          scripts.push(script);
          if (script === 'test:release:precheck') {
            const childOnlyEnv = {
              ...env,
              PRESET_ENDPOINT_API_KEY: 'sk-test-child-only-value',
              PRESET_ENDPOINT_MODEL: 'test-child-only-model',
            };
            expect(childOnlyEnv.PRESET_ENDPOINT_API_KEY).toBe('sk-test-child-only-value');
          }
          return { status: 0, signal: null };
        },
        ownerPreflight: passingOwnerPreflight,
      });

      const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

      expect(exitCode).toBe(1);
      expect(scripts).toEqual(['test:release:precheck']);
      expect(parentEnv.PRESET_ENDPOINT_API_KEY).toBeUndefined();
      expect(parentEnv.PRESET_ENDPOINT_MODEL).toBeUndefined();
      expectCanonicalNotStartedBlocker(combinedOutput, 'sentinel_preflight');
      expect(combinedOutput).toContain('sentinel preflight failed');
      expect(combinedOutput).not.toContain('sk-test-child-only-value');
      expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
      expect(existsSync(join(root, 'summary.json'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the existing campaign only after release-ready sentinel passes', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-sentinel-pass-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const sentinelProfiles: string[] = [];
    const precheckEnvs: NodeJS.ProcessEnv[] = [];
    const campaignEnvs: NodeJS.ProcessEnv[] = [];
    try {
      const exitCode = runReleaseReady(['--dry-run'], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: () => ({
          ok: true,
          headSha: VALID_RELEASE_READY_GIT_SHA,
        }),
        runNpmScript: (script, args, env) => {
          scripts.push([script, ...args].join(' '));
          if (script === 'test:release:precheck') {
            precheckEnvs.push(env);
          }
          if (script === 'release:campaign:full') {
            campaignEnvs.push(env);
          }
          return script === 'release:campaign:full'
            ? { status: 7, signal: null }
            : { status: 0, signal: null };
        },
        sentinelRunner: (profile) => {
          sentinelProfiles.push(profile);
          return passingSentinelResult();
        },
        ownerPreflight: passingOwnerPreflight,
        reusableResourceReadiness: passingReusableResourceReadiness,
      });

      expect(exitCode).toBe(7);
      expect(scripts).toEqual([
        'test:release:precheck',
        'release:campaign:full --dry-run',
      ]);
      expect(sentinelProfiles).toEqual(['release-ready']);
      expect(precheckEnvs).toHaveLength(1);
      expect(precheckEnvs[0]?.AGENTSMITH_RELEASE_READY_GIT_SHA).toBe(VALID_RELEASE_READY_GIT_SHA);
      expect(precheckEnvs[0]?.[READINESS_STATE_ENV.path]).toBe(join(root, 'state', 'readiness.json'));
      expect(precheckEnvs[0]?.[READINESS_STATE_ENV.gitSha]).toBe(VALID_RELEASE_READY_GIT_SHA);
      expect(precheckEnvs[0]?.[READINESS_STATE_ENV.invocationId]).toBeTruthy();
      expect(precheckEnvs[0]?.[READINESS_STATE_ENV.processNonce]).toBeTruthy();
      expect(campaignEnvs).toHaveLength(1);
      expect(campaignEnvs[0]?.AGENTSMITH_RELEASE_READY_GIT_SHA).toBe(VALID_RELEASE_READY_GIT_SHA);
      expect(campaignEnvs[0]?.[READINESS_STATE_ENV.path]).toBe(join(root, 'state', 'readiness.json'));
      expect(campaignEnvs[0]?.[READINESS_STATE_ENV.gitSha]).toBe(VALID_RELEASE_READY_GIT_SHA);
      expect(campaignEnvs[0]?.[READINESS_STATE_ENV.invocationId]).toBe(precheckEnvs[0]?.[READINESS_STATE_ENV.invocationId]);
      expect(campaignEnvs[0]?.[READINESS_STATE_ENV.processNonce]).toBe(precheckEnvs[0]?.[READINESS_STATE_ENV.processNonce]);
      expect(campaignEnvs[0]?.[READINESS_STATE_ENV.invocationId]).toBeTruthy();
      expect(campaignEnvs[0]?.[READINESS_STATE_ENV.processNonce]).toBeTruthy();
      expect(existsSync(join(root, 'state', 'readiness.json'))).toBe(true);
      const readinessValidation = validateRunReadinessStateForConsumer({
        statePath: campaignEnvs[0]?.[READINESS_STATE_ENV.path] ?? '',
        invocationId: campaignEnvs[0]?.[READINESS_STATE_ENV.invocationId] ?? '',
        processNonce: campaignEnvs[0]?.[READINESS_STATE_ENV.processNonce] ?? '',
        inputDigest: campaignEnvs[0]?.[READINESS_STATE_ENV.inputDigest],
        envDigest: campaignEnvs[0]?.[READINESS_STATE_ENV.envDigest],
        gitSha: VALID_RELEASE_READY_GIT_SHA,
      });
      expect(readinessValidation).toMatchObject({ ok: true });
      if (!readinessValidation.ok) {
        throw new Error(readinessValidation.error);
      }
      expect(readinessValidation.state.readiness.integration_deps_ready).toBe('ready');
      expect(readinessValidation.state.readiness.runner_image_digest_prepared).toBe('ready');
      expect(readinessValidation.state.readiness.local_kind_image_import_completed).toBe('ready');
      expect(readinessValidation.state.readiness_identities?.runner_image_digest_prepared?.values).toMatchObject({
        runner_image_ref: 'agentsmith-agent-task-runner:local',
        runner_image_id: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      });
      expect(readinessValidation.state.readiness_identities?.local_kind_image_import_completed?.values).toMatchObject({
        local_kind_context: 'kind-agentsmith',
        local_kind_cluster_uid: 'cluster-uid-release-ready',
        local_kind_control_plane_container_id: 'kind-control-plane-container',
      });
      expect(stdout.join('')).not.toContain('state/readiness.json');
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the release cleanup finalizer after a failed release readiness run without replacing the exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-cleanup-failure-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const scripts: string[] = [];
    const cleanupContexts: string[] = [];
    const cleanupReasons: string[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: () => ({
          ok: true,
          headSha: VALID_RELEASE_READY_GIT_SHA,
        }),
        runNpmScript: (script) => {
          scripts.push(script);
          return script === 'test:release:precheck'
            ? { status: 9, signal: null }
            : { status: 0, signal: null };
        },
        sentinelRunner: () => passingSentinelResult(),
        ownerPreflight: passingOwnerPreflight,
        createCleanupFinalizer: (context) => {
          cleanupContexts.push(context.campaignRoot);
          return {
            finalize: (reason) => cleanupReasons.push(reason),
          };
        },
      });

      expect(exitCode).toBe(9);
      expect(scripts).toEqual(['test:release:precheck']);
      expect(cleanupContexts).toEqual([root]);
      expect(cleanupReasons).toEqual(['failure']);
      expectCanonicalNotStartedBlocker(`${stdout.join('')}\n${stderr.join('')}`, 'release_precheck');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs the release cleanup finalizer after a successful release readiness run', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-cleanup-success-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cleanupReasons: string[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: () => ({
          ok: true,
          headSha: VALID_RELEASE_READY_GIT_SHA,
        }),
        runNpmScript: (script) => {
          if (script === 'release:campaign:full') {
            writeTerminalResult(root);
            writeSummaryCache(root);
          }
          return { status: 0, signal: null };
        },
        sentinelRunner: () => passingSentinelResult(),
        ownerPreflight: passingOwnerPreflight,
        createCleanupFinalizer: () => ({
          finalize: (reason) => cleanupReasons.push(reason),
        }),
      });

      expect(exitCode).toBe(0);
      expect(cleanupReasons).toEqual(['success']);
      expect(stdout.join('')).toContain('Automated release verdict: PASSED');
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('can disable the release cleanup finalizer without changing release readiness execution', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-cleanup-disabled-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cleanupReasons: string[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
          AGENTSMITH_RELEASE_READY_CLEANUP: '0',
        },
        gitCleanGuard: () => ({
          ok: true,
          headSha: VALID_RELEASE_READY_GIT_SHA,
        }),
        runNpmScript: (script) => (
          script === 'test:release:precheck'
            ? { status: 9, signal: null }
            : { status: 0, signal: null }
        ),
        sentinelRunner: () => passingSentinelResult(),
        ownerPreflight: passingOwnerPreflight,
        createCleanupFinalizer: () => ({
          finalize: (reason) => cleanupReasons.push(reason),
        }),
      });

      expect(exitCode).toBe(9);
      expect(cleanupReasons).toEqual([]);
      expectCanonicalNotStartedBlocker(`${stdout.join('')}\n${stderr.join('')}`, 'release_precheck');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps the release cleanup finalizer safe, idempotent, and non-volume-destructive', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-cleanup-plan-'));
    const commands: string[] = [];
    try {
      const finalizer = createReleaseCleanupFinalizer({
        cwd: process.cwd(),
        env: {
          ...process.env,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        campaignRoot: root,
        probeResource: (resource, phase) => (
          phase === 'after'
          && (
            resource === 'integration_deps'
            || resource === 'unified_substrate'
            || resource === 'kind_cluster'
            || resource === 'kind_registry'
          )
        ),
        cleanupRunner: (command) => {
          commands.push([command.executable, ...command.args].join(' '));
          return { status: 0, signal: null };
        },
      });

      finalizer.finalize('failure');
      finalizer.finalize('failure');

      expect(commands).toEqual([
        `npx tsx scripts/unified-deploy/substrate-lifecycle.ts down --profile=local-kind --evidence-dir=${join(root, 'cleanup', 'unified-substrate')}`,
        'npm run integration:deps:down',
        'kind delete cluster --name agentsmith',
        'docker rm -f kind-registry',
      ]);
      expect(commands.join('\n')).not.toContain('down:volumes');
      expect(commands.join('\n')).not.toContain(' -v');
      expect(commands.join('\n')).not.toContain('rm -rf');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the release-runs campaign root for release readiness state when no explicit campaign root is provided', () => {
    const releaseRunsRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-state-root-'));
    const runId = 'release-ready-state-run';
    const stdout: string[] = [];
    const stderr: string[] = [];
    const campaignEnvs: NodeJS.ProcessEnv[] = [];
    try {
      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          RELEASE_RUNS_ROOT: releaseRunsRoot,
          RELEASE_CAMPAIGN_RUN_ID: runId,
        },
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script, _args, env) => {
          if (script === 'release:campaign:full') {
            campaignEnvs.push(env);
            return { status: 7, signal: null };
          }
          return { status: 0, signal: null };
        },
        sentinelRunner: () => passingSentinelResult(),
        ownerPreflight: passingOwnerPreflight,
      });

      const expectedCampaignRoot = join(releaseRunsRoot, runId);
      const expectedStatePath = join(expectedCampaignRoot, 'state', 'readiness.json');

      expect(exitCode).toBe(7);
      expect(campaignEnvs).toHaveLength(1);
      expect(campaignEnvs[0]?.RELEASE_CAMPAIGN_ROOT).toBe(expectedCampaignRoot);
      expect(campaignEnvs[0]?.[READINESS_STATE_ENV.path]).toBe(expectedStatePath);
      expect(existsSync(expectedStatePath)).toBe(true);
      expect(validateRunReadinessStateForConsumer({
        statePath: expectedStatePath,
        invocationId: campaignEnvs[0]?.[READINESS_STATE_ENV.invocationId] ?? '',
        processNonce: campaignEnvs[0]?.[READINESS_STATE_ENV.processNonce] ?? '',
        inputDigest: campaignEnvs[0]?.[READINESS_STATE_ENV.inputDigest],
        envDigest: campaignEnvs[0]?.[READINESS_STATE_ENV.envDigest],
      })).toMatchObject({ ok: true });
      expect(`${stdout.join('')}\n${stderr.join('')}`).not.toContain('state/readiness.json');
    } finally {
      rmSync(releaseRunsRoot, { recursive: true, force: true });
    }
  });

  it('runs the existing campaign after precheck passes and follows the campaign exit code', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-campaign-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const logPath = join(root, 'npm.log');
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  exit 7
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...SENTINEL_PASS_ENV,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(7);
      expect(readFileSync(logPath, 'utf8')).toBe([
        'run test:release:precheck',
        'run release:campaign:full',
        '',
      ].join('\n'));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('treats the release campaign as the only summary writer', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-summary-owner-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    try {
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  mkdir -p "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full"
  campaign_run_id="$(basename "\${RELEASE_CAMPAIGN_ROOT}")"
  cat > "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json" <<JSON
{
  "schema_version": "${CURRENT_GATE_RESULT_SCHEMA_VERSION}",
  "gate_id": "gate-release-full",
  "gate_adapter": { "npm_script": "gate:release:full", "ci_job": null },
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "line_kind": "release_full_verdict",
  "evidence_dir": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full",
  "summary": "Campaign-owned summary passed.",
  "generated_at": "2026-04-25T12:00:00.000Z"
}
JSON
  cat > "\${RELEASE_CAMPAIGN_ROOT}/summary.json" <<JSON
{
  "schema": "agentsmith_release_summary/v1",
  "campaign_id": "release-full",
  "campaign_run_id": "\${campaign_run_id}",
  "campaign_root": "\${RELEASE_CAMPAIGN_ROOT}",
  "automated_release_verdict": "PASSED",
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "blocked_step": null,
  "why": "Campaign-owned summary passed.",
  "next_action": "Attach summary.md to the release note and complete the operator sign-off checklist.",
  "terminal_result_path": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json",
  "summary_json_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.json",
  "summary_md_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.md",
  "evidence_package": "\${RELEASE_CAMPAIGN_ROOT}",
  "manual_operator_signoff": "not_covered",
  "generated_at": "campaign-owned-summary"
}
JSON
  printf '# Campaign-owned summary\\n' > "\${RELEASE_CAMPAIGN_ROOT}/summary.md"
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...SENTINEL_PASS_ENV,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Campaign-owned summary passed.');
      const summary = JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8')) as { generated_at: string };
      expect(summary.generated_at).toBe('campaign-owned-summary');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });

  it('creates and reads the current campaign root instead of falling back to an older latest pointer', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-current-root-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const oldCampaignRoot = join(root, 'old-campaign');
    const logPath = join(root, 'npm.log');
    const repoLatestPath = resolve('artifacts', 'release-runs', 'latest.json');
    const previousLatest = existsSync(repoLatestPath) ? readFileSync(repoLatestPath, 'utf8') : null;
    try {
      writeTerminalResult(oldCampaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Old campaign failed and must not be displayed.',
      });
      writeSummaryCache(oldCampaignRoot, {
        automated_release_verdict: 'FAILED',
        status: 'failed',
        failure_class: 'product_regression',
        why: 'Old campaign failed and must not be displayed.',
        terminal_result_path: join(oldCampaignRoot, 'gate-release-full', 'result.json'),
      });
      writeLatestPointer(repoLatestPath, oldCampaignRoot);

      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s|root=%s|run=%s\\n' "$*" "\${RELEASE_CAMPAIGN_ROOT:-}" "\${RELEASE_CAMPAIGN_RUN_ID:-}" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  mkdir -p "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full"
  campaign_run_id="$(basename "\${RELEASE_CAMPAIGN_ROOT}")"
  cat > "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json" <<JSON
{
  "schema_version": "${CURRENT_GATE_RESULT_SCHEMA_VERSION}",
  "gate_id": "gate-release-full",
  "gate_adapter": { "npm_script": "gate:release:full", "ci_job": null },
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "line_kind": "release_full_verdict",
  "evidence_dir": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full",
  "summary": "Current campaign passed.",
  "generated_at": "2026-04-25T12:00:00.000Z"
}
JSON
  cat > "\${RELEASE_CAMPAIGN_ROOT}/summary.json" <<JSON
{
  "schema": "agentsmith_release_summary/v1",
  "campaign_id": "release-full",
  "campaign_run_id": "\${campaign_run_id}",
  "campaign_root": "\${RELEASE_CAMPAIGN_ROOT}",
  "automated_release_verdict": "PASSED",
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "blocked_step": null,
  "why": "Current campaign passed.",
  "next_action": "Attach summary.md to the release note and complete the operator sign-off checklist.",
  "terminal_result_path": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json",
  "summary_json_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.json",
  "summary_md_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.md",
  "evidence_package": "\${RELEASE_CAMPAIGN_ROOT}",
  "manual_operator_signoff": "not_covered",
  "generated_at": "campaign-owned-summary"
}
JSON
  printf '# Current campaign summary\\n' > "\${RELEASE_CAMPAIGN_ROOT}/summary.md"
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...SENTINEL_PASS_ENV,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_RUNS_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Automated release verdict: PASSED');
      expect(result.stdout).toContain('Current campaign passed.');
      expect(result.stdout).not.toContain('Old campaign failed');
      expect(readFileSync(logPath, 'utf8')).toMatch(/run release:campaign:full\|root=.*agentsmith-release-ready-current-root-/);
      expect(readFileSync(logPath, 'utf8')).toMatch(/run release:campaign:full\|root=.*\|run=release-ready-/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
      if (previousLatest === null) {
        rmSync(repoLatestPath, { force: true });
      } else {
        writeFileSync(repoLatestPath, previousLatest);
      }
    }
  });

  it('does not update the repo latest pointer when RELEASE_CAMPAIGN_ROOT is explicit', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-explicit-root-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-fake-npm-'));
    const repoLatestPath = resolve('artifacts', 'release-runs', 'latest.json');
    const previousLatest = existsSync(repoLatestPath) ? readFileSync(repoLatestPath, 'utf8') : null;
    try {
      writeJson(repoLatestPath, {
        schema: 'agentsmith_release_latest/v1',
        campaign_id: 'release-full',
        campaign_run_id: 'previous-latest',
        campaign_root: '/tmp/previous-latest-root',
        updated_at: '2026-04-25T12:00:00.000Z',
      });

      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "run" && "$2" == "test:release:precheck" ]]; then
  exit 0
fi
if [[ "$1" == "run" && "$2" == "release:campaign:full" ]]; then
  mkdir -p "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full"
  campaign_run_id="$(basename "\${RELEASE_CAMPAIGN_ROOT}")"
  cat > "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json" <<JSON
{
  "schema_version": "${CURRENT_GATE_RESULT_SCHEMA_VERSION}",
  "gate_id": "gate-release-full",
  "gate_adapter": { "npm_script": "gate:release:full", "ci_job": null },
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "line_kind": "release_full_verdict",
  "evidence_dir": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full",
  "summary": "Explicit campaign root passed.",
  "generated_at": "2026-04-25T12:00:00.000Z"
}
JSON
  cat > "\${RELEASE_CAMPAIGN_ROOT}/summary.json" <<JSON
{
  "schema": "agentsmith_release_summary/v1",
  "campaign_id": "release-full",
  "campaign_run_id": "\${campaign_run_id}",
  "campaign_root": "\${RELEASE_CAMPAIGN_ROOT}",
  "automated_release_verdict": "PASSED",
  "status": "passed",
  "failure_class": "none",
  "stage": "aggregate",
  "blocked_step": null,
  "why": "Explicit campaign root passed.",
  "next_action": "Attach summary.md to the release note and complete the operator sign-off checklist.",
  "terminal_result_path": "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full/result.json",
  "summary_json_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.json",
  "summary_md_path": "\${RELEASE_CAMPAIGN_ROOT}/summary.md",
  "evidence_package": "\${RELEASE_CAMPAIGN_ROOT}",
  "manual_operator_signoff": "not_covered",
  "generated_at": "campaign-owned-summary"
}
JSON
  printf '# Explicit campaign root summary\\n' > "\${RELEASE_CAMPAIGN_ROOT}/summary.md"
  exit 0
fi
exit 0
`);

      const result = spawnSync('npx', ['tsx', 'scripts/governance/release-ready.ts'], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ...SENTINEL_PASS_ENV,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(repoLatestPath, 'utf8'))).toMatchObject({
        campaign_run_id: 'previous-latest',
        campaign_root: '/tmp/previous-latest-root',
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
      if (previousLatest === null) {
        rmSync(repoLatestPath, { force: true });
      } else {
        writeFileSync(repoLatestPath, previousLatest);
      }
    }
  });
});
