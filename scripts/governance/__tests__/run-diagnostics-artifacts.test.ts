import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
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
  writeWrappedCommandStartDiagnostics,
  writeWrappedCommandFinishDiagnostics,
} from '../run-diagnostics-writer';

type JsonRecord = Record<string, unknown>;

type CommandResult = {
  status: number;
  stdout: string;
  stderr: string;
};

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

function runCommand(command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env): CommandResult {
  try {
    const stdout = execFileSync(command, [...args], {
      cwd: process.cwd(),
      env,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    return {
      status: 0,
      stdout,
      stderr: '',
    };
  } catch (error) {
    const failed = error as {
      status?: unknown;
      stdout?: unknown;
      stderr?: unknown;
    };

    return {
      status: typeof failed.status === 'number' ? failed.status : 1,
      stdout: typeof failed.stdout === 'string' ? failed.stdout : '',
      stderr: typeof failed.stderr === 'string' ? failed.stderr : '',
    };
  }
}

function runWrappedGate(input: {
  evidenceDir: string;
  command: string;
  runId?: string;
  gateId?: string;
  lineKind?: string;
  npmScript?: string;
  env?: NodeJS.ProcessEnv;
}): { status: number; result: JsonRecord | null; stderr: string } {
  let status = 0;
  let stderr = '';
  const env = {
    ...process.env,
    CURRENT_GATE_RESULT_EVIDENCE_DIR: input.evidenceDir,
    ...input.env,
  };
  if (input.runId !== undefined) {
    env.CURRENT_GATE_RESULT_RUN_ID = input.runId;
  } else {
    delete env.CURRENT_GATE_RESULT_RUN_ID;
  }
  try {
    execFileSync(
      'bash',
      [
        'scripts/run-current-gate-result-wrapped.sh',
        input.gateId ?? 'lane-unified-deploy-local-kind',
        input.lineKind ?? 'unified_deploy_local_kind',
        input.npmScript ?? 'lane:unified-deploy:local-kind',
        '--',
        'bash',
        '-lc',
        input.command,
      ],
      {
        cwd: process.cwd(),
        env,
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
  } catch (error) {
    status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 1;
    stderr = typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr
      : '';
  }

  const resultPath = join(input.evidenceDir, 'result.json');
  return {
    status,
    result: existsSync(resultPath) ? readJson(resultPath) : null,
    stderr,
  };
}

function diagnosticsWriterCommand(input: {
  stage: string;
  event?: 'failed' | 'finished';
  reason?: string;
  runId?: string;
  gateId?: string;
  lineKind?: string;
}): string {
  return [
    `CURRENT_RUN_DIAGNOSTICS_ACTION=run-stage-finish`,
    `CURRENT_RUN_DIAGNOSTICS_RUN_ROOT="$CURRENT_GATE_RESULT_EVIDENCE_DIR"`,
    `CURRENT_RUN_DIAGNOSTICS_RUN_ID="${input.runId ?? '$CURRENT_GATE_RESULT_RUN_ID'}"`,
    `CURRENT_RUN_DIAGNOSTICS_GATE_ID="${input.gateId ?? '$CURRENT_GATE_RESULT_GATE_ID'}"`,
    `CURRENT_RUN_DIAGNOSTICS_LINE_KIND="${input.lineKind ?? '$CURRENT_GATE_RESULT_LINE_KIND'}"`,
    `CURRENT_RUN_DIAGNOSTICS_STAGE="${input.stage}"`,
    `CURRENT_RUN_DIAGNOSTICS_EVENT="${input.event ?? 'failed'}"`,
    `CURRENT_RUN_DIAGNOSTICS_FAILURE_REASON="${input.reason ?? `${input.stage}_failed`}"`,
    `node --import tsx scripts/governance/run-diagnostics-writer.ts`,
  ].join(' ');
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
      gate_id: 'lane-unified-deploy-local-kind',
      line_kind: 'unified_deploy_local_kind',
      stage: 'bootstrap',
      event: 'started',
      diagnostic_reason_code: 'stage_started',
      stage_log_path: 'logs/bootstrap.log',
    });
    appendCurrentRunStageEvent({
      run_root: runRoot,
      run_id: 'diagnostics-run-001',
      gate_id: 'lane-unified-deploy-local-kind',
      line_kind: 'unified_deploy_local_kind',
      stage: 'bootstrap',
      event: 'failed',
      stage_failure_reason: 'bootstrap_healthcheck_timeout',
      stage_log_path: 'logs/bootstrap.log',
    });
    writeCurrentRunPerformance({
      run_root: runRoot,
      run_id: 'diagnostics-run-001',
      gate_id: 'lane-unified-deploy-local-kind',
      line_kind: 'unified_deploy_local_kind',
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
      runId: 'run-diagnostics-wrapper-test',
    });

    expect(success.status).toBe(0);
    expect(success.result).not.toBeNull();
    expect(success.result).toMatchObject({
      gate_id: 'lane-unified-deploy-local-kind',
      status: 'passed',
      failure_class: 'none',
      stage: 'unified_deploy_local_kind',
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
      runId: 'run-diagnostics-wrapper-test',
    });

    expect(failure.status).toBe(7);
    expect(failure.result).not.toBeNull();
    expect(failure.result).toMatchObject({
      gate_id: 'lane-unified-deploy-local-kind',
      status: 'failed',
      failure_class: 'infra_setup_failure',
      stage: 'execute',
    });

    const failureStageEvents = readNdjson(join(failureRoot, 'stage-events.jsonl'));
    expect(failureStageEvents.map((event) => event.event)).toEqual(['started', 'failed']);
    expect(failureStageEvents[1]).toMatchObject({
      stage_failure_reason: 'wrapped_command_exited_nonzero',
    });
    expectNoForbiddenFields(failureStageEvents);
  });

  it('uses inner failed stage diagnostics for wrapped command canonical failures', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-inner-failure-'));
    const failure = runWrappedGate({
      evidenceDir,
      command: `${diagnosticsWriterCommand({
        stage: 'verify',
        reason: 'verify_contract_failed',
      })}; exit 7`,
      runId: 'run-diagnostics-wrapper-inner-failure',
    });

    expect(failure.status).toBe(7);
    expect(failure.result).not.toBeNull();
    expect(failure.result).toMatchObject({
      gate_id: 'lane-unified-deploy-local-kind',
      status: 'failed',
      stage: 'verify',
    });
    expect(failure.result?.summary).toContain('verify');
    expect(failure.result?.summary).toContain('verify_contract_failed');
    expect(failure.result?.summary).not.toContain('wrapped command exited with status');

    const stageEvents = readNdjson(join(evidenceDir, 'stage-events.jsonl'));
    expect(stageEvents.map((event) => `${event.stage}:${event.event}`)).toEqual([
      'execute:started',
      'verify:failed',
      'execute:failed',
    ]);
    expectNoForbiddenFields(stageEvents);
  });

  it('uses an explicit fallback when a wrapped command fails without inner diagnostics', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-no-inner-'));
    const failure = runWrappedGate({
      evidenceDir,
      command: 'exit 7',
      runId: 'run-diagnostics-wrapper-no-inner',
    });

    expect(failure.status).toBe(7);
    expect(failure.result).not.toBeNull();
    expect(failure.result).toMatchObject({
      gate_id: 'lane-unified-deploy-local-kind',
      status: 'failed',
      stage: 'execute',
    });
    expect(failure.result?.summary).toContain('child_exited_nonzero_without_inner_diagnostics');
    expect(failure.result?.summary).toContain('no inner diagnostics observed');
    expect(failure.result?.summary).not.toContain('wrapped command exited with status');
  });

  it('ignores inner stage diagnostics from the wrong run, gate, or line', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-scope-'));
    const failure = runWrappedGate({
      evidenceDir,
      command: [
        diagnosticsWriterCommand({
          stage: 'verify',
          reason: 'wrong_run_verify_failed',
          runId: 'other-run',
        }),
        diagnosticsWriterCommand({
          stage: 'bootstrap',
          reason: 'wrong_gate_bootstrap_failed',
          gateId: 'other-gate',
        }),
        diagnosticsWriterCommand({
          stage: 'report',
          reason: 'wrong_line_report_failed',
          lineKind: 'other_line',
        }),
        'exit 7',
      ].join('; '),
      runId: 'run-diagnostics-wrapper-scope',
    });

    expect(failure.status).toBe(7);
    expect(failure.result).not.toBeNull();
    expect(failure.result).toMatchObject({
      gate_id: 'lane-unified-deploy-local-kind',
      status: 'failed',
      stage: 'execute',
    });
    expect(failure.result?.summary).toContain('child_exited_nonzero_without_inner_diagnostics');
    expect(failure.result?.summary).not.toContain('wrong_run_verify_failed');
    expect(failure.result?.summary).not.toContain('wrong_gate_bootstrap_failed');
    expect(failure.result?.summary).not.toContain('wrong_line_report_failed');
  });

  it('rejects wrapped release full canonical writer calls without writing result.json', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-release-guard-'));
    const result = runWrappedGate({
      evidenceDir,
      gateId: 'gate-release-full',
      lineKind: 'release_full_verdict',
      npmScript: 'release:full',
      command: 'true',
      runId: 'run-diagnostics-wrapper-release-guard',
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('must not write release_full_verdict');
    expect(result.result).toBeNull();
    expect(existsSync(join(evidenceDir, 'result.json'))).toBe(false);
  });

  it('rejects release full writer identity overrides without writing result.json', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-release-env-guard-'));
    const result = runWrappedGate({
      evidenceDir,
      gateId: 'lane-unified-deploy-local-kind',
      lineKind: 'unified_deploy_local_kind',
      npmScript: 'lane:unified-deploy:local-kind',
      command: 'true',
      runId: 'run-diagnostics-wrapper-release-env-guard',
      env: {
        CURRENT_GATE_RESULT_GATE_ID: 'gate-release-full',
        CURRENT_GATE_RESULT_LINE_KIND: 'release_full_verdict',
      },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('must not write release_full_verdict');
    expect(result.result).toBeNull();
    expect(existsSync(join(evidenceDir, 'result.json'))).toBe(false);
  });

  it('redacts selected inner stage reasons before writing wrapper failure summaries', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-selected-redaction-'));
    const rawReason = 'verify failed Bearer raw-token-value api_key=raw-secret ticket=raw-ticket';
    const failure = runWrappedGate({
      evidenceDir,
      command: `${diagnosticsWriterCommand({
        stage: 'verify',
        reason: rawReason,
      })}; exit 7`,
      runId: 'run-diagnostics-wrapper-selected-redaction',
    });

    expect(failure.status).toBe(7);
    expect(failure.result).not.toBeNull();
    expect(failure.result).toMatchObject({
      status: 'failed',
      stage: 'verify',
    });

    const failureClassification = readJson(join(evidenceDir, 'failure-classification.json'));
    const serialized = JSON.stringify({
      result: failure.result,
      failureClassification,
    });
    expect(serialized).not.toContain('raw-token-value');
    expect(serialized).not.toContain('raw-secret');
    expect(serialized).not.toContain('raw-ticket');
    expect(serialized).toContain('[redacted]');
  });

  it('merges wrapper execute performance with existing inner stage performance instead of overwriting it', () => {
    const runRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-performance-merge-'));

    writeCurrentRunPerformance({
      run_root: runRoot,
      run_id: 'diagnostics-run-merge',
      gate_id: 'lane-unified-deploy-local-kind',
      line_kind: 'unified_deploy_local_kind',
      stages: [
        {
          stage: 'reset',
          started_at: '2026-04-27T12:00:00.000Z',
          finished_at: '2026-04-27T12:00:01.000Z',
          duration_ms: 1000,
          diagnostic_reason_code: 'run_stage_duration_observed',
        },
      ],
      generated_at: '2026-04-27T12:00:01.000Z',
    });
    writeWrappedCommandFinishDiagnostics({
      run_root: runRoot,
      run_id: 'diagnostics-run-merge',
      gate_id: 'lane-unified-deploy-local-kind',
      line_kind: 'unified_deploy_local_kind',
      npm_script: 'lane:unified-deploy:local-kind',
      stage: 'execute',
      event: 'finished',
      started_at: '2026-04-27T12:00:00.000Z',
      finished_at: '2026-04-27T12:00:03.000Z',
      started_ms: 0,
      finished_ms: 3000,
      diagnostic_reason_code: 'wrapped_command_completed',
    });

    const performance = readJson(join(runRoot, 'performance.json'));

    expect((performance.stages as JsonRecord[]).map((stage) => stage.stage)).toEqual(['reset', 'execute']);
    expectNoForbiddenFields(performance);
    expectValidPayload('performance', performance);
  });

  it('initializes diagnostics by clearing stale performance from the same evidence directory', () => {
    const runRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-performance-reset-'));

    writeCurrentRunPerformance({
      run_root: runRoot,
      run_id: 'diagnostics-run-old',
      stages: [
        {
          stage: 'stale-stage',
          duration_ms: 123,
          diagnostic_reason_code: 'stale_duration_observed',
        },
      ],
    });
    writeWrappedCommandStartDiagnostics({
      run_root: runRoot,
      run_id: 'diagnostics-run-new',
      stage: 'execute',
      started_at: '2026-04-27T12:00:00.000Z',
    });
    writeCurrentRunPerformance({
      run_root: runRoot,
      run_id: 'diagnostics-run-new',
      stages: [
        {
          stage: 'execute',
          duration_ms: 1,
          diagnostic_reason_code: 'wrapped_command_duration_observed',
        },
      ],
    });

    const performance = readJson(join(runRoot, 'performance.json'));

    expect((performance.stages as JsonRecord[]).map((stage) => stage.stage)).toEqual(['execute']);
    expect(JSON.stringify(performance)).not.toContain('stale-stage');
    expectValidPayload('performance', performance);
  });

  it('redacts free-form diagnostics reasons before writing stage events and performance', () => {
    const runRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-redaction-'));
    const rawReason = 'verify failed with Bearer raw-token-value api_key=raw-secret ticket=raw-ticket';
    const result = runCommand('node', ['--import', 'tsx', 'scripts/governance/run-diagnostics-writer.ts'], {
      ...process.env,
      CURRENT_RUN_DIAGNOSTICS_ACTION: 'run-stage-finish',
      CURRENT_RUN_DIAGNOSTICS_RUN_ROOT: runRoot,
      CURRENT_RUN_DIAGNOSTICS_RUN_ID: 'diagnostics-redaction-run',
      CURRENT_RUN_DIAGNOSTICS_STAGE: 'verify',
      CURRENT_RUN_DIAGNOSTICS_EVENT: 'failed',
      CURRENT_RUN_DIAGNOSTICS_STARTED_AT: '2026-04-27T12:00:00.000Z',
      CURRENT_RUN_DIAGNOSTICS_STARTED_MS: '0',
      CURRENT_RUN_DIAGNOSTICS_FINISHED_AT: '2026-04-27T12:00:01.000Z',
      CURRENT_RUN_DIAGNOSTICS_FINISHED_MS: '1000',
      CURRENT_RUN_DIAGNOSTICS_FAILURE_REASON: rawReason,
    });

    expect(result.status).toBe(0);
    const stageEvents = readNdjson(join(runRoot, 'stage-events.jsonl'));
    const performance = readJson(join(runRoot, 'performance.json'));
    const serialized = JSON.stringify({ stageEvents, performance });

    expect(serialized).not.toContain('raw-token-value');
    expect(serialized).not.toContain('raw-secret');
    expect(serialized).not.toContain('raw-ticket');
    expect(serialized).toContain('[redacted]');
    expectNoForbiddenFields(stageEvents);
    expectNoForbiddenFields(performance);
    for (const event of stageEvents) {
      expectValidPayload('stage_events', event);
    }
    expectValidPayload('performance', performance);
  });

  it('does not echo raw unknown diagnostics CLI actions', () => {
    const runRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-unknown-action-'));
    const result = runCommand('node', ['--import', 'tsx', 'scripts/governance/run-diagnostics-writer.ts'], {
      ...process.env,
      CURRENT_RUN_DIAGNOSTICS_ACTION: 'unknown api_key=raw-secret Bearer raw-token-value',
      CURRENT_RUN_DIAGNOSTICS_RUN_ROOT: runRoot,
      CURRENT_RUN_DIAGNOSTICS_RUN_ID: 'diagnostics-unknown-action-run',
      CURRENT_RUN_DIAGNOSTICS_STAGE: 'verify',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('raw-secret');
    expect(result.stderr).not.toContain('raw-token-value');
    expect(result.stderr).toContain('unknown CURRENT_RUN_DIAGNOSTICS_ACTION');
  });

  it('exports computed gate context to wrapped child commands', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-wrapper-context-'));
    const contextCheck = runWrappedGate({
      evidenceDir,
      command: `test -n "\${CURRENT_GATE_RESULT_RUN_ID:-}" && test "\${CURRENT_GATE_RESULT_EVIDENCE_DIR:-}" = "${evidenceDir}" && test "\${CURRENT_GATE_RESULT_GATE_ID:-}" = "lane-unified-deploy-local-kind"`,
    });

    expect(contextCheck.status).toBe(0);
    expect(contextCheck.result).toMatchObject({
      gate_id: 'lane-unified-deploy-local-kind',
      status: 'passed',
    });
  });

});
