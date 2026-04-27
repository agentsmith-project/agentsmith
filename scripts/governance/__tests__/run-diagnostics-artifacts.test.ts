import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES,
  CURRENT_RUN_DIAGNOSTICS_ARTIFACTS,
  CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS,
  CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
  currentRunDiagnosticArtifactParticipatesInEvidenceCompleteness,
  validateCurrentRunDiagnosticArtifactPayload,
} from '../current-run-diagnostics-schema';
import {
  appendCurrentRunSkipDecision,
  appendCurrentRunStageEvent,
  initializeCurrentRunDiagnosticsArtifacts,
  writeCurrentRunPerformance,
} from '../run-diagnostics-writer';

type JsonRecord = Record<string, unknown>;

function readJson(file: string): JsonRecord {
  return JSON.parse(readFileSync(file, 'utf8')) as JsonRecord;
}

function readNdjson(file: string): JsonRecord[] {
  const content = readFileSync(file, 'utf8').trim();
  if (!content) {
    return [];
  }

  return content.split('\n').map((line) => JSON.parse(line) as JsonRecord);
}

function expectNoForbiddenFields(value: unknown, path = 'payload'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => expectNoForbiddenFields(item, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const [key, nested] of Object.entries(value as JsonRecord)) {
    expect(
      CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS,
      `${path}.${key} must not be a verdict/evidence-truth field`,
    ).not.toContain(key);
    expectNoForbiddenFields(nested, `${path}.${key}`);
  }
}

function expectValidPayload(kind: keyof typeof CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES, payload: unknown): void {
  const result = validateCurrentRunDiagnosticArtifactPayload(kind, payload);

  expect(result).toEqual({
    ok: true,
    value: payload,
  });
}

function runWrappedGate(input: {
  evidenceDir: string;
  command: string;
}): { status: number; result: JsonRecord } {
  let status = 0;
  try {
    execFileSync(
      'bash',
      [
        'scripts/run-current-gate-result-wrapped.sh',
        'lane-demo-rehearsal',
        'demo_rehearsal',
        'lane:demo-rehearsal',
        '--',
        'bash',
        '-lc',
        input.command,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CURRENT_GATE_RESULT_EVIDENCE_DIR: input.evidenceDir,
          CURRENT_GATE_RESULT_RUN_ID: 'run-diagnostics-wrapper-test',
        },
        stdio: 'pipe',
      },
    );
  } catch (error) {
    status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 1;
  }

  return {
    status,
    result: readJson(join(input.evidenceDir, 'result.json')),
  };
}

