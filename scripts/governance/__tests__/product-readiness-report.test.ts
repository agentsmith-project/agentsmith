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
import { basename, dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  AGENTSMITH_CANONICAL_REPO,
  CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
  canonicalReleaseBoundaryJson,
} from '../current-release-boundary-schema';
import { writeReleaseSummaryForCampaign } from '../release-summary';
import {
  PRODUCT_READINESS_REPORT_FILENAME,
  PRODUCT_READINESS_REPORT_GENERATOR_COMMAND,
  PRODUCT_READINESS_REPORT_GENERATOR_VERSION,
  PRODUCT_READINESS_REPORT_SCHEMA_VERSION,
  runProductReadinessReportCli,
  writeProductReadinessReport,
  type ProductReadinessReport,
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
  expect(provenance.run_id).toBe('10001');
  expect(provenance.run_attempt).toBe('1');
  expect(provenance.subject_name).toBe('product-readiness-report');
  expect(provenance.subject_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(provenance.artifact_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(provenance.artifact_uri).toBe(
    `gh-artifact://agentsmith-project/agentsmith/product-readiness/10001/${PRODUCT_READINESS_REPORT_FILENAME}`,
  );
  expect(provenance.generated_at).toBe(GENERATED_AT);
  expect(provenance.generator_command).toBe(PRODUCT_READINESS_REPORT_GENERATOR_COMMAND);
  expect(provenance.generator_version).toBe(PRODUCT_READINESS_REPORT_GENERATOR_VERSION);
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
      const reportSubject: Omit<ProductReadinessReport, 'artifact_provenance'> = {
        schema: report.schema,
        status: report.status,
        release_id: report.release_id,
        git_sha: report.git_sha,
        release_contract_digest: report.release_contract_digest,
        product_readiness_summary: report.product_readiness_summary,
        campaign: report.campaign,
      };
      expect(report).toMatchObject({
        schema: PRODUCT_READINESS_REPORT_SCHEMA_VERSION,
        status: 'pass',
        release_id: contract.release_id,
        git_sha: contract.git_sha,
        release_contract_digest: rawContractDigest,
        product_readiness_summary: {
          path: summaryPath,
          sha256: sha256Buffer(readFileSync(summaryPath)),
        },
        campaign: {
          root,
          terminal_result_path: terminalResultPath,
          terminal_result_sha256: sha256Buffer(readFileSync(terminalResultPath)),
        },
      });
      expect(report.artifact_provenance.subject_sha256)
        .toBe(sha256Text(canonicalReleaseBoundaryJson(reportSubject)));
      expect(report.release_contract_digest).not.toBe(
        (contract.artifact_provenance as Record<string, unknown>).artifact_sha256,
      );
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
        argv: ['--campaign-root', root, '--release-contract', contractPath, '--output', outputPath],
        env: {},
        now: () => new Date(GENERATED_AT),
        stdout: (message) => stdout.push(message),
        stderr: (message) => stderr.push(message),
      });

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join('\n')).toContain(`product readiness report: ${outputPath}`);
      expect(readJson<ProductReadinessReport>(outputPath).schema).toBe(PRODUCT_READINESS_REPORT_SCHEMA_VERSION);
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
