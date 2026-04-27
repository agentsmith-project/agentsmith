import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
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
} from './current-status-projection-schema';

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

export interface BuildStatusProjectionInput {
  goal: CurrentStatusProjectionGoal;
  runtimeLine?: string | null;
  runId?: string | null;
  campaignRoot?: string | null;
  currentGitSha?: string | null;
  evidenceGitSha?: string | null;
  startedAt?: string | null;
  generatedAt?: string;
  phase?: CurrentStatusProjectionPhase;
  lockOwner?: CurrentStatusProjection['lock_owner'];
}

const DEFAULT_GENERATED_AT = '1970-01-01T00:00:00.000Z';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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

function aggregateStatusRef(result: ParsedAggregateResult): CurrentStatusProjectionAggregateStatusRef {
  return {
    path: result.path,
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
    return 'npm run verify:visual';
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
    return 'npm run verify:quick';
  }
  if (owner === 'gate-default') {
    return 'npm run verify:default';
  }
  if (goal === 'local-real') {
    return 'make local-real-status';
  }
  if (goal === 'release-ready') {
    return 'npm run release:ready';
  }
  return null;
}

function failedPrimaryBlocker(result: ParsedAggregateResult): CurrentStatusProjectionBlocker {
  const owner = inferBlockedOwner(result.summary) ?? 'gate-release-full';
  return {
    owner,
    stage: normalizePhase(result.stage),
    path: result.path,
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
      source_path: input.result.path,
    };
  }

  return {
    code: input.result.failureClass,
    summary: input.result.summary,
    source_path: input.result.path,
  };
}

function evidencePathsForAggregate(result: ParsedAggregateResult | null): readonly CurrentStatusProjectionPathRef[] {
  if (!result) {
    return [];
  }
  return [
    {
      path: result.path,
      digest: result.digest,
    },
  ];
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
      summary: running ? 'Release aggregate result has not been produced yet.' : input.source.summary,
      source_path: input.source.path.length > 0 ? input.source.path : null,
    },
    safe_next_command: safeCommandForOwner(null, input.options.goal),
    destructive_recovery_command: null,
    lock_owner: input.options.lockOwner ?? null,
    manual_signoff_status: 'not-covered',
    evidence_paths: [],
    authority_paths: {
      aggregate: null,
      stage: input.source.path.length > 0 ? input.source.path : null,
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
    safe_next_command: presentationStatus === 'passed' ? null : safeCommandForOwner(blockerOwner, input.goal),
    destructive_recovery_command: null,
    lock_owner: input.lockOwner ?? null,
    manual_signoff_status: 'not-covered',
    evidence_paths: evidencePathsForAggregate(aggregate),
    authority_paths: {
      aggregate: aggregate.path,
      stage: aggregate.path,
      evidence: [aggregate.path],
    },
    generated_at: generatedAt,
    release_decision_produced: false,
    commands_executed: false,
    leases_acquired: false,
    leases_released: false,
  };
}
