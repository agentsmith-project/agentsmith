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
import type { ResourceOwnerPreflightResult } from '../resource-owner-preflight';

const GENERATED_AT = '2026-04-27T12:00:00.000Z';
const LEASE_SNAPSHOT_ENV = 'AGENTSMITH_GOVERNANCE_LEASE_SNAPSHOT_PATH';
const LEASE_SNAPSHOT_SECRET = 'sk-clean-status-lease-shadow-do-not-print';
const LEASE_OWNER_SECRET = 'sk-clean-status-owner-secret-1234567';
const LEASE_TICKET_SECRET = 'ticket=clean-status-ticket-raw-value';
const LEASE_API_KEY_SECRET = 'api_key=clean-status-api-key-raw-value';
const LEASE_PASSWORD_SECRET = 'password=clean-status-password-raw-value';
const RELEASE_STATUS_SECRET_ARG = '--api_key=entrypoint-release-api-key-raw-value';
const LOCAL_REAL_STATUS_SECRET_ARG = '--ticket=entrypoint-local-ticket-raw-value';

function expectNoEntrypointSecretLeak(output: string, rawArg: string, rawSecret: string): void {
  expect(output).not.toContain(rawArg);
  expect(output).not.toContain(rawSecret);
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

function localRealAppConflictPreflight(): ResourceOwnerPreflightResult {
  return {
    ok: false,
    evidencePath: 'artifacts/local-real/preflight/evidence.json',
    evidence: {
      schema: 'agentsmith_resource_owner_preflight/v1',
      target: 'local-real-status',
      status: 'failed',
      generated_at: GENERATED_AT,
      lock_id: 'fixed-local-ports',
      checked_ports: [20000],
      conflicts: [],
      blocker: null,
    },
    blocker: {
      port: 20000,
      label: 'API backend base port',
      owner_kind: 'local-real-app',
      owner_label: 'node scripts/local-manual/start-api.js',
      detail: 'local-real app process is listening on port 20000',
      recovery: {
        kind: 'fix',
        command: 'make local-real-down',
      },
    },
    conflicts: [],
  };
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

  it('prints diagnostic-only resource owner state in local-real status without failing the read-only command', () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = runLocalRealStatusProjection([], {
      stdout: { write: (chunk: string) => stdout.push(chunk) },
      stderr: { write: (chunk: string) => stderr.push(chunk) },
      generatedAt: GENERATED_AT,
      ownerPreflight: () => localRealAppConflictPreflight(),
    });

    const output = stdout.join('');

    expect(exitCode).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(output).toContain('Diagnostic only: not a release verdict.');
    expect(output).toContain('AgentSmith Status Projection');
    expect(output).toContain('Blocker: environment_conflict');
    expect(output).toContain('Why: port 20000 is owned by node scripts/local-manual/start-api.js');
    expect(output).toContain('Fix: make local-real-down');
    expect(output).toContain('Evidence: artifacts/local-real/preflight/evidence.json');
    expect(output).not.toContain('Rerun: make local-real-status');
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

  it('runs local-real projection before existing substrate and local-manual diagnostics', () => {
    const makefile = readFileSync('Makefile', 'utf8');

    expect(makefile).toMatch(
      /local-real-status:[\s\S]*tsx scripts\/governance\/local-real-status\.ts[\s\S]*\$\(MAKE\) substrate-status[\s\S]*\$\(MAKE\) local-manual-status/,
    );
    expect(makefile).toMatch(
      /local-real-up:[\s\S]*tsx scripts\/governance\/resource-owner-preflight\.ts --target=local-real-up[\s\S]*\$\(MAKE\) substrate-up/,
    );
    expect(makefile).not.toContain('artifacts/runtime/lines/local-real');
  });
});
