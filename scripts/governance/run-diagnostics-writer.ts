import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES,
  CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
  validateCurrentRunDiagnosticArtifactPayload,
  type CurrentRunDiagnosticArtifactKind,
} from './current-run-diagnostics-schema';
import { redactSensitiveText } from './redaction';

export interface CurrentRunDiagnosticsBaseInput {
  run_root: string;
  run_id: string;
  gate_id?: string;
  line_kind?: string;
}

export interface CurrentRunStageEventInput extends CurrentRunDiagnosticsBaseInput {
  stage: string;
  event: string;
  npm_script?: string;
  ci_job?: string;
  diagnostic_reason_code?: string;
  stage_failure_reason?: string;
  stage_log_path?: string;
  stage_input_digest?: string;
  stage_artifact_digest?: string;
  generated_at?: string;
}

export interface CurrentRunPerformanceStage {
  stage: string;
  started_at?: string;
  finished_at?: string;
  duration_ms: number;
  diagnostic_reason_code?: string;
  stage_failure_reason?: string;
}

export interface CurrentRunPerformanceInput extends CurrentRunDiagnosticsBaseInput {
  npm_script?: string;
  ci_job?: string;
  stages: readonly CurrentRunPerformanceStage[];
  generated_at?: string;
}

export interface CurrentRunSkipDecisionInput extends CurrentRunDiagnosticsBaseInput {
  target: string;
  operation: string;
  input_digest: string;
  existing_artifact_digest: string;
  skip_reason: string;
  validator: string;
  generated_at?: string;
}

export interface WrappedCommandStartDiagnosticsInput extends CurrentRunDiagnosticsBaseInput {
  stage: string;
  npm_script?: string;
  ci_job?: string;
  started_at?: string;
}

export interface WrappedCommandFinishDiagnosticsInput extends CurrentRunDiagnosticsBaseInput {
  stage: string;
  event: 'finished' | 'failed';
  npm_script?: string;
  ci_job?: string;
  started_at?: string;
  finished_at?: string;
  started_ms?: number;
  finished_ms?: number;
  diagnostic_reason_code?: string;
  stage_failure_reason?: string;
}

type DiagnosticPayload = Record<string, unknown>;

export function initializeCurrentRunDiagnosticsArtifacts(input: { run_root: string }): void {
  mkdirSync(input.run_root, { recursive: true });
  writeFileSync(resolveDiagnosticArtifactPath(input.run_root, 'stage_events'), '');
  writeFileSync(resolveDiagnosticArtifactPath(input.run_root, 'skip_decisions'), '');
  rmSync(resolveDiagnosticArtifactPath(input.run_root, 'performance'), { force: true });
}

export function appendCurrentRunStageEvent(input: CurrentRunStageEventInput): void {
  const payload = omitUndefined({
    schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
    artifact_kind: 'stage_event',
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stage: input.stage,
    event: input.event,
    diagnostic_reason_code: sanitizeReasonText(input.diagnostic_reason_code),
    stage_failure_reason: sanitizeReasonText(input.stage_failure_reason),
    stage_log_path: input.stage_log_path,
    stage_input_digest: input.stage_input_digest,
    stage_artifact_digest: input.stage_artifact_digest,
    generated_at: input.generated_at ?? new Date().toISOString(),
  });

  assertValidDiagnosticPayload('stage_events', payload);
  appendJsonLine(resolveDiagnosticArtifactPath(input.run_root, 'stage_events'), payload);
}

export function writeCurrentRunPerformance(input: CurrentRunPerformanceInput): void {
  const performancePath = resolveDiagnosticArtifactPath(input.run_root, 'performance');
  const incomingStages = input.stages.map((stage) => omitUndefined({
    stage: stage.stage,
    started_at: stage.started_at,
    finished_at: stage.finished_at,
    duration_ms: stage.duration_ms,
    diagnostic_reason_code: sanitizeReasonText(stage.diagnostic_reason_code),
    stage_failure_reason: sanitizeReasonText(stage.stage_failure_reason),
  }));
  const payload = omitUndefined({
    schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
    artifact_kind: 'performance',
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stages: [...readExistingPerformanceStages(performancePath), ...incomingStages],
    generated_at: input.generated_at ?? new Date().toISOString(),
  });

  assertValidDiagnosticPayload('performance', payload);
  writeJson(performancePath, payload);
}

export function appendCurrentRunSkipDecision(input: CurrentRunSkipDecisionInput): void {
  const payload = omitUndefined({
    schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
    artifact_kind: 'skip_decision',
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    target: input.target,
    operation: input.operation,
    input_digest: input.input_digest,
    existing_artifact_digest: input.existing_artifact_digest,
    skip_reason: input.skip_reason,
    validator: input.validator,
    generated_at: input.generated_at ?? new Date().toISOString(),
  });

  assertValidDiagnosticPayload('skip_decisions', payload);
  appendJsonLine(resolveDiagnosticArtifactPath(input.run_root, 'skip_decisions'), payload);
}

