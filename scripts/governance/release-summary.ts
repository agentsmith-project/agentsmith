import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import {
  AGENTSMITH_CANONICAL_REPO,
  CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION,
  validateAgentSmithReleaseContract,
  type CurrentAgentSmithReleaseContract,
  type CurrentArtifactProvenance,
} from './current-release-boundary-schema';
import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import {
  assertReleaseCampaignRootNotSymlink,
} from './release-campaign-io';
import {
  PRODUCT_READY_COMMAND,
  PRODUCT_STATUS_COMMAND,
  PRODUCT_STATUS_READ_ONLY_MESSAGE,
} from './product-readiness-entrypoints';
import {
  RELEASE_DEPLOY_CHECK_SNAPSHOT_SCHEMA,
  RELEASE_HUMAN_LOG_NOTE,
  renderHumanReleaseStageLabel,
  renderHumanReleaseStepLabel,
  renderHumanReleaseText,
  renderShortFailureProjection,
} from './status-projection';
import { redactSensitiveText } from './redaction';

export type ProductReadinessVerdict = 'PASSED' | 'FAILED';

export const AGENTSMITH_RELEASE_CONTRACT_PATH_ENV = 'AGENTSMITH_RELEASE_CONTRACT_PATH';

export interface ReleaseContractProvenanceSummary {
  producer_repo: string;
  normalized_remote: string;
  commit_sha: string;
  artifact_uri: string;
  generated_at: string;
  generator_version: string;
}

export interface ReleaseContractSummary {
  schema: typeof CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION;
  path: string;
  digest: string;
  subject_digest: string;
  release_id: string;
  git_sha: string;
  provenance: ReleaseContractProvenanceSummary;
}

export interface ReleaseSummary {
  schema: 'agentsmith_release_summary/v1';
  campaign_id: 'release-full';
  campaign_run_id: string;
  campaign_root: string;
  product_readiness_verdict: ProductReadinessVerdict;
  status: CurrentGateResultStatus;
  failure_class: CurrentGateResultFailureClass;
  stage: string;
  blocked_step: string | null;
  why: string;
  next_action: string;
  terminal_result_path: string;
  summary_json_path: string;
  summary_md_path: string;
  evidence_package: string;
  manual_operator_signoff: 'not_covered';
  release_contract?: ReleaseContractSummary;
  run_observability?: ReleaseRunObservability;
  generated_at: string;
}

export interface ReleaseRunObservabilityCounts {
  real_service_start_count: number;
  api_web_start_count: number;
  backend_real_check_session_count: number;
  image_import_count: number;
}

export interface ReleaseRunSlowStage {
  id: string;
  label: string;
  duration_ms: number;
  status: string;
}

export type ReleasePollRetryCoverage =
  | 'not_covered'
  | 'runtime_pending_readiness_adaptive_wait';

export interface ReleaseRunObservability {
  total_duration_ms: number | null;
  top_slow_stages: readonly ReleaseRunSlowStage[];
  counts_source: 'parent_flow';
  counts: ReleaseRunObservabilityCounts;
  poll_retry_coverage: ReleasePollRetryCoverage;
  report_size_bytes: number;
}

export interface ReleaseSummaryStageObservationInput {
  id: string;
  label?: string;
  durationMs: number;
  status?: string;
}

export interface ReleaseSummaryObservabilityInput {
  totalDurationMs?: number | null;
  stages?: readonly ReleaseSummaryStageObservationInput[];
  counts?: Partial<ReleaseRunObservabilityCounts>;
  reportSizeBytes?: number;
}

export interface ReleaseLatestPointer {
  schema: 'agentsmith_release_latest/v1';
  campaign_id: 'release-full';
  campaign_run_id: string;
  campaign_root: string;
  git_sha: string;
  summary_json?: string;
  summary_md?: string;
  terminal_result_path?: string;
  /**
   * When this read-only latest pointer was generated. New writes keep
   * updated_at as a compatibility alias, but readers must not use it as a
   * replacement for generated_at.
   */
  generated_at: string;
  updated_at?: string;
}

export type ReleaseStatusRead =
  | { kind: 'ready'; latestPath: string; summary: ReleaseSummary; latest?: ReleaseLatestPointer }
  | { kind: 'missing_latest'; latestPath: string }
  | { kind: 'missing_summary'; latestPath: string; summaryPath: string }
  | { kind: 'malformed'; latestPath: string; error: string };

const RELEASE_LATEST_POINTER_KEYS = new Set([
  'schema',
  'campaign_id',
  'campaign_run_id',
  'campaign_root',
  'git_sha',
  'summary_json',
  'summary_md',
  'terminal_result_path',
  'generated_at',
  'updated_at',
]);

const GIT_COMMIT_HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

interface ParsedTerminalResult {
  schema_version?: unknown;
  gate_id?: unknown;
  gate_adapter?: unknown;
  status?: unknown;
  failure_class?: unknown;
  stage?: unknown;
  line_kind?: unknown;
  evidence_dir?: unknown;
  summary?: unknown;
  generated_at?: unknown;
}

export interface WriteReleaseSummaryOptions {
  campaignRoot: string;
  latestPath?: string;
  writeLatest?: boolean;
  releaseContractPath?: string;
  resolveGitSha?: () => string;
  observability?: ReleaseSummaryObservabilityInput;
}

export interface ReadReleaseStatusOptions {
  latestPath?: string;
  campaignRoot?: string;
}

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function defaultLatestPath(): string {
  return resolve('artifacts', 'release-runs', 'latest.json');
}

export function isDefaultReleaseRunsCampaignRoot(campaignRoot: string): boolean {
  const releaseRunsRoot = resolve('artifacts', 'release-runs');
  const resolvedCampaignRoot = resolve(campaignRoot);
  return resolvedCampaignRoot === releaseRunsRoot || resolvedCampaignRoot.startsWith(`${releaseRunsRoot}/`);
}

