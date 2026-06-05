import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

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
export const PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV =
  'AGENTSMITH_PRODUCT_READINESS_ARTIFACT_NAME' as const;
export const PRODUCT_READINESS_REPORT_ARTIFACT_URI_ENV =
  'AGENTSMITH_PRODUCT_READINESS_REPORT_ARTIFACT_URI' as const;

const PRODUCT_READINESS_REPORT_SUBJECT_NAME = 'product-readiness-report' as const;
const FILES_RESTORE_RUNTIME_READINESS_DETAILS_RELATIVE_PATH =
  'gate-release/child-internal-evidence/files_restore_continuation_spec/runtime-readiness-details.json' as const;
const RUNTIME_READINESS_DETAILS_SCHEMA_VERSION = 'agentsmith.runtime-readiness-details/v1' as const;
const RUNTIME_READINESS_THEME = 'runtime_pending_readiness' as const;

export interface ProductReadinessReferencedFile {
  id: 'product_readiness_summary' | 'terminal_result' | 'runtime_readiness_details';
  path: string;
  sha256: string;
}

export type ProductReadinessArtifactPublication =
  | {
      mode: 'ci_artifact';
      artifact_name: string;
      artifact_uri: string;
      repository: string;
      run_id: string;
      run_attempt: string;
      run_url: string;
    }
  | {
      mode: 'local_diagnostics_only';
      artifact_uri: null;
      reason: string;
    };

export type ProductReadinessArtifactProvenance = Omit<CurrentArtifactProvenance, 'artifact_uri'> & {
  artifact_uri?: string;
  run_url?: string;
};

export interface ProductReadinessLocalDiagnostics {
  path_root: string;
  output_path: string;
  release_contract_path: string;
  product_readiness_summary_path: string;
  campaign_root: string;
  terminal_result_path: string;
}

export interface ProductReadinessReportSubject {
  schema: typeof PRODUCT_READINESS_REPORT_SCHEMA_VERSION;
  status: 'pass';
  release_id: string;
  git_sha: string;
  /**
   * Compatibility alias for release_contract_file_sha256. Do not compare this
   * field with release_contract_artifact_sha256.
   */
  release_contract_digest: string;
  release_contract_file_sha256: string;
  release_contract_artifact_sha256: string;
  release_contract_artifact_uri: string;
  product_readiness_summary: {
    path: string;
    sha256: string;
  };
  campaign: {
    root: string;
    path_root: string;
    terminal_result_path: string;
    terminal_result_sha256: string;
  };
  runtime_readiness: {
    files_restore_continuation: {
      path: string;
      sha256: string;
      schema_version: typeof RUNTIME_READINESS_DETAILS_SCHEMA_VERSION;
      theme: typeof RUNTIME_READINESS_THEME;
      classification: string;
      outcome: string;
      signals_count: number;
      call_summaries_count: number;
    };
  };
  referenced_files: readonly ProductReadinessReferencedFile[];
  artifact_publication: ProductReadinessArtifactPublication;
}

export interface ProductReadinessReport extends ProductReadinessReportSubject {
  artifact_provenance: ProductReadinessArtifactProvenance;
  local_diagnostics: ProductReadinessLocalDiagnostics;
}

