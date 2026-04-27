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
import type { GovernanceRuntimeLockLease } from '../governance-lock-lease-manager';
import { buildMinimalLeaseStatusShadow, resolveMinimalLeaseStatusShadow } from '../lease-status-shadow';
import { buildStatusProjection, renderStatusProjection } from '../status-projection';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const CURRENT_GIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EVIDENCE_GIT_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STALE_EVIDENCE_GIT_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SENSITIVE_AGGREGATE_SUMMARY = [
  'Campaign step gate-release did not pass.',
  'Authorization: Bearer projection-bearer-raw-token',
  'OPENAI_API_KEY=sk-projection-raw-value',
  'api_key=projection-api-key-raw-value',
  'access_token=projection-access-token-raw-value',
  'refresh_token=projection-refresh-token-raw-value',
  'oauth_token=projection-oauth-token-raw-value',
  'client_secret=projection-client-secret-raw-value',
  'password=projection-password-raw-value',
  'managed_credentials: {"feishu":"projection-managed-credential-object-raw-value"}',
  'password: {"value":"projection-password-object-raw-value"}',
  'ticket=projection-ticket-raw-value',
  'managed_credentials.feishu=projection-managed-credential-raw-value',
  'Cookie: sid=projection-cookie-raw-value',
].join(' ');
const SENSITIVE_PROJECTION_FRAGMENTS = [
  'projection-bearer-raw-token',
  'sk-projection-raw-value',
  'projection-api-key-raw-value',
  'projection-access-token-raw-value',
  'projection-refresh-token-raw-value',
  'projection-oauth-token-raw-value',
  'projection-client-secret-raw-value',
  'projection-password-raw-value',
  'projection-managed-credential-object-raw-value',
  'projection-password-object-raw-value',
  'projection-ticket-raw-value',
  'projection-managed-credential-raw-value',
  'projection-cookie-raw-value',
];
const PREBUILT_SCOPE_KIND_SECRET = 'sk-status-prebuilt-scope-kind-secret-1234567';
const PREBUILT_MODE_SECRET = 'api_key=status-prebuilt-mode-api-key-raw-value';
const PREBUILT_OWNER_SECRET = 'sk-status-prebuilt-owner-secret-1234567';
const PREBUILT_TICKET_SECRET = 'ticket=status-prebuilt-ticket-raw-value';

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

function writeRehearsalResult(gateResultsRoot: string, input: {
  gateId: 'lane-demo-rehearsal' | 'lane-cluster-rehearsal';
  lineKind: 'demo_rehearsal' | 'cluster_rehearsal';
  runId: string;
  status?: string;
  failure_class?: string;
  stage?: string;
  summary?: string;
  generated_at?: string;
}): string {
  const runRoot = join(gateResultsRoot, input.gateId, input.runId);
  const path = join(runRoot, 'result.json');
  writeJson(path, {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: input.gateId,
    gate_adapter: {
      npm_script: input.gateId === 'lane-demo-rehearsal' ? 'lane:demo-rehearsal' : 'lane:cluster-rehearsal',
      ci_job: 'local',
    },
    status: input.status ?? 'passed',
    failure_class: input.failure_class ?? 'none',
    stage: input.stage ?? input.lineKind,
    line_kind: input.lineKind,
    evidence_dir: runRoot,
    summary: input.summary ?? `Gate ${input.gateId} passed during ${input.lineKind}.`,
    generated_at: input.generated_at ?? GENERATED_AT,
  });
  return path;
}

function writeStageEvents(runRoot: string, events: readonly Record<string, unknown>[]): string {
  const path = join(runRoot, 'stage-events.jsonl');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  return path;
}