function terminalResultPath(campaignRoot: string): string {
  return join(resolve(campaignRoot), 'gate-release-full', 'result.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function defaultReleaseRunObservabilityCounts(): ReleaseRunObservabilityCounts {
  return {
    real_service_start_count: 0,
    api_web_start_count: 0,
    backend_real_check_session_count: 0,
    image_import_count: 0,
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function sanitizeObservabilityText(value: string): string {
  return redactSensitiveText(value).slice(0, 160);
}

function normalizeObservationCount(value: unknown): number | undefined {
  const parsed = nonNegativeInteger(value);
  return parsed === null ? undefined : parsed;
}

function readReadinessParentCounts(campaignRoot: string): Partial<ReleaseRunObservabilityCounts> {
  const path = join(campaignRoot, 'state', 'readiness.json');
  if (!existsSync(path)) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = readJson(path);
  } catch {
    return {};
  }
  if (!isRecord(parsed) || !isRecord(parsed.parent_observations) || !isRecord(parsed.parent_observations.counts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(defaultReleaseRunObservabilityCounts())
      .map(([field]) => [field, normalizeObservationCount(parsed.parent_observations.counts[field])])
      .filter((entry): entry is [string, number] => entry[1] !== undefined),
  );
}

function listFilesForSize(root: string): readonly string[] {
  if (!existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const visit = (path: string): void => {
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(path);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      return;
    }
    if (stat.isFile()) {
      files.push(path);
      return;
    }
    if (!stat.isDirectory()) {
      return;
    }
    for (const entry of readdirSync(path)) {
      visit(join(path, entry));
    }
  };
  visit(root);
  return files;
}

function reportSizeBytes(root: string): number {
  return listFilesForSize(root).reduce((sum, path) => {
    try {
      return sum + lstatSync(path).size;
    } catch {
      return sum;
    }
  }, 0);
}

function normalizeReleaseRunObservability(input: {
  campaignRoot: string;
  observability?: ReleaseSummaryObservabilityInput;
  reportSizeBytes?: number;
}): ReleaseRunObservability {
  const readinessCounts = readReadinessParentCounts(input.campaignRoot);
  const suppliedCounts = input.observability?.counts ?? {};
  const counts = {
    ...defaultReleaseRunObservabilityCounts(),
    ...readinessCounts,
    ...Object.fromEntries(
      Object.entries(suppliedCounts)
        .map(([field, value]) => [field, normalizeObservationCount(value)])
        .filter((entry): entry is [string, number] => entry[1] !== undefined),
    ),
  };

  const topSlowStages = (input.observability?.stages ?? [])
    .filter((stage) => nonNegativeInteger(stage.durationMs) !== null)
    .map((stage) => ({
      id: sanitizeObservabilityText(stage.id),
      label: sanitizeObservabilityText(stage.label ?? stage.id),
      duration_ms: stage.durationMs,
      status: sanitizeObservabilityText(stage.status ?? 'unknown'),
    }))
    .sort((left, right) => right.duration_ms - left.duration_ms)
    .slice(0, 3);

  const totalDuration = input.observability?.totalDurationMs ?? null;
  return {
    total_duration_ms: totalDuration === null ? null : nonNegativeInteger(totalDuration),
    top_slow_stages: topSlowStages,
    counts_source: 'parent_flow',
    counts,
    poll_retry_coverage: 'runtime_pending_readiness_adaptive_wait',
    report_size_bytes: input.reportSizeBytes ?? input.observability?.reportSizeBytes ?? 0,
  };
}

function formatDuration(ms: number | null): string {
  if (ms === null) {
    return '<unknown>';
  }
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function renderReleaseObservabilityLines(observability?: ReleaseRunObservability): readonly string[] {
  if (!observability) {
    return [];
  }
  const slowStages = observability.top_slow_stages.length > 0
    ? observability.top_slow_stages
      .map((stage) => `${renderHumanReleaseText(stage.label || renderHumanReleaseStepLabel(stage.id))} ${formatDuration(stage.duration_ms)}`)
      .join('; ')
    : '<none>';
  return [
    `Total duration: ${formatDuration(observability.total_duration_ms)}`,
    `Slowest steps: ${slowStages}`,
    `Real service starts: ${observability.counts.real_service_start_count}`,
    `API/Web starts: ${observability.counts.api_web_start_count}`,
    `Backend real sessions: ${observability.counts.backend_real_check_session_count}`,
    `Image imports: ${observability.counts.image_import_count}`,
    `Poll/retry coverage: ${renderPollRetryCoverage(observability.poll_retry_coverage)}`,
    `Report size: ${observability.report_size_bytes} bytes`,
  ];
}

function renderPollRetryCoverage(value: ReleasePollRetryCoverage): string {
  if (value === 'runtime_pending_readiness_adaptive_wait') {
    return 'runtime pending/readiness adaptive wait';
  }
  return 'not covered';
}

function renderReleaseContractReference(contract?: ReleaseContractSummary): string | null {
  if (!contract) {
    return null;
  }
  const shortDigest = contract.digest.length > 22 ? `${contract.digest.slice(0, 19)}...` : contract.digest;
  return `${contract.release_id} ${shortDigest} (${basename(contract.path.replaceAll('\\', '/'))})`;
}

export function resolveCurrentGitSha(cwd = process.cwd()): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd,
    encoding: 'utf8',
  });
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (result.status !== 0 || stdout.length === 0) {
    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    throw new Error(`Unable to resolve current git sha${stderr ? `: ${stderr}` : '.'}`);
  }
  return stdout;
}

function requireNonEmptyStringField(record: Record<string, unknown>, field: string, label: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must include ${field}.`);
  }
  return value;
}

function requireOptionalStringField(record: Record<string, unknown>, field: string, label: string): void {
  const value = record[field];
  if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0)) {
    throw new Error(`${label} ${field} must be a non-empty string when present.`);
  }
}

function assertAllowedFields(record: Record<string, unknown>, allowedFields: ReadonlySet<string>, label: string): void {
  const unexpectedField = Object.keys(record).find((field) => !allowedFields.has(field));
  if (unexpectedField) {
    throw new Error(`${label} has unexpected field: ${unexpectedField}.`);
  }
}

function requireGitCommitHash(record: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonEmptyStringField(record, field, label);
  if (!GIT_COMMIT_HASH_PATTERN.test(value)) {
    throw new Error(`${label} ${field} must be a 40 or 64 character hex git commit hash.`);
  }
  return value;
}

function requireSha256Digest(record: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonEmptyStringField(record, field, label);
  if (!SHA256_DIGEST_PATTERN.test(value)) {
    throw new Error(`${label} ${field} must be sha256:<64 lowercase hex>.`);
  }
  return value;
}

function requireIsoTimestamp(record: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonEmptyStringField(record, field, label);
  const parsed = new Date(value);
  if (
    !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== value
  ) {
    throw new Error(`${label} ${field} must be a valid canonical ISO timestamp.`);
  }
  return value;
}

function readTerminalResult(campaignRoot: string): ParsedTerminalResult {
  const path = terminalResultPath(campaignRoot);
  const result = requireRecord(readJson(path), 'release terminal result');

  if (result.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION) {
    throw new Error(`release terminal result schema_version must be ${CURRENT_GATE_RESULT_SCHEMA_VERSION}.`);
  }
  if (result.gate_id !== 'gate-release-full') {
    throw new Error('release terminal result must belong to gate-release-full.');
  }
  if (result.line_kind !== 'release_full_verdict') {
    throw new Error('release terminal result must use line_kind release_full_verdict.');
  }
  if (typeof result.status !== 'string' || !CURRENT_GATE_RESULT_STATUSES.includes(result.status as CurrentGateResultStatus)) {
    throw new Error('release terminal result status is not a current gate result status.');
  }
  if (
    typeof result.failure_class !== 'string'
    || !CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(result.failure_class as CurrentGateResultFailureClass)
  ) {
    throw new Error('release terminal result failure_class is not a current gate result failure class.');
  }
  if (result.status === 'passed' && result.failure_class !== 'none') {
    throw new Error('release terminal result is inconsistent: passed result must use failure_class none.');
  }
  if (result.status === 'failed' && result.failure_class === 'none') {
    throw new Error('release terminal result is inconsistent: failed result must use a non-none failure_class.');
  }
  if (typeof result.stage !== 'string' || typeof result.summary !== 'string') {
    throw new Error('release terminal result must include stage and summary strings.');
  }

  return result;
}

function resolveSummaryGitSha(resolveGitSha: (() => string) | undefined): string {
  const gitSha = (resolveGitSha ?? resolveCurrentGitSha)().trim();
  if (!GIT_COMMIT_HASH_PATTERN.test(gitSha)) {
    throw new Error('release summary git sha must be a 40 or 64 character hex git commit hash.');
  }
  return gitSha;
}

function releaseContractValidationError(contractPath: string, failures: readonly { path: string; reason: string }[]): Error {
  return new Error(
    [
      `release contract is invalid: ${contractPath}`,
      ...failures.map((failure) => `${failure.path}: ${failure.reason}`),
    ].join('; '),
  );
}

function buildReleaseContractSummary(input: {
  releaseContractPath: string;
  resolveGitSha?: () => string;
}): ReleaseContractSummary {
  const contractPath = resolve(input.releaseContractPath);
  const parsed = readJson(contractPath);
  const validation = validateAgentSmithReleaseContract(parsed);
  if (!validation.ok) {
    throw releaseContractValidationError(contractPath, validation.failures);
  }

  const contract: CurrentAgentSmithReleaseContract = validation.value;
  const provenance: CurrentArtifactProvenance = contract.artifact_provenance;
  const gitSha = resolveSummaryGitSha(input.resolveGitSha);
  if (contract.git_sha !== gitSha) {
    throw new Error('release contract git_sha must match current release summary git sha.');
  }
  if (provenance.commit_sha !== gitSha) {
    throw new Error('release contract artifact_provenance.commit_sha must match current release summary git sha.');
  }

  return {
    schema: contract.schema_version,
    path: contractPath,
    digest: provenance.artifact_sha256,
    subject_digest: provenance.subject_sha256,
    release_id: contract.release_id,
    git_sha: contract.git_sha,
    provenance: {
      producer_repo: provenance.producer_repo,
      normalized_remote: provenance.normalized_remote,
      commit_sha: provenance.commit_sha,
      artifact_uri: provenance.artifact_uri,
      generated_at: provenance.generated_at,
      generator_version: provenance.generator_version,
    },
  };
}

function inferBlockedStep(status: CurrentGateResultStatus, summary: string): string | null {
  if (status === 'passed') {
    return null;
  }

  for (const pattern of [
    /Campaign step ([a-z0-9-]+) did not pass\./,
    /Missing campaign step result: ([a-z0-9-]+)/,
    /campaign step ([a-z0-9-]+)/i,
  ]) {
    const match = pattern.exec(summary);
    if (match?.[1]) {
      return match[1];
    }
  }

  return 'gate-release-full';
}

function nextActionForFailure(
  failureClass: CurrentGateResultFailureClass,
  blockedStep: string | null,
): string {
  if (failureClass === 'none') {
    return 'Attach summary.md to the release note and complete the operator sign-off checklist.';
  }

  const ownerInspection = blockedStep
    ? `Inspect the product readiness evidence for ${renderHumanReleaseStepLabel(blockedStep)}, fix the owning issue, then rerun ${PRODUCT_READY_COMMAND}.`
    : `Inspect the product readiness evidence, fix the owning issue, then rerun ${PRODUCT_READY_COMMAND}.`;

  if (failureClass === 'infra_setup_failure') {
    return `Fix the local release environment, then rerun ${PRODUCT_READY_COMMAND}.`;
  }
  if (failureClass === 'environment_conflict') {
    return `Resolve the active runtime or port conflict, then run ${PRODUCT_STATUS_COMMAND} before retrying ${PRODUCT_READY_COMMAND}.`;
  }
  if (failureClass === 'evidence_missing') {
    return ownerInspection;
  }
  if (failureClass === 'contract_drift') {
    return 'Do not blindly rerun. Hand this to the governance maintainer to repair manifest/schema/evidence drift.';
  }

  return ownerInspection;
}

function renderReleaseSummaryMarkdown(summary: ReleaseSummary): string {
  const releaseContractReference = renderReleaseContractReference(summary.release_contract);
  return [
    '# AgentSmith Product Readiness Summary',
    '',
    `- status: ${summary.status}`,
    `- blocker: ${summary.blocked_step ? renderHumanReleaseStepLabel(summary.blocked_step) : '<none>'}`,
    `- summary: ${summary.summary_md_path}`,
    `- evidence: ${summary.evidence_package}`,
    `- manual_operator_signoff: ${summary.manual_operator_signoff}`,
    ...(releaseContractReference ? [`- release_contract: ${releaseContractReference}`] : []),
    ...renderReleaseObservabilityLines(summary.run_observability).map((line) => `- ${line}`),
    '',
    '## Why',
    '',
    renderHumanReleaseText(summary.why),
    '',
    '## Next Action',
    '',
    renderHumanReleaseText(summary.next_action),
    '',
  ].join('\n');
}

export function writeReleaseSummaryForCampaign(options: WriteReleaseSummaryOptions): ReleaseSummary {
  const campaignRoot = resolve(options.campaignRoot);
  assertReleaseCampaignRootNotSymlink(campaignRoot);
  const terminalPath = terminalResultPath(campaignRoot);
  const terminalResult = readTerminalResult(campaignRoot);
  const status = terminalResult.status as CurrentGateResultStatus;
  const failureClass = terminalResult.failure_class as CurrentGateResultFailureClass;
  const blockedStep = inferBlockedStep(status, terminalResult.summary as string);
  const summaryJsonPath = join(campaignRoot, 'summary.json');
  const summaryMdPath = join(campaignRoot, 'summary.md');
  const generatedAt = new Date().toISOString();
  const initialObservability = normalizeReleaseRunObservability({
    campaignRoot,
    observability: options.observability,
  });
  const releaseContractSummary = options.releaseContractPath
    ? buildReleaseContractSummary({
      releaseContractPath: options.releaseContractPath,
      resolveGitSha: options.resolveGitSha,
    })
    : undefined;

  const summary: ReleaseSummary = {
    schema: 'agentsmith_release_summary/v1',
    campaign_id: 'release-full',
    campaign_run_id: basename(campaignRoot),
    campaign_root: campaignRoot,
    product_readiness_verdict: status === 'passed' ? 'PASSED' : 'FAILED',
    status,
    failure_class: failureClass,
    stage: terminalResult.stage as string,
    blocked_step: blockedStep,
    why: redactSensitiveText(terminalResult.summary as string),
    next_action: redactSensitiveText(nextActionForFailure(failureClass, blockedStep)),
    terminal_result_path: terminalPath,
    summary_json_path: summaryJsonPath,
    summary_md_path: summaryMdPath,
    evidence_package: campaignRoot,
    manual_operator_signoff: 'not_covered',
    ...(releaseContractSummary ? { release_contract: releaseContractSummary } : {}),
    run_observability: initialObservability,
    generated_at: generatedAt,
  };

  mkdirSync(campaignRoot, { recursive: true });
  writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(summaryMdPath, renderReleaseSummaryMarkdown(summary));
  summary.run_observability = normalizeReleaseRunObservability({
    campaignRoot,
    observability: options.observability,
    reportSizeBytes: reportSizeBytes(campaignRoot),
  });
  writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(summaryMdPath, renderReleaseSummaryMarkdown(summary));
  for (let index = 0; index < 3; index += 1) {
    const stableReportSize = reportSizeBytes(campaignRoot);
    if (summary.run_observability.report_size_bytes === stableReportSize) {
      break;
    }
    summary.run_observability = {
      ...summary.run_observability,
      report_size_bytes: stableReportSize,
    };
    writeFileSync(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`);
    writeFileSync(summaryMdPath, renderReleaseSummaryMarkdown(summary));
  }

  if (options.writeLatest !== false) {
    const latestPath = resolve(options.latestPath ?? defaultLatestPath());
    const gitSha = releaseContractSummary?.git_sha ?? resolveSummaryGitSha(options.resolveGitSha);
    const latest: ReleaseLatestPointer = {
      schema: 'agentsmith_release_latest/v1',
      campaign_id: 'release-full',
      campaign_run_id: summary.campaign_run_id,
      campaign_root: campaignRoot,
      git_sha: gitSha,
      summary_json: summaryJsonPath,
      summary_md: summaryMdPath,
      terminal_result_path: terminalPath,
      generated_at: summary.generated_at,
      updated_at: summary.generated_at,
    };
    mkdirSync(dirname(latestPath), { recursive: true });
    writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);
  }

  return summary;
}

