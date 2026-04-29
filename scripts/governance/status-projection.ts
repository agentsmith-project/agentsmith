import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
} from './current-status-projection-schema';
import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';
import type {
  MinimalLeaseLockSection,
  MinimalLeaseOwnerRef,
  MinimalLeasePortFamilySection,
  MinimalLeaseSecretProfileSection,
} from './lease-status-shadow';
import { validateCurrentRunDiagnosticArtifactPayload } from './current-run-diagnostics-schema';
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

type RehearsalGoal = Extract<CurrentStatusProjectionGoal, 'demo-rehearsal' | 'cluster-rehearsal'>;

interface RehearsalStatusConfig {
  goal: RehearsalGoal;
  gateId: 'lane-demo-rehearsal' | 'lane-cluster-rehearsal';
  lineKind: 'demo_rehearsal' | 'cluster_rehearsal';
  safeNextCommand: 'npm run rehearse:demo' | 'npm run rehearse:cluster';
}

interface RehearsalResultCandidate {
  runId: string;
  runRoot: string;
  resultPath: string;
  content: string;
  sortTimestamp: number;
}

interface RehearsalStageEvent {
  stage: string;
  event: string;
  diagnosticReasonCode: string | null;
  stageFailureReason: string | null;
}

interface RehearsalDiagnosticArtifact {
  path: string;
  digest: string;
}

interface RehearsalStageEventsArtifact extends RehearsalDiagnosticArtifact {
  lastFailedEvent: RehearsalStageEvent | null;
}

interface ParsedRehearsalEvidence {
  ok: true;
  config: RehearsalStatusConfig;
  laneRoot: string;
  runRoot: string;
  runId: string;
  resultPath: string;
  resultDigest: string;
  status: CurrentGateResultStatus;
  failureClass: CurrentGateResultFailureClass;
  stage: string;
  summary: string;
  stageEvents: RehearsalStageEventsArtifact | null;
  performance: RehearsalDiagnosticArtifact | null;
}

interface MissingRehearsalEvidence {
  ok: false;
  config: RehearsalStatusConfig;
  laneRoot: string;
  path: string;
  reasonCode: string;
  summary: string;
}

type RehearsalEvidenceRead = ParsedRehearsalEvidence | MissingRehearsalEvidence;

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

const DEFAULT_GENERATED_AT = '1970-01-01T00:00:00.000Z';
const REHEARSAL_STATUS_CONFIGS: Record<RehearsalGoal, RehearsalStatusConfig> = {
  'demo-rehearsal': {
    goal: 'demo-rehearsal',
    gateId: 'lane-demo-rehearsal',
    lineKind: 'demo_rehearsal',
    safeNextCommand: 'npm run rehearse:demo',
  },
  'cluster-rehearsal': {
    goal: 'cluster-rehearsal',
    gateId: 'lane-cluster-rehearsal',
    lineKind: 'cluster_rehearsal',
    safeNextCommand: 'npm run rehearse:cluster',
  },
};

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

function releaseAggregateResultPath(campaignRoot: string): string {
  return join(resolve(campaignRoot), 'gate-release-full', 'result.json');
}

