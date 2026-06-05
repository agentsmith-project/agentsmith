import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  AGENTSMITH_CANONICAL_REPO,
  CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
  canonicalReleaseBoundaryJson,
} from '../current-release-boundary-schema';
import { writeReleaseSummaryForCampaign } from '../release-summary';
import {
  PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV,
  PRODUCT_READINESS_REPORT_FILENAME,
  PRODUCT_READINESS_REPORT_GENERATOR_COMMAND,
  PRODUCT_READINESS_REPORT_GENERATOR_VERSION,
  PRODUCT_READINESS_REPORT_SCHEMA_VERSION,
  runProductReadinessReportCli,
  writeProductReadinessReport,
  type ProductReadinessReport,
  type ProductReadinessReportSubject,
} from '../product-readiness-report';

const VALID_RELEASE_CONTRACT_FIXTURE =
  'scripts/governance/__fixtures__/release-boundary/release-contract.valid.json';
const VALID_TEST_GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const GENERATED_AT = '2026-06-01T12:00:00.000Z';

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function sha256Buffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function sha256Text(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function writeTerminalResult(
  campaignRoot: string,
  overrides: Partial<{ status: string; failure_class: string; summary: string }> = {},
): void {
  writeJson(join(campaignRoot, 'gate-release-full', 'result.json'), {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: 'gate-release-full',
    gate_adapter: {
      npm_script: 'gate:release:full',
      ci_job: null,
    },
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: 'aggregate',
    line_kind: 'release_full_verdict',
    evidence_dir: join(campaignRoot, 'gate-release-full'),
    summary: overrides.summary ?? 'Release-full campaign evidence passed aggregate verification.',
    generated_at: '2026-04-25T12:00:00.000Z',
  });
}

function writeRuntimeReadinessDetails(
  campaignRoot: string,
  overrides: Record<string, unknown> = {},
): string {
  const path = join(
    campaignRoot,
    'gate-release',
    'child-internal-evidence',
    'files_restore_continuation_spec',
    'runtime-readiness-details.json',
  );
  writeJson(path, {
    schema_version: 'agentsmith.runtime-readiness-details/v1',
    theme: 'runtime_pending_readiness',
    classification: 'runtime_flake',
    outcome: 'focused_gate_passed_after_runtime_readiness_marker',
    signals: [
      { source: 'api', error_code: 'AGENT_SANDBOX_UNAVAILABLE' },
      { source: 'pod_manager', error_code: 'AGENT_SANDBOX_UNAVAILABLE' },
      { source: 'asbcp_create_status', error_code: 'AGENT_SANDBOX_UNAVAILABLE' },
    ],
    call_summaries: [
      { source: 'api', error_code: 'AGENT_SANDBOX_UNAVAILABLE' },
      { source: 'pod_manager', error_code: 'AGENT_SANDBOX_UNAVAILABLE' },
      { source: 'asbcp_create_status', error_code: 'AGENT_SANDBOX_UNAVAILABLE' },
    ],
    k8s_pods: [],
    ...overrides,
  });
  return path;
}

function readValidReleaseContractFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(VALID_RELEASE_CONTRACT_FIXTURE, 'utf8')) as Record<string, unknown>;
}

function writeReleaseContractFixture(
  path: string,
  mutate?: (contract: Record<string, unknown>) => void,
): Record<string, unknown> {
  const contract = structuredClone(readValidReleaseContractFixture());
  mutate?.(contract);
  writeJson(path, contract);
  return contract;
}

function rehashReleaseContractProjection(contract: Record<string, unknown>): void {
  const projection = structuredClone(contract);
  const projectionProvenance = projection.artifact_provenance as Record<string, unknown>;
  delete projectionProvenance.artifact_sha256;
  (contract.artifact_provenance as Record<string, unknown>).artifact_sha256 =
    sha256Text(canonicalReleaseBoundaryJson(projection));
}