function parseLatestPointer(path: string): ReleaseLatestPointer {
  const latest = requireRecord(readJson(path), 'release latest pointer');
  assertAllowedFields(latest, RELEASE_LATEST_POINTER_KEYS, 'release latest pointer');
  if (latest.schema !== 'agentsmith_release_latest/v1') {
    throw new Error('release latest pointer schema must be agentsmith_release_latest/v1.');
  }
  if (latest.campaign_id !== 'release-full') {
    throw new Error('release latest pointer campaign_id must be release-full.');
  }
  const campaignRunId = requireNonEmptyStringField(latest, 'campaign_run_id', 'release latest pointer');
  const campaignRoot = requireNonEmptyStringField(latest, 'campaign_root', 'release latest pointer');
  requireGitCommitHash(latest, 'git_sha', 'release latest pointer');
  requireIsoTimestamp(latest, 'generated_at', 'release latest pointer');
  requireOptionalStringField(latest, 'summary_json', 'release latest pointer');
  requireOptionalStringField(latest, 'summary_md', 'release latest pointer');
  requireOptionalStringField(latest, 'terminal_result_path', 'release latest pointer');
  requireOptionalStringField(latest, 'updated_at', 'release latest pointer');
  if (campaignRunId !== basename(resolve(campaignRoot))) {
    throw new Error('release latest pointer campaign_run_id must match the campaign root basename.');
  }
  return latest as unknown as ReleaseLatestPointer;
}