function writeRawStageEvents(runRoot: string, lines: readonly string[]): string {
  const path = join(runRoot, 'stage-events.jsonl');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function writePerformance(runRoot: string, payload: Record<string, unknown>): string {
  const path = join(runRoot, 'performance.json');
  writeJson(path, payload);
  return path;
}

function lease(overrides: Partial<GovernanceRuntimeLockLease>): GovernanceRuntimeLockLease {
  return {
    leaseId: overrides.leaseId ?? 'lease-000001',
    lockId: overrides.lockId ?? 'release-campaign-root-writes',
    scopeKind: overrides.scopeKind ?? 'campaign_root',
    scopeKey: overrides.scopeKey ?? '/tmp/release-run',
    ownerGroup: overrides.ownerGroup ?? 'release-full|run-lease-001|/tmp/release-run',
    ownerAttemptId: overrides.ownerAttemptId ?? 'attempt-lease-001',
    ownerStepId: overrides.ownerStepId ?? 'gate-release',
    mode: overrides.mode ?? 'exclusive',
    campaignId: overrides.campaignId ?? 'release-full',
    runId: overrides.runId ?? 'run-lease-001',
    campaignRoot: overrides.campaignRoot ?? '/tmp/release-run',
    acquiredAt: overrides.acquiredAt ?? GENERATED_AT,
  };
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

function expectNoSensitiveProjectionLeak(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const fragment of SENSITIVE_PROJECTION_FRAGMENTS) {
    expect(serialized).not.toContain(fragment);
  }
  expect(serialized).not.toContain('Bearer projection-bearer-raw-token');
}

function expectNoInternalVerifyAlias(value: unknown): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  expect(serialized).not.toContain('npm run verify:');
}

