import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  AGENTSMITH_CANONICAL_REPO,
  CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
  canonicalReleaseBoundaryJson,
  sha256Digest,
  validateAgentSmithReleaseContract,
  type CurrentAgentSmithReleaseContract,
  type CurrentArtifactProvenance,
} from './current-release-boundary-schema';
import {
  AGENTSMITH_RELEASE_CONTRACT_PATH_ENV,
  readReleaseStatus,
  type ReleaseSummary,
} from './release-summary';
import {
  assertReleaseCampaignRootNotSymlink,
} from './release-campaign-io';

export const PRODUCT_READINESS_REPORT_SCHEMA_VERSION =
  'agentsmith.product-readiness-report/v1' as const;
export const PRODUCT_READINESS_REPORT_FILENAME = 'product-readiness-report.json' as const;
export const PRODUCT_READINESS_REPORT_GENERATOR_COMMAND = 'npm run product-readiness:report' as const;
export const PRODUCT_READINESS_REPORT_GENERATOR_VERSION = 'p0-product-readiness-report' as const;

const PRODUCT_READINESS_REPORT_SUBJECT_NAME = 'product-readiness-report' as const;

export interface ProductReadinessReport {
  schema: typeof PRODUCT_READINESS_REPORT_SCHEMA_VERSION;
  status: 'pass';
  release_id: string;
  git_sha: string;
  release_contract_digest: string;
  artifact_provenance: CurrentArtifactProvenance;
}

export interface WriteProductReadinessReportOptions {
  campaignRoot?: string;
  latestPath?: string;
  releaseContractPath?: string;
  outputPath?: string;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}

export interface WriteProductReadinessReportResult {
  outputPath: string;
  releaseContractPath: string;
  releaseContractDigest: string;
  report: ProductReadinessReport;
}