function normalizeArtifactPointer(value: string): string {
  return value.trim().replaceAll('\\', '/');
}

function decodeArtifactPointer(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasUriScheme(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(value);
}

function hasLocalOrTraversalPath(value: string): boolean {
  const decoded = decodeArtifactPointer(value);
  return value.startsWith('/')
    || /^[a-z]:\//iu.test(value)
    || value === '.'
    || value === '..'
    || value.startsWith('./')
    || value.startsWith('../')
    || /(?:^|\/)\.{1,2}(?:\/|$)/u.test(decoded);
}

function isLocalArtifactUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const protocol = url.protocol.toLowerCase();
  return protocol === 'file:'
    || protocol === 'local:'
    || isLocalOrUnspecifiedHost(url.hostname);
}

function isLocalOrUnspecifiedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return host === 'localhost'
    || isLocalOrUnspecifiedIpv4Host(host)
    || host === '::'
    || host === '::1'
    || host === '0:0:0:0:0:0:0:0'
    || host === '0:0:0:0:0:0:0:1';
}

function isLocalOrUnspecifiedIpv4Host(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) {
    return false;
  }
  const octets = parts.map((part) => {
    if (!/^\d+$/u.test(part)) {
      return null;
    }
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });
  if (octets.some((octet) => octet === null)) {
    return false;
  }
  return octets.every((octet) => octet === 0) || octets[0] === 127;
}

function isAgentSmithGitHubSourceUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  const pathname = canonicalGitHubPathname(url.pathname);
  if (hostname === 'github.com') {
    return pathname === '/agentsmith-project/agentsmith'
      || pathname === '/agentsmith-project/agentsmith.git'
      || pathname.startsWith('/agentsmith-project/agentsmith/archive/')
      || pathname.startsWith('/agentsmith-project/agentsmith/blob/')
      || pathname.startsWith('/agentsmith-project/agentsmith/raw/')
      || pathname.startsWith('/agentsmith-project/agentsmith/tree/');
  }
  if (hostname === 'raw.githubusercontent.com' || hostname === 'codeload.github.com') {
    return pathname === '/agentsmith-project/agentsmith'
      || pathname.startsWith('/agentsmith-project/agentsmith/');
  }
  if (hostname === 'api.github.com') {
    const repoPath = '/repos/agentsmith-project/agentsmith';
    return pathname === `${repoPath}/tarball`
      || pathname.startsWith(`${repoPath}/tarball/`)
      || pathname === `${repoPath}/zipball`
      || pathname.startsWith(`${repoPath}/zipball/`)
      || pathname === `${repoPath}/contents`
      || pathname.startsWith(`${repoPath}/contents/`)
      || pathname === `${repoPath}/git`
      || pathname.startsWith(`${repoPath}/git/`);
  }
  return false;
}

function canonicalGitHubPathname(pathname: string): string {
  return decodeArtifactPointer(pathname)
    .replace(/\/{2,}/gu, '/')
    .replace(/\/+$/u, '')
    .toLowerCase();
}

function isAgentSmithProductSourcePointer(value: string): boolean {
  const decoded = decodeArtifactPointer(value).toLowerCase();
  if (!hasUriScheme(decoded)) {
    return /^(?:scripts|src|packages|docs)(?:\/|$)/u.test(decoded)
      || decoded === 'package.json';
  }
  if (isAgentSmithGitHubSourceUri(value)) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const agentSmithPath = `${url.hostname}${decodeArtifactPointer(url.pathname)}`.toLowerCase();
  return /(?:^|\/)agentsmith\/(?:scripts|src|packages|docs)(?:\/|$)/u.test(agentSmithPath)
    || /(?:^|\/)agentsmith\/package\.json$/u.test(agentSmithPath);
}

function requireRemoteCiArtifactUri(record: Record<string, unknown>, field: string, label: string): string {
  const value = requireNonEmptyStringField(record, field, label);
  const normalized = normalizeArtifactPointer(value);
  if (
    !hasUriScheme(normalized)
    || isLocalArtifactUri(normalized)
    || hasLocalOrTraversalPath(normalized)
    || isAgentSmithProductSourcePointer(normalized)
  ) {
    throw new Error(`${label} ${field} must be a remote/CI artifact URI, not a local/relative AgentSmith source path.`);
  }
  return value;
}

function validateReleaseContractSummary(value: unknown): void {
  const contract = requireRecord(value, 'release summary release_contract');
  assertAllowedFields(contract, new Set([
    'schema',
    'path',
    'digest',
    'subject_digest',
    'release_id',
    'git_sha',
    'provenance',
  ]), 'release summary release_contract');

  if (contract.schema !== CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION) {
    throw new Error(`release summary release_contract schema must be ${CURRENT_RELEASE_CONTRACT_SCHEMA_VERSION}.`);
  }
  requireNonEmptyStringField(contract, 'path', 'release summary release_contract');
  requireSha256Digest(contract, 'digest', 'release summary release_contract');
  requireSha256Digest(contract, 'subject_digest', 'release summary release_contract');
  requireNonEmptyStringField(contract, 'release_id', 'release summary release_contract');
  const gitSha = requireGitCommitHash(contract, 'git_sha', 'release summary release_contract');

  const provenance = requireRecord(contract.provenance, 'release summary release_contract provenance');
  assertAllowedFields(provenance, new Set([
    'producer_repo',
    'normalized_remote',
    'commit_sha',
    'artifact_uri',
    'generated_at',
    'generator_version',
  ]), 'release summary release_contract provenance');
  const producerRepo = requireNonEmptyStringField(provenance, 'producer_repo', 'release summary release_contract provenance');
  const normalizedRemote = requireNonEmptyStringField(provenance, 'normalized_remote', 'release summary release_contract provenance');
  const provenanceCommitSha = requireGitCommitHash(provenance, 'commit_sha', 'release summary release_contract provenance');
  requireRemoteCiArtifactUri(provenance, 'artifact_uri', 'release summary release_contract provenance');
  requireIsoTimestamp(provenance, 'generated_at', 'release summary release_contract provenance');
  requireNonEmptyStringField(provenance, 'generator_version', 'release summary release_contract provenance');

  if (producerRepo !== AGENTSMITH_CANONICAL_REPO || normalizedRemote !== AGENTSMITH_CANONICAL_REPO) {
    throw new Error(`release summary release_contract provenance repo identity must be ${AGENTSMITH_CANONICAL_REPO}.`);
  }
  if (provenanceCommitSha !== gitSha) {
    throw new Error('release summary release_contract provenance commit_sha must match release_contract.git_sha.');
  }
}

