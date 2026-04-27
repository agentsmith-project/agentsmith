import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
}): { status: number; result: JsonRecord } {
  let status = 0;
  const env = {
    ...process.env,
    CURRENT_GATE_RESULT_EVIDENCE_DIR: input.evidenceDir,
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
        env,
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

function writeStageScript(stageRoot: string, stage: string, body: string): void {
  writeFileSync(join(stageRoot, `${stage}.sh`), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
}

function runRehearsalStageRunner(input: {
  evidenceDir: string;
  stageRoot: string;
  line: 'demo-rehearsal' | 'cluster-rehearsal';
}): number {
  let status = 0;
  try {
    execFileSync(
      'bash',
      ['scripts/governance/run-rehearsal-stages.sh', input.line],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CURRENT_REHEARSAL_STAGE_ROOT: input.stageRoot,
          CURRENT_GATE_RESULT_EVIDENCE_DIR: input.evidenceDir,
          CURRENT_GATE_RESULT_RUN_ID: `run-diagnostics-${input.line}`,
          CURRENT_GATE_RESULT_GATE_ID: `lane-${input.line}`,
          CURRENT_GATE_RESULT_LINE_KIND: input.line.replace('-', '_'),
          CURRENT_GATE_RESULT_NPM_SCRIPT: `lane:${input.line}`,
        },
        stdio: 'pipe',
      },
    );
  } catch (error) {
    status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 1;
  }
  return status;
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
      runId: 'run-diagnostics-wrapper-test',
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
      runId: 'run-diagnostics-wrapper-test',
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

  it('merges wrapper execute performance with existing inner stage performance instead of overwriting it', () => {
    const runRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-performance-merge-'));

    writeCurrentRunPerformance({
      run_root: runRoot,
      run_id: 'diagnostics-run-merge',
      gate_id: 'lane-demo-rehearsal',
      line_kind: 'demo_rehearsal',
      stages: [
        {
          stage: 'reset',
          started_at: '2026-04-27T12:00:00.000Z',
          finished_at: '2026-04-27T12:00:01.000Z',
          duration_ms: 1000,
          diagnostic_reason_code: 'rehearsal_stage_duration_observed',
        },
      ],
      generated_at: '2026-04-27T12:00:01.000Z',
    });
    writeWrappedCommandFinishDiagnostics({
      run_root: runRoot,
      run_id: 'diagnostics-run-merge',
      gate_id: 'lane-demo-rehearsal',
      line_kind: 'demo_rehearsal',
      npm_script: 'lane:demo-rehearsal',
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
      CURRENT_RUN_DIAGNOSTICS_ACTION: 'rehearsal-stage-finish',
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
      command: `test -n "\${CURRENT_GATE_RESULT_RUN_ID:-}" && test "\${CURRENT_GATE_RESULT_EVIDENCE_DIR:-}" = "${evidenceDir}" && test "\${CURRENT_GATE_RESULT_GATE_ID:-}" = "lane-demo-rehearsal"`,
    });

    expect(contextCheck.status).toBe(0);
    expect(contextCheck.result).toMatchObject({
      gate_id: 'lane-demo-rehearsal',
      status: 'passed',
    });
  });

  it('records successful rehearsal diagnostics for reset/up/bootstrap/verify/report stages', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-rehearsal-success-'));
    const stageRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-stage-root-'));
    const orderFile = join(stageRoot, 'order.txt');
    mkdirSync(stageRoot, { recursive: true });
    for (const stage of ['reset', 'up', 'bootstrap', 'verify', 'report']) {
      writeStageScript(stageRoot, stage, `printf '%s\\n' "${stage}" >> "${orderFile}"`);
    }

    const status = runRehearsalStageRunner({
      evidenceDir,
      stageRoot,
      line: 'demo-rehearsal',
    });

    expect(status).toBe(0);
    expect(readFileSync(orderFile, 'utf8').trim().split('\n')).toEqual([
      'reset',
      'up',
      'bootstrap',
      'verify',
      'report',
    ]);
    const stageEvents = readNdjson(join(evidenceDir, 'stage-events.jsonl'));
    const performance = readJson(join(evidenceDir, 'performance.json'));
    expect(stageEvents.map((event) => `${event.stage}:${event.event}`)).toEqual([
      'reset:started',
      'reset:finished',
      'up:started',
      'up:finished',
      'bootstrap:started',
      'bootstrap:finished',
      'verify:started',
      'verify:finished',
      'report:started',
      'report:finished',
    ]);
    expect((performance.stages as JsonRecord[]).map((stage) => stage.stage)).toEqual([
      'reset',
      'up',
      'bootstrap',
      'verify',
      'report',
    ]);
    expectNoForbiddenFields(stageEvents);
    expectNoForbiddenFields(performance);
    for (const event of stageEvents) {
      expectValidPayload('stage_events', event);
    }
    expectValidPayload('performance', performance);
  });

  it('preserves failing rehearsal stage exit status and does not execute later stages', () => {
    const evidenceDir = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-rehearsal-failure-'));
    const stageRoot = mkdtempSync(join(tmpdir(), 'current-run-diagnostics-stage-root-'));
    const orderFile = join(stageRoot, 'order.txt');
    mkdirSync(stageRoot, { recursive: true });
    for (const stage of ['reset', 'up', 'bootstrap']) {
      writeStageScript(stageRoot, stage, `printf '%s\\n' "${stage}" >> "${orderFile}"`);
    }
    writeStageScript(stageRoot, 'verify', `printf '%s\\n' "verify" >> "${orderFile}"\nexit 7`);
    writeStageScript(stageRoot, 'report', `printf '%s\\n' "report" >> "${orderFile}"`);

    const status = runRehearsalStageRunner({
      evidenceDir,
      stageRoot,
      line: 'cluster-rehearsal',
    });

    expect(status).toBe(7);
    expect(readFileSync(orderFile, 'utf8').trim().split('\n')).toEqual([
      'reset',
      'up',
      'bootstrap',
      'verify',
    ]);
    const stageEvents = readNdjson(join(evidenceDir, 'stage-events.jsonl'));
    const performance = readJson(join(evidenceDir, 'performance.json'));
    expect(stageEvents.map((event) => `${event.stage}:${event.event}`)).toEqual([
      'reset:started',
      'reset:finished',
      'up:started',
      'up:finished',
      'bootstrap:started',
      'bootstrap:finished',
      'verify:started',
      'verify:failed',
    ]);
    expect(stageEvents.at(-1)).toMatchObject({
      stage: 'verify',
      stage_failure_reason: 'rehearsal_stage_exited_nonzero',
    });
    expect((performance.stages as JsonRecord[]).map((stage) => stage.stage)).toEqual([
      'reset',
      'up',
      'bootstrap',
      'verify',
    ]);
    expect((performance.stages as JsonRecord[]).at(-1)).toMatchObject({
      stage: 'verify',
      stage_failure_reason: 'rehearsal_stage_exited_nonzero',
    });
    expectNoForbiddenFields(stageEvents);
    expectNoForbiddenFields(performance);
    for (const event of stageEvents) {
      expectValidPayload('stage_events', event);
    }
    expectValidPayload('performance', performance);
  });

  it('does not echo raw unknown rehearsal line arguments', () => {
    const result = runCommand('bash', ['scripts/governance/run-rehearsal-stages.sh', '--api_key=raw-secret']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('[rehearsal-stages] unknown rehearsal line');
    expect(result.stderr).not.toContain('--api_key=raw-secret');
    expect(result.stderr).not.toContain('raw-secret');
  });
});