function gateResultsRoot(input?: string | null): string {
  return resolve(input ?? join(process.cwd(), 'artifacts', 'gate-results'));
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
      summary: 'No release campaign root was provided.',
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

function rehearsalConfigForGoal(goal: CurrentStatusProjectionGoal): RehearsalStatusConfig | null {
  if (goal === 'demo-rehearsal' || goal === 'cluster-rehearsal') {
    return REHEARSAL_STATUS_CONFIGS[goal];
  }
  return null;
}

function latestRehearsalResultCandidate(laneRoot: string): RehearsalResultCandidate | null {
  if (!existsSync(laneRoot)) {
    return null;
  }

  const candidates: RehearsalResultCandidate[] = [];
  for (const entry of readdirSync(laneRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const runId = entry.name;
    const runRoot = join(laneRoot, runId);
    const resultPath = join(runRoot, 'result.json');
    if (!existsSync(resultPath)) {
      continue;
    }

    let content: string;
    try {
      content = readFileSync(resultPath, 'utf8');
    } catch {
      continue;
    }

    let sortTimestamp = 0;
    try {
      sortTimestamp = statSync(resultPath).mtimeMs;
    } catch {
      // Keep the run visible even if filesystem metadata races during a read-only status check.
    }
    try {
      const parsed = JSON.parse(content) as unknown;
      if (isRecord(parsed) && typeof parsed.generated_at === 'string') {
        const generatedAtMs = new Date(parsed.generated_at).getTime();
        if (Number.isFinite(generatedAtMs)) {
          sortTimestamp = generatedAtMs;
        }
      }
    } catch {
      // Keep the filesystem timestamp fallback so malformed latest results are still visible.
    }

    candidates.push({
      runId,
      runRoot,
      resultPath,
      content,
      sortTimestamp,
    });
  }

  return candidates
    .sort((left, right) => (
      left.sortTimestamp - right.sortTimestamp
      || left.runId.localeCompare(right.runId)
    ))
    .at(-1) ?? null;
}

function readDiagnosticContent(path: string): (RehearsalDiagnosticArtifact & { content: string }) | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const content = readFileSync(path, 'utf8');
    return {
      path,
      digest: sha256(content),
      content,
    };
  } catch {
    return null;
  }
}

function matchesRehearsalDiagnosticIdentity(input: {
  value: unknown;
  kind: 'stage_events' | 'performance';
  artifactKind: 'stage_event' | 'performance';
  runId: string;
  config: RehearsalStatusConfig;
}): input is {
  value: Record<string, unknown>;
  kind: 'stage_events' | 'performance';
  artifactKind: 'stage_event' | 'performance';
  runId: string;
  config: RehearsalStatusConfig;
} {
  if (!isRecord(input.value)) {
    return false;
  }
  if (validateCurrentRunDiagnosticArtifactPayload(input.kind, input.value).ok !== true) {
    return false;
  }
  return input.value.artifact_kind === input.artifactKind
    && input.value.run_id === input.runId
    && input.value.gate_id === input.config.gateId
    && input.value.line_kind === input.config.lineKind;
}

function parseRehearsalStageEvent(value: Record<string, unknown>): RehearsalStageEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.stage !== 'string' || typeof value.event !== 'string') {
    return null;
  }
  return {
    stage: value.stage,
    event: value.event,
    diagnosticReasonCode: typeof value.diagnostic_reason_code === 'string'
      ? value.diagnostic_reason_code
      : null,
    stageFailureReason: typeof value.stage_failure_reason === 'string'
      ? value.stage_failure_reason
      : null,
  };
}

function isGenericWrapperFailedEvent(event: RehearsalStageEvent): boolean {
  if (event.stage !== 'execute') {
    return false;
  }
  return event.diagnosticReasonCode === 'execute:failed'
    || event.stageFailureReason === 'wrapped_command_exited_nonzero';
}

function readRehearsalStageEventsArtifact(input: {
  path: string;
  runId: string;
  config: RehearsalStatusConfig;
}): RehearsalStageEventsArtifact | null {
  const artifact = readDiagnosticContent(input.path);
  if (!artifact) {
    return null;
  }

  let sawValidSameRunEvent = false;
  let lastInnerFailedEvent: RehearsalStageEvent | null = null;
  let lastWrapperFailedEvent: RehearsalStageEvent | null = null;
  for (const line of artifact.content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    if (!matchesRehearsalDiagnosticIdentity({
      value: parsed,
      kind: 'stage_events',
      artifactKind: 'stage_event',
      runId: input.runId,
      config: input.config,
    })) {
      continue;
    }
    const event = parseRehearsalStageEvent(parsed);
    if (!event) {
      continue;
    }
    sawValidSameRunEvent = true;
    if (event.event !== 'failed') {
      continue;
    }
    if (isGenericWrapperFailedEvent(event)) {
      lastWrapperFailedEvent = event;
    } else {
      lastInnerFailedEvent = event;
    }
  }

  if (!sawValidSameRunEvent) {
    return null;
  }

  const { content: _content, ...diagnosticArtifact } = artifact;
  return {
    ...diagnosticArtifact,
    lastFailedEvent: lastInnerFailedEvent ?? lastWrapperFailedEvent,
  };
}

