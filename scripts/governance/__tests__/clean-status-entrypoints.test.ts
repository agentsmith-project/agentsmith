import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CURRENT_GATE_RESULT_SCHEMA_VERSION } from '../current-gate-result-schema';
import { validateCurrentStatusProjection } from '../current-status-projection-schema';
import type { GovernanceRuntimeLockLease } from '../governance-lock-lease-manager';
import { runLocalRealStatusProjection } from '../local-real-status';
import { runRehearsalEntrypoint } from '../rehearsal-entrypoint';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const LEASE_SNAPSHOT_ENV = 'AGENTSMITH_GOVERNANCE_LEASE_SNAPSHOT_PATH';
const LEASE_SNAPSHOT_SECRET = 'sk-clean-status-lease-shadow-do-not-print';
const LEASE_OWNER_SECRET = 'sk-clean-status-owner-secret-1234567';
const LEASE_TICKET_SECRET = 'ticket=clean-status-ticket-raw-value';
const LEASE_API_KEY_SECRET = 'api_key=clean-status-api-key-raw-value';
const LEASE_PASSWORD_SECRET = 'password=clean-status-password-raw-value';
const RELEASE_STATUS_SECRET_ARG = '--api_key=entrypoint-release-api-key-raw-value';
const LOCAL_REAL_STATUS_SECRET_ARG = '--ticket=entrypoint-local-ticket-raw-value';
const REHEARSAL_STATUS_SECRET_ARG = 'Authorization: Bearer entrypoint-rehearsal-bearer-raw-token';

function passingSentinelResult() {
  return {
    exitCode: 0 as const,
    output: {
      presence: {},
      profile_digest: 'sha256:test-profile-digest',
      public_endpoint: null,
      port_family: 'unknown',
    },
  };
}

function failingSentinelResult() {
  return {
    exitCode: 1 as const,
    output: {
      presence: {
        'probe.registry_available': false,
      },
      profile_digest: 'sha256:redacted-failing-profile-digest',
      public_endpoint: null,
      port_family: 'unknown',
    },
  };
}

function expectNoEntrypointSecretLeak(output: string, rawArg: string, rawSecret: string): void {
  expect(output).not.toContain(rawArg);
  expect(output).not.toContain(rawSecret);
  expect(output).not.toContain('Authorization: Bearer entrypoint-rehearsal-bearer-raw-token');
}