describe('current status projection', () => {
  it('includes the read-only lease status shadow in projection JSON without producing decisions or commands', () => {
    const leaseStatusShadow = buildMinimalLeaseStatusShadow({
      activeLeases: [
        lease({}),
        lease({
          leaseId: 'lease-destructive',
          lockId: 'destructive-lifecycle',
          scopeKind: 'local_host',
          scopeKey: 'localhost',
          ownerStepId: 'local-real-reset',
        }),
        lease({
          leaseId: 'lease-ports',
          lockId: 'fixed-local-ports',
          scopeKind: 'local_host',
          scopeKey: 'local-real:ports',
          ownerStepId: 'local-real-up',
        }),
        lease({
          leaseId: 'lease-secret',
          lockId: 'provider-secret-profile',
          scopeKind: 'provider_profile',
          scopeKey: 'backend-real-managed-secret',
          ownerStepId: 'gate-release',
        }),
      ],
      requiredSecretNames: ['BACKEND_REAL_API_KEY'],
      env: {
        BACKEND_REAL_API_KEY: 'sk-status-projection-do-not-print',
      },
      generatedAt: GENERATED_AT,
    });

    const projection = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
      leaseStatusShadow,
    });

    expect(projection).toMatchObject({
      schema: CURRENT_STATUS_PROJECTION_SCHEMA,
      version: CURRENT_STATUS_PROJECTION_VERSION,
      projection_kind: 'read_only',
      lease_status_shadow: {
        schema: 'agentsmith_lease_status_shadow/v1',
        projection_kind: 'read_only_shadow',
        leases_acquired: false,
        leases_released: false,
        active_run: {
          run_id: 'run-lease-001',
          campaign_id: 'release-full',
        },
        destructive_command_lock: {
          present: true,
          lock_id: 'destructive-lifecycle',
        },
        port_family: {
          present: true,
          lock_id: 'fixed-local-ports',
        },
        secret_profile_lock: {
          present: true,
          lock_id: 'provider-secret-profile',
          profile: {
            present: true,
            digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          },
        },
      },
      release_decision_produced: false,
      commands_executed: false,
      leases_acquired: false,
      leases_released: false,
    });
    expect(JSON.stringify(projection)).not.toContain('sk-status-projection-do-not-print');
    expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    expectNoReleaseVerdictFields(projection);
  });

  it('renders lease shadow state and safe action on the first status screen', () => {
    const leaseStatusShadow = buildMinimalLeaseStatusShadow({
      activeLeases: [
        lease({}),
        lease({
          leaseId: 'lease-destructive',
          lockId: 'destructive-lifecycle',
          scopeKind: 'local_host',
          scopeKey: 'localhost',
          ownerStepId: 'local-real-reset',
        }),
        lease({
          leaseId: 'lease-ports',
          lockId: 'fixed-local-ports',
          scopeKind: 'local_host',
          scopeKey: 'local-real:ports',
          ownerStepId: 'local-real-up',
        }),
        lease({
          leaseId: 'lease-secret',
          lockId: 'provider-secret-profile',
          scopeKind: 'provider_profile',
          scopeKey: 'backend-real-managed-secret',
          ownerStepId: 'gate-release',
        }),
      ],
      requiredSecretNames: ['BACKEND_REAL_API_KEY'],
      env: {
        BACKEND_REAL_API_KEY: 'sk-status-render-do-not-print',
      },
      generatedAt: GENERATED_AT,
    });

    const projection = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
      leaseStatusShadow,
    });
    const rendered = renderStatusProjection(projection);

    expect(rendered).toContain('Lease shadow active run: run-lease-001');
    expect(rendered).toContain('Lease shadow destructive command lock: present');
    expect(rendered).toContain('destructive-lifecycle');
    expect(rendered).toContain('Lease shadow port family: present');
    expect(rendered).toContain('fixed-local-ports');
    expect(rendered).toContain('Lease shadow secret profile: present');
    expect(rendered).toContain('profile_presence=true');
    expect(rendered).toContain('digest=sha256:');
    expect(rendered).toContain('Next action: npm run release:ready');
    expect(rendered).toContain('Safe action: npm run release:ready');
    expect(rendered).toContain('Release decision produced: false');
    expect(rendered).toContain('Commands executed: false');
    expect(rendered).not.toContain('sk-status-render-do-not-print');
  });

  it('keeps prebuilt shadow scope_kind and mode redacted in projection JSON, lock_owner, and human output', () => {
    const prebuilt = buildMinimalLeaseStatusShadow({
      activeLeases: [lease({})],
      requiredSecretNames: [],
      generatedAt: GENERATED_AT,
    });
    const leaseStatusShadow = resolveMinimalLeaseStatusShadow({
      snapshotJson: JSON.stringify({
        ...prebuilt,
        active_run: prebuilt.active_run
          ? {
              ...prebuilt.active_run,
              owner_group: `owner-${PREBUILT_OWNER_SECRET}`,
              owner_step_id: `step-${PREBUILT_TICKET_SECRET}`,
            }
          : null,
        active_leases: prebuilt.active_leases.map((owner) => ({
          ...owner,
          scope_kind: PREBUILT_SCOPE_KIND_SECRET,
          mode: PREBUILT_MODE_SECRET,
          owner_group: `owner-${PREBUILT_OWNER_SECRET}`,
          owner_attempt_id: `attempt-${PREBUILT_TICKET_SECRET}`,
          owner_step_id: `step-${PREBUILT_OWNER_SECRET}`,
        })),
      }),
      generatedAt: GENERATED_AT,
    });

    const projection = buildStatusProjection({
      goal: 'release-ready',
      currentGitSha: CURRENT_GIT_SHA,
      generatedAt: GENERATED_AT,
      leaseStatusShadow,
    });
    const rendered = renderStatusProjection(projection);
    const serialized = JSON.stringify(projection);

    expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    expect(projection.lease_status_shadow?.active_leases[0]?.scope_kind).toContain('[redacted]');
    expect(projection.lease_status_shadow?.active_leases[0]?.mode).toContain('[redacted]');
    expect(projection.lock_owner?.owners[0]?.scope_kind).toContain('[redacted]');
    expect(serialized).toContain('[redacted]');
    expect(rendered).toContain('[redacted]');
    for (const raw of [
      PREBUILT_SCOPE_KIND_SECRET,
      PREBUILT_MODE_SECRET,
      PREBUILT_OWNER_SECRET,
      PREBUILT_TICKET_SECRET,
    ]) {
      expect(serialized).not.toContain(raw);
      expect(rendered).not.toContain(raw);
    }
  });

  it('keeps the status projection builder read-only and outside lock acquisition/release paths', () => {
    const source = readFileSync('scripts/governance/status-projection.ts', 'utf8');

    expect(source).not.toMatch(/new GovernanceLockLeaseManager/);
    expect(source).not.toMatch(/\.acquire\s*\(/);
    expect(source).not.toMatch(/\.release(?:Many)?\s*\(/);
  });

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

  it('keeps secret-looking artifact paths schema-valid and openable while redacting summaries', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-status-projection-api_key=path-secret-'));
    try {
      const aggregatePath = writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: SENSITIVE_AGGREGATE_SUMMARY,
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });

      expect(projection.aggregate_status_ref?.path).toBe(aggregatePath);
      expect(projection.deepest_reason?.source_path).toBe(aggregatePath);
      expect(projection.authority_paths.aggregate).toBe(aggregatePath);
      expect(projection.evidence_paths.map((entry) => entry.path)).toContain(aggregatePath);
      expect(existsSync(projection.aggregate_status_ref?.path ?? '')).toBe(true);
      expect(projection.aggregate_status_ref?.path.replaceAll('\\', '/')).toMatch(/\/gate-release-full\/result\.json$/);
      expect(projection.deepest_reason?.summary).toContain('[redacted]');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
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

  it('projects the latest passed rehearsal evidence as read-only pointers without release verdict truth', () => {
    withTempRoot((root) => {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      writeRehearsalResult(gateResultsRoot, {
        gateId: 'lane-demo-rehearsal',
        lineKind: 'demo_rehearsal',
        runId: '20260427T010000Z',
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'verify',
        summary: 'Older failed rehearsal evidence must not be selected.',
        generated_at: '2026-04-27T01:00:00.000Z',
      });
      const resultPath = writeRehearsalResult(gateResultsRoot, {
        gateId: 'lane-demo-rehearsal',
        lineKind: 'demo_rehearsal',
        runId: '20260427T020000Z',
        generated_at: '2026-04-27T02:00:00.000Z',
      });
      const runRoot = dirname(resultPath);
      const stageEventsPath = writeStageEvents(runRoot, [
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T020000Z',
          gate_id: 'lane-demo-rehearsal',
          line_kind: 'demo_rehearsal',
          stage: 'report',
          event: 'finished',
          diagnostic_reason_code: 'rehearsal_stage_completed',
          generated_at: '2026-04-27T02:00:03.000Z',
        },
      ]);
      const performancePath = writePerformance(runRoot, {
        schema_version: '1.0.0',
        artifact_kind: 'performance',
        run_id: '20260427T020000Z',
        gate_id: 'lane-demo-rehearsal',
        line_kind: 'demo_rehearsal',
        stages: [
          {
            stage: 'report',
            duration_ms: 250,
            diagnostic_reason_code: 'rehearsal_stage_duration_observed',
          },
        ],
        generated_at: '2026-04-27T02:00:03.000Z',
      });

      const projection = buildStatusProjection({
        goal: 'demo-rehearsal',
        runtimeLine: 'demo-rehearsal',
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(projection).toMatchObject({
        goal: 'demo-rehearsal',
        runtime_line: 'demo-rehearsal',
        run_id: '20260427T020000Z',
        aggregate_status_ref: null,
        presentation_status: 'passed',
        primary_blocker: null,
        safe_next_command: null,
        release_decision_produced: false,
        commands_executed: false,
      });
      expect(projection.deepest_reason).toMatchObject({
        code: 'rehearsal_result_passed',
        source_path: resultPath,
      });
      expect(projection.evidence_paths.map((entry) => entry.path)).toEqual([
        resultPath,
        stageEventsPath,
        performancePath,
      ]);
      expect(projection.authority_paths).toEqual({
        aggregate: null,
        stage: stageEventsPath,
        evidence: [resultPath, stageEventsPath, performancePath],
      });
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
      expect(JSON.stringify(projection)).not.toContain('failure_class');
      expect(existsSync(join(runRoot, 'status.json'))).toBe(false);
    });
  });

  it('ignores wrong-lane and mismatched run stage events for deepest reason and authority', () => {
    withTempRoot((root) => {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      const resultPath = writeRehearsalResult(gateResultsRoot, {
        gateId: 'lane-demo-rehearsal',
        lineKind: 'demo_rehearsal',
        runId: '20260427T025000Z',
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'verify',
        summary: 'Selected result failed during verify.',
        generated_at: '2026-04-27T02:50:00.000Z',
      });
      const stageEventsPath = writeRawStageEvents(dirname(resultPath), [
        '{not-valid-json',
        JSON.stringify({
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T024500Z',
          gate_id: 'lane-demo-rehearsal',
          line_kind: 'demo_rehearsal',
          stage: 'bootstrap',
          event: 'failed',
          stage_failure_reason: 'wrong_run_must_not_win',
          generated_at: '2026-04-27T02:50:01.000Z',
        }),
        JSON.stringify({
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T025000Z',
          gate_id: 'lane-cluster-rehearsal',
          line_kind: 'cluster_rehearsal',
          stage: 'verify',
          event: 'failed',
          stage_failure_reason: 'wrong_lane_must_not_win',
          generated_at: '2026-04-27T02:50:02.000Z',
        }),
        JSON.stringify({
          schema_version: '0.9.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T025000Z',
          gate_id: 'lane-demo-rehearsal',
          line_kind: 'demo_rehearsal',
          stage: 'verify',
          event: 'failed',
          stage_failure_reason: 'wrong_schema_must_not_win',
          generated_at: '2026-04-27T02:50:03.000Z',
        }),
        JSON.stringify({
          schema_version: '1.0.0',
          artifact_kind: 'performance',
          run_id: '20260427T025000Z',
          gate_id: 'lane-demo-rehearsal',
          line_kind: 'demo_rehearsal',
          stage: 'verify',
          event: 'failed',
          stage_failure_reason: 'wrong_artifact_kind_must_not_win',
          generated_at: '2026-04-27T02:50:04.000Z',
        }),
      ]);

      const projection = buildStatusProjection({
        goal: 'demo-rehearsal',
        runtimeLine: 'demo-rehearsal',
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('failed');
      expect(projection.primary_blocker).toEqual({
        owner: 'lane-demo-rehearsal',
        stage: 'verify',
        path: resultPath,
      });
      expect(projection.deepest_reason).toEqual({
        code: 'rehearsal_result_failed',
        summary: 'Selected result failed during verify.',
        source_path: resultPath,
      });
      expect(projection.authority_paths.stage).toBe(resultPath);
      expect(projection.evidence_paths.map((entry) => entry.path)).not.toContain(stageEventsPath);
      expect(JSON.stringify(projection)).not.toContain('wrong_run_must_not_win');
      expect(JSON.stringify(projection)).not.toContain('wrong_lane_must_not_win');
      expect(JSON.stringify(projection)).not.toContain('wrong_schema_must_not_win');
      expect(JSON.stringify(projection)).not.toContain('wrong_artifact_kind_must_not_win');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
  });

  it('uses the last failed rehearsal stage event as deepest reason and blocker source', () => {
    withTempRoot((root) => {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      const resultPath = writeRehearsalResult(gateResultsRoot, {
        gateId: 'lane-cluster-rehearsal',
        lineKind: 'cluster_rehearsal',
        runId: '20260427T030000Z',
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'execute',
        summary: 'Gate lane-cluster-rehearsal failed during execute: generic wrapper failure.',
        generated_at: '2026-04-27T03:00:00.000Z',
      });
      const runRoot = dirname(resultPath);
      const stageEventsPath = writeStageEvents(runRoot, [
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T030000Z',
          gate_id: 'lane-cluster-rehearsal',
          line_kind: 'cluster_rehearsal',
          stage: 'bootstrap',
          event: 'failed',
          stage_failure_reason: 'bootstrap_healthcheck_timeout',
          generated_at: '2026-04-27T03:00:02.000Z',
        },
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T030000Z',
          gate_id: 'lane-cluster-rehearsal',
          line_kind: 'cluster_rehearsal',
          stage: 'verify',
          event: 'failed',
          stage_failure_reason: 'rehearsal_stage_exited_nonzero',
          generated_at: '2026-04-27T03:00:04.000Z',
        },
      ]);

      const projection = buildStatusProjection({
        goal: 'cluster-rehearsal',
        runtimeLine: 'cluster-rehearsal',
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('failed');
      expect(projection.aggregate_status_ref).toBe(null);
      expect(projection.primary_blocker).toEqual({
        owner: 'lane-cluster-rehearsal',
        stage: 'verify',
        path: stageEventsPath,
      });
      expect(projection.deepest_reason).toEqual({
        code: 'rehearsal_stage_exited_nonzero',
        summary: 'Rehearsal stage verify failed: rehearsal_stage_exited_nonzero',
        source_path: stageEventsPath,
      });
      expect(projection.safe_next_command).toBe('npm run rehearse:cluster');
      expect(projection.authority_paths.stage).toBe(stageEventsPath);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
      expect(JSON.stringify(projection)).not.toContain('aggregate_result_not_applicable');
    });
  });

  it('picks inner failed rehearsal stage events over generic execute wrapper failures', () => {
    withTempRoot((root) => {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      const resultPath = writeRehearsalResult(gateResultsRoot, {
        gateId: 'lane-cluster-rehearsal',
        lineKind: 'cluster_rehearsal',
        runId: '20260427T033000Z',
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'execute',
        summary: 'Generic execute wrapper failed after inner rehearsal stages.',
        generated_at: '2026-04-27T03:30:00.000Z',
      });
      const stageEventsPath = writeStageEvents(dirname(resultPath), [
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T033000Z',
          gate_id: 'lane-cluster-rehearsal',
          line_kind: 'cluster_rehearsal',
          stage: 'bootstrap',
          event: 'failed',
          stage_failure_reason: 'bootstrap_healthcheck_timeout',
          generated_at: '2026-04-27T03:30:02.000Z',
        },
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T033000Z',
          gate_id: 'lane-cluster-rehearsal',
          line_kind: 'cluster_rehearsal',
          stage: 'verify',
          event: 'failed',
          stage_failure_reason: 'verify_rehearsal_contract_drift',
          generated_at: '2026-04-27T03:30:04.000Z',
        },
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T033000Z',
          gate_id: 'lane-cluster-rehearsal',
          line_kind: 'cluster_rehearsal',
          stage: 'execute',
          event: 'failed',
          diagnostic_reason_code: 'execute:failed',
          stage_failure_reason: 'wrapped_command_exited_nonzero',
          generated_at: '2026-04-27T03:30:05.000Z',
        },
      ]);

      const projection = buildStatusProjection({
        goal: 'cluster-rehearsal',
        runtimeLine: 'cluster-rehearsal',
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(projection.primary_blocker).toEqual({
        owner: 'lane-cluster-rehearsal',
        stage: 'verify',
        path: stageEventsPath,
      });
      expect(projection.deepest_reason).toEqual({
        code: 'verify_rehearsal_contract_drift',
        summary: 'Rehearsal stage verify failed: verify_rehearsal_contract_drift',
        source_path: stageEventsPath,
      });
      expect(projection.phase).toBe('verify');
      expect(JSON.stringify(projection)).not.toContain('wrapped_command_exited_nonzero');
      expect(JSON.stringify(projection)).not.toContain('execute:failed');
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
  });

  it('ignores invalid performance artifacts instead of treating file existence as evidence', () => {
    withTempRoot((root) => {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      const resultPath = writeRehearsalResult(gateResultsRoot, {
        gateId: 'lane-demo-rehearsal',
        lineKind: 'demo_rehearsal',
        runId: '20260427T034000Z',
        generated_at: '2026-04-27T03:40:00.000Z',
      });
      const runRoot = dirname(resultPath);
      const stageEventsPath = writeStageEvents(runRoot, [
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T034000Z',
          gate_id: 'lane-demo-rehearsal',
          line_kind: 'demo_rehearsal',
          stage: 'report',
          event: 'finished',
          diagnostic_reason_code: 'rehearsal_stage_completed',
          generated_at: '2026-04-27T03:40:02.000Z',
        },
      ]);
      const performancePath = writePerformance(runRoot, {
        schema_version: '1.0.0',
        artifact_kind: 'stage_event',
        run_id: '20260427T033000Z',
        gate_id: 'lane-cluster-rehearsal',
        line_kind: 'cluster_rehearsal',
        stages: [],
        generated_at: '2026-04-27T03:40:03.000Z',
      });

      const projection = buildStatusProjection({
        goal: 'demo-rehearsal',
        runtimeLine: 'demo-rehearsal',
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('passed');
      expect(projection.evidence_paths.map((entry) => entry.path)).toEqual([
        resultPath,
        stageEventsPath,
      ]);
      expect(projection.authority_paths).toEqual({
        aggregate: null,
        stage: stageEventsPath,
        evidence: [resultPath, stageEventsPath],
      });
      expect(projection.evidence_paths.map((entry) => entry.path)).not.toContain(performancePath);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
  });

  it('reports rehearsal not-started with the lane evidence root and safe next command', () => {
    withTempRoot((root) => {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      const laneEvidenceRoot = join(gateResultsRoot, 'lane-demo-rehearsal');

      const projection = buildStatusProjection({
        goal: 'demo-rehearsal',
        runtimeLine: 'demo-rehearsal',
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('not-started');
      expect(projection.aggregate_status_ref).toBe(null);
      expect(projection.primary_blocker).toBe(null);
      expect(projection.deepest_reason).toEqual({
        code: 'rehearsal_evidence_missing',
        summary: `No rehearsal evidence found under ${laneEvidenceRoot}.`,
        source_path: laneEvidenceRoot,
      });
      expect(projection.safe_next_command).toBe('npm run rehearse:demo');
      expect(projection.evidence_paths).toEqual([]);
      expect(projection.authority_paths).toEqual({
        aggregate: null,
        stage: laneEvidenceRoot,
        evidence: [],
      });
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
    });
  });

  it('redacts sensitive rehearsal result and stage-event summaries at the projection boundary', () => {
    withTempRoot((root) => {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      const resultPath = writeRehearsalResult(gateResultsRoot, {
        gateId: 'lane-demo-rehearsal',
        lineKind: 'demo_rehearsal',
        runId: '20260427T040000Z',
        status: 'failed',
        failure_class: 'product_regression',
        stage: 'verify',
        summary: SENSITIVE_AGGREGATE_SUMMARY,
        generated_at: '2026-04-27T04:00:00.000Z',
      });
      writeStageEvents(dirname(resultPath), [
        {
          schema_version: '1.0.0',
          artifact_kind: 'stage_event',
          run_id: '20260427T040000Z',
          gate_id: 'lane-demo-rehearsal',
          line_kind: 'demo_rehearsal',
          stage: 'verify',
          event: 'failed',
          stage_failure_reason: SENSITIVE_AGGREGATE_SUMMARY,
          generated_at: '2026-04-27T04:00:02.000Z',
        },
      ]);

      const projection = buildStatusProjection({
        goal: 'demo-rehearsal',
        runtimeLine: 'demo-rehearsal',
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(projection.presentation_status).toBe('failed');
      expect(projection.deepest_reason?.summary).toContain('[redacted]');
      expect(projection.deepest_reason?.code).toContain('[redacted]');
      expectNoSensitiveProjectionLeak(projection);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
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
      expect(blocked.safe_next_command).toBe('npm run verify -- --goal=visual --run');
      expectNoInternalVerifyAlias(blocked);

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

  it.each([
    ['lane-visual', 'npm run verify -- --goal=visual --run'],
    ['gate-fast', 'npm run verify -- --goal=debug --run'],
    ['gate-default', 'npm run verify -- --goal=pr --run'],
    ['gate-release', 'npm run verify -- --goal=release-real --run'],
  ])('uses governed verify command for failed release owner %s', (owner, expectedCommand) => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'evidence_missing',
        summary: `Missing campaign step result: ${owner}`,
      });

      const projection = buildStatusProjection({
        goal: 'release-ready',
        campaignRoot,
        currentGitSha: CURRENT_GIT_SHA,
        evidenceGitSha: EVIDENCE_GIT_SHA,
        generatedAt: GENERATED_AT,
      });
      const rendered = renderStatusProjection(projection);

      expect(projection.presentation_status).toBe('failed');
      expect(projection.primary_blocker?.owner).toBe(owner);
      expect(projection.safe_next_command).toBe(expectedCommand);
      expect(rendered).toContain(`Next action: ${expectedCommand}`);
      expectNoInternalVerifyAlias(projection);
      expectNoInternalVerifyAlias(rendered);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
      expectNoReleaseVerdictFields(projection);
    });
  });

  it('redacts sensitive aggregate summaries at the status projection boundary', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: SENSITIVE_AGGREGATE_SUMMARY,
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
      expect(projection.deepest_reason?.summary).toContain('[redacted]');
      expectNoSensitiveProjectionLeak(projection);
      expect(validateCurrentStatusProjection(projection)).toEqual({ ok: true, value: projection });
    });
  });

  it('redacts deepest reason summary again when rendering exported status projections', () => {
    const projection = {
      ...buildStatusProjection({
        goal: 'release-ready',
        currentGitSha: CURRENT_GIT_SHA,
        generatedAt: GENERATED_AT,
      }),
      deepest_reason: {
        code: 'renderer_secret_regression',
        summary: [
          'Authorization: Bearer renderer-bearer-raw-token',
          'managed_credentials: {"feishu":"renderer-managed-credential-raw-value"}',
          'password: {"value":"renderer-password-raw-value"}',
        ].join(' '),
        source_path: null,
      },
    };

    const rendered = renderStatusProjection(projection);

    expect(rendered).toContain('[redacted]');
    expect(rendered).not.toContain('renderer-bearer-raw-token');
    expect(rendered).not.toContain('renderer-managed-credential-raw-value');
    expect(rendered).not.toContain('renderer-password-raw-value');
    expect(rendered).not.toContain('Authorization: Bearer renderer-bearer-raw-token');
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

  it('keeps release-status --json from replaying redacted terminal summary secrets', () => {
    withTempRoot((campaignRoot) => {
      writeAggregateResult(campaignRoot, {
        status: 'failed',
        failure_class: 'product_regression',
        summary: SENSITIVE_AGGREGATE_SUMMARY,
      });

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
      expectNoSensitiveProjectionLeak(output);
    });
  });
});
