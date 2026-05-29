import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import {
  CURRENT_GATE_RESULT_FAILURE_CLASSES,
  CURRENT_GATE_RESULT_SCHEMA_VERSION,
  CURRENT_GATE_RESULT_STATUSES,
  type CurrentGateResultFailureClass,
  type CurrentGateResultStatus,
} from './current-gate-result-schema';
import {
  CURRENT_STATUS_PROJECTION_SCHEMA,
  CURRENT_STATUS_PROJECTION_VERSION,
  normalizeStatusProjectionRuntimeLine,
  type CurrentStatusProjection,
  type CurrentStatusProjectionAggregateStatusRef,
  type CurrentStatusProjectionBlocker,
  type CurrentStatusProjectionGoal,
  type CurrentStatusProjectionPathRef,
  type CurrentStatusProjectionPhase,
  type CurrentStatusProjectionPresentationStatus,
  type CurrentStatusProjectionReason,
  type CurrentStatusProjectionResumeRecommendation,
  type CurrentStatusProjectionRunObservability,
} from './current-status-projection-schema';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';
import { sanitizePublicVerificationText } from './verify-impact-selector';
import type {
  MinimalLeaseLockSection,
  MinimalLeaseOwnerRef,
  MinimalLeasePortFamilySection,
  MinimalLeaseSecretProfileSection,
} from './lease-status-shadow';
import { redactSensitiveText } from './redaction';

interface ParsedAggregateResult {
  ok: true;
  path: string;
  digest: string;
  status: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  stage: string;
  summary: string;
}

interface MissingAggregateResult {
  ok: false;
  path: string;
  reasonCode: string;
  summary: string;
}

type AggregateResultRead = ParsedAggregateResult | MissingAggregateResult;

interface ParsedCampaignStepResult {
  step: CurrentVerificationCampaignStep;
  path: string;
  digest: string;
  stage: string;
  summary: string;
  skipped: boolean;
}

export interface BuildStatusProjectionInput {
  goal: CurrentStatusProjectionGoal;
  runtimeLine?: string | null;
  runId?: string | null;
  campaignRoot?: string | null;
  gateResultsRoot?: string | null;
  currentGitSha?: string | null;
  evidenceGitSha?: string | null;
  startedAt?: string | null;
  generatedAt?: string;
  phase?: CurrentStatusProjectionPhase;
  lockOwner?: CurrentStatusProjection['lock_owner'];
  leaseStatusShadow?: CurrentStatusProjection['lease_status_shadow'];
}

export interface ShortFailureProjectionInput {
  title?: string;
  diagnosticOnly?: boolean;
  readOnlyMessage?: string | null;
  verdict?: 'FAILED' | 'BLOCKED';
  blocker: string;
  stage: string;
  why: string;
  fixCommand?: string | null;
  inspectCommand?: string | null;
  rerunCommand?: string | null;
  evidencePath?: string | null;
}

export const RELEASE_HUMAN_LOG_NOTE = [
  'Raw logs stay available above/in artifacts;',
  'common setup warnings (NO_COLOR, already-existing Postgres resources, containerd deprecations)',
  'are diagnostic unless the evidence above names them as the blocker.',
].join(' ');

const DEFAULT_GENERATED_AT = '1970-01-01T00:00:00.000Z';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function redactProjectionText(value: string): string {
  return redactSensitiveText(value);
}

function redactProjectionPath(path: string): string {
  return path;
}

const HUMAN_RELEASE_STEP_LABELS: Record<string, string> = {
  'gate-fast': 'Quick precheck',
  'gate-default': 'Default verification',
  'lane-visual': 'Visual check',
  'gate-release': 'Backend-real check',
  'lane-unified-deploy-substrate': 'Transition-only deploy diagnostic / dependencies',
  'lane-unified-deploy-local-kind-images': 'Transition-only deploy diagnostic / images',
  'lane-unified-deploy-local-kind': 'Transition-only deploy diagnostic / rollout',
  'lane-unified-deploy-product-flows': 'Transition-only deploy diagnostic / product flows',
  'gate-release-full': 'Release summary',
};

export const RELEASE_DEPLOY_CHECK_SNAPSHOT_SCHEMA = 'agentsmith_release_deploy_check_snapshot/v1' as const;

function humanReleaseStepLabel(value: string | null | undefined): string {
  if (!value) {
    return 'Release check';
  }
  return HUMAN_RELEASE_STEP_LABELS[value] ?? value;
}

function humanReleaseStageLabel(value: string | null | undefined): string {
  if (value === 'aggregate') {
    return 'release result';
  }
  if (value === 'not-started') {
    return 'not started';
  }
  if (!value) {
    return 'release check';
  }
  return value.replaceAll('-', ' ');
}

function replaceInternalReleaseTerms(value: string): string {
  const replacements = Object.entries(HUMAN_RELEASE_STEP_LABELS)
    .sort(([left], [right]) => right.length - left.length);
  let output = value;
  for (const [internalId, label] of replacements) {
    output = output.replaceAll(internalId, label);
  }
  return output
    .replace(/\bDeploy check \/ dependencies\b/gi, 'Transition-only deploy diagnostic / dependencies')
    .replace(/\bDeploy check \/ images\b/gi, 'Transition-only deploy diagnostic / images')
    .replace(/\bDeploy check \/ rollout\b/gi, 'Transition-only deploy diagnostic / rollout')
    .replace(/\bDeploy check \/ product flows\b/gi, 'Transition-only deploy diagnostic / product flows')
    .replace(/\bDeploy product flows\b/gi, 'Transition-only deploy diagnostic product flows')
    .replace(/\brelease-full campaign evidence passed aggregate verification\./gi, 'Product readiness checks passed.')
    .replace(/\bCampaign step\b/g, 'Release check')
    .replace(/\bcampaign step\b/g, 'release check')
    .replace(/\bcampaign evidence\b/g, 'product readiness evidence')
    .replace(/\bcampaign-scoped\b/g, 'release-run')
    .replace(/\bcampaign\b/g, 'release run');
}

