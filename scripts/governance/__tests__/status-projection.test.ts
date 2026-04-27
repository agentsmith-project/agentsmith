import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import {
  CURRENT_STATUS_PROJECTION_SCHEMA,
  CURRENT_STATUS_PROJECTION_VERSION,
  validateCurrentStatusProjection,
} from '../current-status-projection-schema';
import { buildStatusProjection } from '../status-projection';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const CURRENT_GIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EVIDENCE_GIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STALE_EVIDENCE_GIT_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeAggregateResult(campaignRoot: string, overrides: Partial<{
  status: string;
  failure_class: string;
  stage: string;
  summary: string;
  generated_at: string;
}> = {}): string {
  const payload = {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: 'gate-release-full',
    gate_adapter: {
      npm_script: 'gate:release:full',
      ci_job: null,
    },
    status: overrides.status ?? 'passed',
    failure_class: overrides.failure_class ?? 'none',
    stage: overrides.stage ?? 'aggregate',
    line_kind: 'release_full_verdict',
    evidence_dir: join(campaignRoot, 'gate-release-full'),
    summary: overrides.summary ?? 'Release-full campaign evidence passed aggregate verification.',
    generated_at: overrides.generated_at ?? GENERATED_AT,
  };
  const path = join(campaignRoot, 'gate-release-full', 'result.json');
  writeJson(path, payload);
  return path;
}

function withTempRoot<T>(action: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'agentsmith-status-projection-'));
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function expectNoReleaseVerdictFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  expect(serialized).not.toContain('release_verdict');
  expect(serialized).not.toContain('automated_release_verdict');
}