function readRehearsalPerformanceArtifact(input: {
  path: string;
  runId: string;
  config: RehearsalStatusConfig;
}): RehearsalDiagnosticArtifact | null {
  const artifact = readDiagnosticContent(input.path);
  if (!artifact) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(artifact.content) as unknown;
  } catch {
    return null;
  }
  if (!matchesRehearsalDiagnosticIdentity({
    value: parsed,
    kind: 'performance',
    artifactKind: 'performance',
    runId: input.runId,
    config: input.config,
  })) {
    return null;
  }

  const { content: _content, ...diagnosticArtifact } = artifact;
  return {
    ...diagnosticArtifact,
  };
}

function rehearsalMalformedEvidence(input: {
  config: RehearsalStatusConfig;
  laneRoot: string;
  path: string;
  reasonCode: string;
  summary: string;
}): MissingRehearsalEvidence {
  return {
    ok: false,
    config: input.config,
    laneRoot: input.laneRoot,
    path: input.path,
    reasonCode: input.reasonCode,
    summary: input.summary,
  };
}

function readRehearsalEvidence(input: {
  config: RehearsalStatusConfig;
  gateResultsRoot?: string | null;
}): RehearsalEvidenceRead {
  const root = gateResultsRoot(input.gateResultsRoot);
  const laneRoot = join(root, input.config.gateId);
  const latest = latestRehearsalResultCandidate(laneRoot);
  if (!latest) {
    return {
      ok: false,
      config: input.config,
      laneRoot,
      path: laneRoot,
      reasonCode: 'rehearsal_evidence_missing',
      summary: `No rehearsal evidence found under ${laneRoot}.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(latest.content) as unknown;
  } catch (error) {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_malformed',
      summary: `Rehearsal result is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (!isRecord(parsed)) {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_malformed',
      summary: 'Rehearsal result must be a JSON object.',
    });
  }

  if (
    parsed.schema_version !== CURRENT_GATE_RESULT_SCHEMA_VERSION
    || parsed.gate_id !== input.config.gateId
    || parsed.line_kind !== input.config.lineKind
  ) {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_wrong_lane',
      summary: `Rehearsal result must be ${input.config.gateId} / ${input.config.lineKind}.`,
    });
  }

  if (
    typeof parsed.status !== 'string'
    || typeof parsed.failure_class !== 'string'
    || typeof parsed.stage !== 'string'
    || typeof parsed.summary !== 'string'
  ) {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_malformed',
      summary: 'Rehearsal result must include status, failure_class, stage, and summary strings.',
    });
  }

  if (!CURRENT_GATE_RESULT_STATUSES.includes(parsed.status as CurrentGateResultStatus)) {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_invalid_status',
      summary: 'Rehearsal result status is not a current gate result status.',
    });
  }
  if (!CURRENT_GATE_RESULT_FAILURE_CLASSES.includes(parsed.failure_class as CurrentGateResultFailureClass)) {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_invalid_failure_class',
      summary: 'Rehearsal result failure_class is not a current gate result failure class.',
    });
  }

  const status = parsed.status as CurrentGateResultStatus;
  const failureClass = parsed.failure_class as CurrentGateResultFailureClass;
  if (status === 'passed' && failureClass !== 'none') {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_inconsistent',
      summary: 'Rehearsal result is inconsistent: passed result must use failure_class none.',
    });
  }
  if (status === 'failed' && failureClass === 'none') {
    return rehearsalMalformedEvidence({
      config: input.config,
      laneRoot,
      path: latest.resultPath,
      reasonCode: 'rehearsal_result_inconsistent',
      summary: 'Rehearsal result is inconsistent: failed result must use a non-none failure_class.',
    });
  }

  return {
    ok: true,
    config: input.config,
    laneRoot,
    runRoot: latest.runRoot,
    runId: latest.runId,
    resultPath: latest.resultPath,
    resultDigest: sha256(latest.content),
    status,
    failureClass,
    stage: parsed.stage,
    summary: parsed.summary,
    stageEvents: readRehearsalStageEventsArtifact({
      path: join(latest.runRoot, 'stage-events.jsonl'),
      runId: latest.runId,
      config: input.config,
    }),
    performance: readRehearsalPerformanceArtifact({
      path: join(latest.runRoot, 'performance.json'),
      runId: latest.runId,
      config: input.config,
    }),
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
  if (owner === 'lane-visual') {
    return 'npm run verify -- --goal=visual --run';
  }
  if (owner === 'gate-release') {
    return 'npm run verify -- --goal=release-real --run';
  }
  if (owner === 'lane-demo-rehearsal') {
    return 'npm run rehearse:demo';
  }
  if (owner === 'lane-cluster-rehearsal') {
    return 'npm run rehearse:cluster';
  }
  if (owner === 'gate-fast') {
    return 'npm run verify -- --goal=debug --run';
  }
  if (owner === 'gate-default') {
    return 'npm run verify -- --goal=pr --run';
  }
  if (goal === 'local-real') {
    return 'make local-real-status';
  }
  if (goal === 'demo-rehearsal') {
    return 'npm run rehearse:demo';
  }
  if (goal === 'cluster-rehearsal') {
    return 'npm run rehearse:cluster';
  }
  if (goal === 'release-ready') {
    return 'npm run release:ready';
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

function rehearsalPresentationStatus(input: {
  evidence: ParsedRehearsalEvidence;
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
  return input.evidence.status === 'passed' ? 'passed' : 'failed';
}

function rehearsalEvidencePathRefs(
  evidence: ParsedRehearsalEvidence,
): readonly CurrentStatusProjectionPathRef[] {
  return [
    {
      path: redactProjectionPath(evidence.resultPath),
      digest: evidence.resultDigest,
    },
    ...(evidence.stageEvents
      ? [{
          path: redactProjectionPath(evidence.stageEvents.path),
          digest: evidence.stageEvents.digest,
        }]
      : []),
    ...(evidence.performance
      ? [{
          path: redactProjectionPath(evidence.performance.path),
          digest: evidence.performance.digest,
        }]
      : []),
  ];
}

function rehearsalAuthorityEvidencePaths(evidence: ParsedRehearsalEvidence): readonly string[] {
  return rehearsalEvidencePathRefs(evidence).map((entry) => entry.path);
}

function rehearsalStageAuthorityPath(evidence: ParsedRehearsalEvidence): string {
  if (evidence.stageEvents) {
    return redactProjectionPath(evidence.stageEvents.path);
  }
  return redactProjectionPath(evidence.resultPath);
}

function rehearsalFailedPrimaryBlocker(evidence: ParsedRehearsalEvidence): CurrentStatusProjectionBlocker {
  const failedEvent = evidence.stageEvents?.lastFailedEvent ?? null;
  return {
    owner: evidence.config.gateId,
    stage: normalizePhase(failedEvent?.stage ?? evidence.stage),
    path: failedEvent && evidence.stageEvents
      ? redactProjectionPath(evidence.stageEvents.path)
      : redactProjectionPath(evidence.resultPath),
  };
}

function reasonForRehearsal(input: {
  evidence: ParsedRehearsalEvidence;
  presentationStatus: CurrentStatusProjectionPresentationStatus;
  currentGitSha: string | null;
  evidenceGitSha: string | null;
}): CurrentStatusProjectionReason {
  if (input.presentationStatus === 'stale') {
    return {
      code: 'stale_evidence_git_sha',
      summary: redactProjectionText(
        `Evidence git sha ${input.evidenceGitSha ?? '<unknown>'} does not match current git sha ${input.currentGitSha ?? '<unknown>'}.`,
      ),
      source_path: redactProjectionPath(input.evidence.resultPath),
    };
  }

  const failedEvent = input.evidence.stageEvents?.lastFailedEvent ?? null;
  if (input.presentationStatus === 'failed' && failedEvent) {
    const rawReason = failedEvent.stageFailureReason
      ?? failedEvent.diagnosticReasonCode
      ?? 'rehearsal_stage_failed';
    const safeReason = redactProjectionText(rawReason);
    return {
      code: safeReason,
      summary: redactProjectionText(`Rehearsal stage ${failedEvent.stage} failed: ${rawReason}`),
      source_path: input.evidence.stageEvents
        ? redactProjectionPath(input.evidence.stageEvents.path)
        : redactProjectionPath(input.evidence.resultPath),
    };
  }

  if (input.presentationStatus === 'failed') {
    return {
      code: 'rehearsal_result_failed',
      summary: redactProjectionText(input.evidence.summary),
      source_path: redactProjectionPath(input.evidence.resultPath),
    };
  }

  return {
    code: 'rehearsal_result_passed',
    summary: redactProjectionText(input.evidence.summary),
    source_path: redactProjectionPath(input.evidence.resultPath),
  };
}

function phaseForRehearsal(
  evidence: ParsedRehearsalEvidence,
  presentationStatus: CurrentStatusProjectionPresentationStatus,
): CurrentStatusProjectionPhase {
  if (presentationStatus === 'passed') {
    return 'complete';
  }
  if (presentationStatus === 'failed' && evidence.stageEvents?.lastFailedEvent) {
    return normalizePhase(evidence.stageEvents.lastFailedEvent.stage);
  }
  return normalizePhase(evidence.stage);
}

function buildMissingRehearsalProjection(input: {
  source: MissingRehearsalEvidence;
  options: BuildStatusProjectionInput;
  generatedAt: string;
  runtimeLine: string | null;
}): CurrentStatusProjection {
  const safePath = redactProjectionPath(input.source.path);

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
    phase: input.options.phase ?? 'not-started',
    aggregate_status_ref: null,
    presentation_status: input.source.reasonCode === 'rehearsal_evidence_missing'
      ? 'not-started'
      : 'unknown',
    primary_blocker: null,
    downstream_skipped: [],
    deepest_reason: {
      code: input.source.reasonCode,
      summary: redactProjectionText(input.source.summary),
      source_path: safePath,
    },
    safe_next_command: input.source.config.safeNextCommand,
    resume_recommendation: notAvailableResumeRecommendation({
      reasonCodes: [input.source.reasonCode],
      safeNextCommand: input.source.config.safeNextCommand,
      downstreamAggregateJobId: null,
    }),
    destructive_recovery_command: null,
    lock_owner: lockOwnerForInput(input.options),
    lease_status_shadow: leaseStatusShadowForInput(input.options),
    manual_signoff_status: 'not-covered',
    evidence_paths: [],
    authority_paths: {
      aggregate: null,
      stage: safePath,
      evidence: [],
    },
    generated_at: input.generatedAt,
    release_decision_produced: false,
    commands_executed: false,
    leases_acquired: false,
    leases_released: false,
  };
}

function buildRehearsalProjection(input: {
  evidence: ParsedRehearsalEvidence;
  options: BuildStatusProjectionInput;
  generatedAt: string;
  runtimeLine: string | null;
}): CurrentStatusProjection {
  const presentationStatus = rehearsalPresentationStatus({
    evidence: input.evidence,
    currentGitSha: input.options.currentGitSha ?? null,
    evidenceGitSha: input.options.evidenceGitSha ?? null,
  });

  return {
    schema: CURRENT_STATUS_PROJECTION_SCHEMA,
    version: CURRENT_STATUS_PROJECTION_VERSION,
    projection_kind: 'read_only',
    goal: input.options.goal,
    runtime_line: input.runtimeLine,
    run_id: input.options.runId ?? input.evidence.runId,
    current_git_sha: input.options.currentGitSha ?? null,
    evidence_git_sha: input.options.evidenceGitSha ?? null,
    run_age_seconds: runAgeSeconds(input.options),
    phase: input.options.phase ?? phaseForRehearsal(input.evidence, presentationStatus),
    aggregate_status_ref: null,
    presentation_status: presentationStatus,
    primary_blocker: presentationStatus === 'failed'
      ? rehearsalFailedPrimaryBlocker(input.evidence)
      : null,
    downstream_skipped: [],
    deepest_reason: reasonForRehearsal({
      evidence: input.evidence,
      presentationStatus,
      currentGitSha: input.options.currentGitSha ?? null,
      evidenceGitSha: input.options.evidenceGitSha ?? null,
    }),
    safe_next_command: presentationStatus === 'passed' ? null : input.evidence.config.safeNextCommand,
    resume_recommendation: notAvailableResumeRecommendation({
      reasonCodes: ['not_release_goal'],
      safeNextCommand: presentationStatus === 'passed' ? null : input.evidence.config.safeNextCommand,
      downstreamAggregateJobId: null,
    }),
    destructive_recovery_command: null,
    lock_owner: lockOwnerForInput(input.options),
    lease_status_shadow: leaseStatusShadowForInput(input.options),
    manual_signoff_status: 'not-covered',
    evidence_paths: rehearsalEvidencePathRefs(input.evidence),
    authority_paths: {
      aggregate: null,
      stage: rehearsalStageAuthorityPath(input.evidence),
      evidence: rehearsalAuthorityEvidencePaths(input.evidence),
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
  const rehearsalConfig = rehearsalConfigForGoal(input.goal);
  if (rehearsalConfig) {
    const rehearsalEvidence = readRehearsalEvidence({
      config: rehearsalConfig,
      gateResultsRoot: input.gateResultsRoot,
    });
    if (!rehearsalEvidence.ok) {
      return buildMissingRehearsalProjection({
        source: rehearsalEvidence,
        options: input,
        generatedAt,
        runtimeLine,
      });
    }
    return buildRehearsalProjection({
      evidence: rehearsalEvidence,
      options: input,
      generatedAt,
      runtimeLine,
    });
  }

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
    `safe_next=${renderOptional(recommendation.safe_next_command)}`,
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

export function renderStatusProjection(projection: CurrentStatusProjection): string {
  return [
    'AgentSmith Status Projection',
    '',
    `Projection kind: ${projection.projection_kind.replaceAll('_', '-')}`,
    `Goal: ${renderOptional(projection.goal)}`,
    `Runtime line: ${renderOptional(projection.runtime_line)}`,
    `Run: ${renderOptional(projection.run_id)}`,
    `Phase: ${projection.phase}`,
    `Aggregate status ref: ${renderAggregateStatusRef(projection.aggregate_status_ref)}`,
    `Presentation status: ${projection.presentation_status}`,
    `Primary blocker: ${renderPrimaryBlocker(projection.primary_blocker)}`,
    `Deepest reason: ${renderDeepestReason(projection.deepest_reason)}`,
    `Next action: ${renderOptional(projection.safe_next_command)}`,
    `Safe action: ${renderOptional(projection.safe_next_command)}`,
    `Resume recommendation: ${renderResumeRecommendation(projection.resume_recommendation)}`,
    `Recovery: ${renderOptional(projection.destructive_recovery_command)}`,
    `Freshness: current_git_sha=${renderOptional(projection.current_git_sha)}; evidence_git_sha=${renderOptional(projection.evidence_git_sha)}; run_age_seconds=${renderOptional(projection.run_age_seconds)}`,
    `Locks: ${renderLocks(projection.lock_owner)}`,
    ...renderStatusProjectionLeaseShadowLines(projection),
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
