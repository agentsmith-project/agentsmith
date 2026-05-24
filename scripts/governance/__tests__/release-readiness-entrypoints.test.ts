import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  canonicalReleaseBoundaryJson,
  type CurrentAgentSmithReleaseContract,
} from '../current-release-boundary-schema';
import {
  readReleaseStatus,
  renderReleaseStatus,
  writeReleaseSummaryForCampaign,
} from '../release-summary';
import {
  createReleaseCleanupFinalizer,
} from '../release-cleanup-finalizer';
import { runReleaseReady } from '../release-ready';
import { runReleaseCampaignExecution } from '../release-campaign-execution';
import {
  RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV,
  READINESS_STATE_ENV,
  resolveReadinessGitSha,
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
  /\bnpm run release:contract:ci-artifact\b/,
  /\bnpm run release:deploy-template-package\b/,
  /\bnpm run release:campaign:full\b/,
  /\bRELEASE_CAMPAIGN_ROOT=<campaign-root>\s+npm run gate:release:full\b/,
] as const;

const VALID_TEST_GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const VALID_RELEASE_READY_GIT_SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const VALID_RELEASE_CONTRACT_FIXTURE = 'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json';
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

function readValidReleaseContractFixture(): CurrentAgentSmithReleaseContract {
  return JSON.parse(readFileSync(VALID_RELEASE_CONTRACT_FIXTURE, 'utf8')) as CurrentAgentSmithReleaseContract;
}