describe('current run diagnostics artifacts', () => {
  it('declares stage events, performance, and skip decisions as diagnostic audit artifacts', () => {
    expect(CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION).toBe('1.0.0');
    expect(CURRENT_RUN_DIAGNOSTIC_ARTIFACT_NAMES).toEqual({
      stage_events: 'stage-events.jsonl',
      performance: 'performance.json',
      skip_decisions: 'skip-decisions.ndjson',
    });
    expect(CURRENT_RUN_DIAGNOSTICS_ARTIFACTS).toEqual([
      {
        kind: 'stage_events',
        file_name: 'stage-events.jsonl',
        purpose: 'diagnostic_audit',
        participates_in_evidence_completeness: false,
      },
      {
        kind: 'performance',
        file_name: 'performance.json',
        purpose: 'diagnostic_audit',
        participates_in_evidence_completeness: false,
      },
      {
        kind: 'skip_decisions',
        file_name: 'skip-decisions.ndjson',
        purpose: 'diagnostic_audit',
        participates_in_evidence_completeness: false,
      },
    ]);
    expect(currentRunDiagnosticArtifactParticipatesInEvidenceCompleteness('skip_decisions')).toBe(false);
  });

  it('writes diagnostics artifacts without verdict, result, claim, or reusable fields', () => {
    const runRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-'));

    initializeCurrentRunDiagnosticsArtifacts({ run_root: runRoot });
    appendCurrentRunStageEvent({
      run_root: runRoot,
      run_id: 'diagnostics-run-001',
      gate_id: 'lane-demo-rehearsal',
      line_kind: 'demo_rehearsal',
      stage: 'bootstrap',
      event: 'started',
      diagnostic_reason_code: 'stage_started',
      stage_log_path: 'logs/bootstrap.log',
    });
    appendCurrentRunStageEvent({
      run_root: runRoot,
      run_id: 'diagnostics-run-001',
      gate_id: 'lane-demo-rehearsal',
      line_kind: 'demo_rehearsal',
      stage: 'bootstrap',
      event: 'failed',
      stage_failure_reason: 'bootstrap_healthcheck_timeout',
      stage_log_path: 'logs/bootstrap.log',
    });
    writeCurrentRunPerformance({
      run_root: runRoot,
      run_id: 'diagnostics-run-001',
      gate_id: 'lane-demo-rehearsal',
      line_kind: 'demo_rehearsal',
      stages: [
        {
          stage: 'bootstrap',
          started_at: '2026-04-27T12:00:00.000Z',
          finished_at: '2026-04-27T12:00:03.250Z',
          duration_ms: 3250,
          diagnostic_reason_code: 'duration_observed',
        },
      ],
    });
    appendCurrentRunSkipDecision({
      run_root: runRoot,
      run_id: 'diagnostics-run-001',
      target: 'docker-image',
      operation: 'load',
      input_digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      existing_artifact_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
      skip_reason: 'digest_already_loaded',
      validator: 'local-containerd-digest',
    });

    const stageEvents = readNdjson(join(runRoot, 'stage-events.jsonl'));
    const performance = readJson(join(runRoot, 'performance.json'));
    const skipDecisions = readNdjson(join(runRoot, 'skip-decisions.ndjson'));

    expect(stageEvents).toHaveLength(2);
    expect(skipDecisions).toHaveLength(1);
    expect(stageEvents[0]).toMatchObject({
      schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
      artifact_kind: 'stage_event',
      diagnostic_reason_code: 'stage_started',
    });
    expect(stageEvents[1]).toMatchObject({
      artifact_kind: 'stage_event',
      stage_failure_reason: 'bootstrap_healthcheck_timeout',
    });
    expect(performance).toMatchObject({
      schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
      artifact_kind: 'performance',
      stages: [
        {
          stage: 'bootstrap',
          duration_ms: 3250,
          diagnostic_reason_code: 'duration_observed',
        },
      ],
    });
    expect(skipDecisions[0]).toMatchObject({
      schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
      artifact_kind: 'skip_decision',
      skip_reason: 'digest_already_loaded',
    });

    expectNoForbiddenFields(stageEvents);
    expectNoForbiddenFields(performance);
    expectNoForbiddenFields(skipDecisions);
    for (const event of stageEvents) {
      expectValidPayload('stage_events', event);
    }
    expectValidPayload('performance', performance);
    for (const decision of skipDecisions) {
      expectValidPayload('skip_decisions', decision);
    }
  });

  it('rejects verdict-like or canonical-result fields anywhere in diagnostics payloads', () => {
    for (const field of CURRENT_RUN_DIAGNOSTICS_FORBIDDEN_FIELDS) {
      const payload: JsonRecord = {
        schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
        artifact_kind: 'stage_event',
        run_id: 'diagnostics-run-002',
        stage: 'verify',
        event: 'failed',
        stage_failure_reason: 'assertion_failed',
        [field]: 'forbidden',
      };

      const result = validateCurrentRunDiagnosticArtifactPayload('stage_events', payload);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              reason: `forbidden diagnostic field "${field}"`,
            }),
          ]),
        );
      }
    }

    const nestedResult = validateCurrentRunDiagnosticArtifactPayload('performance', {
      schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
      artifact_kind: 'performance',
      run_id: 'diagnostics-run-002',
      stages: [
        {
          stage: 'verify',
          duration_ms: 1,
          diagnostic_reason_code: 'duration_observed',
          failure_class: 'evidence_missing',
        },
      ],
      generated_at: '2026-04-27T12:00:00.000Z',
    });

    expect(nestedResult.ok).toBe(false);
    if (!nestedResult.ok) {
      expect(nestedResult.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: 'payload.stages[0].failure_class',
            reason: 'forbidden diagnostic field "failure_class"',
          }),
        ]),
      );
    }
  });

  it('requires stage reasons to use diagnostic_reason_code or stage_failure_reason', () => {
    const result = validateCurrentRunDiagnosticArtifactPayload('stage_events', {
      schema_version: CURRENT_RUN_DIAGNOSTICS_SCHEMA_VERSION,
      artifact_kind: 'stage_event',
      run_id: 'diagnostics-run-003',
      stage: 'verify',
      event: 'failed',
      reason: 'generic reason field is not allowed',
      generated_at: '2026-04-27T12:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reason: 'stage events must use diagnostic_reason_code or stage_failure_reason.',
          }),
          expect.objectContaining({
            reason: 'unknown stage event field "reason"',
          }),
        ]),
      );
    }
  });

  it('lets the wrapper write diagnostics without changing canonical gate result semantics', () => {
    const successRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-success-'));
    const success = runWrappedGate({
      evidenceDir: successRoot,
      command: 'true',
    });

    expect(success.status).toBe(0);
    expect(success.result).toMatchObject({
      gate_id: 'lane-demo-rehearsal',
      status: 'passed',
      failure_class: 'none',
      stage: 'demo_rehearsal',
    });

    const successStageEvents = readNdjson(join(successRoot, 'stage-events.jsonl'));
    const successPerformance = readJson(join(successRoot, 'performance.json'));
    expect(existsSync(join(successRoot, 'skip-decisions.ndjson'))).toBe(true);
    expect(successStageEvents.map((event) => event.event)).toEqual(['started', 'finished']);
    expect(successStageEvents[1]).toMatchObject({
      diagnostic_reason_code: 'wrapped_command_completed',
    });
    expect(successPerformance).toMatchObject({
      artifact_kind: 'performance',
      stages: [
        {
          stage: 'execute',
          diagnostic_reason_code: 'wrapped_command_duration_observed',
        },
      ],
    });
    expectNoForbiddenFields(successStageEvents);
    expectNoForbiddenFields(successPerformance);

    const failureRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-failure-'));
    const failure = runWrappedGate({
      evidenceDir: failureRoot,
      command: 'exit 7',
    });

    expect(failure.status).toBe(7);
    expect(failure.result).toMatchObject({
      gate_id: 'lane-demo-rehearsal',
      status: 'failed',
      failure_class: 'product_regression',
      stage: 'execute',
    });

    const failureStageEvents = readNdjson(join(failureRoot, 'stage-events.jsonl'));
    expect(failureStageEvents.map((event) => event.event)).toEqual(['started', 'failed']);
    expect(failureStageEvents[1]).toMatchObject({
      stage_failure_reason: 'wrapped_command_exited_nonzero',
    });
    expectNoForbiddenFields(failureStageEvents);
  });
});