export interface WriteProductReadinessReportOptions {
  campaignRoot?: string;
  latestPath?: string;
  releaseContractPath?: string;
  outputPath?: string;
  pathRoot?: string;
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

function sha256FileDigest(path: string, label: string): string {
  try {
    return sha256BufferDigest(readFileSync(path));
  } catch (error) {
    throw new Error(`cannot read ${label} for sha256: ${error instanceof Error ? error.message : String(error)}`);
  }
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

function toPortableRelativePath(relativePath: string, label: string): string {
  if (
    relativePath.length === 0
    || relativePath === '..'
    || relativePath.startsWith(`..${sep}`)
    || relativePath.startsWith('../')
    || isAbsolute(relativePath)
    || relativePath.includes('\0')
  ) {
    throw new Error(`${label} must stay under --path-root.`);
  }
  return relativePath.split(sep).join('/');
}

function resolvePathRoot(summary: ReleaseSummary, options: WriteProductReadinessReportOptions): string {
  const rawPathRoot = firstNonEmptyString(options.pathRoot, summary.campaign_root);
  if (!rawPathRoot) {
    throw new Error('--path-root is required when product readiness summary has no campaign_root.');
  }
  return resolve(rawPathRoot);
}

function requireRootRelativeOutputPath(path: string, pathRoot: string, label: string): string {
  return toPortableRelativePath(relative(resolve(pathRoot), resolve(path)), label);
}

function readReferencedFile(input: {
  id: ProductReadinessReferencedFile['id'];
  label: string;
  path: string;
  pathRoot: string;
}): ProductReadinessReferencedFile {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(input.path);
  } catch (error) {
    throw new Error(`${input.label} is missing: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!stat.isFile()) {
    throw new Error(`${input.label} must be a file.`);
  }

  let realRoot: string;
  let realPath: string;
  try {
    realRoot = realpathSync(input.pathRoot);
    realPath = realpathSync(input.path);
  } catch (error) {
    throw new Error(`${input.label} cannot be resolved under --path-root: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    id: input.id,
    path: toPortableRelativePath(relative(realRoot, realPath), input.label),
    sha256: sha256FileDigest(realPath, input.label),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonRecord(path: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed;
}

function requiredStringField(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}.${field} must be a non-empty string.`);
  }
  return value;
}

function arrayCount(record: Record<string, unknown>, field: string, label: string): number {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new Error(`${label}.${field} must be an array.`);
  }
  return value.length;
}

function readRuntimeReadinessDetails(input: {
  campaignRoot: string;
  pathRoot: string;
}): {
  referencedFile: ProductReadinessReferencedFile;
  details: ProductReadinessReportSubject['runtime_readiness']['files_restore_continuation'];
} {
  const label = 'runtime_readiness.files_restore_continuation';
  const path = join(resolve(input.campaignRoot), FILES_RESTORE_RUNTIME_READINESS_DETAILS_RELATIVE_PATH);
  const referencedFile = readReferencedFile({
    id: 'runtime_readiness_details',
    label: `${label}.path`,
    path,
    pathRoot: input.pathRoot,
  });
  const payload = readJsonRecord(path, label);
  const schemaVersion = requiredStringField(payload, 'schema_version', label);
  if (schemaVersion !== RUNTIME_READINESS_DETAILS_SCHEMA_VERSION) {
    throw new Error(`${label}.schema_version must be ${RUNTIME_READINESS_DETAILS_SCHEMA_VERSION}.`);
  }
  const theme = requiredStringField(payload, 'theme', label);
  if (theme !== RUNTIME_READINESS_THEME) {
    throw new Error(`${label}.theme must be ${RUNTIME_READINESS_THEME}.`);
  }

  return {
    referencedFile,
    details: {
      path: referencedFile.path,
      sha256: referencedFile.sha256,
      schema_version: RUNTIME_READINESS_DETAILS_SCHEMA_VERSION,
      theme: RUNTIME_READINESS_THEME,
      classification: requiredStringField(payload, 'classification', label),
      outcome: requiredStringField(payload, 'outcome', label),
      signals_count: arrayCount(payload, 'signals', label),
      call_summaries_count: arrayCount(payload, 'call_summaries', label),
    },
  };
}

function requireGitHubArtifactEnv(
  env: Readonly<Record<string, string | undefined>>,
  field: string,
): string {
  const value = firstNonEmptyString(env[field]);
  if (!value) {
    throw new Error(`${PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV} requires ${field} for CI artifact provenance.`);
  }
  return value;
}

function githubActionsRunUrl(repository: string, runId: string, runAttempt: string): string {
  return `https://github.com/${repository}/actions/runs/${runId}/attempts/${runAttempt}`;
}

function buildArtifactPublication(input: {
  env: Readonly<Record<string, string | undefined>>;
  subjectUri: string;
}): ProductReadinessArtifactPublication {
  const artifactName = firstNonEmptyString(input.env[PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV]);
  const explicitArtifactUri = firstNonEmptyString(input.env[PRODUCT_READINESS_REPORT_ARTIFACT_URI_ENV]);
  if (explicitArtifactUri && !artifactName) {
    throw new Error(`${PRODUCT_READINESS_REPORT_ARTIFACT_URI_ENV} requires ${PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV}.`);
  }

  if (!artifactName) {
    return {
      mode: 'local_diagnostics_only',
      artifact_uri: null,
      reason: input.env.GITHUB_ACTIONS === 'true'
        ? `${PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV} was not set; artifact_uri omitted.`
        : 'local run; artifact_uri omitted.',
    };
  }

  if (input.env.GITHUB_ACTIONS !== 'true') {
    throw new Error(`${PRODUCT_READINESS_REPORT_ARTIFACT_NAME_ENV} requires GITHUB_ACTIONS=true.`);
  }

  const repository = requireGitHubArtifactEnv(input.env, 'GITHUB_REPOSITORY');
  if (`github.com/${repository}` !== AGENTSMITH_CANONICAL_REPO) {
    throw new Error(`GITHUB_REPOSITORY must be agentsmith-project/agentsmith for product readiness artifact provenance.`);
  }
  const runId = requireGitHubArtifactEnv(input.env, 'GITHUB_RUN_ID');
  const runAttempt = requireGitHubArtifactEnv(input.env, 'GITHUB_RUN_ATTEMPT');
  const expectedArtifactUriPrefix = `gh-artifact://${repository}/${artifactName}/${runId}/`;
  if (explicitArtifactUri && !explicitArtifactUri.startsWith(expectedArtifactUriPrefix)) {
    throw new Error(`${PRODUCT_READINESS_REPORT_ARTIFACT_URI_ENV} must start with ${expectedArtifactUriPrefix}.`);
  }
  const artifactUri = explicitArtifactUri
    ?? `gh-artifact://${repository}/${artifactName}/${runId}/${input.subjectUri}`;

  return {
    mode: 'ci_artifact',
    artifact_name: artifactName,
    artifact_uri: artifactUri,
    repository,
    run_id: runId,
    run_attempt: runAttempt,
    run_url: githubActionsRunUrl(repository, runId, runAttempt),
  };
}

function buildArtifactProvenance(input: {
  subject: ProductReadinessReportSubject;
  contract: CurrentAgentSmithReleaseContract;
  artifactPublication: ProductReadinessArtifactPublication;
  subjectUri: string;
  env: Readonly<Record<string, string | undefined>>;
  generatedAt: string;
}): ProductReadinessArtifactProvenance {
  const subjectSha256 = sha256Digest(canonicalReleaseBoundaryJson(input.subject));
  const ciFields = input.artifactPublication.mode === 'ci_artifact'
    ? {
        workflow_name: requireGitHubArtifactEnv(input.env, 'GITHUB_WORKFLOW'),
        run_id: input.artifactPublication.run_id,
        run_attempt: input.artifactPublication.run_attempt,
        run_url: input.artifactPublication.run_url,
        job: requireGitHubArtifactEnv(input.env, 'GITHUB_JOB'),
        artifact_uri: input.artifactPublication.artifact_uri,
      }
    : {};

  const provenanceWithoutArtifactSha256: Omit<ProductReadinessArtifactProvenance, 'artifact_sha256'> = {
    schema_version: CURRENT_ARTIFACT_PROVENANCE_SCHEMA_VERSION,
    provenance_kind: 'ci_artifact',
    producer_repo: AGENTSMITH_CANONICAL_REPO,
    normalized_remote: AGENTSMITH_CANONICAL_REPO,
    commit_sha: input.contract.git_sha,
    subject_name: PRODUCT_READINESS_REPORT_SUBJECT_NAME,
    subject_sha256: subjectSha256,
    subject_uri: input.subjectUri,
    ...ciFields,
    generated_at: input.generatedAt,
    generator_command: PRODUCT_READINESS_REPORT_GENERATOR_COMMAND,
    generator_version: PRODUCT_READINESS_REPORT_GENERATOR_VERSION,
    attestation: 'none',
  };

  const artifactProjection = {
    ...input.subject,
    artifact_provenance: provenanceWithoutArtifactSha256,
  };

  return {
    ...provenanceWithoutArtifactSha256,
    artifact_sha256: sha256Digest(canonicalReleaseBoundaryJson(artifactProjection)),
  };
}

function buildProductReadinessReport(input: {
  contract: CurrentAgentSmithReleaseContract;
  releaseContractFileSha256: string;
  productReadinessSummary: ProductReadinessReferencedFile;
  terminalResult: ProductReadinessReferencedFile;
  runtimeReadinessDetails: ProductReadinessReportSubject['runtime_readiness']['files_restore_continuation'];
  runtimeReadinessReferencedFile: ProductReadinessReferencedFile;
  artifactPublication: ProductReadinessArtifactPublication;
  localDiagnostics: ProductReadinessLocalDiagnostics;
  subjectUri: string;
  env: Readonly<Record<string, string | undefined>>;
  generatedAt: string;
}): ProductReadinessReport {
  const subject = buildProductReadinessReportSubject(input);
  return {
    ...subject,
    artifact_provenance: buildArtifactProvenance({
      subject,
      contract: input.contract,
      artifactPublication: input.artifactPublication,
      subjectUri: input.subjectUri,
      env: input.env,
      generatedAt: input.generatedAt,
    }),
    local_diagnostics: input.localDiagnostics,
  };
}

function buildProductReadinessReportSubject(input: {
  contract: CurrentAgentSmithReleaseContract;
  releaseContractFileSha256: string;
  productReadinessSummary: ProductReadinessReferencedFile;
  terminalResult: ProductReadinessReferencedFile;
  runtimeReadinessDetails: ProductReadinessReportSubject['runtime_readiness']['files_restore_continuation'];
  runtimeReadinessReferencedFile: ProductReadinessReferencedFile;
  artifactPublication: ProductReadinessArtifactPublication;
}): ProductReadinessReportSubject {
  return {
    schema: PRODUCT_READINESS_REPORT_SCHEMA_VERSION,
    status: 'pass',
    release_id: input.contract.release_id,
    git_sha: input.contract.git_sha,
    release_contract_digest: input.releaseContractFileSha256,
    release_contract_file_sha256: input.releaseContractFileSha256,
    release_contract_artifact_sha256: input.contract.artifact_provenance.artifact_sha256,
    release_contract_artifact_uri: input.contract.artifact_provenance.artifact_uri,
    product_readiness_summary: {
      path: input.productReadinessSummary.path,
      sha256: input.productReadinessSummary.sha256,
    },
    campaign: {
      root: '.',
      path_root: '.',
      terminal_result_path: input.terminalResult.path,
      terminal_result_sha256: input.terminalResult.sha256,
    },
    runtime_readiness: {
      files_restore_continuation: input.runtimeReadinessDetails,
    },
    referenced_files: [
      input.productReadinessSummary,
      input.terminalResult,
      input.runtimeReadinessReferencedFile,
    ],
    artifact_publication: input.artifactPublication,
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
  const pathRoot = resolvePathRoot(summary, options);
  assertReleaseCampaignRootNotSymlink(resolve(summary.campaign_root));
  assertReleaseCampaignRootNotSymlink(pathRoot, 'product readiness report path root');
  assertOutputPathWritable(outputPath);
  const { raw, contract } = readValidatedReleaseContract(releaseContractPath);
  assertReleaseContractMatchesSummary(summary, contract);

  const releaseContractFileSha256 = sha256BufferDigest(raw);
  const productReadinessSummary = readReferencedFile({
    id: 'product_readiness_summary',
    label: 'product_readiness_summary.path',
    path: summary.summary_json_path,
    pathRoot,
  });
  const terminalResult = readReferencedFile({
    id: 'terminal_result',
    label: 'campaign.terminal_result_path',
    path: summary.terminal_result_path,
    pathRoot,
  });
  const runtimeReadiness = readRuntimeReadinessDetails({
    campaignRoot: summary.campaign_root,
    pathRoot,
  });
  const subjectUri = requireRootRelativeOutputPath(outputPath, pathRoot, 'artifact_provenance.subject_uri');
  const artifactPublication = buildArtifactPublication({
    env: options.env ?? process.env,
    subjectUri,
  });
  const generatedAt = (options.now ?? (() => new Date()))().toISOString();
  const report = buildProductReadinessReport({
    contract,
    releaseContractFileSha256,
    productReadinessSummary,
    terminalResult,
    runtimeReadinessDetails: runtimeReadiness.details,
    runtimeReadinessReferencedFile: runtimeReadiness.referencedFile,
    artifactPublication,
    localDiagnostics: {
      path_root: pathRoot,
      output_path: outputPath,
      release_contract_path: releaseContractPath,
      product_readiness_summary_path: summary.summary_json_path,
      campaign_root: summary.campaign_root,
      terminal_result_path: summary.terminal_result_path,
    },
    subjectUri,
    env: options.env ?? process.env,
    generatedAt,
  });
  writeJsonAtomically(outputPath, report);
  return {
    outputPath,
    releaseContractPath,
    releaseContractDigest: releaseContractFileSha256,
    report,
  };
}

function usage(): string {
  return `Usage:
  npm run product-readiness:report -- \\
    [--campaign-root <campaign-root> | --latest-path <latest.json>] \\
    [--release-contract <agentsmith-release-contract.json>] \\
    [--path-root <artifact-root>] \\
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
    } else if (arg === '--path-root') {
      options.pathRoot = requireArgValue(argv, index);
      index += 1;
    } else if (arg.startsWith('--path-root=')) {
      options.pathRoot = arg.slice('--path-root='.length);
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