export function writeWrappedCommandStartDiagnostics(input: WrappedCommandStartDiagnosticsInput): void {
  initializeCurrentRunDiagnosticsArtifacts({
    run_root: input.run_root,
  });
  appendCurrentRunStageEvent({
    run_root: input.run_root,
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stage: input.stage,
    event: 'started',
    diagnostic_reason_code: 'wrapped_command_started',
    generated_at: input.started_at,
  });
}

export function writeWrappedCommandFinishDiagnostics(input: WrappedCommandFinishDiagnosticsInput): void {
  const finishedAt = input.finished_at ?? new Date().toISOString();
  const durationMs = resolveDurationMs(input.started_ms, input.finished_ms);

  appendCurrentRunStageEvent({
    run_root: input.run_root,
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stage: input.stage,
    event: input.event,
    diagnostic_reason_code: input.diagnostic_reason_code,
    stage_failure_reason: input.stage_failure_reason,
    generated_at: finishedAt,
  });
  writeCurrentRunPerformance({
    run_root: input.run_root,
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stages: [
      {
        stage: input.stage,
        started_at: input.started_at,
        finished_at: finishedAt,
        duration_ms: durationMs,
        diagnostic_reason_code: input.event === 'finished'
          ? 'wrapped_command_duration_observed'
          : undefined,
        stage_failure_reason: input.event === 'failed'
          ? input.stage_failure_reason ?? 'wrapped_command_exited_nonzero'
          : undefined,
      },
    ],
    generated_at: finishedAt,
  });
}

export function writeRehearsalStageStartDiagnostics(input: WrappedCommandStartDiagnosticsInput): void {
  appendCurrentRunStageEvent({
    run_root: input.run_root,
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stage: input.stage,
    event: 'started',
    diagnostic_reason_code: 'rehearsal_stage_started',
    generated_at: input.started_at,
  });
}

export function writeRehearsalStageFinishDiagnostics(input: WrappedCommandFinishDiagnosticsInput): void {
  const finishedAt = input.finished_at ?? new Date().toISOString();
  const durationMs = resolveDurationMs(input.started_ms, input.finished_ms);
  const failureReason = input.stage_failure_reason ?? 'rehearsal_stage_exited_nonzero';

  appendCurrentRunStageEvent({
    run_root: input.run_root,
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stage: input.stage,
    event: input.event,
    diagnostic_reason_code: input.event === 'finished'
      ? input.diagnostic_reason_code ?? 'rehearsal_stage_completed'
      : undefined,
    stage_failure_reason: input.event === 'failed'
      ? failureReason
      : undefined,
    generated_at: finishedAt,
  });
  writeCurrentRunPerformance({
    run_root: input.run_root,
    run_id: input.run_id,
    gate_id: input.gate_id,
    line_kind: input.line_kind,
    npm_script: input.npm_script,
    ci_job: input.ci_job,
    stages: [
      {
        stage: input.stage,
        started_at: input.started_at,
        finished_at: finishedAt,
        duration_ms: durationMs,
        diagnostic_reason_code: input.event === 'finished'
          ? 'rehearsal_stage_duration_observed'
          : undefined,
        stage_failure_reason: input.event === 'failed'
          ? failureReason
          : undefined,
      },
    ],
    generated_at: finishedAt,
  });
}

export function resolveDiagnosticArtifactPath(
  runRoot: string,
  kind: CurrentRunDiagnosticArtifactKind,
): string {
  return join(runRoot, CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES[kind]);
}

function appendJsonLine(file: string, payload: DiagnosticPayload): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(payload)}\n`);
}

function writeJson(file: string, payload: DiagnosticPayload): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

function readExistingPerformanceStages(file: string): readonly DiagnosticPayload[] {
  if (!existsSync(file)) {
    return [];
  }

  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(payload) || !Array.isArray(payload.stages)) {
    return [];
  }

  return payload.stages.filter(isRecord).map(sanitizePerformanceStage);
}

function assertValidDiagnosticPayload(
  kind: CurrentRunDiagnosticArtifactKind,
  payload: DiagnosticPayload,
): void {
  const result = validateCurrentRunDiagnosticArtifactPayload(kind, payload);
  if (!result.ok) {
    throw new Error(result.failures.map((failure) => `${failure.path}: ${failure.reason}`).join('\n'));
  }
}

function omitUndefined(input: DiagnosticPayload): DiagnosticPayload {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function sanitizeReasonText(value: string | undefined): string | undefined {
  return typeof value === 'string' ? redactSensitiveText(value) : undefined;
}

function sanitizePerformanceStage(stage: DiagnosticPayload): DiagnosticPayload {
  return omitUndefined({
    ...stage,
    diagnostic_reason_code: typeof stage.diagnostic_reason_code === 'string'
      ? sanitizeReasonText(stage.diagnostic_reason_code)
      : stage.diagnostic_reason_code,
    stage_failure_reason: typeof stage.stage_failure_reason === 'string'
      ? sanitizeReasonText(stage.stage_failure_reason)
      : stage.stage_failure_reason,
  });
}

function resolveDurationMs(startedMs: number | undefined, finishedMs: number | undefined): number {
  if (typeof startedMs !== 'number' || typeof finishedMs !== 'number') {
    return 0;
  }
  if (!Number.isFinite(startedMs) || !Number.isFinite(finishedMs)) {
    return 0;
  }
  return Math.max(0, finishedMs - startedMs);
}

function isRecord(value: unknown): value is DiagnosticPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function optionalNumberEnv(name: string): number | undefined {
  const value = optionalEnv(name);
  if (!value) {
    return undefined;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${name} must be numeric`);
  }
  return numericValue;
}