function parseSummary(path: string): ReleaseSummary {
  const summary = requireRecord(readJson(path), 'release summary');
  assertAllowedFields(summary, new Set([
    'schema',
    'campaign_id',
    'campaign_run_id',
    'campaign_root',
    'product_readiness_verdict',
    'status',
    'failure_class',
    'stage',
    'blocked_step',
    'why',
    'next_action',
    'terminal_result_path',
    'summary_json_path',
    'summary_md_path',
    'evidence_package',
    'manual_operator_signoff',
    'release_contract',
    'run_observability',
    'deploy_check_snapshot',
    'generated_at',
  ]), 'release summary');
  if (summary.schema !== 'agentsmith_release_summary/v1') {
    throw new Error('release summary schema must be agentsmith_release_summary/v1.');
  }

  const stringFields = [
    'campaign_id',
    'campaign_run_id',
    'campaign_root',
    'product_readiness_verdict',
    'status',
    'failure_class',
    'stage',
    'why',
    'next_action',
    'terminal_result_path',
    'summary_json_path',
    'summary_md_path',
    'evidence_package',
    'manual_operator_signoff',
    'generated_at',
  ] as const;
  for (const field of stringFields) {
    if (typeof summary[field] !== 'string' || summary[field].trim().length === 0) {
      throw new Error(`release summary cache missing required field: ${field}.`);
    }
  }
  if (summary.blocked_step !== null && typeof summary.blocked_step !== 'string') {
    throw new Error('release summary cache missing required field: blocked_step.');
  }
  if (summary.campaign_id !== 'release-full') {
    throw new Error('release summary cache campaign_id must be release-full.');
  }
  if (summary.product_readiness_verdict !== 'PASSED' && summary.product_readiness_verdict !== 'FAILED') {
    throw new Error('release summary cache product_readiness_verdict is invalid.');
  }
  if (!CURRENT_GATE_RESULT_STATUSES.includes(summary.status as CurrentGateResultStatus)) {
    throw new Error('release summary cache status is invalid.');
  }
  if (!CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(summary.failure_class as CurrentGateResultFailureClass)) {
    throw new Error('release summary cache failure_class is invalid.');
  }
  if (summary.run_observability !== undefined) {
    validateReleaseRunObservability(summary.run_observability);
  }
  if (summary.release_contract !== undefined) {
    validateReleaseContractSummary(summary.release_contract);
  }
  if (summary.deploy_check_snapshot !== undefined) {
    validateReleaseDeployCheckSnapshot(summary.deploy_check_snapshot);
  }
  return summary as unknown as ReleaseSummary;
}

function validateReleaseDeployCheckSnapshot(value: unknown): void {
  const snapshot = requireRecord(value, 'release summary deploy_check_snapshot');
  assertAllowedFields(snapshot, new Set(['schema', 'generated_at', 'items']), 'release summary deploy_check_snapshot');
  if (snapshot.schema !== RELEASE_DEPLOY_CHECK_SNAPSHOT_SCHEMA) {
    throw new Error(`release summary deploy_check_snapshot schema must be ${RELEASE_DEPLOY_CHECK_SNAPSHOT_SCHEMA}.`);
  }
  requireIsoTimestamp(snapshot, 'generated_at', 'release summary deploy_check_snapshot');
  if (!Array.isArray(snapshot.items)) {
    throw new Error('release summary deploy_check_snapshot items must be an array.');
  }
  for (const [index, item] of snapshot.items.entries()) {
    const record = requireRecord(item, `release summary deploy_check_snapshot items[${index}]`);
    assertAllowedFields(record, new Set([
      'id',
      'label',
      'status',
      'evidence_path',
      'result_path',
      'result_digest',
    ]), `release summary deploy_check_snapshot items[${index}]`);
    for (const field of ['id', 'label', 'evidence_path', 'result_path'] as const) {
      requireNonEmptyStringField(record, field, `release summary deploy_check_snapshot items[${index}]`);
    }
    if (
      record.status !== 'passed'
      && record.status !== 'failed'
      && record.status !== 'not_available'
      && record.status !== 'unknown'
    ) {
      throw new Error(`release summary deploy_check_snapshot items[${index}] status is invalid.`);
    }
    if (record.result_digest !== null) {
      const digest = requireNonEmptyStringField(record, 'result_digest', `release summary deploy_check_snapshot items[${index}]`);
      if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
        throw new Error(`release summary deploy_check_snapshot items[${index}] result_digest must be sha256:<64 lowercase hex> or null.`);
      }
    }
  }
}

function validateReleaseRunObservability(value: unknown): void {
  const observability = requireRecord(value, 'release summary run_observability');
  const allowed = new Set([
    'total_duration_ms',
    'top_slow_stages',
    'counts_source',
    'counts',
    'poll_retry_coverage',
    'report_size_bytes',
  ]);
  assertAllowedFields(observability, allowed, 'release summary run_observability');
  if (observability.total_duration_ms !== null && nonNegativeInteger(observability.total_duration_ms) === null) {
    throw new Error('release summary run_observability total_duration_ms must be a non-negative integer or null.');
  }
  if (observability.counts_source !== 'parent_flow') {
    throw new Error('release summary run_observability counts_source must be parent_flow.');
  }
  if (
    observability.poll_retry_coverage !== 'not_covered'
    && observability.poll_retry_coverage !== 'runtime_pending_readiness_adaptive_wait'
  ) {
    throw new Error('release summary run_observability poll_retry_coverage is invalid.');
  }
  if (!Array.isArray(observability.top_slow_stages)) {
    throw new Error('release summary run_observability top_slow_stages must be an array.');
  }
  for (const [index, stage] of observability.top_slow_stages.entries()) {
    const record = requireRecord(stage, `release summary run_observability top_slow_stages[${index}]`);
    assertAllowedFields(record, new Set(['id', 'label', 'duration_ms', 'status']), `release summary run_observability top_slow_stages[${index}]`);
    for (const field of ['id', 'label', 'status'] as const) {
      requireNonEmptyStringField(record, field, `release summary run_observability top_slow_stages[${index}]`);
    }
    if (nonNegativeInteger(record.duration_ms) === null) {
      throw new Error(`release summary run_observability top_slow_stages[${index}] duration_ms must be a non-negative integer.`);
    }
  }
  const counts = requireRecord(observability.counts, 'release summary run_observability counts');
  assertAllowedFields(counts, new Set(Object.keys(defaultReleaseRunObservabilityCounts())), 'release summary run_observability counts');
  for (const field of Object.keys(defaultReleaseRunObservabilityCounts())) {
    if (nonNegativeInteger(counts[field]) === null) {
      throw new Error(`release summary run_observability counts ${field} must be a non-negative integer.`);
    }
  }
  if (nonNegativeInteger(observability.report_size_bytes) === null) {
    throw new Error('release summary run_observability report_size_bytes must be a non-negative integer.');
  }
}