function writeReleaseContractFixture(
  path: string,
  mutate?: (contract: Record<string, unknown>) => void,
): CurrentAgentSmithReleaseContract {
  const contract = structuredClone(readValidReleaseContractFixture()) as unknown as Record<string, unknown>;
  mutate?.(contract);
  writeJson(path, contract);
  return contract as unknown as CurrentAgentSmithReleaseContract;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function rehashReleaseContractProjection(contract: Record<string, unknown>): void {
  const projection = structuredClone(contract);
  const projectionProvenance = projection.artifact_provenance as Record<string, unknown>;
  delete projectionProvenance.artifact_sha256;
  (contract.artifact_provenance as Record<string, unknown>).artifact_sha256 =
    sha256(canonicalReleaseBoundaryJson(projection));
}

type PrecheckOperationStatus = 'reused' | 'started';

const DEFAULT_RELEASE_PRECHECK_DEPS_IDENTITY = {
  postgres_port: '25432',
  mongo_port: '27027',
  redis_port: '26379',
  minio_api_port: '29000',
  minio_console_port: '29001',
  keycloak_port: '28081',
  keycloak_base_url: 'http://localhost:28081',
  keycloak_realm: 'mbos',
  keycloak_client_id: 'agentsmith',
} as const;

function writePrecheckSummary(campaignRoot: string, overrides: Partial<{
  campaignRunId: string;
  campaignRoot: string;
  dependencyStatus: PrecheckOperationStatus;
  dependencyStartCount: number;
  apiWebStatus: PrecheckOperationStatus;
  apiWebStartCount: number;
  integrationDepsIdentity: Record<string, string>;
  omitIntegrationDepsIdentity: boolean;
}> = {}): void {
  writeJson(join(campaignRoot, 'release-local-precheck', 'precheck-summary.json'), {
    schema_version: 'agentsmith.release-local-precheck/v1',
    status: 'passed',
    campaign_run_id: overrides.campaignRunId ?? basename(campaignRoot),
    campaign_root: overrides.campaignRoot ?? campaignRoot,
    checks: [
      'dependency_services_ready',
      'api_minimal_ready',
      'web_minimal_ready',
      'public_auth_token_smoke',
    ],
    observed_operations: {
      dependency_services: {
        status: overrides.dependencyStatus ?? 'reused',
        start_count: overrides.dependencyStartCount ?? 0,
      },
      api_web: {
        status: overrides.apiWebStatus ?? 'started',
        start_count: overrides.apiWebStartCount ?? 1,
      },
    },
    ...(
      overrides.omitIntegrationDepsIdentity
        ? {}
        : { integration_deps_identity: overrides.integrationDepsIdentity ?? DEFAULT_RELEASE_PRECHECK_DEPS_IDENTITY }
    ),
    generated_at: '2026-04-25T12:00:00.000Z',
  });
}

function writePrecheckSummaryForEnv(env: NodeJS.ProcessEnv): void {
  const campaignRoot = env.RELEASE_CAMPAIGN_ROOT;
  if (!campaignRoot) {
    throw new Error('test precheck summary requires RELEASE_CAMPAIGN_ROOT');
  }
  writePrecheckSummary(campaignRoot, {
    campaignRunId: env.RELEASE_CAMPAIGN_RUN_ID,
    campaignRoot: env.RELEASE_CAMPAIGN_ROOT,
  });
}

function writePrecheckSummaryForEnvWithOverrides(
  env: NodeJS.ProcessEnv,
  overrides: NonNullable<Parameters<typeof writePrecheckSummary>[1]> = {},
): void {
  const campaignRoot = env.RELEASE_CAMPAIGN_ROOT;
  if (!campaignRoot) {
    throw new Error('test precheck summary requires RELEASE_CAMPAIGN_ROOT');
  }
  writePrecheckSummary(campaignRoot, {
    ...overrides,
    campaignRunId: overrides.campaignRunId ?? env.RELEASE_CAMPAIGN_RUN_ID,
    campaignRoot: overrides.campaignRoot ?? env.RELEASE_CAMPAIGN_ROOT,
  });
}

const WRITE_PRECHECK_SUMMARY_SHELL = [
  '  mkdir -p "${RELEASE_CAMPAIGN_ROOT}/release-local-precheck"',
  '  cat > "${RELEASE_CAMPAIGN_ROOT}/release-local-precheck/precheck-summary.json" <<JSON',
  '{',
  '  "schema_version": "agentsmith.release-local-precheck/v1",',
  '  "status": "passed",',
  '  "campaign_run_id": "${RELEASE_CAMPAIGN_RUN_ID}",',
  '  "campaign_root": "${RELEASE_CAMPAIGN_ROOT}",',
  '  "checks": [',
  '    "dependency_services_ready",',
  '    "api_minimal_ready",',
  '    "web_minimal_ready",',
  '    "public_auth_token_smoke"',
  '  ],',
  '  "observed_operations": {',
  '    "dependency_services": { "status": "reused", "start_count": 0 },',
  '    "api_web": { "status": "started", "start_count": 1 }',
  '  },',
  '  "integration_deps_identity": {',
  '    "postgres_port": "25432",',
  '    "mongo_port": "27027",',
  '    "redis_port": "26379",',
  '    "minio_api_port": "29000",',
  '    "minio_console_port": "29001",',
  '    "keycloak_port": "28081",',
  '    "keycloak_base_url": "http://localhost:28081",',
  '    "keycloak_realm": "mbos",',
  '    "keycloak_client_id": "agentsmith"',
  '  },',
  '  "generated_at": "2026-04-25T12:00:00.000Z"',
  '}',
  'JSON',
].join('\n');

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

function writeDeployResult(campaignRoot: string, stepId: string, status: 'passed' | 'failed'): void {
  writeJson(join(campaignRoot, stepId, 'result.json'), {
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
  });
}

function writeDeployResults(campaignRoot: string): void {
  writeDeployResult(campaignRoot, 'lane-unified-deploy-substrate', 'passed');
  writeDeployResult(campaignRoot, 'lane-unified-deploy-local-kind-images', 'passed');
  writeDeployResult(campaignRoot, 'lane-unified-deploy-local-kind', 'passed');
  writeDeployResult(campaignRoot, 'lane-unified-deploy-product-flows', 'passed');
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

  it('keeps release artifact producers internal', () => {
    const scripts = readPackageScripts();

    expect(scripts['release:contract:ci-artifact']).toContain(
      'scripts/governance/release-contract-artifact.ts',
    );
    expect(scripts['release:deploy-template-package']).toContain(
      'scripts/governance/deploy-template-package.ts',
    );
    expect(scripts['release:ready']).not.toContain('release-contract-artifact');
    expect(scripts['release:status']).not.toContain('release-contract-artifact');
    expect(scripts['release:ready']).not.toContain('deploy-template-package');
    expect(scripts['release:status']).not.toContain('deploy-template-package');
  });

  it('keeps the release readiness checklist centered on clean human entrypoints', () => {
    const checklist = readFileSync('docs/user-guides/release-readiness-checklist.md', 'utf8');

    expect(checklist).toContain('npm run release:ready');
    expect(checklist).toContain('npm run release:status');
    expect(checklist).toContain('internal adapter');
    expect(checklist).not.toMatch(/Terminal result/i);

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
      writeDeployResults(root);

      const summary = writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      expect(summary.automated_release_verdict).toBe('FAILED');
      expect(summary.failure_class).toBe('evidence_missing');
      expect(summary.blocked_step).toBe('lane-visual');
      expect(summary.terminal_result_path).toBe(join(root, 'gate-release-full', 'result.json'));
      expect(summary.deploy_check_snapshot?.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'lane-unified-deploy-product-flows',
            status: 'passed',
          }),
        ]),
      );
      expect(existsSync(join(root, 'summary.json'))).toBe(true);
      expect(existsSync(join(root, 'summary.md'))).toBe(true);
      const summaryMarkdown = readFileSync(join(root, 'summary.md'), 'utf8');
      expect(summaryMarkdown).toContain('- Deploy check / 部署检查:');
      expect(summaryMarkdown).toContain('- dependencies: passed');
      expect(summaryMarkdown).not.toContain('- - dependencies');
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

  it('records an explicitly provided release contract as a short validated summary', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-summary-contract-'));
    const latestPath = join(root, 'latest.json');
    const contractPath = join(root, 'inputs', 'agentsmith-release-contract.json');
    try {
      writeTerminalResult(root);
      const contract = writeReleaseContractFixture(contractPath);

      const summary = writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        releaseContractPath: contractPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      expect(summary.release_contract).toEqual({
        schema: contract.schema_version,
        path: contractPath,
        digest: contract.artifact_provenance.artifact_sha256,
        subject_digest: contract.artifact_provenance.subject_sha256,
        release_id: contract.release_id,
        git_sha: VALID_TEST_GIT_SHA,
        provenance: {
          producer_repo: contract.artifact_provenance.producer_repo,
          normalized_remote: contract.artifact_provenance.normalized_remote,
          commit_sha: VALID_TEST_GIT_SHA,
          artifact_uri: contract.artifact_provenance.artifact_uri,
          generated_at: contract.artifact_provenance.generated_at,
          generator_version: contract.artifact_provenance.generator_version,
        },
      });
      expect(JSON.stringify(summary)).not.toContain('workflow_name');
      expect(JSON.stringify(summary)).not.toContain('run_attempt');
      expect(JSON.stringify(summary)).not.toContain('generate-release-contract');
      const shortContractReference = `${contract.release_id} ${contract.artifact_provenance.artifact_sha256.slice(0, 19)}... (${basename(contractPath)})`;
      const summaryMarkdown = readFileSync(join(root, 'summary.md'), 'utf8');
      expect(summaryMarkdown).toContain(`release_contract: ${shortContractReference}`);
      expect(summaryMarkdown).not.toContain(contract.artifact_provenance.artifact_sha256);
      expect(summaryMarkdown).not.toContain(contractPath);
      expect(summaryMarkdown).not.toContain('workflow_name');

      const status = readReleaseStatus({ latestPath });
      expect(status.kind).toBe('ready');
      const output = renderReleaseStatus(status);
      expect(output).toContain(`Release contract: ${shortContractReference}`);
      expect(output).not.toContain(contract.artifact_provenance.artifact_sha256);
      expect(output).not.toContain(contractPath);
      expect(output).not.toContain('workflow_name');
      expect(output).not.toContain('run_attempt');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast for invalid explicit release contracts before writing summary output', () => {
    const cases: Array<{
      label: string;
      mutate: (contract: Record<string, unknown>) => void;
      expectedError: string;
    }> = [
      {
        label: 'local artifact uri',
        mutate: (contract) => {
          const provenance = contract.artifact_provenance as Record<string, unknown>;
          provenance.artifact_uri = 'file:///tmp/agentsmith-release-contract.json';
          rehashReleaseContractProjection(contract);
        },
        expectedError: 'artifact_provenance.artifact_uri must be a remote/CI artifact URI',
      },
      {
        label: 'localhost artifact uri',
        mutate: (contract) => {
          const provenance = contract.artifact_provenance as Record<string, unknown>;
          provenance.artifact_uri = 'http://localhost/artifacts/agentsmith-release-contract.json';
          rehashReleaseContractProjection(contract);
        },
        expectedError: 'artifact_provenance.artifact_uri must be a remote/CI artifact URI',
      },
      {
        label: 'local scheme artifact uri',
        mutate: (contract) => {
          const provenance = contract.artifact_provenance as Record<string, unknown>;
          provenance.artifact_uri = 'local://release-contract/agentsmith-release-contract.json';
          rehashReleaseContractProjection(contract);
        },
        expectedError: 'artifact_provenance.artifact_uri must be a remote/CI artifact URI',
      },
      {
        label: 'missing provenance',
        mutate: (contract) => {
          delete contract.artifact_provenance;
        },
        expectedError: 'artifact_provenance is required',
      },
      {
        label: 'stale git sha',
        mutate: () => undefined,
        expectedError: 'release contract git_sha must match current release summary git sha',
      },
    ];

    for (const testCase of cases) {
      const root = mkdtempSync(join(tmpdir(), `agentsmith-release-summary-contract-${testCase.label.replaceAll(' ', '-')}-`));
      const contractPath = join(root, 'inputs', 'agentsmith-release-contract.json');
      try {
        writeTerminalResult(root);
        writeReleaseContractFixture(contractPath, testCase.mutate);

        expect(() => writeReleaseSummaryForCampaign({
          campaignRoot: root,
          latestPath: join(root, 'latest.json'),
          releaseContractPath: contractPath,
          resolveGitSha: () => testCase.label === 'stale git sha'
            ? 'abcdef0123456789abcdef0123456789abcdef01'
            : VALID_TEST_GIT_SHA,
        }), testCase.label).toThrow(testCase.expectedError);
        expect(existsSync(join(root, 'summary.json')), testCase.label).toBe(false);
        expect(existsSync(join(root, 'summary.md')), testCase.label).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('fails closed when a cached release contract summary is malformed or stale against latest', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-contract-cache-'));
    const latestPath = join(root, 'latest.json');
    const contractPath = join(root, 'inputs', 'agentsmith-release-contract.json');
    try {
      writeTerminalResult(root);
      writeReleaseContractFixture(contractPath);
      writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath,
        releaseContractPath: contractPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      const summaryPath = join(root, 'summary.json');
      const validSummary = JSON.parse(readFileSync(summaryPath, 'utf8')) as Record<string, unknown>;
      writeJson(summaryPath, {
        ...validSummary,
        release_contract: {
          ...(validSummary.release_contract as Record<string, unknown>),
          digest: 'sha256:not-a-digest',
        },
      });
      const malformedStatus = readReleaseStatus({ latestPath });
      expect(malformedStatus.kind).toBe('malformed');
      if (malformedStatus.kind !== 'malformed') {
        throw new Error('Expected malformed release contract summary cache to fail closed.');
      }
      expect(malformedStatus.error).toContain('release summary release_contract digest');

      for (const artifactUri of [
        '../agentsmith-release-contract.json',
        'scripts/governance/release-summary.ts',
        'https://github.com/agentsmith-project/agentsmith.git/',
        'https://api.github.com/repos/agentsmith-project/agentsmith/tarball/main',
        'https://api.github.com/repos/agentsmith-project/agentsmith/git/trees/main',
        'http://[::1]/artifacts/agentsmith-release-contract.json',
        'http://0.0.0.0/artifacts/agentsmith-release-contract.json',
      ]) {
        writeJson(summaryPath, {
          ...validSummary,
          release_contract: {
            ...(validSummary.release_contract as Record<string, unknown>),
            provenance: {
              ...((validSummary.release_contract as Record<string, unknown>).provenance as Record<string, unknown>),
              artifact_uri: artifactUri,
            },
          },
        });
        const sourcePointerStatus = readReleaseStatus({ latestPath });
        expect(sourcePointerStatus.kind, artifactUri).toBe('malformed');
        if (sourcePointerStatus.kind !== 'malformed') {
          throw new Error(`Expected cached artifact_uri source pointer ${artifactUri} to fail closed.`);
        }
        expect(sourcePointerStatus.error).toContain('release summary release_contract provenance artifact_uri');
        expect(sourcePointerStatus.error).toContain('remote/CI artifact URI');
      }

      writeJson(summaryPath, validSummary);
      const latest = JSON.parse(readFileSync(latestPath, 'utf8')) as Record<string, unknown>;
      writeJson(latestPath, {
        ...latest,
        git_sha: 'abcdef0123456789abcdef0123456789abcdef01',
      });
      const staleStatus = readReleaseStatus({ latestPath });
      expect(staleStatus.kind).toBe('malformed');
      if (staleStatus.kind !== 'malformed') {
        throw new Error('Expected stale release contract summary cache to fail closed.');
      }
      expect(staleStatus.error).toContain('release_contract.git_sha');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps release summary next actions on release:ready instead of release-real owner diagnostics', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-summary-public-next-action-'));
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
      expect(summary.next_action).toContain('npm run release:ready');
      expect(summary.next_action).not.toContain('npm run verify -- --goal=release-real --run');
      expect(summary.next_action).not.toContain('npm run verify:release-real');
      expect(summary.next_action).not.toMatch(/\bnpm run (?:gate|lane|backend-real):[a-z0-9:_-]+/);
      expect(renderReleaseStatus({
        kind: 'ready',
        latestPath,
        summary,
      })).toContain('Rerun: npm run release:ready');
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
      expect(rendered).toContain('Blocker: Deploy check / product flows');
      expect(rendered).toContain('Stage: release result');
      expect(rendered).toContain('Why: Deploy check / product flows did not pass.');
      expect(rendered).toContain('Inspect:');
      expect(rendered).toContain('Rerun: npm run release:ready');
      expect(rendered).toContain(`Evidence: ${root}`);
      expect(rendered).toContain('Deploy check / 部署检查:');
      expect(rendered).not.toContain('lane-unified-deploy-product-flows');
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
      expect(output).toContain('Status: unknown');
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
      expect(output).toContain('Status: missing');
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
        expect(output).toContain('Status: unknown');
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
        expect(output).toContain('Status: unknown');
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
      expect(output).toContain('Status: unknown');
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

  it('fails closed when release precheck passes but its operational summary is missing or malformed', () => {
    const cases: Array<{
      label: string;
      writeSummary?: (campaignRoot: string) => void;
      expectedOutput: string;
    }> = [
      {
        label: 'missing summary',
        expectedOutput: 'release local precheck summary cannot be read',
      },
      {
        label: 'malformed summary',
        writeSummary: (campaignRoot) => writeJson(join(campaignRoot, 'release-local-precheck', 'precheck-summary.json'), {
          schema_version: 'agentsmith.release-local-precheck/v1',
          status: 'passed',
          campaign_run_id: basename(campaignRoot),
          campaign_root: campaignRoot,
          checks: [
            'dependency_services_ready',
            'api_minimal_ready',
            'web_minimal_ready',
            'public_auth_token_smoke',
          ],
          observed_operations: {
            dependency_services: {
              status: 'reused',
              start_count: 0,
            },
          },
        }),
        expectedOutput: 'observed_operations.api_web',
      },
      {
        label: 'wrong run id',
        writeSummary: (campaignRoot) => writePrecheckSummary(campaignRoot, {
          campaignRunId: 'previous-release-run',
        }),
        expectedOutput: 'campaign_run_id',
      },
      {
        label: 'wrong campaign root',
        writeSummary: (campaignRoot) => writePrecheckSummary(campaignRoot, {
          campaignRoot: join(campaignRoot, '..', 'previous-release-root'),
        }),
        expectedOutput: 'campaign_root',
      },
      {
        label: 'missing deps identity',
        writeSummary: (campaignRoot) => writePrecheckSummary(campaignRoot, {
          omitIntegrationDepsIdentity: true,
        }),
        expectedOutput: 'integration_deps_identity',
      },
    ];

    for (const testCase of cases) {
      const root = mkdtempSync(join(tmpdir(), `agentsmith-release-ready-precheck-summary-${testCase.label.replaceAll(' ', '-')}-`));
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
            if (script === 'test:release:precheck') {
              testCase.writeSummary?.(root);
            }
            return { status: 0, signal: null };
          },
          sentinelRunner: (profile) => {
            sentinelProfiles.push(profile);
            return passingSentinelResult();
          },
          ownerPreflight: passingOwnerPreflight,
        });

        const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

        expect(exitCode, testCase.label).toBe(1);
        expect(scripts, testCase.label).toEqual(['test:release:precheck']);
        expect(sentinelProfiles, testCase.label).toEqual([]);
        expectCanonicalNotStartedBlocker(combinedOutput, 'release_precheck_summary');
        expect(combinedOutput, testCase.label).toContain(testCase.expectedOutput);
        expect(combinedOutput, testCase.label).not.toContain('Automated release verdict: PASSED');
        expect(existsSync(join(root, 'gate-release-full', 'result.json'))).toBe(false);
        expect(existsSync(join(root, 'summary.json'))).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
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
        runNpmScript: (script, _args, env) => {
          scripts.push(script);
          if (script === 'test:release:precheck') {
            writePrecheckSummaryForEnv(env);
          }
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
        runNpmScript: (script, _args, env) => {
          scripts.push(script);
          if (script === 'test:release:precheck') {
            writePrecheckSummaryForEnv(env);
          }
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
            writePrecheckSummaryForEnv(env);
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

  it('writes release readiness parent observation counts from the precheck summary instead of hardcoding starts', () => {
    const cases: Array<{
      label: string;
      dependencyStatus: PrecheckOperationStatus;
      dependencyStartCount: number;
      expectedRealServiceStartCount: number;
    }> = [
      {
        label: 'reused dependencies',
        dependencyStatus: 'reused',
        dependencyStartCount: 0,
        expectedRealServiceStartCount: 0,
      },
      {
        label: 'started bootstrap dependencies',
        dependencyStatus: 'started',
        dependencyStartCount: 1,
        expectedRealServiceStartCount: 1,
      },
    ];

    for (const testCase of cases) {
      const root = mkdtempSync(join(tmpdir(), `agentsmith-release-ready-precheck-counts-${testCase.label.replaceAll(' ', '-')}-`));
      const stdout: string[] = [];
      const stderr: string[] = [];
      const campaignEnvs: NodeJS.ProcessEnv[] = [];
      try {
        const exitCode = runReleaseReady([], {
          stdout: { write: (chunk: string) => stdout.push(chunk) },
          stderr: { write: (chunk: string) => stderr.push(chunk) },
          env: {
            ...process.env,
            RELEASE_CAMPAIGN_ROOT: root,
          },
          gitCleanGuard: passingGitGuard,
          runNpmScript: (script, _args, env) => {
            if (script === 'test:release:precheck') {
              writePrecheckSummaryForEnvWithOverrides(env, {
                dependencyStatus: testCase.dependencyStatus,
                dependencyStartCount: testCase.dependencyStartCount,
                apiWebStatus: 'started',
                apiWebStartCount: 1,
              });
            }
            if (script === 'release:campaign:full') {
              campaignEnvs.push(env);
              return { status: 7, signal: null };
            }
            return { status: 0, signal: null };
          },
          sentinelRunner: () => passingSentinelResult(),
          ownerPreflight: passingOwnerPreflight,
        });

        expect(exitCode, testCase.label).toBe(7);
        expect(campaignEnvs, testCase.label).toHaveLength(1);
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
        expect(readinessValidation.state.parent_observations.counts.real_service_start_count).toBe(
          testCase.expectedRealServiceStartCount,
        );
        expect(readinessValidation.state.parent_observations.counts.api_web_start_count).toBe(1);
        expect(readinessValidation.state.parent_observations.services).toEqual({
          real_services_started: 'ready',
          api_web_started: 'ready',
        });
        expect(readinessValidation.state.readiness.integration_deps_ready).toBe('ready');
        expect(readinessValidation.state.readiness_identities?.integration_deps_ready?.values).toEqual(
          DEFAULT_RELEASE_PRECHECK_DEPS_IDENTITY,
        );
        expect(`${stdout.join('')}\n${stderr.join('')}`).not.toContain('sk-test');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('does not mark runner image digest ready from a local Docker tag without producer evidence', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-runner-image-no-evidence-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-fake-docker-'));
    const stdout: string[] = [];
    const stderr: string[] = [];
    const campaignEnvs: NodeJS.ProcessEnv[] = [];
    try {
      const dockerPath = join(fakeBin, 'docker');
      writeFileSync(dockerPath, [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'if [[ "$1" == "image" && "$2" == "inspect" ]]; then',
        '  printf "%s\\n" "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"',
        '  exit 0',
        'fi',
        'exit 1',
        '',
      ].join('\n'));
      chmodSync(dockerPath, 0o755);
      const kubectlPath = join(fakeBin, 'kubectl');
      writeFileSync(kubectlPath, '#!/usr/bin/env bash\nexit 1\n');
      chmodSync(kubectlPath, 0o755);

      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: passingGitGuard,
        runNpmScript: (script, _args, env) => {
          if (script === 'test:release:precheck') {
            writePrecheckSummaryForEnv(env);
          }
          if (script === 'release:campaign:full') {
            campaignEnvs.push(env);
            return { status: 7, signal: null };
          }
          return { status: 0, signal: null };
        },
        sentinelRunner: () => passingSentinelResult(),
        ownerPreflight: passingOwnerPreflight,
      });

      expect(exitCode).toBe(7);
      expect(campaignEnvs).toHaveLength(1);
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
      expect(readinessValidation.state.parent_observations.services).toEqual({
        real_services_started: 'ready',
        api_web_started: 'ready',
      });
      expect(readinessValidation.state.readiness.runner_image_digest_prepared).toBe('unknown');
      expect(readinessValidation.state.readiness_identities?.runner_image_digest_prepared).toBeUndefined();
      expect(`${stdout.join('')}\n${stderr.join('')}`).not.toContain('state/readiness.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
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
            writePrecheckSummaryForEnv(env);
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
      expect(readinessValidation.state.readiness.runner_image_digest_prepared).toBe('unknown');
      expect(readinessValidation.state.readiness.local_kind_image_import_completed).toBe('unknown');
      expect(readinessValidation.state.readiness_identities?.integration_deps_ready?.values).toEqual(
        DEFAULT_RELEASE_PRECHECK_DEPS_IDENTITY,
      );
      expect(readinessValidation.state.readiness_identities?.runner_image_digest_prepared).toBeUndefined();
      expect(readinessValidation.state.readiness_identities?.local_kind_image_import_completed).toBeUndefined();
      expect(stdout.join('')).not.toContain('state/readiness.json');
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hands readiness writing to the release campaign orchestrator for same-run local-kind image import readiness', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-campaign-readiness-handoff-'));
    const fakeBin = mkdtempSync(join(tmpdir(), 'agentsmith-release-ready-campaign-readiness-bin-'));
    const logPath = join(root, 'npm.log');
    const stdout: string[] = [];
    const stderr: string[] = [];
    const campaignEnvs: NodeJS.ProcessEnv[] = [];
    const gitSha = resolveReadinessGitSha(process.cwd());
    try {
      const siteEnv = [
        'AGENTSMITH_APP_IMAGE=kind-registry:5000/mbos/agentsmith-app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'AGENTSMITH_MANAGED_RUNNER_IMAGE=kind-registry:5000/mbos/agentsmith-managed-runner@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '',
      ].join('\n');
      mkdirSync(join(root, 'unified-deploy'), { recursive: true });
      writeFileSync(join(root, 'unified-deploy', 'local-kind-site.env'), siteEnv);
      writeFakeNpm(fakeBin, `#!/usr/bin/env bash
set -euo pipefail
printf '%s|writer=%s\\n' "$*" "\${${RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV}:-}" >> "${logPath}"
if [[ "$1" == "run" && "$2" == "gate:release:full" ]]; then
  mkdir -p "\${RELEASE_CAMPAIGN_ROOT}/gate-release-full"
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
  "summary": "Release-ready handoff campaign passed.",
  "generated_at": "2026-04-25T12:00:00.000Z"
}
JSON
fi
exit 0
`);
      writeFileSync(join(fakeBin, 'kubectl'), [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'if [[ "$1" == "config" && "$2" == "current-context" ]]; then',
        '  printf "kind-agentsmith\\n"',
        '  exit 0',
        'fi',
        'if [[ "$1" == "get" && "$2" == "namespace" && "$3" == "kube-system" ]]; then',
        '  printf "cluster-uid-release-ready-campaign\\n"',
        '  exit 0',
        'fi',
        'exit 1',
        '',
      ].join('\n'));
      chmodSync(join(fakeBin, 'kubectl'), 0o755);

      const exitCode = runReleaseReady([], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          RELEASE_CAMPAIGN_ROOT: root,
        },
        gitCleanGuard: () => ({
          ok: true,
          headSha: gitSha,
        }),
        runNpmScript: (script, _args, env) => {
          if (script === 'test:release:precheck') {
            writePrecheckSummaryForEnv(env);
          }
          if (script === 'release:campaign:full') {
            campaignEnvs.push(env);
            const result = runReleaseCampaignExecution({
              campaign: {
                id: 'release-full',
                description: 'minimal release-ready readiness handoff campaign',
                runRootPattern: '<tmp>',
                steps: [
                  {
                    id: 'lane-unified-deploy-local-kind-images',
                    gateId: 'lane-unified-deploy-local-kind-images',
                    npmScript: 'lane:unified-deploy:local-kind:images',
                    command: 'npm run lane:unified-deploy:local-kind:images',
                    workflowRole: 'evidence_owner',
                    executionMode: 'execute',
                    resultRequired: false,
                    evidenceRequired: false,
                    lineKind: 'unified_deploy_local_kind_images',
                    defaultFailureClass: 'infra_setup_failure',
                    dependsOn: [],
                    evidenceHints: [],
                    evidenceChecks: [],
                  },
                  {
                    id: 'gate-release-full',
                    gateId: 'gate-release-full',
                    npmScript: 'gate:release:full',
                    command: 'npm run gate:release:full',
                    workflowRole: 'terminal_verdict',
                    executionMode: 'aggregate_only',
                    resultRequired: false,
                    evidenceRequired: false,
                    lineKind: 'release_full_verdict',
                    defaultFailureClass: 'evidence_missing',
                    dependsOn: ['lane-unified-deploy-local-kind-images'],
                    evidenceHints: [],
                    evidenceChecks: [],
                  },
                ],
              },
              campaignRoot: root,
              runId: env.RELEASE_CAMPAIGN_RUN_ID ?? 'release-ready-campaign-readiness-handoff',
              cwd: process.cwd(),
              env,
              stdio: 'pipe',
            });
            return { status: result.exitCode, signal: null };
          }
          return { status: 0, signal: null };
        },
        sentinelRunner: () => passingSentinelResult(),
        ownerPreflight: passingOwnerPreflight,
      });

      expect(exitCode).toBe(0);
      expect(campaignEnvs).toHaveLength(1);
      expect(campaignEnvs[0]?.[RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV]).toMatch(/^writer-/);
      const readinessValidation = validateRunReadinessStateForConsumer({
        statePath: campaignEnvs[0]?.[READINESS_STATE_ENV.path] ?? '',
        invocationId: campaignEnvs[0]?.[READINESS_STATE_ENV.invocationId] ?? '',
        processNonce: campaignEnvs[0]?.[READINESS_STATE_ENV.processNonce] ?? '',
        inputDigest: campaignEnvs[0]?.[READINESS_STATE_ENV.inputDigest],
        envDigest: campaignEnvs[0]?.[READINESS_STATE_ENV.envDigest],
        gitSha,
      });
      expect(readinessValidation).toMatchObject({ ok: true });
      if (!readinessValidation.ok) {
        throw new Error(readinessValidation.error);
      }
      expect(readinessValidation.state.readiness.local_kind_image_import_completed).toBe('ready');
      expect(readinessValidation.state.readiness_identities?.local_kind_image_import_completed?.values).toEqual({
        local_kind_context: 'kind-agentsmith',
        local_kind_cluster_uid: 'cluster-uid-release-ready-campaign',
        local_kind_site_env_digest: sha256(siteEnv),
      });
      const log = readFileSync(logPath, 'utf8');
      expect(log).toContain('run lane:unified-deploy:local-kind:images|writer=');
      expect(log).toContain('run gate:release:full|writer=');
      expect(log).not.toContain(campaignEnvs[0]?.[RELEASE_CAMPAIGN_ORCHESTRATOR_READINESS_WRITER_TOKEN_ENV] ?? 'writer-missing');
      expect(stderr.join('')).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
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
        runNpmScript: (script, _args, env) => {
          if (script === 'test:release:precheck') {
            writePrecheckSummaryForEnv(env);
          }
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
      expect(stdout.join('')).toContain('Status: passed');
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
          if (script === 'test:release:precheck') {
            writePrecheckSummaryForEnv(env);
          }
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
${WRITE_PRECHECK_SUMMARY_SHELL}
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
${WRITE_PRECHECK_SUMMARY_SHELL}
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
${WRITE_PRECHECK_SUMMARY_SHELL}
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
      expect(result.stdout).toContain('Status: passed');
      expect(result.stdout).toContain('Current release run passed.');
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
${WRITE_PRECHECK_SUMMARY_SHELL}
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