function humanReleaseReason(value: string): string {
  const redacted = redactProjectionText(value);
  const didNotPass = /^Campaign step ([a-z0-9-]+) did not pass\./i.exec(redacted);
  if (didNotPass?.[1]) {
    const rest = redacted.slice(didNotPass[0].length).trim();
    return [
      `${humanReleaseStepLabel(didNotPass[1])} did not pass.`,
      rest ? replaceInternalReleaseTerms(rest) : '',
    ].filter(Boolean).join(' ');
  }

  const missingStep = /^Missing campaign step result: ([a-z0-9-]+)/i.exec(redacted);
  if (missingStep?.[1]) {
    return `${humanReleaseStepLabel(missingStep[1])} evidence is missing.`;
  }

  return replaceInternalReleaseTerms(redacted);
}

export function renderHumanReleaseStepLabel(value: string | null | undefined): string {
  return humanReleaseStepLabel(value);
}

export function renderHumanReleaseStageLabel(value: string | null | undefined): string {
  return humanReleaseStageLabel(value);
}

export function renderHumanReleaseText(value: string): string {
  return humanReleaseReason(value);
}

function campaignRootFromAggregatePath(path: string | null | undefined): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.replaceAll('\\', '/');
  if (!normalized.endsWith('/gate-release-full/result.json')) {
    return null;
  }
  return dirname(dirname(path));
}

function isCleanRerunCommand(command: string): boolean {
  return [
    /^npm run verify(?:\s|$)/,
    /^npm run release:(?:ready|status)(?:\s|$)/,
    /^make local-real-(?:up|status|down|reset)(?:\s|$)/,
  ].some((pattern) => pattern.test(command));
}

function publicStatusCommand(command: string): string {
  return sanitizePublicVerificationText(command);
}

function renderPublicCommand(value: string): string {
  return redactProjectionText(publicStatusCommand(value));
}

function renderPublicFailureText(value: string): string {
  return redactProjectionText(publicStatusCommand(value))
    .replace(/\binternal ([a-z0-9 -]+) verification adapter\b/gi, 'internal $1 verification check step')
    .replace(/\bverification adapter\b/gi, 'verification check step')
    .replace(/\badapter\b/gi, 'internal check step');
}

function renderOptionalPublicCommand(value: string | null | undefined): string {
  return value === null || value === undefined ? '<none>' : renderPublicCommand(value);
}

export function renderShortFailureProjection(input: ShortFailureProjectionInput): string {
  const lines: string[] = [];
  if (input.readOnlyMessage) {
    lines.push(`Read-only: ${renderPublicFailureText(input.readOnlyMessage)}`);
  }
  if (input.diagnosticOnly) {
    lines.push('Diagnostic only: not a product readiness conclusion.');
  }
  lines.push(`Blocker: ${redactProjectionText(input.blocker)}`);
  lines.push(`Stage: ${redactProjectionText(input.stage)}`);
  lines.push(`Why: ${renderPublicFailureText(input.why)}`);
  if (input.fixCommand) {
    lines.push(`Fix: ${renderPublicCommand(input.fixCommand)}`);
  } else if (input.inspectCommand) {
    lines.push(`Inspect: ${renderPublicCommand(input.inspectCommand)}`);
  }
  const rerunCommand = input.rerunCommand ? publicStatusCommand(input.rerunCommand) : null;
  if (rerunCommand && isCleanRerunCommand(rerunCommand)) {
    lines.push(`Rerun: ${redactProjectionText(rerunCommand)}`);
  } else if (input.rerunCommand && !input.fixCommand && !input.inspectCommand) {
    lines.push(`Inspect: ${renderPublicCommand(input.rerunCommand)}`);
  }
  if (input.evidencePath) {
    lines.push(`Evidence: ${redactProjectionPath(input.evidencePath)}`);
  }
  return `${lines.join('\n')}\n`;
}

function releaseAggregateResultPath(campaignRoot: string): string {
  return join(resolve(campaignRoot), 'gate-release-full', 'result.json');
}

function aggregateMalformedResult(input: {
  path: string;
  reasonCode: string;
  summary: string;
}): MissingAggregateResult {
  return {
    ok: false,
    path: input.path,
    reasonCode: input.reasonCode,
    summary: input.summary,
  };
}