function writeJson(path: string, payload: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function writeReleaseAggregateResult(campaignRoot: string): void {
  writeJson(join(campaignRoot, 'gate-release-full', 'result.json'), {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: 'gate-release-full',
    gate_adapter: {
      npm_script: 'gate:release:full',
      ci_job: null,
    },
    status: 'passed',
    failure_class: 'none',
    stage: 'aggregate',
    line_kind: 'release_full_verdict',
    evidence_dir: join(campaignRoot, 'gate-release-full'),
    summary: 'Release-full campaign evidence passed aggregate verification.',
    generated_at: GENERATED_AT,
  });
}

function lease(overrides: Partial<GovernanceRuntimeLockLease>): GovernanceRuntimeLockLease {
  return {
    leaseId: overrides.leaseId ?? 'lease-clean-status-001',
    lockId: overrides.lockId ?? 'release-campaign-root-writes',
    scopeKind: overrides.scopeKind ?? 'campaign_root',
    scopeKey: overrides.scopeKey ?? '/tmp/clean-status-release-run',
    ownerGroup: overrides.ownerGroup ?? 'release-full|clean-status-run|/tmp/clean-status-release-run',
    ownerAttemptId: overrides.ownerAttemptId ?? 'clean-status-run:gate-release',
    ownerStepId: overrides.ownerStepId ?? 'gate-release',
    mode: overrides.mode ?? 'exclusive',
    campaignId: overrides.campaignId ?? 'release-full',
    runId: overrides.runId ?? 'clean-status-run',
    campaignRoot: overrides.campaignRoot ?? '/tmp/clean-status-release-run',
    acquiredAt: overrides.acquiredAt ?? GENERATED_AT,
  };
}

function activeLeaseSnapshot(): readonly GovernanceRuntimeLockLease[] {
  return [
    lease({}),
    lease({
      leaseId: 'lease-clean-status-destructive',
      lockId: 'destructive-lifecycle',
      scopeKind: 'local_host',
      scopeKey: 'localhost',
      ownerStepId: 'local-real-reset',
    }),
    lease({
      leaseId: 'lease-clean-status-ports',
      lockId: 'fixed-local-ports',
      scopeKind: 'local_host',
      scopeKey: 'local-real:ports',
      ownerStepId: 'local-real-up',
    }),
    lease({
      leaseId: 'lease-clean-status-secret',
      lockId: 'provider-secret-profile',
      scopeKind: 'provider_profile',
      scopeKey: 'backend-real-managed-secret',
      ownerStepId: 'gate-release',
    }),
  ];
}

function writeLeaseSnapshot(root: string): string {
  const path = join(root, 'lease-snapshot.json');
  writeJson(path, {
    activeLeases: activeLeaseSnapshot(),
  });
  return path;
}

function writeMalformedLeaseSnapshot(root: string): string {
  const path = join(root, 'lease-snapshot-malformed.json');
  writeJson(path, {
    activeLeases: [
      lease({ acquiredAt: 'not-an-iso-date' }),
    ],
  });
  return path;
}

function writeSecretLikeLeaseSnapshot(root: string): string {
  const path = join(root, 'lease-snapshot-secret-like.json');
  writeJson(path, {
    activeLeases: [
      lease({
        leaseId: `lease-${LEASE_OWNER_SECRET}`,
        scopeKey: `/tmp/${LEASE_API_KEY_SECRET}`,
        ownerGroup: `release-full|${LEASE_OWNER_SECRET}|${LEASE_TICKET_SECRET}`,
        ownerAttemptId: `attempt-${LEASE_TICKET_SECRET}`,
        ownerStepId: `gate-release-${LEASE_OWNER_SECRET}`,
        campaignId: `release-${LEASE_OWNER_SECRET}`,
        runId: `run-${LEASE_OWNER_SECRET}`,
        campaignRoot: `/tmp/${LEASE_PASSWORD_SECRET}`,
      }),
      lease({
        leaseId: `lease-secret-${LEASE_OWNER_SECRET}`,
        lockId: 'provider-secret-profile',
        scopeKind: 'provider_profile',
        scopeKey: `backend-real-${LEASE_API_KEY_SECRET}`,
        ownerGroup: `provider|${LEASE_OWNER_SECRET}`,
        ownerAttemptId: `attempt-secret-${LEASE_TICKET_SECRET}`,
        ownerStepId: `gate-release-${LEASE_OWNER_SECRET}`,
      }),
    ],
  });
  return path;
}

function expectNoLeaseSnapshotSecretLeak(output: string): void {
  expect(output).not.toContain(LEASE_OWNER_SECRET);
  expect(output).not.toContain(LEASE_TICKET_SECRET);
  expect(output).not.toContain(LEASE_API_KEY_SECRET);
  expect(output).not.toContain(LEASE_PASSWORD_SECRET);
  expect(output).not.toContain(LEASE_SNAPSHOT_SECRET);
}

function withLeaseSnapshotEnv<T>(snapshotPath: string, action: () => T): T {
  const previousSnapshot = process.env[LEASE_SNAPSHOT_ENV];
  const previousSecret = process.env.BACKEND_REAL_API_KEY;
  process.env[LEASE_SNAPSHOT_ENV] = snapshotPath;
  process.env.BACKEND_REAL_API_KEY = LEASE_SNAPSHOT_SECRET;
  try {
    return action();
  } finally {
    if (previousSnapshot === undefined) {
      delete process.env[LEASE_SNAPSHOT_ENV];
    } else {
      process.env[LEASE_SNAPSHOT_ENV] = previousSnapshot;
    }
    if (previousSecret === undefined) {
      delete process.env.BACKEND_REAL_API_KEY;
    } else {
      process.env.BACKEND_REAL_API_KEY = previousSecret;
    }
  }
}

function writeRehearsalEvidence(gateResultsRoot: string, input: {
  gateId: 'lane-demo-rehearsal' | 'lane-cluster-rehearsal';
  lineKind: 'demo_rehearsal' | 'cluster_rehearsal';
  runId: string;
  status?: 'passed' | 'failed';
  failureClass?: 'none' | 'product_regression';
  stage?: string;
  summary?: string;
}): {
  resultPath: string;
  stageEventsPath: string;
} {
  const runRoot = join(gateResultsRoot, input.gateId, input.runId);
  const resultPath = join(runRoot, 'result.json');
  writeJson(resultPath, {
    schema_version: CURRENT_GATE_RESULT_SCHEMA_VERSION,
    gate_id: input.gateId,
    gate_adapter: {
      npm_script: input.gateId === 'lane-demo-rehearsal' ? 'lane:demo-rehearsal' : 'lane:cluster-rehearsal',
      ci_job: 'local',
    },
    status: input.status ?? 'failed',
    failure_class: input.failureClass ?? 'product_regression',
    stage: input.stage ?? 'execute',
    line_kind: input.lineKind,
    evidence_dir: runRoot,
    summary: input.summary ?? `Gate ${input.gateId} failed during execute.`,
    generated_at: GENERATED_AT,
  });
  const stageEventsPath = join(runRoot, 'stage-events.jsonl');
  mkdirSync(dirname(stageEventsPath), { recursive: true });
  writeFileSync(stageEventsPath, `${JSON.stringify({
    schema_version: '1.0.0',
    artifact_kind: 'stage_event',
    run_id: input.runId,
    gate_id: input.gateId,
    line_kind: input.lineKind,
    stage: 'verify',
    event: 'failed',
    stage_failure_reason: 'rehearsal_stage_exited_nonzero',
    generated_at: GENERATED_AT,
  })}\n`);
  writeJson(join(runRoot, 'performance.json'), {
    schema_version: '1.0.0',
    artifact_kind: 'performance',
    run_id: input.runId,
    gate_id: input.gateId,
    line_kind: input.lineKind,
    stages: [
      {
        stage: 'verify',
        duration_ms: 1000,
        stage_failure_reason: 'rehearsal_stage_exited_nonzero',
      },
    ],
    generated_at: GENERATED_AT,
  });
  return {
    resultPath,
    stageEventsPath,
  };
}

function readPackageScripts(): Record<string, string> {
  return (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
}

describe('clean status entrypoints', () => {
  it('renders release:status default human output as a read-only status projection first screen', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-projection-'));
    try {
      writeReleaseAggregateResult(campaignRoot);

      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });

      expect(output).toContain('AgentSmith Status Projection');
      expect(output).toContain('Projection kind: read-only');
      expect(output).toContain('Goal: release-ready');
      expect(output).toContain('Presentation status: passed');
      expect(output).toContain('Lease shadow active run: not-known');
      expect(output).toContain('Lease shadow destructive command lock: not-known');
      expect(output).toContain('Lease shadow port family: not-known');
      expect(output).toContain('Lease shadow secret profile: not-known');
      expect(output).toContain('Release decision produced: false');
      expect(output).toContain('Commands executed: false');
      expect(output).not.toContain('Automated release verdict');
      expect(output).not.toContain('release_verdict');
      expect(output).not.toContain('automated_release_verdict');
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('keeps release:status --json as the unified read-only projection', () => {
    const campaignRoot = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-json-'));
    try {
      writeReleaseAggregateResult(campaignRoot);

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
      expect(projection).toMatchObject({
        schema: 'agentsmith_status_projection/v1',
        goal: 'release-ready',
        projection_kind: 'read_only',
        lease_status_shadow: null,
        release_decision_produced: false,
        commands_executed: false,
      });
    } finally {
      rmSync(campaignRoot, { recursive: true, force: true });
    }
  });

  it('reads an existing active lease snapshot in real release:status JSON and human output', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-live-lease-'));
    try {
      const campaignRoot = join(root, 'campaign');
      writeReleaseAggregateResult(campaignRoot);
      const snapshotPath = writeLeaseSnapshot(root);
      const env = {
        ...process.env,
        [LEASE_SNAPSHOT_ENV]: snapshotPath,
        BACKEND_REAL_API_KEY: LEASE_SNAPSHOT_SECRET,
      };

      const jsonOutput = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      });
      const projection = JSON.parse(jsonOutput) as {
        lease_status_shadow: {
          active_run: { run_id: string } | null;
          destructive_command_lock: { present: boolean };
          port_family: { present: boolean };
          secret_profile_lock: { present: boolean; profile: { present: boolean; digest: string | null } };
        } | null;
        commands_executed: boolean;
        release_decision_produced: boolean;
      };

      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection.lease_status_shadow?.active_run?.run_id).toBe('clean-status-run');
      expect(projection.lease_status_shadow?.destructive_command_lock.present).toBe(true);
      expect(projection.lease_status_shadow?.port_family.present).toBe(true);
      expect(projection.lease_status_shadow?.secret_profile_lock.present).toBe(true);
      expect(projection.lease_status_shadow?.secret_profile_lock.profile).toEqual({
        present: true,
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      });
      expect(projection.commands_executed).toBe(false);
      expect(projection.release_decision_produced).toBe(false);
      expect(jsonOutput).not.toContain(LEASE_SNAPSHOT_SECRET);

      const humanOutput = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      });
      expect(humanOutput).toContain('Lease shadow active run: clean-status-run');
      expect(humanOutput).toContain('Lease shadow destructive command lock: present');
      expect(humanOutput).toContain('Lease shadow port family: present');
      expect(humanOutput).toContain('Lease shadow secret profile: present');
      expect(humanOutput).toContain('profile_presence=true');
      expect(humanOutput).not.toContain(LEASE_SNAPSHOT_SECRET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('degrades malformed active lease snapshots in real release:status without invalidating JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-malformed-lease-'));
    try {
      const campaignRoot = join(root, 'campaign');
      writeReleaseAggregateResult(campaignRoot);
      const snapshotPath = writeMalformedLeaseSnapshot(root);
      const output = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          [LEASE_SNAPSHOT_ENV]: snapshotPath,
        },
        encoding: 'utf8',
      });
      const projection = JSON.parse(output) as {
        lease_status_shadow: unknown;
        commands_executed: boolean;
        release_decision_produced: boolean;
      };

      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection.lease_status_shadow).toBe(null);
      expect(projection.commands_executed).toBe(false);
      expect(projection.release_decision_produced).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('redacts secret-like lease snapshot strings in real release:status JSON and human output', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-release-status-secret-lease-'));
    try {
      const campaignRoot = join(root, 'campaign');
      writeReleaseAggregateResult(campaignRoot);
      const snapshotPath = writeSecretLikeLeaseSnapshot(root);
      const env = {
        ...process.env,
        [LEASE_SNAPSHOT_ENV]: snapshotPath,
        BACKEND_REAL_API_KEY: LEASE_SNAPSHOT_SECRET,
      };

      const jsonOutput = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--json',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      });
      const projection = JSON.parse(jsonOutput) as unknown;

      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(jsonOutput).toContain('[redacted]');
      expectNoLeaseSnapshotSecretLeak(jsonOutput);

      const humanOutput = execFileSync('npx', [
        'tsx',
        'scripts/governance/release-status.ts',
        '--campaign-root',
        campaignRoot,
      ], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      });

      expect(humanOutput).toContain('[redacted]');
      expect(humanOutput).toContain('Lease shadow active run:');
      expectNoLeaseSnapshotSecretLeak(humanOutput);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not echo secret-like unknown args from release status errors', () => {
    const result = spawnSync('npx', [
      'tsx',
      'scripts/governance/release-status.ts',
      RELEASE_STATUS_SECRET_ARG,
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[release-status]');
    expectNoEntrypointSecretLeak(
      combinedOutput,
      RELEASE_STATUS_SECRET_ARG,
      'entrypoint-release-api-key-raw-value',
    );
  });

  it.each([
    ['demo-rehearsal', 'demo-rehearsal', 'npm run lane:demo-rehearsal'],
    ['cluster-rehearsal', 'cluster-rehearsal', 'npm run lane:cluster-rehearsal'],
  ])('renders %s --status --json as read-only projection without delegating the lane', (line, runtimeLine, laneCommand) => {
    const stdout: string[] = [];
    const delegated: string[][] = [];
    const sentinelProfiles: string[] = [];

    const exitCode = runRehearsalEntrypoint([line, '--status', '--json'], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: () => undefined },
      delegate: (command, args) => {
        delegated.push([command, ...args]);
        return { status: 0 };
      },
      sentinelRunner: (profile) => {
        sentinelProfiles.push(profile);
        return failingSentinelResult();
      },
      generatedAt: GENERATED_AT,
    });

    expect(exitCode).toBe(0);
    expect(delegated).toEqual([]);
    expect(sentinelProfiles).toEqual([]);
    expect(stdout.join('')).not.toContain(laneCommand);

    const projection = JSON.parse(stdout.join('')) as unknown;
    expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
    expect(projection).toMatchObject({
      schema: 'agentsmith_status_projection/v1',
      goal: line,
      runtime_line: runtimeLine,
      projection_kind: 'read_only',
      commands_executed: false,
      leases_acquired: false,
      leases_released: false,
    });
  });

  it('renders rehearsal --status --json from existing read-only evidence without producing release verdict fields', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-rehearsal-status-json-'));
    try {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      const { resultPath, stageEventsPath } = writeRehearsalEvidence(gateResultsRoot, {
        gateId: 'lane-demo-rehearsal',
        lineKind: 'demo_rehearsal',
        runId: '20260427T050000Z',
      });
      const stdout: string[] = [];
      const delegated: string[][] = [];

      const exitCode = runRehearsalEntrypoint(['demo-rehearsal', '--status', '--json'], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: () => undefined },
        delegate: (command, args) => {
          delegated.push([command, ...args]);
          return { status: 0 };
        },
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      expect(exitCode).toBe(0);
      expect(delegated).toEqual([]);
      const output = stdout.join('');
      expect(output).not.toContain('release_verdict');
      expect(output).not.toContain('automated_release_verdict');
      expect(output).not.toContain('failure_class');

      const projection = JSON.parse(output) as unknown;
      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection).toMatchObject({
        schema: 'agentsmith_status_projection/v1',
        goal: 'demo-rehearsal',
        runtime_line: 'demo-rehearsal',
        projection_kind: 'read_only',
        aggregate_status_ref: null,
        presentation_status: 'failed',
        primary_blocker: {
          owner: 'lane-demo-rehearsal',
          stage: 'verify',
          path: stageEventsPath,
        },
        deepest_reason: {
          code: 'rehearsal_stage_exited_nonzero',
          source_path: stageEventsPath,
        },
        safe_next_command: 'npm run rehearse:demo',
        commands_executed: false,
      });
      expect((projection as { evidence_paths: readonly { path: string }[] }).evidence_paths.map((entry) => entry.path))
        .toContain(resultPath);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads an existing active lease snapshot in rehearsal status JSON without delegating the lane', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-rehearsal-status-live-lease-'));
    try {
      const snapshotPath = writeLeaseSnapshot(root);
      const stdout: string[] = [];
      const delegated: string[][] = [];

      const exitCode = withLeaseSnapshotEnv(snapshotPath, () => runRehearsalEntrypoint([
        'demo-rehearsal',
        '--status',
        '--json',
      ], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: () => undefined },
        delegate: (command, args) => {
          delegated.push([command, ...args]);
          return { status: 0 };
        },
        generatedAt: GENERATED_AT,
      }));

      const projection = JSON.parse(stdout.join('')) as {
        lease_status_shadow: { active_run: { run_id: string } | null } | null;
        commands_executed: boolean;
      };
      expect(exitCode).toBe(0);
      expect(delegated).toEqual([]);
      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection.lease_status_shadow?.active_run?.run_id).toBe('clean-status-run');
      expect(projection.commands_executed).toBe(false);
      expect(stdout.join('')).not.toContain(LEASE_SNAPSHOT_SECRET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('renders rehearsal human status with the selected run id on the first screen', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-rehearsal-status-human-'));
    try {
      const gateResultsRoot = join(root, 'artifacts', 'gate-results');
      writeRehearsalEvidence(gateResultsRoot, {
        gateId: 'lane-demo-rehearsal',
        lineKind: 'demo_rehearsal',
        runId: '20260427T051500Z',
      });
      const stdout: string[] = [];
      const delegated: string[][] = [];

      const exitCode = runRehearsalEntrypoint(['demo-rehearsal', '--status'], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: () => undefined },
        delegate: (command, args) => {
          delegated.push([command, ...args]);
          return { status: 0 };
        },
        gateResultsRoot,
        generatedAt: GENERATED_AT,
      });

      const output = stdout.join('');
      expect(exitCode).toBe(0);
      expect(delegated).toEqual([]);
      expect(output).toContain('AgentSmith Status Projection');
      expect(output).toContain('Goal: demo-rehearsal');
      expect(output).toContain('Run: 20260427T051500Z');
      expect(output).toContain('Lease shadow active run: not-known');
      expect(output).toContain('Lease shadow destructive command lock: not-known');
      expect(output).toContain('Lease shadow port family: not-known');
      expect(output).toContain('Lease shadow secret profile: not-known');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['demo-rehearsal', 'lane:demo-rehearsal'],
    ['cluster-rehearsal', 'lane:cluster-rehearsal'],
  ])('delegates %s default execution to the existing lane adapter', (line, laneScript) => {
    const delegated: string[][] = [];
    const sentinelProfiles: string[] = [];

    const exitCode = runRehearsalEntrypoint([line], {
      stdout: { write: () => undefined },
      stderr: { write: () => undefined },
      sentinelRunner: (profile) => {
        sentinelProfiles.push(profile);
        return passingSentinelResult();
      },
      delegate: (command, args) => {
        delegated.push([command, ...args]);
        return { status: 0 };
      },
      generatedAt: GENERATED_AT,
    });

    expect(exitCode).toBe(0);
    expect(sentinelProfiles).toEqual([line]);
    expect(delegated).toEqual([['npm', 'run', laneScript]]);
  });

  it.each([
    ['demo-rehearsal', 'lane:demo-rehearsal'],
    ['cluster-rehearsal', 'lane:cluster-rehearsal'],
  ])('stops %s default execution before delegating when sentinel fails', (line, laneScript) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const delegated: string[][] = [];
    const sentinelProfiles: string[] = [];

    const exitCode = runRehearsalEntrypoint([line], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      sentinelRunner: (profile) => {
        sentinelProfiles.push(profile);
        return failingSentinelResult();
      },
      delegate: (command, args) => {
        delegated.push([command, ...args]);
        return { status: 0 };
      },
      generatedAt: GENERATED_AT,
    });

    const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

    expect(exitCode).toBe(1);
    expect(sentinelProfiles).toEqual([line]);
    expect(delegated).toEqual([]);
    expect(combinedOutput).toContain('sentinel preflight failed');
    expect(combinedOutput).toContain('"probe.registry_available": false');
    expect(combinedOutput).not.toContain(laneScript);
    expect(combinedOutput).not.toContain('release_verdict');
    expect(combinedOutput).not.toContain('automated_release_verdict');
  });

  it('points public rehearse scripts at the mode-aware governance adapter', () => {
    const scripts = readPackageScripts();

    expect(scripts['rehearse:demo']).toBe('tsx scripts/governance/rehearsal-entrypoint.ts demo-rehearsal');
    expect(scripts['rehearse:cluster']).toBe('tsx scripts/governance/rehearsal-entrypoint.ts cluster-rehearsal');
  });

  it('renders local-real status projection with the registered local-manual runtime line', () => {
    const stdout: string[] = [];
    const exitCode = runLocalRealStatusProjection(['--json'], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: () => undefined },
      generatedAt: GENERATED_AT,
    });

    expect(exitCode).toBe(0);
    const projection = JSON.parse(stdout.join('')) as unknown;
    expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
    expect(projection).toMatchObject({
      goal: 'local-real',
      runtime_line: 'local-manual',
      projection_kind: 'read_only',
      commands_executed: false,
      leases_acquired: false,
      leases_released: false,
    });
  });

  it('reads an existing active lease snapshot in local-real status JSON', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentsmith-local-real-status-live-lease-'));
    try {
      const snapshotPath = writeLeaseSnapshot(root);
      const stdout: string[] = [];
      const exitCode = withLeaseSnapshotEnv(snapshotPath, () => runLocalRealStatusProjection(['--json'], {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: () => undefined },
        generatedAt: GENERATED_AT,
      }));

      const projection = JSON.parse(stdout.join('')) as {
        lease_status_shadow: { active_run: { run_id: string } | null } | null;
        leases_acquired: boolean;
        leases_released: boolean;
      };
      expect(exitCode).toBe(0);
      expect(validateCurrentStatusProjection(projection)).toMatchObject({ ok: true });
      expect(projection.lease_status_shadow?.active_run?.run_id).toBe('clean-status-run');
      expect(projection.leases_acquired).toBe(false);
      expect(projection.leases_released).toBe(false);
      expect(stdout.join('')).not.toContain(LEASE_SNAPSHOT_SECRET);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not echo secret-like unknown args from local-real status errors', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runLocalRealStatusProjection([LOCAL_REAL_STATUS_SECRET_ARG], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      generatedAt: GENERATED_AT,
    });

    const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

    expect(exitCode).toBe(1);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('[local-real-status]');
    expectNoEntrypointSecretLeak(
      combinedOutput,
      LOCAL_REAL_STATUS_SECRET_ARG,
      'entrypoint-local-ticket-raw-value',
    );
  });

  it('does not echo secret-like unknown args from rehearsal entrypoint errors', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const delegated: string[][] = [];

    const exitCode = runRehearsalEntrypoint(['demo-rehearsal', REHEARSAL_STATUS_SECRET_ARG], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      delegate: (command, args) => {
        delegated.push([command, ...args]);
        return { status: 0 };
      },
      generatedAt: GENERATED_AT,
    });

    const combinedOutput = `${stdout.join('')}\n${stderr.join('')}`;

    expect(exitCode).toBe(1);
    expect(delegated).toEqual([]);
    expect(stdout.join('')).toBe('');
    expect(stderr.join('')).toContain('[rehearsal-entrypoint]');
    expectNoEntrypointSecretLeak(
      combinedOutput,
      REHEARSAL_STATUS_SECRET_ARG,
      'entrypoint-rehearsal-bearer-raw-token',
    );
  });

  it('runs local-real projection before existing substrate and local-manual diagnostics', () => {
    const makefile = readFileSync('Makefile', 'utf8');

    expect(makefile).toMatch(
      /local-real-status:[\s\S]*tsx scripts\/governance\/local-real-status\.ts[\s\S]*\$\(MAKE\) substrate-status[\s\S]*\$\(MAKE\) local-manual-status/,
    );
    expect(makefile).not.toContain('artifacts/runtime/lines/local-real');
  });
});