function summaryMatchesTerminal(args: {
  campaignRoot: string;
  summaryPath: string;
  summary: ReleaseSummary;
  terminalResult: ParsedTerminalResult;
}): string | null {
  const terminalStatus = args.terminalResult.status as CurrentGateResultStatus;
  const terminalFailureClass = args.terminalResult.failure_class as CurrentGateResultFailureClass;
  const expectedVerdict = terminalStatus === 'passed' ? 'PASSED' : 'FAILED';
  const expectedBlockedStep = inferBlockedStep(terminalStatus, args.terminalResult.summary as string);
  const expectedTerminalPath = terminalResultPath(args.campaignRoot);
  const expectedNextAction = nextActionForFailure(terminalFailureClass, expectedBlockedStep);

  const checks: Array<[boolean, string]> = [
    [resolve(args.summary.campaign_root) === resolve(args.campaignRoot), 'campaign_root'],
    [args.summary.campaign_run_id === basename(resolve(args.campaignRoot)), 'campaign_run_id'],
    [args.summary.product_readiness_verdict === expectedVerdict, 'product_readiness_verdict'],
    [args.summary.status === terminalStatus, 'status'],
    [args.summary.failure_class === terminalFailureClass, 'failure_class'],
    [args.summary.stage === args.terminalResult.stage, 'stage'],
    [args.summary.why === redactSensitiveText(args.terminalResult.summary as string), 'why'],
    [resolve(args.summary.terminal_result_path) === resolve(expectedTerminalPath), 'terminal_result_path'],
    [resolve(args.summary.summary_json_path) === resolve(args.summaryPath), 'summary_json_path'],
    [resolve(args.summary.evidence_package) === resolve(args.campaignRoot), 'evidence_package'],
    [args.summary.blocked_step === expectedBlockedStep, 'blocked_step'],
    [args.summary.next_action === redactSensitiveText(expectedNextAction), 'next_action'],
  ];

  const failed = checks.find(([ok]) => !ok);
  return failed ? `release summary cache does not match campaign terminal result field: ${failed[1]}.` : null;
}

