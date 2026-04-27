import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES,
  validateCurrentRunDiagnosticArtifactPayload,
} from './current-run-diagnostics-schema';
import { redactSensitiveText } from './redaction';

export interface CurrentRunDiagnosticSelectorInput {
  runRoot: string;
  runId: string;
  gateId: string;
  lineKind: string;
  childStatus?: string;
}

export interface CurrentRunDiagnosticSelection {
  kind: 'inner_stage_failure' | 'fallback';
  stage: string;
  reason: string;
  summary: string;
}

interface StageEventPayload {
  run_id: string;
  gate_id: string;
  line_kind: string;
  stage: string;
  event: string;
  diagnostic_reason_code?: string;
  stage_failure_reason?: string;
}

const FALLBACK_REASON = 'child_exited_nonzero_without_inner_diagnostics';

export function selectCurrentRunFailureDiagnostic(
  input: CurrentRunDiagnosticSelectorInput,
): CurrentRunDiagnosticSelection {
  const stageEventsPath = join(input.runRoot, CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES.stage_events);
  const matchingFailures = readValidStageEvents(stageEventsPath).filter((event) => (
    event.run_id === input.runId
    && event.gate_id === input.gateId
    && event.line_kind === input.lineKind
    && event.event === 'failed'
  ));
  const innerFailure = matchingFailures.filter((event) => !isGenericWrapperFailure(event)).at(-1);

  if (innerFailure) {
    const stage = normalizeDiagnosticText(innerFailure.stage, 'unknown');
    const reason = normalizeDiagnosticText(
      innerFailure.stage_failure_reason ?? innerFailure.diagnostic_reason_code,
      'inner_stage_failed',
    );

    return {
      kind: 'inner_stage_failure',
      stage,
      reason,
      summary: `inner diagnostic stage ${stage} failed: ${reason}`,
    };
  }

  const statusSuffix = input.childStatus ? `; child exit status ${normalizeDiagnosticText(input.childStatus, 'unknown')}` : '';
  return {
    kind: 'fallback',
    stage: 'execute',
    reason: FALLBACK_REASON,
    summary: `${FALLBACK_REASON}: no inner diagnostics observed${statusSuffix}`,
  };
}

function readValidStageEvents(file: string): StageEventPayload[] {
  if (!existsSync(file)) {
    return [];
  }

  return readFileSync(file, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap(parseValidStageEvent);
}

function parseValidStageEvent(line: string): StageEventPayload[] {
  let payload: unknown;
  try {
    payload = JSON.parse(line) as unknown;
  } catch {
    return [];
  }

  const validation = validateCurrentRunDiagnosticArtifactPayload('stage_events', payload);
  if (!validation.ok || !isStageEventPayload(payload)) {
    return [];
  }

  return [payload];
}

function isGenericWrapperFailure(event: StageEventPayload): boolean {
  return event.stage === 'execute'
    && (
      event.stage_failure_reason === 'wrapped_command_exited_nonzero'
      || event.diagnostic_reason_code === 'execute:failed'
    );
}

function isStageEventPayload(value: unknown): value is StageEventPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.run_id === 'string'
    && typeof value.gate_id === 'string'
    && typeof value.line_kind === 'string'
    && typeof value.stage === 'string'
    && typeof value.event === 'string'
    && optionalString(value.diagnostic_reason_code)
    && optionalString(value.stage_failure_reason);
}

function normalizeDiagnosticText(value: string | undefined, fallback: string): string {
  const redacted = redactSensitiveText(value ?? '').replace(/\s+/gu, ' ').trim();
  return redacted.length > 0 ? redacted : fallback;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
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

function runCliFromEnv(): void {
  const selection = selectCurrentRunFailureDiagnostic({
    runRoot: requireEnv('CURRENT_RUN_DIAGNOSTICS_RUN_ROOT'),
    runId: requireEnv('CURRENT_RUN_DIAGNOSTICS_RUN_ID'),
    gateId: requireEnv('CURRENT_RUN_DIAGNOSTICS_GATE_ID'),
    lineKind: requireEnv('CURRENT_RUN_DIAGNOSTICS_LINE_KIND'),
    childStatus: optionalEnv('CURRENT_RUN_DIAGNOSTICS_CHILD_STATUS'),
  });

  process.stdout.write(`${JSON.stringify(selection)}\n`);
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
    const message = error instanceof Error ? error.message : 'current run diagnostic selector failed';
    process.stderr.write(`${redactSensitiveText(message)}\n`);
    process.exit(1);
  }
}