interface CliOptions extends WriteProductReadinessReportOptions {
  help?: boolean;
}

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function firstNonEmptyString(...values: readonly (string | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function sha256BufferDigest(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function readJsonBuffer(path: string, label: string): { raw: Buffer; value: unknown } {
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (error) {
    throw new Error(`cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    return { raw, value: JSON.parse(raw.toString('utf8')) as unknown };
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function releaseStatusFailureMessage(kind: string, error?: string): string {
  if (kind === 'missing_latest') {
    return 'product readiness latest summary is missing.';
  }
  if (kind === 'missing_summary') {
    return 'product readiness summary is missing.';
  }
  if (kind === 'malformed') {
    return `product readiness summary is malformed: ${error ?? 'unknown error'}`;
  }
  return `product readiness status is not ready: ${kind}`;
}

function requirePassedReleaseSummary(options: WriteProductReadinessReportOptions): ReleaseSummary {
  const status = readReleaseStatus({
    ...(options.campaignRoot ? { campaignRoot: options.campaignRoot } : {}),
    ...(options.latestPath ? { latestPath: options.latestPath } : {}),
  });

  if (status.kind !== 'ready') {
    throw new Error(releaseStatusFailureMessage(status.kind, 'error' in status ? status.error : undefined));
  }

  const { summary } = status;
  if (
    summary.status !== 'passed'
    || summary.product_readiness_verdict !== 'PASSED'
    || summary.failure_class !== 'none'
  ) {
    throw new Error('product readiness summary must be passed before writing product-readiness-report.json.');
  }
  if (!summary.release_contract) {
    throw new Error('product readiness summary must include release_contract before writing product-readiness-report.json.');
  }
  return summary;
}

function readValidatedReleaseContract(path: string): {
  raw: Buffer;
  contract: CurrentAgentSmithReleaseContract;
} {
  const { raw, value } = readJsonBuffer(path, 'release contract');
  const validation = validateAgentSmithReleaseContract(value);
  if (!validation.ok) {
    throw new Error([
      `release contract is invalid: ${path}`,
      ...validation.failures.map((failure) => `${failure.path}: ${failure.reason}`),
    ].join('; '));
  }
  return { raw, contract: validation.value };
}

function assertReleaseContractMatchesSummary(
  summary: ReleaseSummary,
  contract: CurrentAgentSmithReleaseContract,
): void {
  const summaryContract = summary.release_contract;
  if (!summaryContract) {
    throw new Error('product readiness summary must include release_contract.');
  }
  if (contract.release_id !== summaryContract.release_id) {
    throw new Error('release contract release_id must match product readiness summary release_contract.release_id.');
  }
  if (contract.git_sha !== summaryContract.git_sha) {
    throw new Error('release contract git_sha must match product readiness summary release_contract.git_sha.');
  }
  if (contract.artifact_provenance.artifact_sha256 !== summaryContract.digest) {
    throw new Error('release summary release_contract.digest must match release contract artifact_provenance.artifact_sha256.');
  }
  if (contract.artifact_provenance.subject_sha256 !== summaryContract.subject_digest) {
    throw new Error('release summary release_contract.subject_digest must match release contract artifact_provenance.subject_sha256.');
  }
  if (contract.artifact_provenance.commit_sha !== contract.git_sha) {
    throw new Error('release contract artifact_provenance.commit_sha must match release contract git_sha.');
  }

  const summaryProvenance = summaryContract.provenance;
  const contractProvenance = contract.artifact_provenance;
  const provenanceComparisons: Array<[string, string, string]> = [
    ['producer_repo', summaryProvenance.producer_repo, contractProvenance.producer_repo],
    ['normalized_remote', summaryProvenance.normalized_remote, contractProvenance.normalized_remote],
    ['commit_sha', summaryProvenance.commit_sha, contractProvenance.commit_sha],
    ['artifact_uri', summaryProvenance.artifact_uri, contractProvenance.artifact_uri],
    ['generated_at', summaryProvenance.generated_at, contractProvenance.generated_at],
    ['generator_version', summaryProvenance.generator_version, contractProvenance.generator_version],
  ];

  const mismatch = provenanceComparisons.find(([, left, right]) => left !== right);
  if (mismatch) {
    throw new Error(`release summary release_contract.provenance.${mismatch[0]} must match release contract artifact_provenance.${mismatch[0]}.`);
  }
}

function encodeArtifactUriSegment(value: string): string {
  return encodeURIComponent(value).replaceAll('%2F', '_');
}

function portableSubjectUri(campaignRoot: string, outputPath: string): string {
  const relativePath = relative(resolve(campaignRoot), resolve(outputPath)).split(sep).join('/');
  if (
    relativePath.length === 0
    || relativePath.startsWith('../')
    || relativePath === '..'
    || relativePath.includes('\0')
  ) {
    return `product-readiness/${PRODUCT_READINESS_REPORT_FILENAME}`;
  }
  return relativePath;
}

function buildArtifactProvenance(input: {
  summary: ReleaseSummary;
  contract: CurrentAgentSmithReleaseContract;
  releaseContractDigest: string;
  outputPath: string;
  env: Readonly<Record<string, string | undefined>>;
  generatedAt: string;
}): CurrentArtifactProvenance {
  const subject = {
    schema: PRODUCT_READINESS_REPORT_SCHEMA_VERSION,
    status: 'pass',
    release_id: input.contract.release_id,
    git_sha: input.contract.git_sha,
    release_contract_digest: input.releaseContractDigest,
  } satisfies Omit<ProductReadinessReport, 'artifact_provenance'>;
  const subjectSha256 = sha256Digest(canonicalReleaseBoundaryJson(subject));
  const runId = firstNonEmptyString(
    input.env.GITHUB_RUN_ID,
    input.contract.artifact_provenance.run_id,
    input.summary.campaign_run_id,
  ) ?? input.summary.campaign_run_id;
  const runAttempt = firstNonEmptyString(
    input.env.GITHUB_RUN_ATTEMPT,
    input.contract.artifact_provenance.run_attempt,
    '1',
  ) ?? '1';
  const artifactUri = firstNonEmptyString(
    input.env.AGENTSMITH_PRODUCT_READINESS_REPORT_ARTIFACT_URI,
  ) ?? `gh-artifact://agentsmith-project/agentsmith/product-readiness/${encodeArtifactUriSegment(runId)}/${PRODUCT_READINESS_REPORT_FILENAME}`;

  const provenanceWithoutArtifactSha256 = {
    schema_version: CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
    provenance_kind: 'ci_artifact',
    producer_repo: AGENTSMITH_CANONICAL_REPO,
    normalized_remote: AGENTSMITH_CANONICAL_REPO,
    commit_sha: input.contract.git_sha,
    subject_name: PRODUCT_READINESS_REPORT_SUBJECT_NAME,
    subject_sha256: subjectSha256,
    subject_uri: portableSubjectUri(input.summary.campaign_root, input.outputPath),
    workflow_name: firstNonEmptyString(
      input.env.GITHUB_WORKFLOW,
      input.contract.artifact_provenance.workflow_name,
      'AgentSmith Product Readiness Report',
    ) ?? 'AgentSmith Product Readiness Report',
    run_id: runId,
    run_attempt: runAttempt,
    job: firstNonEmptyString(
      input.env.GITHUB_JOB,
      input.contract.artifact_provenance.job,
      'product-readiness-report',
    ) ?? 'product-readiness-report',
    artifact_uri: artifactUri,
    generated_at: input.generatedAt,
    generator_command: PRODUCT_READINESS_REPORT_GENERATOR_COMMAND,
    generator_version: PRODUCT_READINESS_REPORT_GENERATOR_VERSION,
    attestation: 'none',
  } satisfies Omit<CurrentArtifactProvenance, 'artifact_sha256'>;

  const artifactProjection = {
    ...subject,
    artifact_provenance: provenanceWithoutArtifactSha256,
  };

  return {
    ...provenanceWithoutArtifactSha256,
    artifact_sha256: sha256Digest(canonicalReleaseBoundaryJson(artifactProjection)),
  };
}

function buildProductReadinessReport(input: {
  summary: ReleaseSummary;
  contract: CurrentAgentSmithReleaseContract;
  releaseContractDigest: string;
  outputPath: string;
  env: Readonly<Record<string, string | undefined>>;
  generatedAt: string;
}): ProductReadinessReport {
  return {
    schema: PRODUCT_READINESS_REPORT_SCHEMA_VERSION,
    status: 'pass',
    release_id: input.contract.release_id,
    git_sha: input.contract.git_sha,
    release_contract_digest: input.releaseContractDigest,
    artifact_provenance: buildArtifactProvenance(input),
  };
}

function resolveReleaseContractPath(
  summary: ReleaseSummary,
  options: WriteProductReadinessReportOptions,
): string {
  const rawPath = firstNonEmptyString(
    options.releaseContractPath,
    options.env?.[AGENTSMITH_RELEASE_CONTRACT_PATH_ENV],
    summary.release_contract?.path,
  );
  if (!rawPath) {
    throw new Error(`release contract path is required; pass --release-contract or set ${AGENTSMITH_RELEASE_CONTRACT_PATH_ENV}.`);
  }
  return resolve(rawPath);
}

function resolveOutputPath(summary: ReleaseSummary, options: WriteProductReadinessReportOptions): string {
  if (options.outputPath?.trim()) {
    return resolve(options.outputPath);
  }
  return join(resolve(summary.campaign_root), 'product-readiness', PRODUCT_READINESS_REPORT_FILENAME);
}

function assertOutputPathWritable(outputPath: string): void {
  const outputDir = dirname(outputPath);
  assertReleaseCampaignRootNotSymlink(outputDir, 'product readiness report output directory');
  if (existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()) {
    throw new Error(`product readiness report output must not be a symlink: ${outputPath}`);
  }
}

function writeJsonAtomically(outputPath: string, value: unknown): void {
  const outputDir = dirname(outputPath);
  mkdirSync(outputDir, { recursive: true });
  assertOutputPathWritable(outputPath);
  const tempPath = join(outputDir, `.${PRODUCT_READINESS_REPORT_FILENAME}.${process.pid}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tempPath, outputPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function writeProductReadinessReport(
  options: WriteProductReadinessReportOptions = {},
): WriteProductReadinessReportResult {
  const summary = requirePassedReleaseSummary(options);
  const releaseContractPath = resolveReleaseContractPath(summary, options);
  const outputPath = resolveOutputPath(summary, options);
  assertReleaseCampaignRootNotSymlink(resolve(summary.campaign_root));
  assertOutputPathWritable(outputPath);
  const { raw, contract } = readValidatedReleaseContract(releaseContractPath);
  assertReleaseContractMatchesSummary(summary, contract);

  const releaseContractDigest = sha256BufferDigest(raw);
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const report = buildProductReadinessReport({
    summary,
    contract,
    releaseContractDigest,
    outputPath,
    env: options.env ?? process.env,
    generatedAt,
  });
  writeJsonAtomically(outputPath, report);
  return {
    outputPath,
    releaseContractPath,
    releaseContractDigest,
    report,
  };
}

function usage(): string {
  return `Usage:
  npm run product-readiness:report -- \\
    [--campaign-root <campaign-root> | --latest-path <latest.json>] \\
    [--release-contract <agentsmith-release-contract.json>] \\
    [--output <product-readiness-report.json>]

Converts an already-passed AgentSmith product readiness summary into the
canonical product-readiness-report.json consumed by release-kit GA aggregate.`;
}

function requireArgValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${argv[index]}.`);
  }
  return value;
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--campaign-root') {
      options.campaignRoot = requireArgValue(argv, index);
      index += 1;
    } else if (arg.startsWith('--campaign-root=')) {
      options.campaignRoot = arg.slice('--campaign-root='.length);
    } else if (arg === '--latest-path') {
      options.latestPath = requireArgValue(argv, index);
      index += 1;
    } else if (arg.startsWith('--latest-path=')) {
      options.latestPath = arg.slice('--latest-path='.length);
    } else if (arg === '--release-contract') {
      options.releaseContractPath = requireArgValue(argv, index);
      index += 1;
    } else if (arg.startsWith('--release-contract=')) {
      options.releaseContractPath = arg.slice('--release-contract='.length);
    } else if (arg === '--output') {
      options.outputPath = requireArgValue(argv, index);
      index += 1;
    } else if (arg.startsWith('--output=')) {
      options.outputPath = arg.slice('--output='.length);
    } else {
      throw new Error(`unknown product readiness report argument: ${arg}`);
    }
  }
  return options;
}

export function runProductReadinessReportCli(
  options: {
    argv?: readonly string[];
    env?: Readonly<Record<string, string | undefined>>;
    stdout?: (message: string) => void;
    stderr?: (message: string) => void;
    now?: () => Date;
  } = {},
): number {
  const stdout = options.stdout ?? ((message: string) => console.log(message));
  const stderr = options.stderr ?? ((message: string) => console.error(message));
  try {
    const parsed = parseCliArgs(options.argv ?? process.argv.slice(2));
    if (parsed.help) {
      stdout(usage());
      return 0;
    }
    const result = writeProductReadinessReport({
      ...parsed,
      env: options.env ?? process.env,
      now: options.now,
    });
    stdout(`product readiness report: ${result.outputPath}`);
    stdout(`release contract digest: ${result.releaseContractDigest}`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (isCliEntrypoint('product-readiness-report.ts')) {
  process.exit(runProductReadinessReportCli());
}