function readStatusFromCampaignRoot(args: {
  latestPath: string;
  campaignRoot: string;
  latest?: ReleaseLatestPointer;
}): ReleaseStatusRead {
  const campaignRoot = resolve(args.campaignRoot);
  let terminalResult: ParsedTerminalResult;
  try {
    terminalResult = readTerminalResult(campaignRoot);
  } catch (error) {
    return {
      kind: 'malformed',
      latestPath: args.latestPath,
      error: `campaign terminal result is missing or malformed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const summaryPath = resolve(args.latest?.summary_json ?? join(campaignRoot, 'summary.json'));
  if (!existsSync(summaryPath)) {
    return { kind: 'missing_summary', latestPath: args.latestPath, summaryPath };
  }

  try {
    const summary = parseSummary(summaryPath);
    if (args.latest && args.latest.campaign_run_id !== summary.campaign_run_id) {
      return {
        kind: 'malformed',
        latestPath: args.latestPath,
        error: 'release latest pointer campaign_run_id must match release summary campaign_run_id.',
      };
    }
    if (args.latest && summary.release_contract && summary.release_contract.git_sha !== args.latest.git_sha) {
      return {
        kind: 'malformed',
        latestPath: args.latestPath,
        error: 'release latest pointer git_sha must match release summary release_contract.git_sha.',
      };
    }
    const mismatch = summaryMatchesTerminal({
      campaignRoot,
      summaryPath,
      summary,
      terminalResult,
    });
    if (mismatch) {
      return { kind: 'malformed', latestPath: args.latestPath, error: mismatch };
    }
    return {
      kind: 'ready',
      latestPath: args.latestPath,
      latest: args.latest,
      summary,
    };
  } catch (error) {
    return {
      kind: 'malformed',
      latestPath: args.latestPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readReleaseStatus(options: ReadReleaseStatusOptions = {}): ReleaseStatusRead {
  const latestPath = resolve(options.latestPath ?? defaultLatestPath());

  if (options.campaignRoot) {
    return readStatusFromCampaignRoot({
      latestPath,
      campaignRoot: options.campaignRoot,
    });
  }

  if (!existsSync(latestPath)) {
    return { kind: 'missing_latest', latestPath };
  }

  try {
    const latest = parseLatestPointer(latestPath);
    return readStatusFromCampaignRoot({
      latestPath,
      campaignRoot: latest.campaign_root,
      latest,
    });
  } catch (error) {
    return { kind: 'malformed', latestPath, error: error instanceof Error ? error.message : String(error) };
  }
}

export function renderReleaseStatus(status: ReleaseStatusRead): string {
  if (status.kind === 'missing_latest') {
    return [
      'AgentSmith Product Readiness Status',
      '',
      'Status: missing',
      `Latest product readiness summary: not found (${status.latestPath})`,
      `Next: run ${PRODUCT_READY_COMMAND}`,
      renderShortFailureProjection({
        readOnlyMessage: PRODUCT_STATUS_READ_ONLY_MESSAGE,
        verdict: 'BLOCKED',
        blocker: 'release_status_missing_latest',
        stage: 'not-started',
        why: `Latest release summary pointer was not found: ${status.latestPath}`,
        rerunCommand: PRODUCT_READY_COMMAND,
        evidencePath: status.latestPath,
      }).trimEnd(),
      `Note: ${RELEASE_HUMAN_LOG_NOTE}`,
      '',
    ].join('\n');
  }

  if (status.kind === 'missing_summary') {
    return [
      'AgentSmith Product Readiness Status',
      '',
      'Status: missing',
      `Product readiness summary: not found (${status.summaryPath})`,
      `Next: run ${PRODUCT_READY_COMMAND} to produce a fresh campaign summary.`,
      renderShortFailureProjection({
        readOnlyMessage: PRODUCT_STATUS_READ_ONLY_MESSAGE,
        verdict: 'BLOCKED',
        blocker: 'release_status_missing_summary',
        stage: 'report',
        why: `Product readiness summary is missing: ${status.summaryPath}`,
        rerunCommand: PRODUCT_READY_COMMAND,
        evidencePath: status.summaryPath,
      }).trimEnd(),
      `Note: ${RELEASE_HUMAN_LOG_NOTE}`,
      '',
    ].join('\n');
  }

  if (status.kind === 'malformed') {
    return [
      'AgentSmith Product Readiness Status',
      '',
      'Status: unknown',
      `Why: ${renderHumanReleaseText(status.error)}`,
      `Next: rerun ${PRODUCT_READY_COMMAND} after fixing the malformed summary pointer.`,
      renderShortFailureProjection({
        readOnlyMessage: PRODUCT_STATUS_READ_ONLY_MESSAGE,
        verdict: 'BLOCKED',
        blocker: 'release_status_malformed',
        stage: 'report',
        why: renderHumanReleaseText(status.error),
        inspectCommand: status.latestPath,
        rerunCommand: PRODUCT_READY_COMMAND,
        evidencePath: status.latestPath,
      }).trimEnd(),
      `Note: ${RELEASE_HUMAN_LOG_NOTE}`,
      '',
    ].join('\n');
  }

  const summary = status.summary;
  const releaseContractReference = renderReleaseContractReference(summary.release_contract);
  if (summary.status !== 'passed') {
    return [
      'AgentSmith Product Readiness Status',
      '',
      `Status: ${summary.status}`,
      renderShortFailureProjection({
        readOnlyMessage: PRODUCT_STATUS_READ_ONLY_MESSAGE,
        verdict: 'FAILED',
        blocker: renderHumanReleaseStepLabel(summary.blocked_step ?? summary.failure_class),
        stage: renderHumanReleaseStageLabel(summary.stage),
        why: renderHumanReleaseText(summary.why),
        inspectCommand: summary.summary_md_path,
        rerunCommand: PRODUCT_READY_COMMAND,
        evidencePath: summary.evidence_package,
      }).trimEnd(),
      `Summary: ${summary.summary_md_path}`,
      ...(releaseContractReference ? [`Release contract: ${releaseContractReference}`] : []),
      ...renderReleaseObservabilityLines(summary.run_observability),
      `Next: ${renderHumanReleaseText(summary.next_action)}`,
      `Note: ${RELEASE_HUMAN_LOG_NOTE}`,
      '',
    ].join('\n');
  }

  return [
    'AgentSmith Product Readiness Status',
    '',
    `Read-only: ${PRODUCT_STATUS_READ_ONLY_MESSAGE}`,
    `Status: ${summary.status}`,
    `Why: ${renderHumanReleaseText(summary.why)}`,
    `Summary: ${summary.summary_md_path}`,
    `Evidence: ${summary.evidence_package}`,
    ...(releaseContractReference ? [`Release contract: ${releaseContractReference}`] : []),
    ...renderReleaseObservabilityLines(summary.run_observability),
    `Next: ${renderHumanReleaseText(summary.next_action)}`,
    `Note: ${RELEASE_HUMAN_LOG_NOTE}`,
    '',
  ].join('\n');
}

function parseSummaryCliArgs(argv: readonly string[]): WriteReleaseSummaryOptions {
  const options: Partial<WriteReleaseSummaryOptions> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--campaign-root' && next) {
      options.campaignRoot = next;
      index += 1;
    } else if (arg.startsWith('--campaign-root=')) {
      options.campaignRoot = arg.slice('--campaign-root='.length);
    } else if (arg === '--latest-path' && next) {
      options.latestPath = next;
      index += 1;
    } else if (arg.startsWith('--latest-path=')) {
      options.latestPath = arg.slice('--latest-path='.length);
    } else if (arg === '--release-contract' && next) {
      options.releaseContractPath = next;
      index += 1;
    } else if (arg.startsWith('--release-contract=')) {
      options.releaseContractPath = arg.slice('--release-contract='.length);
    } else if (arg === '--no-latest') {
      options.writeLatest = false;
    } else {
      throw new Error(`Unknown release summary argument: ${arg}`);
    }
  }

  const campaignRoot = options.campaignRoot ?? process.env.RELEASE_CAMPAIGN_ROOT;
  if (!campaignRoot?.trim()) {
    throw new Error('release summary requires --campaign-root or RELEASE_CAMPAIGN_ROOT.');
  }
  const releaseContractPath = options.releaseContractPath ?? process.env[AGENTSMITH_RELEASE_CONTRACT_PATH_ENV];

  return {
    campaignRoot,
    latestPath: options.latestPath,
    writeLatest: options.writeLatest,
    releaseContractPath: releaseContractPath?.trim() ? releaseContractPath : undefined,
  };
}

function main(): void {
  try {
    const summary = writeReleaseSummaryForCampaign(parseSummaryCliArgs(process.argv.slice(2)));
    process.stdout.write(`${renderReleaseStatus({ kind: 'ready', latestPath: defaultLatestPath(), summary })}`);
  } catch (error) {
    process.stderr.write(`[release-summary] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

if (isCliEntrypoint('release-summary.ts')) {
  main();
}