function preparePassedCampaign(rootPrefix = 'agentsmith-product-readiness-report-'): {
  root: string;
  latestPath: string;
  contractPath: string;
  contract: Record<string, unknown>;
} {
  const root = mkdtempSync(join(tmpdir(), rootPrefix));
  const latestPath = join(root, 'latest.json');
  const contractPath = join(root, 'inputs', 'agentsmith-release-contract.json');
  writeTerminalResult(root);
  writeRuntimeReadinessDetails(root);
  const contract = writeReleaseContractFixture(contractPath);
  writeReleaseSummaryForCampaign({
    campaignRoot: root,
    latestPath,
    releaseContractPath: contractPath,
    resolveGitSha: () => VALID_TEST_GIT_SHA,
  });
  return { root, latestPath, contractPath, contract };
}

function expectReleaseKitProductProvenanceShape(
  report: ProductReadinessReport,
  contract: Record<string, unknown>,
): void {
  const provenance = report.artifact_provenance;
  expect(provenance.schema_version).toBe(CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION);
  expect(provenance.provenance_kind).toBe('ci_artifact');
  expect(provenance.producer_repo).toBe(AGENTSMITH_CANONICAL_REPO);
  expect(provenance.normalized_remote).toBe(AGENTSMITH_CANONICAL_REPO);
  expect(provenance.commit_sha).toBe(contract.git_sha);
  expect(provenance.subject_name).toBe('product-readiness-report');
  expect(provenance.subject_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(provenance.subject_uri).toBe(report.artifact_provenance.subject_uri);
  expect(provenance.artifact_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(provenance.generated_at).toBe(GENERATED_AT);
  expect(provenance.generator_command).toBe(PRODUCT_READINESS_REPORT_GENERATOR_COMMAND);
  expect(provenance.generator_version).toBe(PRODUCT_READINESS_REPORT_GENERATOR_VERSION);
}

function reportSubject(report: ProductReadinessReport): ProductReadinessReportSubject {
  const {
    artifact_provenance: _artifactProvenance,
    local_diagnostics: _localDiagnostics,
    ...subject
  } = report;
  return subject;
}

function collectAbsoluteStrings(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') {
    return isAbsolute(value) ? [`${path}=${value}`] : [];
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectAbsoluteStrings(item, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, item]) => collectAbsoluteStrings(item, `${path}.${key}`));
}

function githubArtifactEnv(overrides: Readonly<Record<string, string | undefined>> = {}): Record<string, string | undefined> {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'agentsmith-project/agentsmith',
    GITHUB_RUN_ID: '10001',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW: 'AgentSmith Product Readiness Artifact',
    GITHUB_JOB: 'product-readiness',
    [PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV]: 'agentsmith-product-readiness',
    ...overrides,
  };
}