function readReleaseAggregateResult(campaignRoot?: string | null): AggregateResultRead {
  if (!campaignRoot) {
    return {
      ok: false,
      path: '',
      reasonCode: 'aggregate_result_not_applicable',
      summary: 'No product readiness campaign root was provided.',
    };
  }

  const path = releaseAggregateResultPath(campaignRoot);
  if (!existsSync(path)) {
    return {
      ok: false,
      path,
      reasonCode: 'aggregate_result_missing',
      summary: `Release aggregate result is missing: ${path}`,
    };
  }

  const content = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_malformed',
      summary: `Release aggregate result is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (!isRecord(parsed)) {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_malformed',
      summary: 'Release aggregate result must be a JSON object.',
    });
  }

  if (
    parsed.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION
    || parsed.gate_id !== 'gate-release-full'
    || parsed.line_kind !== 'release_full_verdict'
  ) {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_not_terminal',
      summary: 'Release aggregate result must be gate-release-full / release_full_verdict.',
    });
  }

  if (
    typeof parsed.status !== 'string'
    || typeof parsed.failure_class !== 'string'
    || typeof parsed.stage !== 'string'
    || typeof parsed.summary !== 'string'
  ) {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_malformed',
      summary: 'Release aggregate result must include status, failure_class, stage, and summary strings.',
    });
  }

  if (!CURRENT_GATE_RESULT_STATUSES.includes(parsed.status as CurrentGateResultStatus)) {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_invalid_status',
      summary: 'Release aggregate result status is not a current gate result status.',
    });
  }

  if (!CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(parsed.failure_class as CurrentGateResultFailureClass)) {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_invalid_failure_class',
      summary: 'Release aggregate result failure_class is not a current gate result failure class.',
    });
  }

  const status = parsed.status as CurrentGateResultStatus;
  const failureClass = parsed.failure_class as CurrentGateResultFailureClass;
  const stage = parsed.stage;
  const summary = parsed.summary;
  if (status === 'passed' && failureClass !== 'none') {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_inconsistent',
      summary: 'Release aggregate result is inconsistent: passed result must use failure_class none.',
    });
  }
  if (status === 'failed' && failureClass === 'none') {
    return aggregateMalformedResult({
      path,
      reasonCode: 'aggregate_result_inconsistent',
      summary: 'Release aggregate result is inconsistent: failed result must use a non-none failure_class.',
    });
  }

  return {
    ok: true,
    path,
    digest: sha256(content),
    status,
    failureClass,
    stage,
    summary,
  };
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function sanitizeObservabilityText(value: string): string {
  return redactSensitiveText(value).slice(0, 160);
}

function readReleaseSummaryObservability(campaignRoot?: string | null): CurrentStatusProjectionRunObservability | null {
  if (!campaignRoot) {
    return null;
  }
  const path = join(resolve(campaignRoot), 'summary.json');
  if (!existsSync(path)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !isRecord(parsed.run_observability)) {
    return null;
  }
  const observability = parsed.run_observability;
  const counts = isRecord(observability.counts) ? observability.counts : {};
  const countValue = (field: string): number => nonNegativeInteger(counts[field]) ?? 0;
  const topSlowStages = Array.isArray(observability.top_slow_stages)
    ? observability.top_slow_stages
      .filter(isRecord)
      .map((stage) => ({
        id: sanitizeObservabilityText(typeof stage.id === 'string' ? stage.id : 'unknown'),
        label: sanitizeObservabilityText(typeof stage.label === 'string' ? stage.label : String(stage.id ?? 'unknown')),
        duration_ms: nonNegativeInteger(stage.duration_ms) ?? 0,
        status: sanitizeObservabilityText(typeof stage.status === 'string' ? stage.status : 'unknown'),
      }))
      .sort((left, right) => right.duration_ms - left.duration_ms)
      .slice(0, 3)
    : [];

  return {
    total_duration_ms: observability.total_duration_ms === null
      ? null
      : nonNegativeInteger(observability.total_duration_ms),
    top_slow_stages: topSlowStages,
    counts_source: 'parent_flow',
    counts: {
      real_service_start_count: countValue('real_service_start_count'),
      api_web_start_count: countValue('api_web_start_count'),
      backend_real_check_session_count: countValue('backend_real_check_session_count'),
      image_import_count: countValue('image_import_count'),
    },
    poll_retry_coverage: 'not_covered',
    report_size_bytes: nonNegativeInteger(observability.report_size_bytes) ?? 0,
  };
}

function aggregateStatusRef(result: ParsedAggregateResult): CurrentStatusProjectionAggregateStatusRef {
  return {
    path: redactProjectionPath(result.path),
    digest: result.digest,
    gate_id: 'gate-release-full',
    line_kind: 'release_full_verdict',
  };
}

function normalizePhase(value: string): CurrentStatusProjectionPhase {
  if (
    value === 'reset'
    || value === 'up'
    || value === 'bootstrap'
    || value === 'verify'
    || value === 'report'
    || value === 'aggregate'
    || value === 'complete'
    || value === 'not-started'
    || value === 'running'
    || value === 'unknown'
  ) {
    return value;
  }
  return 'unknown';
}

function runAgeSeconds(input: Pick<BuildStatusProjectionInput, 'startedAt' | 'generatedAt'>): number | null {
  if (!input.startedAt) {
    return null;
  }
  const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT;
  const started = new Date(input.startedAt).getTime();
  const generated = new Date(generatedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(generated) || generated < started) {
    return null;
  }
  return Math.floor((generated - started) / 1000);
}

function inferBlockedOwner(summary: string): string | null {
  const patterns = [
    /Missing campaign step result: ([a-z0-9-]+)/,
    /Campaign step ([a-z0-9-]+) did not pass\./,
    /campaign step ([a-z0-9-]+)/i,
  ] as const;

  for (const pattern of patterns) {
    const match = pattern.exec(summary);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function safeCommandForOwner(owner: string | null, goal: CurrentStatusProjectionGoal): string | null {
  if (goal === 'release-ready') {
    return 'npm run release:ready';
  }
  if (owner === 'lane-visual') {
    return 'npm run verify -- --goal=visual --run';
  }
  if (owner === 'gate-release') {
    return 'npm run verify -- --goal=real --run';
  }
  if (
    owner === 'lane-unified-deploy-substrate'
    || owner === 'lane-unified-deploy-local-kind-images'
    || owner === 'lane-unified-deploy-local-kind'
    || owner === 'lane-unified-deploy-product-flows'
  ) {
    return goal === 'release-ready' ? 'npm run release:ready' : null;
  }
  if (owner === 'gate-fast') {
    return 'npm run verify -- --goal=pr --run';
  }
  if (owner === 'gate-default') {
    return 'npm run verify -- --goal=pr --run';
  }
  if (goal === 'local-real') {
    return 'make local-real-status';
  }
  return null;
}

function releaseFullCampaignSteps(): readonly CurrentVerificationCampaignStep[] {
  return findCurrentVerificationCampaignById('release-full')?.steps ?? [];
}

function campaignStepResultPath(campaignRoot: string, step: CurrentVerificationCampaignStep): string {
  return join(resolve(campaignRoot), step.id, 'result.json');
}

function readFailedCampaignStepResult(input: {
  campaignRoot: string;
  step: CurrentVerificationCampaignStep;
}): ParsedCampaignStepResult | null {
  if (input.step.executionMode === 'aggregate_only') {
    return null;
  }

  const path = campaignStepResultPath(input.campaignRoot, input.step);
  if (!existsSync(path)) {
    return null;
  }

  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }
  if (
    parsed.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION
    || parsed.gate_id !== input.step.gateId
    || parsed.status !== 'failed'
    || typeof parsed.stage !== 'string'
    || typeof parsed.summary !== 'string'
  ) {
    return null;
  }

  return {
    step: input.step,
    path,
    digest: sha256(content),
    stage: parsed.stage,
    summary: parsed.summary,
    skipped: parsed.stage === 'skipped',
  };
}

function releaseStepForOwner(owner: string | null): CurrentVerificationCampaignStep | null {
  if (!owner) {
    return null;
  }
  return releaseFullCampaignSteps().find((step) => step.id === owner || step.gateId === owner) ?? null;
}

function failedCampaignStepResultForBlocker(input: {
  campaignRoot: string | null | undefined;
  aggregate: ParsedAggregateResult;
  primaryBlocker: CurrentStatusProjectionBlocker | null;
}): ParsedCampaignStepResult | null {
  if (!input.campaignRoot) {
    return null;
  }

  const blockerStep = releaseStepForOwner(input.primaryBlocker?.owner ?? null);
  if (!blockerStep) {
    return null;
  }
  if (!input.aggregate.summary.includes(`Campaign step ${blockerStep.id} did not pass.`)) {
    return null;
  }

  return readFailedCampaignStepResult({
    campaignRoot: input.campaignRoot,
    step: blockerStep,
  });
}

function notAvailableResumeRecommendation(input: {
  reasonCodes: readonly string[];
  safeNextCommand: string | null;
  downstreamAggregateJobId: 'gate-release-full' | null;
}): CurrentStatusProjectionResumeRecommendation {
  return {
    projection_kind: 'read_only',
    source: 'not_available',
    action: 'not_available',
    owner_job_id: null,
    owner_gate_id: null,
    producer_job_ids: [],
    downstream_aggregate_job_id: input.downstreamAggregateJobId,
    step_result_pointer: null,
    safe_next_command: input.safeNextCommand,
    reason_codes: input.reasonCodes,
    automatic_rerun: false,
    automatic_skip: false,
  };
}

function terminalAggregateResumeRecommendation(input: {
  presentationStatus: CurrentStatusProjectionPresentationStatus;
  primaryBlocker: CurrentStatusProjectionBlocker | null;
  safeNextCommand: string | null;
}): CurrentStatusProjectionResumeRecommendation {
  if (input.presentationStatus === 'passed') {
    return {
      projection_kind: 'read_only',
      source: 'terminal_aggregate',
      action: 'none',
      owner_job_id: null,
      owner_gate_id: null,
      producer_job_ids: [],
      downstream_aggregate_job_id: 'gate-release-full',
      step_result_pointer: null,
      safe_next_command: null,
      reason_codes: ['terminal_aggregate_passed'],
      automatic_rerun: false,
      automatic_skip: false,
    };
  }

  const ownerStep = releaseStepForOwner(input.primaryBlocker?.owner ?? null);
  const reasonCodes = input.presentationStatus === 'stale'
    ? ['stale_evidence_git_sha']
    : ['terminal_aggregate_failed'];
  return {
    projection_kind: 'read_only',
    source: 'terminal_aggregate',
    action: 'inspect_authority',
    owner_job_id: ownerStep?.id ?? input.primaryBlocker?.owner ?? null,
    owner_gate_id: ownerStep?.gateId ?? null,
    producer_job_ids: ownerStep ? [ownerStep.id] : [],
    downstream_aggregate_job_id: 'gate-release-full',
    step_result_pointer: null,
    safe_next_command: input.safeNextCommand,
    reason_codes: reasonCodes,
    automatic_rerun: false,
    automatic_skip: false,
  };
}

function resumeRecommendationForRelease(input: {
  campaignRoot: string | null | undefined;
  aggregate: ParsedAggregateResult;
  presentationStatus: CurrentStatusProjectionPresentationStatus;
  primaryBlocker: CurrentStatusProjectionBlocker | null;
  safeNextCommand: string | null;
}): CurrentStatusProjectionResumeRecommendation {
  if (input.presentationStatus !== 'failed') {
    return terminalAggregateResumeRecommendation({
      presentationStatus: input.presentationStatus,
      primaryBlocker: input.primaryBlocker,
      safeNextCommand: input.safeNextCommand,
    });
  }

  const failedStepResult = failedCampaignStepResultForBlocker({
    campaignRoot: input.campaignRoot,
    aggregate: input.aggregate,
    primaryBlocker: input.primaryBlocker,
  });
  if (!failedStepResult) {
    return terminalAggregateResumeRecommendation({
      presentationStatus: input.presentationStatus,
      primaryBlocker: input.primaryBlocker,
      safeNextCommand: input.safeNextCommand,
    });
  }

  return {
    projection_kind: 'read_only',
    source: 'campaign_step_results',
    action: failedStepResult.skipped ? 'blocked_by_upstream' : 'rerun_required',
    owner_job_id: failedStepResult.step.id,
    owner_gate_id: failedStepResult.step.gateId,
    producer_job_ids: [failedStepResult.step.id],
    downstream_aggregate_job_id: 'gate-release-full',
    step_result_pointer: {
      path: redactProjectionPath(failedStepResult.path),
      digest: failedStepResult.digest,
    },
    safe_next_command: safeCommandForOwner(failedStepResult.step.id, 'release-ready'),
    reason_codes: [failedStepResult.skipped ? 'campaign_step_skipped' : 'campaign_step_failed'],
    automatic_rerun: false,
    automatic_skip: false,
  };
}

function failedPrimaryBlocker(result: ParsedAggregateResult): CurrentStatusProjectionBlocker {
  const owner = inferBlockedOwner(result.summary) ?? 'gate-release-full';
  return {
    owner,
    stage: normalizePhase(result.stage),
    path: redactProjectionPath(result.path),
  };
}

function statusForAggregate(input: {
  result: ParsedAggregateResult;
  currentGitSha: string | null;
  evidenceGitSha: string | null;
}): CurrentStatusProjectionPresentationStatus {
  if (
    input.currentGitSha
    && input.evidenceGitSha
    && input.currentGitSha !== input.evidenceGitSha
  ) {
    return 'stale';
  }
  if (input.result.status === 'passed') {
    return 'passed';
  }
  if (input.result.status === 'failed') {
    return 'failed';
  }
  return 'unknown';
}

function reasonForAggregate(input: {
  result: ParsedAggregateResult;
  presentationStatus: CurrentStatusProjectionPresentationStatus;
  currentGitSha: string | null;
  evidenceGitSha: string | null;
}): CurrentStatusProjectionReason {
  if (input.presentationStatus === 'stale') {
    return {
      code: 'stale_evidence_git_sha',
      summary: `Evidence git sha ${input.evidenceGitSha ?? '<unknown>'} does not match current git sha ${input.currentGitSha ?? '<unknown>'}.`,
      source_path: redactProjectionPath(input.result.path),
    };
  }

  return {
    code: input.result.failureClass,
    summary: redactSensitiveText(input.result.summary),
    source_path: redactProjectionPath(input.result.path),
  };
}

function evidencePathsForAggregate(result: ParsedAggregateResult | null): readonly CurrentStatusProjectionPathRef[] {
  if (!result) {
    return [];
  }
  return [
    {
      path: redactProjectionPath(result.path),
      digest: result.digest,
    },
  ];
}

function leaseStatusShadowForInput(
  input: Pick<BuildStatusProjectionInput, 'leaseStatusShadow'>,
): CurrentStatusProjection['lease_status_shadow'] {
  return input.leaseStatusShadow ?? null;
}

function lockOwnerFromLeaseStatusShadow(
  leaseStatusShadow: CurrentStatusProjection['lease_status_shadow'],
): CurrentStatusProjection['lock_owner'] {
  if (!leaseStatusShadow || leaseStatusShadow.active_leases.length === 0) {
    return null;
  }

  return {
    active_run_id: leaseStatusShadow.active_run?.run_id ?? null,
    active_lock_count: leaseStatusShadow.active_leases.length,
    owners: leaseStatusShadow.active_leases.map((owner) => ({
      lock_id: owner.lock_id,
      scope_kind: owner.scope_kind,
      scope_key: owner.scope_key,
      owner_group: owner.owner_group,
      owner_step_id: owner.owner_step_id,
      owner_attempt_id: owner.owner_attempt_id,
      pid: owner.pid,
    })),
  };
}

function lockOwnerForInput(
  input: Pick<BuildStatusProjectionInput, 'lockOwner' | 'leaseStatusShadow'>,
): CurrentStatusProjection['lock_owner'] {
  return input.lockOwner !== undefined
    ? input.lockOwner
    : lockOwnerFromLeaseStatusShadow(leaseStatusShadowForInput(input));
}

function missingAggregatePresentationStatus(input: {
  running: boolean;
  reasonCode: string;
}): CurrentStatusProjectionPresentationStatus {
  if (input.running) {
    return 'running';
  }
  if (
    input.reasonCode === 'aggregate_result_missing'
    || input.reasonCode === 'aggregate_result_not_applicable'
  ) {
    return 'not-started';
  }
  return 'unknown';
}

function buildMissingAggregateProjection(input: {
  source: MissingAggregateResult;
  options: BuildStatusProjectionInput;
  generatedAt: string;
  runtimeLine: string | null;
}): CurrentStatusProjection {
  const running = Boolean(input.options.runId && input.options.startedAt);
  const status = missingAggregatePresentationStatus({
    running,
    reasonCode: input.source.reasonCode,
  });
  const phase: CurrentStatusProjectionPhase = input.options.phase ?? (running ? 'verify' : 'not-started');
  const sourcePath = input.source.path.length > 0 ? redactProjectionPath(input.source.path) : null;
  const safeNextCommand = safeCommandForOwner(null, input.options.goal);

  return {
    schema: CURRENT_STATUS_PROJECTION_SCHEMA,
    version: CURRENT_STATUS_PROJECTION_VERSION,
    projection_kind: 'read_only',
    goal: input.options.goal,
    runtime_line: input.runtimeLine,
    run_id: input.options.runId ?? null,
    current_git_sha: input.options.currentGitSha ?? null,
    evidence_git_sha: input.options.evidenceGitSha ?? null,
    run_age_seconds: runAgeSeconds(input.options),
    phase,
    aggregate_status_ref: null,
    presentation_status: status,
    primary_blocker: null,
    downstream_skipped: [],
    deepest_reason: {
      code: running ? 'aggregate_result_pending' : input.source.reasonCode,
      summary: running ? 'Release aggregate result has not been produced yet.' : redactSensitiveText(input.source.summary),
      source_path: sourcePath,
    },
    safe_next_command: safeNextCommand,
    resume_recommendation: notAvailableResumeRecommendation({
      reasonCodes: [running ? 'aggregate_result_pending' : input.source.reasonCode],
      safeNextCommand,
      downstreamAggregateJobId: input.options.goal === 'release-ready' ? 'gate-release-full' : null,
    }),
    destructive_recovery_command: null,
    lock_owner: lockOwnerForInput(input.options),
    lease_status_shadow: leaseStatusShadowForInput(input.options),
    run_observability: readReleaseSummaryObservability(input.options.campaignRoot),
    manual_signoff_status: 'not-covered',
    evidence_paths: [],
    authority_paths: {
      aggregate: null,
      stage: sourcePath,
      evidence: [],
    },
    generated_at: input.generatedAt,
    release_decision_produced: false,
    commands_executed: false,
    leases_acquired: false,
    leases_released: false,
  };
}

export function buildStatusProjection(input: BuildStatusProjectionInput): CurrentStatusProjection {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const runtimeLine = normalizeStatusProjectionRuntimeLine({
    goal: input.goal,
    runtimeLine: input.runtimeLine,
  });

  const aggregate = input.goal === 'release-ready'
    ? readReleaseAggregateResult(input.campaignRoot)
    : {
        ok: false as const,
        path: '',
        reasonCode: 'aggregate_result_not_applicable',
        summary: 'Aggregate result is not applicable for this goal.',
      };

  if (!aggregate.ok) {
    return buildMissingAggregateProjection({
      source: aggregate,
      options: input,
      generatedAt,
      runtimeLine,
    });
  }

  const presentationStatus = statusForAggregate({
    result: aggregate,
    currentGitSha: input.currentGitSha ?? null,
    evidenceGitSha: input.evidenceGitSha ?? null,
  });
  const primaryBlocker = presentationStatus === 'failed' ? failedPrimaryBlocker(aggregate) : null;
  const blockerOwner = primaryBlocker?.owner ?? null;
  const safeNextCommand = presentationStatus === 'passed' ? null : safeCommandForOwner(blockerOwner, input.goal);

  return {
    schema: CURRENT_STATUS_PROJECTION_SCHEMA,
    version: CURRENT_STATUS_PROJECTION_VERSION,
    projection_kind: 'read_only',
    goal: input.goal,
    runtime_line: runtimeLine,
    run_id: input.runId ?? null,
    current_git_sha: input.currentGitSha ?? null,
    evidence_git_sha: input.evidenceGitSha ?? null,
    run_age_seconds: runAgeSeconds(input),
    phase: input.phase ?? normalizePhase(aggregate.stage),
    aggregate_status_ref: aggregateStatusRef(aggregate),
    presentation_status: presentationStatus,
    primary_blocker: primaryBlocker,
    downstream_skipped: [],
    deepest_reason: reasonForAggregate({
      result: aggregate,
      presentationStatus,
      currentGitSha: input.currentGitSha ?? null,
      evidenceGitSha: input.evidenceGitSha ?? null,
    }),
    safe_next_command: safeNextCommand,
    resume_recommendation: resumeRecommendationForRelease({
      campaignRoot: input.campaignRoot,
      aggregate,
      presentationStatus,
      primaryBlocker,
      safeNextCommand,
    }),
    destructive_recovery_command: null,
    lock_owner: lockOwnerForInput(input),
    lease_status_shadow: leaseStatusShadowForInput(input),
    run_observability: readReleaseSummaryObservability(input.campaignRoot),
    manual_signoff_status: 'not-covered',
    evidence_paths: evidencePathsForAggregate(aggregate),
    authority_paths: {
      aggregate: redactProjectionPath(aggregate.path),
      stage: redactProjectionPath(aggregate.path),
      evidence: [redactProjectionPath(aggregate.path)],
    },
    generated_at: generatedAt,
    release_decision_produced: false,
    commands_executed: false,
    leases_acquired: false,
    leases_released: false,
  };
}

function renderOptional(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '<none>' : String(value);
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

function renderRunObservabilityLines(
  observability: CurrentStatusProjectionRunObservability | null | undefined,
): readonly string[] {
  if (!observability) {
    return [];
  }
  const slowStages = observability.top_slow_stages.length > 0
    ? observability.top_slow_stages
      .map((stage) => `${replaceInternalReleaseTerms(stage.label || humanReleaseStepLabel(stage.id))} ${formatDuration(stage.duration_ms)}`)
      .join('; ')
    : '<none>';
  return [
    `Total duration: ${formatDuration(observability.total_duration_ms)}`,
    `Slowest steps: ${slowStages}`,
    `Real service starts: ${observability.counts.real_service_start_count}`,
    `API/Web starts: ${observability.counts.api_web_start_count}`,
    `Backend real sessions: ${observability.counts.backend_real_check_session_count}`,
    `Image imports: ${observability.counts.image_import_count}`,
    'Poll/retry coverage: not covered',
    `Report size: ${observability.report_size_bytes} bytes`,
  ];
}

function renderOptionalPath(value: string | null | undefined): string {
  return value === null || value === undefined ? '<none>' : redactProjectionPath(value);
}

function renderAggregateStatusRef(ref: CurrentStatusProjectionAggregateStatusRef | null): string {
  return ref ? `${redactProjectionPath(ref.path)} (${ref.digest})` : '<none>';
}

function renderPathRefs(paths: readonly CurrentStatusProjectionPathRef[]): string {
  if (paths.length === 0) {
    return '<none>';
  }
  return paths.map((path) => `${redactProjectionPath(path.path)}${path.digest ? ` (${path.digest})` : ''}`).join('; ');
}

function renderPrimaryBlocker(blocker: CurrentStatusProjectionBlocker | null): string {
  if (!blocker) {
    return '<none>';
  }
  return `${blocker.owner} (${blocker.stage})${blocker.path ? ` @ ${redactProjectionPath(blocker.path)}` : ''}`;
}

function renderDeepestReason(reason: CurrentStatusProjectionReason | null): string {
  if (!reason) {
    return '<none>';
  }
  return `${redactSensitiveText(reason.code)}: ${redactSensitiveText(reason.summary)}${reason.source_path ? ` @ ${redactProjectionPath(reason.source_path)}` : ''}`;
}

function renderResumeRecommendation(recommendation: CurrentStatusProjectionResumeRecommendation): string {
  const pointer = recommendation.step_result_pointer
    ? `${redactProjectionPath(recommendation.step_result_pointer.path)} (${renderOptional(recommendation.step_result_pointer.digest)})`
    : '<none>';
  const owner = recommendation.owner_job_id
    ? `${recommendation.owner_job_id}${recommendation.owner_gate_id ? `/${recommendation.owner_gate_id}` : ''}`
    : '<none>';
  return [
    `action=${recommendation.action}`,
    `source=${recommendation.source}`,
    `owner=${owner}`,
    `producer_jobs=${recommendation.producer_job_ids.length > 0 ? recommendation.producer_job_ids.join(',') : '<none>'}`,
    `downstream_aggregate=${renderOptional(recommendation.downstream_aggregate_job_id)}`,
    `pointer=${pointer}`,
    `safe_next=${renderOptionalPublicCommand(recommendation.safe_next_command)}`,
    `reason=${recommendation.reason_codes.length > 0 ? recommendation.reason_codes.join(',') : '<none>'}`,
    `automatic_rerun=${String(recommendation.automatic_rerun)}`,
    `automatic_skip=${String(recommendation.automatic_skip)}`,
  ].join('; ');
}

function renderLocks(lockOwner: CurrentStatusProjection['lock_owner']): string {
  if (!lockOwner || lockOwner.active_lock_count === 0) {
    return '<none>';
  }
  const owners = lockOwner.owners.map((owner) => (
    `${owner.lock_id}:${owner.owner_group}/${owner.owner_step_id}${owner.pid ? ` pid=${owner.pid}` : ''}`
  ));
  return [
    `active_run=${renderOptional(lockOwner.active_run_id)}`,
    `active_lock_count=${lockOwner.active_lock_count}`,
    owners.join('; '),
  ].filter(Boolean).join('; ');
}

function renderLeaseShadowOwners(owners: readonly MinimalLeaseOwnerRef[]): string {
  if (owners.length === 0) {
    return '<none>';
  }
  return owners.map((owner) => (
    `${owner.lock_id}:${owner.owner_group}/${owner.owner_step_id}${owner.pid ? ` pid=${owner.pid}` : ''}`
  )).join('; ');
}

function renderLeaseLockPresence(section: MinimalLeaseLockSection): string {
  return section.present ? 'present' : 'absent';
}

function renderLeaseShadowDestructiveLock(
  section: MinimalLeaseLockSection,
): string {
  return [
    renderLeaseLockPresence(section),
    `lock=${renderOptional(section.lock_id)}`,
    `owners=${renderLeaseShadowOwners(section.owners)}`,
  ].join('; ');
}

function renderLeaseShadowPortFamilies(section: MinimalLeasePortFamilySection): string {
  if (section.families.length === 0) {
    return 'not-applicable';
  }
  return section.families.map((family) => (
    `${family.name}[${family.ports.length > 0 ? family.ports.join(',') : 'not-known'}]`
  )).join('; ');
}

function renderLeaseShadowPortFamily(section: MinimalLeasePortFamilySection): string {
  return [
    renderLeaseLockPresence(section),
    `lock=${renderOptional(section.lock_id)}`,
    `families=${renderLeaseShadowPortFamilies(section)}`,
    `owners=${renderLeaseShadowOwners(section.owners)}`,
  ].join('; ');
}

function renderLeaseShadowSecretProfile(section: MinimalLeaseSecretProfileSection): string {
  return [
    renderLeaseLockPresence(section),
    `lock=${renderOptional(section.lock_id)}`,
    `profile_presence=${String(section.profile.present)}`,
    `digest=${renderOptional(section.profile.digest)}`,
    `owners=${renderLeaseShadowOwners(section.owners)}`,
  ].join('; ');
}

export function renderStatusProjectionLeaseShadowLines(
  projection: Pick<CurrentStatusProjection, 'lease_status_shadow'>,
): readonly string[] {
  const shadow = projection.lease_status_shadow;
  if (!shadow) {
    return [
      'Lease shadow active run: not-known',
      'Lease shadow destructive command lock: not-known',
      'Lease shadow port family: not-known',
      'Lease shadow secret profile: not-known',
    ];
  }

  const activeRun = shadow.active_run
    ? [
        shadow.active_run.run_id,
        `(campaign=${renderOptional(shadow.active_run.campaign_id)}; owner=${shadow.active_run.owner_group}/${shadow.active_run.owner_step_id}; started_at=${shadow.active_run.started_at})`,
      ].join(' ')
    : 'none observed';

  return [
    `Lease shadow active run: ${activeRun}`,
    `Lease shadow destructive command lock: ${renderLeaseShadowDestructiveLock(shadow.destructive_command_lock)}`,
    `Lease shadow port family: ${renderLeaseShadowPortFamily(shadow.port_family)}`,
    `Lease shadow secret profile: ${renderLeaseShadowSecretProfile(shadow.secret_profile_lock)}`,
  ];
}

function releaseReadyRerunCommand(projection: CurrentStatusProjection): string | null {
  if (projection.goal === 'release-ready' && projection.presentation_status !== 'passed') {
    return 'npm run release:ready';
  }
  return projection.safe_next_command ? publicStatusCommand(projection.safe_next_command) : null;
}

function primaryEvidencePath(projection: CurrentStatusProjection): string | null {
  return projection.primary_blocker?.path
    ?? projection.deepest_reason?.source_path
    ?? projection.authority_paths.aggregate
    ?? projection.evidence_paths[0]?.path
    ?? null;
}

function releaseEvidenceRootForProjection(projection: CurrentStatusProjection): string | null {
  return campaignRootFromAggregatePath(projection.aggregate_status_ref?.path)
    ?? campaignRootFromAggregatePath(projection.authority_paths.aggregate)
    ?? campaignRootFromAggregatePath(primaryEvidencePath(projection));
}

function renderProjectionBlocker(
  projection: CurrentStatusProjection,
  options: { humanSummary?: boolean } = {},
): string | null {
  if (projection.goal !== 'release-ready' || projection.presentation_status === 'passed') {
    return null;
  }

  const evidencePath = primaryEvidencePath(projection);
  const humanEvidencePath = options.humanSummary
    ? releaseEvidenceRootForProjection(projection) ?? evidencePath
    : evidencePath;
  return renderShortFailureProjection({
    blocker: options.humanSummary
      ? humanReleaseStepLabel(projection.primary_blocker?.owner ?? projection.deepest_reason?.code ?? projection.presentation_status)
      : projection.primary_blocker?.owner ?? projection.deepest_reason?.code ?? projection.presentation_status,
    stage: options.humanSummary
      ? humanReleaseStageLabel(projection.primary_blocker?.stage ?? projection.phase)
      : projection.primary_blocker?.stage ?? projection.phase,
    why: options.humanSummary
      ? humanReleaseReason(projection.deepest_reason?.summary ?? projection.presentation_status)
      : projection.deepest_reason?.summary ?? projection.presentation_status,
    inspectCommand: humanEvidencePath ?? 'release status artifacts are not available yet.',
    rerunCommand: releaseReadyRerunCommand(projection),
    evidencePath: humanEvidencePath,
  }).trimEnd();
}

function renderCompactLeaseShadow(projection: CurrentStatusProjection): string {
  const shadow = projection.lease_status_shadow;
  if (!shadow) {
    return 'Lease shadow: active_run=not-known; locks=not-known';
  }

  const activeRun = shadow.active_run?.run_id ?? 'none observed';
  const lockStates = [
    `destructive=${renderLeaseLockPresence(shadow.destructive_command_lock)}`,
    `ports=${renderLeaseLockPresence(shadow.port_family)}`,
    `secret_profile=${renderLeaseLockPresence(shadow.secret_profile_lock)}`,
    `profile_presence=${String(shadow.secret_profile_lock.profile.present)}`,
  ].join('; ');
  return `Lease shadow: active_run=${activeRun}; ${lockStates}`;
}

export function renderStatusProjectionSummary(projection: CurrentStatusProjection): string {
  const blocker = renderProjectionBlocker(projection, { humanSummary: true });
  const evidenceRoot = releaseEvidenceRootForProjection(projection) ?? primaryEvidencePath(projection);
  return [
    'AgentSmith Product Readiness Status',
    '',
    'Read-only: release:status does not rerun checks or revalidate evidence.',
    `Status: ${projection.presentation_status}`,
    ...(blocker ? [blocker] : []),
    `Evidence: ${renderOptionalPath(evidenceRoot)}`,
    ...renderRunObservabilityLines(projection.run_observability),
    `Next: ${renderOptionalPublicCommand(releaseReadyRerunCommand(projection))}`,
    renderCompactLeaseShadow(projection),
    `Note: ${RELEASE_HUMAN_LOG_NOTE}`,
    '',
  ].join('\n');
}

export function renderStatusProjection(projection: CurrentStatusProjection): string {
  const blocker = renderProjectionBlocker(projection);
  return [
    'AgentSmith Status Projection',
    '',
    ...(blocker ? [blocker, ''] : []),
    `Projection kind: ${projection.projection_kind.replaceAll('_', '-')}`,
    `Goal: ${renderOptional(projection.goal)}`,
    `Runtime line: ${renderOptional(projection.runtime_line)}`,
    `Run: ${renderOptional(projection.run_id)}`,
    `Phase: ${projection.phase}`,
    `Aggregate status ref: ${renderAggregateStatusRef(projection.aggregate_status_ref)}`,
    `Presentation status: ${projection.presentation_status}`,
    `Primary blocker: ${renderPrimaryBlocker(projection.primary_blocker)}`,
    `Deepest reason: ${renderDeepestReason(projection.deepest_reason)}`,
    `Next action: ${renderOptionalPublicCommand(projection.safe_next_command)}`,
    `Safe action: ${renderOptionalPublicCommand(projection.safe_next_command)}`,
    `Diagnostic context: ${renderResumeRecommendation(projection.resume_recommendation)}`,
    `Recovery: ${renderOptional(projection.destructive_recovery_command)}`,
    `Freshness: current_git_sha=${renderOptional(projection.current_git_sha)}; evidence_git_sha=${renderOptional(projection.evidence_git_sha)}; run_age_seconds=${renderOptional(projection.run_age_seconds)}`,
    `Locks: ${renderLocks(projection.lock_owner)}`,
    ...renderStatusProjectionLeaseShadowLines(projection),
    ...renderRunObservabilityLines(projection.run_observability),
    `Manual sign-off: ${projection.manual_signoff_status}`,
    `Evidence: ${renderPathRefs(projection.evidence_paths)}`,
    `Authority: aggregate=${renderOptionalPath(projection.authority_paths.aggregate)}; stage=${renderOptionalPath(projection.authority_paths.stage)}; evidence=${projection.authority_paths.evidence.length > 0 ? projection.authority_paths.evidence.map(redactProjectionPath).join('; ') : '<none>'}`,
    `Release decision produced: ${String(projection.release_decision_produced)}`,
    `Commands executed: ${String(projection.commands_executed)}`,
    `Leases acquired: ${String(projection.leases_acquired)}`,
    `Leases released: ${String(projection.leases_released)}`,
    'Note: read-only projection; it points at current authority artifacts and does not produce a release decision.',
    '',
  ].join('\n');
}