describe('current status projection', () => {
  it('projects a passed release status as read-only presentation without producing a release verdict', () => {
    withTempRoot((campaignRoot) => {
      const aggregatePath = writeAggregateResult(campaignRoot);
      const aggregateContent = readFileSync(aggregatePath, 'utf8');

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection).toMatchObject({
        schema: CURRENT_STATUS_PROJECTION_SCHEMA,
        version: CURRENT_STATUS_PROJECTION_VERSION,
        projection_kind: 'read_only',
        goal: 'release-ready',
        runtime_line: null,
        phase: 'aggregate',
        presentation_status: 'passed',
        primary_blocker: null,
        deepest_reason: {
          code: 'none',
          source_path: aggregatePath,
        },
        aggregate_status_ref: {
          path: aggregatePath,
          digest: sha256(aggregateContent),
          gate_id: 'gate-release-full',
          line_kind: 'release_full_verdict',
        },
        release_decision_produced: false,
        commands_executed: false,
        leases_acquired: false,
        leases_released: false,
      });
      expect(projection.aggregate_status_ref).not.toHaveProperty('status');
      expect(projection.aggregate_status_ref).not.toHaveProperty('failure_class');
      expect(projection.authority_paths.aggregate).toBe(aggregatePath);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });

  it('keeps goal and runtime_line separate and maps local-real to the registered local-manual runtime line', () => {
    const projection = buildStatusProjection({
      goal: 'local-real',
      runtimeLine: 'local-real',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
    });

    expect(projection.goal).toBe('local-real');
    expect(projection.runtime_line).toBe('local-manual');
    expect(projection.aggregate_status_ref).toBe(null);
    expect(projection.authority_paths.aggregate).toBe(null);
    expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    expectNoReleaseVerdictFields(projection);
  });

  it('only references the release-full aggregate result even when sibling gate results exist', () => {
    withTempRoot((campaignRoot) => {
      writeJson(join(campaignRoot, 'gate-release', 'result.json'), {
        schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
        gate_id: 'gate-release',
        status: 'passed',
        failure_class: 'none',
        stage: 'verify',
        line_kind: 'release_backend_real',
        evidence_dir: join(campaignRoot, 'gate-release'),
        summary: 'Sibling result must not become aggregate_status_ref.',
        generated_at: GENERATED_AT,
      });
      const aggregatePath = writeAggregateResult(campaignRoot);

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.aggregate_status_ref?.path).toBe(aggregatePath);
      expect(projection.authority_paths.aggregate).toBe(aggregatePath);
      expect(JSON.stringify(projection)).not.toContain('gate-release/result.json');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
  });

  it('classifies stale, running, blocked, and evidence-missing fixtures for first-screen status', () => {
    withTempRoot((staleRoot) => withTempRoot((blockedRoot) => withTempRoot((runningRoot) => {
      writeAggregateResult(staleRoot, { status: 'passed', failure_class: 'none' });
      const stale = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: staleRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: STALE_EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      expect(stale.presentation_status).toBe('stale');
      expect(stale.deepest_reason?.code).toBe('stale_evidence_git_sha');

      writeAggregateResult(blockedRoot, {
        status: 'failed',
        failure_class: 'evidence_missing',
        stage: 'aggregate',
        summary: 'Missing campaign step result: lane-visual',
      });
      const blocked = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: blockedRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      expect(blocked.presentation_status).toBe('failed');
      expect(blocked.primary_blocker).toMatchObject({
        owner: 'lane-visual',
        stage: 'aggregate',
      });
      expect(blocked.deepest_reason).toMatchObject({
        code: 'evidence_missing',
        summary: 'Missing campaign step result: lane-visual',
      });
      expect(blocked.safe_next_command).toBe('npm run verify:visual');

      const running = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: runningRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        runId: 'release-run-001',
        startedAt: '2026-04-27T11:59:00.000Z',
        generatedAt: GENERATED_AT,
      });
      expect(running.presentation_status).toBe('running');
      expect(running.phase).toBe('verify');
      expect(running.aggregate_status_ref).toBe(null);
      expect(running.run_age_seconds).toBe(60);

      for (const projection of [stale, blocked, running]) {
        expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
        expectNoReleaseVerdictFields(projection);
      }
    })));
  });

  it('uses the governed release-real run command as the gate-release safe next action', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: 'Campaign step gate-release did not pass.',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('failed');
      expect(projection.primary_blocker?.owner).toBe('gate-release');
      expect(projection.safe_next_command).toBe('npm run verify -- --goal=release-real --run');
      expect(projection.safe_next_command).not.toBe('npm run verify:release-real');
      expect(JSON.stringify(projection)).not.toContain('npm run verify:release-real');
    });
  });

  it('fails closed when aggregate status is passed but failure_class is not none', () => {
    withTempRoot((campaignRoot) => {
      const aggregatePath = writeAggregateResult(campaignRoot, {
        status: 'passed',
        failure_class: 'product_regression',
        summary: 'Corrupt aggregate says passed with product regression.',
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).not.toBe('passed');
      expect(projection.presentation_status).toBe('unknown');
      expect(projection.aggregate_status_ref).toBe(null);
      expect(projection.deepest_reason).toMatchObject({
        code: 'aggregate_result_inconsistent',
        source_path: aggregatePath,
      });
      expect(projection.deepest_reason?.summary).toContain('passed result must use failure_class none');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
    });
  });

  it('fails closed when aggregate status or failure_class is outside the current gate schema enum', () => {
    withTempRoot((badStatusRoot) => withTempRoot((badFailureClassRoot) => {
      const badStatusPath = writeAggregateResult(badStatusRoot, {
        status: 'green',
        failure_class: 'none',
        summary: 'Corrupt aggregate uses an unknown status.',
      });
      const badStatus = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: badStatusRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(badStatus.presentation_status).toBe('unknown');
      expect(badStatus.aggregate_status_ref).toBe(null);
      expect(badStatus.deepest_reason).toMatchObject({
        code: 'aggregate_result_invalid_status',
        source_path: badStatusPath,
      });
      expect(badStatus.deepest_reason?.summary).toContain('current gate result status');

      const badFailureClassPath = writeAggregateResult(badFailureClassRoot, {
        status: 'failed',
        failure_class: 'flaky',
        summary: 'Corrupt aggregate uses an unknown failure class.',
      });
      const badFailureClass = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot: badFailureClassRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(badFailureClass.presentation_status).toBe('unknown');
      expect(badFailureClass.aggregate_status_ref).toBe(null);
      expect(badFailureClass.deepest_reason).toMatchObject({
        code: 'aggregate_result_invalid_failure_class',
        source_path: badFailureClassPath,
      });
      expect(badFailureClass.deepest_reason?.summary).toContain('current gate result failure class');

      for (const projection of [badStatus, badFailureClass]) {
        expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
        expectNoReleaseVerdictFields(projection);
      }
    }));
  });

  it('fails schema validation for verdict pollution and non-aggregate status references', () => {
    const polluted = {
      ...buildStatusProjection({
        goal: 'release-ready',
        currentGitSha: CURRENT_GIT_SHA,
        generatedAt: GENERATED_AT,
      }),
      release_verdict: 'PASSED',
    };

    expect(validateCurrentStatusProjection(polluted)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ path: 'projection.release_verdict' }),
      ]),
    });

    const badAggregate = {
      ...buildStatusProjection({
        goal: 'release-ready',
        currentGitSha: CURRENT_GIT_SHA,
        generatedAt: GENERATED_AT,
      }),
      aggregate_status_ref: {
        path: 'artifacts/release-runs/run-001/gate-release/result.json',
        digest: `sha256:${'1'.repeat(64)}`,
        gate_id: 'gate-release',
        line_kind: 'release_backend_real',
      },
    };

    expect(validateCurrentStatusProjection(badAggregate)).toMatchObject({
      ok: false,
      failures: expect.arrayContaining([
        expect.objectContaining({ path: 'projection.aggregate_status_ref.gate_id' }),
        expect.objectContaining({ path: 'projection.aggregate_status_ref.line_kind' }),
      ]),
    });
  });

  it('supports release-status --json as a read-only projection without changing release-summary truth', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot);

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      const projection = JSON.parse(output) as unknown;

      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expectNoReleaseVerdictFields(projection);
      expect(existsSync(join(campaignRoot, 'summary.json'))).toBe(false);
      expect(existsSync(join(campaignRoot, 'status.json'))).toBe(false);
    });
  });
});