describe('product readiness report producer', () => {
  it('writes a release-kit canonical report from a passed product readiness summary', () => {
    const { root, contractPath, contract } = preparePassedCampaign();
    try {
      const rawContractDigest = sha256Buffer(readFileSync(contractPath));
      const result = writeProductReadinessReport({
        campaignRoot: root,
        env: {},
        now: () => new Date(GENERATED_AT),
      });
      const defaultOutputPath = join(root, 'product-readiness', PRODUCT_READINESS_REPORT_FILENAME);

      expect(result.outputPath).toBe(defaultOutputPath);
      expect(result.releaseContractPath).toBe(contractPath);
      expect(result.releaseContractDigest).toBe(rawContractDigest);
      expect(existsSync(defaultOutputPath)).toBe(true);

      const report = readJson<ProductReadinessReport>(defaultOutputPath);
      const summaryPath = join(root, 'summary.json');
      const terminalResultPath = join(root, 'gate-release-full', 'result.json');
      const runtimeDetailsPath = join(
        root,
        'gate-release',
        'child-internal-evidence',
        'files_restore_continuation_spec',
        'runtime-readiness-details.json',
      );
      const subject = reportSubject(report);
      expect(report).toMatchObject({
        schema: PRODUCT_READINESS_REPORT_SCHEMA_VERSION,
        status: 'pass',
        release_id: contract.release_id,
        git_sha: contract.git_sha,
        release_contract_digest: rawContractDigest,
        release_contract_file_sha256: rawContractDigest,
        release_contract_artifact_sha256: (contract.artifact_provenance as Record<string, unknown>).artifact_sha256,
        release_contract_artifact_uri: (contract.artifact_provenance as Record<string, unknown>).artifact_uri,
        product_readiness_summary: {
          path: 'summary.json',
          sha256: sha256Buffer(readFileSync(summaryPath)),
        },
        campaign: {
          root: '.',
          path_root: '.',
          terminal_result_path: 'gate-release-full/result.json',
          terminal_result_sha256: sha256Buffer(readFileSync(terminalResultPath)),
        },
        runtime_readiness: {
          observation_policy: {
            step_id: 'gate-release',
            gate_id: 'gate-release',
            theme: 'runtime_pending_readiness',
            backoff: 'increasing_after_consecutive_non_terminal',
            interval_ms: [60_000, 90_000, 120_000, 180_000, 300_000],
            evidence_focus: [
              'Files restore continuation focused backend-real gate',
              'AGENT_SANDBOX_UNAVAILABLE API/pod-manager/ASBCP summaries',
              'runtime flake versus stability blocker classification',
            ],
            state_convergence: {
              files: {
                pending: expect.stringContaining('file_library_list_pending'),
                releasing: expect.stringContaining('workspace binding release convergence'),
                offline: expect.stringContaining('no active writer'),
                not_found: expect.stringContaining('no active writer'),
              },
              agent_task_sandbox: {
                pending: expect.stringContaining('bounded ASBCP status checks'),
                releasing: expect.stringContaining('release-incomplete'),
                offline: expect.stringContaining('ASBCP create-or-ensure'),
                not_found: expect.stringContaining('ASBCP create-or-ensure'),
              },
              afscp_workspace_binding: {
                pending: expect.stringContaining('workspace binding owner'),
                releasing: expect.stringContaining('terminal released/revoked/expired/deleted'),
                offline: expect.stringContaining('no active writer'),
                not_found: expect.stringContaining('no active writer'),
              },
              read_export: {
                pending: expect.stringContaining('typed pending'),
                releasing: expect.stringContaining('runtime release fence'),
                offline: expect.stringContaining('no active writer'),
                not_found: expect.stringContaining('fresh read export'),
              },
            },
          },
          files_restore_continuation: {
            path: 'gate-release/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json',
            sha256: sha256Buffer(readFileSync(runtimeDetailsPath)),
            schema_version: 'agentsmith.runtime-readiness-details/v1',
            theme: 'runtime_pending_readiness',
            classification: 'runtime_flake',
            outcome: 'focused_gate_passed_after_runtime_readiness_marker',
            signals_count: 3,
            call_summaries_count: 3,
          },
        },
        referenced_files: [
          {
            id: 'product_readiness_summary',
            path: 'summary.json',
            sha256: sha256Buffer(readFileSync(summaryPath)),
          },
          {
            id: 'terminal_result',
            path: 'gate-release-full/result.json',
            sha256: sha256Buffer(readFileSync(terminalResultPath)),
          },
          {
            id: 'runtime_readiness_details',
            path: 'gate-release/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json',
            sha256: sha256Buffer(readFileSync(runtimeDetailsPath)),
          },
        ],
        artifact_publication: {
          mode: 'local_diagnostics_only',
          artifact_uri: null,
          reason: 'local run; artifact_uri omitted.',
        },
        local_diagnostics: {
          path_root: root,
          output_path: defaultOutputPath,
          release_contract_path: contractPath,
          product_readiness_summary_path: summaryPath,
          campaign_root: root,
          terminal_result_path: terminalResultPath,
        },
      });
      expect(collectAbsoluteStrings(subject)).toEqual([]);
      expect(report.artifact_provenance.subject_sha256)
        .toBe(sha256Text(canonicalReleaseBoundaryJson(subject)));
      expect(report.artifact_provenance.subject_uri).toBe(`product-readiness/${PRODUCT_READINESS_REPORT_FILENAME}`);
      expect(report.artifact_provenance).not.toHaveProperty('artifact_uri');
      expect(report.release_contract_digest).toBe(report.release_contract_file_sha256);
      expect(report.release_contract_file_sha256).not.toBe(report.release_contract_artifact_sha256);
      expectReleaseKitProductProvenanceShape(report, contract);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('supports the CLI with an explicit output path', () => {
    const { root, contractPath } = preparePassedCampaign('agentsmith-product-readiness-report-cli-');
    const outputPath = join(root, 'handoff', PRODUCT_READINESS_REPORT_FILENAME);
    const stdout: string[] = [];
    const stderr: string[] = [];
    try {
      const exitCode = runProductReadinessReportCli({
        argv: ['--campaign-root', root, '--release-contract', contractPath, '--path-root', root, '--output', outputPath],
        env: {},
        now: () => new Date(GENERATED_AT),
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join('\n')).toContain(`product readiness report: ${outputPath}`);
      const report = readJson<ProductReadinessReport>(outputPath);
      expect(report.schema).toBe(PRODUCT_READINESS_REPORT_SCHEMA_VERSION);
      expect(report.artifact_provenance.subject_uri).toBe(`handoff/${PRODUCT_READINESS_REPORT_FILENAME}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('adds artifact_uri only when the CI artifact upload binding is present', () => {
    const { root, contractPath, contract } = preparePassedCampaign('agentsmith-product-readiness-report-ci-');
    try {
      const result = writeProductReadinessReport({
        campaignRoot: root,
        env: githubArtifactEnv(),
        now: () => new Date(GENERATED_AT),
      });
      const report = readJson<ProductReadinessReport>(result.outputPath);

      expect(report.artifact_publication).toEqual({
        mode: 'ci_artifact',
        artifact_name: 'agentsmith-product-readiness',
        artifact_uri:
          `gh-artifact://agentsmith-project/agentsmith/agentsmith-product-readiness/10001/product-readiness/${PRODUCT_READINESS_REPORT_FILENAME}`,
        repository: 'agentsmith-project/agentsmith',
        run_id: '10001',
        run_attempt: '1',
        run_url: 'https://github.com/agentsmith-project/agentsmith/actions/runs/10001/attempts/1',
      });
      expect(report.artifact_provenance).toMatchObject({
        workflow_name: 'AgentSmith Product Readiness Artifact',
        run_id: '10001',
        run_attempt: '1',
        run_url: 'https://github.com/agentsmith-project/agentsmith/actions/runs/10001/attempts/1',
        job: 'product-readiness',
        artifact_uri:
          `gh-artifact://agentsmith-project/agentsmith/agentsmith-product-readiness/10001/product-readiness/${PRODUCT_READINESS_REPORT_FILENAME}`,
      });
      expect(report.artifact_provenance.subject_uri).toBe(`product-readiness/${PRODUCT_READINESS_REPORT_FILENAME}`);
      expectReleaseKitProductProvenanceShape(report, contract);
      expect(contractPath).toContain('agentsmith-release-contract.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when CI artifact binding is incomplete', () => {
    const { root } = preparePassedCampaign('agentsmith-product-readiness-report-ci-missing-run-');
    try {
      expect(() => writeProductReadinessReport({
        campaignRoot: root,
        env: githubArtifactEnv({ GITHUB_RUN_ID: undefined }),
      })).toThrow(/requires GITHUB_RUN_ID/u);
      expect(existsSync(join(root, 'product-readiness', PRODUCT_READINESS_REPORT_FILENAME))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when a referenced handoff file escapes --path-root', () => {
    const { root } = preparePassedCampaign('agentsmith-product-readiness-report-escape-');
    const narrowPathRoot = join(root, 'product-readiness');
    try {
      mkdirSync(narrowPathRoot, { recursive: true });

      expect(() => writeProductReadinessReport({ campaignRoot: root, pathRoot: narrowPathRoot }))
        .toThrow(/product_readiness_summary\.path must stay under --path-root/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when a referenced handoff file is missing', () => {
    const { root } = preparePassedCampaign('agentsmith-product-readiness-report-missing-ref-');
    try {
      rmSync(join(root, 'gate-release-full', 'result.json'));

      expect(() => writeProductReadinessReport({ campaignRoot: root }))
        .toThrow(/campaign terminal result is missing or malformed/u);
      expect(existsSync(join(root, 'product-readiness', PRODUCT_READINESS_REPORT_FILENAME))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when runtime readiness evidence is mislabeled as a clean pass', () => {
    const { root } = preparePassedCampaign('agentsmith-product-readiness-report-runtime-clean-mismatch-');
    try {
      writeRuntimeReadinessDetails(root, {
        classification: 'clean_pass',
        outcome: 'focused_gate_passed',
      });

      expect(() => writeProductReadinessReport({ campaignRoot: root }))
        .toThrow(/classification clean_pass must not include runtime readiness signals/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when runtime flake evidence drops owner call summary coverage', () => {
    const { root } = preparePassedCampaign('agentsmith-product-readiness-report-runtime-flake-incomplete-');
    try {
      writeRuntimeReadinessDetails(root, {
        call_summaries: [
          { source: 'api', error_code: 'AGENT_SANDBOX_UNAVAILABLE' },
        ],
      });

      expect(() => writeProductReadinessReport({ campaignRoot: root }))
        .toThrow(/classification runtime_flake must cover API, pod-manager, and ASBCP call summaries/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when the product readiness summary did not pass', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-product-readiness-report-failed-'));
    const contractPath = join(root, 'inputs', 'agentsmith-release-contract.json');
    try {
      writeTerminalResult(root, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-release did not pass.',
      });
      writeReleaseContractFixture(contractPath);
      writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath: join(root, 'latest.json'),
        releaseContractPath: contractPath,
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      expect(() => writeProductReadinessReport({ campaignRoot: root }))
        .toThrow('product readiness summary must be passed');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when the summary has no release contract', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-product-readiness-report-no-contract-'));
    try {
      writeTerminalResult(root);
      writeReleaseSummaryForCampaign({
        campaignRoot: root,
        latestPath: join(root, 'latest.json'),
        resolveGitSha: () => VALID_TEST_GIT_SHA,
      });

      expect(() => writeProductReadinessReport({ campaignRoot: root }))
        .toThrow('product readiness summary must include release_contract');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when the release contract content drifts after the summary was produced', () => {
    const { root, contractPath } = preparePassedCampaign('agentsmith-product-readiness-report-drift-');
    try {
      const driftedContract = readJson<Record<string, unknown>>(contractPath);
      const provenance = driftedContract.artifact_provenance as Record<string, unknown>;
      provenance.artifact_uri = 'gh-artifact://agentsmith/release-contract/10002/release-contract.json';
      rehashReleaseContractProjection(driftedContract);
      writeJson(contractPath, driftedContract);

      expect(() => writeProductReadinessReport({ campaignRoot: root }))
        .toThrow('release summary release_contract.digest must match release contract artifact_provenance.artifact_sha256');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails fast when the release contract git sha does not match the summary', () => {
    const { root, contractPath } = preparePassedCampaign('agentsmith-product-readiness-report-sha-drift-');
    const replacementPath = join(root, 'inputs', 'agentsmith-release-contract-other.json');
    try {
      writeReleaseContractFixture(replacementPath, (contract) => {
        contract.git_sha = 'abcdef0123456789abcdef0123456789abcdef01';
      });

      expect(() => writeProductReadinessReport({
        campaignRoot: root,
        releaseContractPath: replacementPath,
      })).toThrow(/release contract is invalid|release contract git_sha must match/u);
      expect(existsSync(join(root, 'product-readiness', PRODUCT_READINESS_REPORT_FILENAME))).toBe(false);
      expect(basename(contractPath)).toBe('agentsmith-release-contract.json');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