function runCliFromEnv(): void {
  const action = requireEnv('CURRENT_RUN_DIAGNOSTICS_ACTION');
  const baseInput = {
    run_root: requireEnv('CURRENT_RUN_DIAGNOSTICS_RUN_ROOT'),
    run_id: requireEnv('CURRENT_RUN_DIAGNOSTICS_RUN_ID'),
    gate_id: optionalEnv('CURRENT_RUN_DIAGNOSTICS_GATE_ID'),
    line_kind: optionalEnv('CURRENT_RUN_DIAGNOSTICS_LINE_KIND'),
    npm_script: optionalEnv('CURRENT_RUN_DIAGNOSTICS_NPM_SCRIPT'),
    ci_job: optionalEnv('CURRENT_RUN_DIAGNOSTICS_CI_JOB'),
    stage: requireEnv('CURRENT_RUN_DIAGNOSTICS_STAGE'),
  };

  if (action === 'wrapped-command-start') {
    writeWrappedCommandStartDiagnostics({
      ...baseInput,
      started_at: optionalEnv('CURRENT_RUN_DIAGNOSTICS_STARTED_AT'),
    });
    return;
  }

  if (action === 'wrapped-command-finish') {
    const event = requireEnv('CURRENT_RUN_DIAGNOSTICS_EVENT');
    if (event !== 'finished' && event !== 'failed') {
      throw new Error('CURRENT_RUN_DIAGNOSTICS_EVENT must be finished or failed');
    }

    writeWrappedCommandFinishDiagnostics({
      ...baseInput,
      event,
      started_at: optionalEnv('CURRENT_RUN_DIAGNOSTICS_STARTED_AT'),
      finished_at: optionalEnv('CURRENT_RUN_DIAGNOSTICS_FINISHED_AT'),
      started_ms: optionalNumberEnv('CURRENT_RUN_DIAGNOSTICS_STARTED_MS'),
      finished_ms: optionalNumberEnv('CURRENT_RUN_DIAGNOSTICS_FINISHED_MS'),
      diagnostic_reason_code: optionalEnv('CURRENT_RUN_DIAGNOSTICS_REASON_CODE'),
      stage_failure_reason: optionalEnv('CURRENT_RUN_DIAGNOSTICS_FAILURE_REASON'),
    });
    return;
  }

  if (action === 'rehearsal-stage-start') {
    writeRehearsalStageStartDiagnostics({
      ...baseInput,
      started_at: optionalEnv('CURRENT_RUN_DIAGNOSTICS_STARTED_AT'),
    });
    return;
  }

  if (action === 'rehearsal-stage-finish') {
    const event = requireEnv('CURRENT_RUN_DIAGNOSTICS_EVENT');
    if (event !== 'finished' && event !== 'failed') {
      throw new Error('CURRENT_RUN_DIAGNOSTICS_EVENT must be finished or failed');
    }

    writeRehearsalStageFinishDiagnostics({
      ...baseInput,
      event,
      started_at: optionalEnv('CURRENT_RUN_DIAGNOSTICS_STARTED_AT'),
      finished_at: optionalEnv('CURRENT_RUN_DIAGNOSTICS_FINISHED_AT'),
      started_ms: optionalNumberEnv('CURRENT_RUN_DIAGNOSTICS_STARTED_MS'),
      finished_ms: optionalNumberEnv('CURRENT_RUN_DIAGNOSTICS_FINISHED_MS'),
      diagnostic_reason_code: optionalEnv('CURRENT_RUN_DIAGNOSTICS_REASON_CODE'),
      stage_failure_reason: optionalEnv('CURRENT_RUN_DIAGNOSTICS_FAILURE_REASON'),
    });
    return;
  }

  throw new Error('unknown CURRENT_RUN_DIAGNOSTICS_ACTION');
}

function isDirectCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return resolve(entrypoint) === fileURLToPath(import.meta.url);
}

if (isDirectCliEntrypoint()) {
  try {
    runCliFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'run diagnostics writer failed';
    process.stderr.write(`${redactSensitiveText(message)}\n`);
    process.exit(1);
  }
}
