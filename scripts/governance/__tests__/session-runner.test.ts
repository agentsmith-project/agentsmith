import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MOCK_LANE_SESSION_SHARDS,
  MockLaneSessionAbortError,
  buildMockLaneSessionShardPlan,
  pruneMockLaneRuns,
  runMockLaneSession,
  runSessionRunnerCli,
  startMockLaneSession,
  startServerWithRetry,
  writeVisualBuildInfo,
  type MockLaneSessionDriver,
} from '../session-runner';

const FORBIDDEN_DIAGNOSTIC_FIELDS = [
  'verdict',
  'release_decision',
  'releaseDecision',
  'claim_id',
  'claimId',
  'evidence_claim_id',
  'passed',
  'reusable',
  'merge_allowed',
  'mergeAllowed',
] as const;

function expectNoForbiddenDiagnosticFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      expectNoForbiddenDiagnosticFields(item);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const key of Object.keys(value)) {
    expect(FORBIDDEN_DIAGNOSTIC_FIELDS).not.toContain(key as never);
    expectNoForbiddenDiagnosticFields((value as Record<string, unknown>)[key]);
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}

describe('mock lane session runner', () => {
  const tempRoots: string[] = [];
  const originalEnv = new Map<string, string | undefined>();

  afterEach(() => {
    for (const [key, value] of originalEnv) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    originalEnv.clear();

    while (tempRoots.length > 0) {
      const tempRoot = tempRoots.pop();
      if (tempRoot) {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    }
  });

  function setEnv(key: string, value: string | undefined): void {
    if (!originalEnv.has(key)) {
      originalEnv.set(key, process.env[key]);
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  function createTempRoot(prefix = 'mock-lane-session-'): string {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
    tempRoots.push(tempRoot);
    return tempRoot;
  }

  function createTempGitRoot(prefix = 'mock-lane-session-'): string {
    const tempRoot = createTempRoot(prefix);
    execFileSync('git', ['init'], { cwd: tempRoot, stdio: 'ignore' });
    writeFileSync(path.join(tempRoot, 'README.md'), 'mock lane session test\n');
    execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.name=AgentSmith Test',
        '-c',
        'user.email=agentsmith-test@example.com',
        'commit',
        '-m',
        'init',
      ],
      { cwd: tempRoot, stdio: 'ignore' },
    );
    return tempRoot;
  }

  function runRootFor(rootDir: string, runId: string): string {
    return path.join(rootDir, 'artifacts', 'mock-lane', 'runs', runId);
  }

  function captureStdout() {
    let output = '';
    return {
      writer: {
        write(chunk: string | Uint8Array) {
          output += chunk.toString();
          return true;
        },
      },
      read: () => output,
    };
  }

  it('declares stable shard mapping for mock defaults and keeps visual update out of shared sessions', () => {
    expect(MOCK_LANE_SESSION_SHARDS.map((shard) => shard.id)).toEqual([
      'smoke',
      'chromium',
      'chromium-serial',
      'visual',
    ]);
    expect(buildMockLaneSessionShardPlan('default').map((shard) => shard.id)).toEqual([
      'smoke',
      'chromium',
      'chromium-serial',
    ]);
    expect(buildMockLaneSessionShardPlan('with-visual').map((shard) => shard.id)).toEqual([
      'smoke',
      'chromium',
      'chromium-serial',
      'visual',
    ]);

    for (const shard of MOCK_LANE_SESSION_SHARDS) {
      expect(shard.kind).toBe('mock');
      expect(shard.currentGateId).toBe('lane-mock');
      expect(shard.evidenceOwner).toMatch(/^mock-lane-session:/);
      expect(['process', 'serialized']).toContain(shard.isolationLevel);
      expect(shard.currentNpmScripts).not.toContain('test:e2e:lane:mock:visual:update');
    }
  });

  it('starts the mock lane server once, runs shards in project order, and keeps diagnostic-only evidence by default', async () => {
    setEnv('MOCK_LANE_SESSION_KEEP_SUCCESS', undefined);
    setEnv('MOCK_LANE_KEEP_SUCCESS', undefined);
    const tempRoot = createTempGitRoot();
    const calls: string[] = [];

    const driver: MockLaneSessionDriver = {
      async startServer(session) {
        calls.push(`start:${session.port}`);
      },
      async warmRoutes(session) {
        calls.push(`warm:${session.baseUrl}`);
      },
      async runPlaywrightShard(_session, shard) {
        calls.push(`playwright:${shard.id}:${shard.playwrightArgs.join(' ')}`);
        return {
          exitCode: 0,
          listenerLost: false,
          transientFailure: false,
          stdout: `stdout ${shard.id}`,
          stderr: `stderr ${shard.id}`,
        };
      },
      async stopServer(session) {
        calls.push(`stop:${session.port}`);
      },
    };

    const result = await runMockLaneSession({
      driver,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      port: 3999,
      preset: 'with-visual',
      rootDir: tempRoot,
      runId: 'mock-session-test',
      runRoot: runRootFor(tempRoot, 'mock-session-test'),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(result.sessionRoot)).toBe(true);
    expect(existsSync(path.join(result.sessionRoot, 'aggregate.json'))).toBe(true);
    expect(calls).toEqual([
      'start:3999',
      'warm:http://127.0.0.1:3999',
      'playwright:smoke:--project=smoke --workers=1',
      'playwright:chromium:--project=chromium --workers=4',
      'playwright:chromium-serial:--project=chromium-serial --workers=1',
      'playwright:visual:e2e/visual.spec.ts --project=visual --workers=1',
      'stop:3999',
    ]);

    const aggregate = readJson(path.join(result.sessionRoot, 'aggregate.json')) as {
      diagnostic_only: boolean;
      fixed_cost: { startup_count: number; route_warm_count: number };
      shards: Array<{ diagnostic_state: string; shard_id: string }>;
    };
    expect(aggregate.diagnostic_only).toBe(true);
    expect(aggregate.fixed_cost).toEqual({ startup_count: 1, route_warm_count: 1 });
    expect(aggregate.shards.map((shard) => shard.shard_id)).toEqual([
      'smoke',
      'chromium',
      'chromium-serial',
      'visual',
    ]);
    expect(aggregate.shards.map((shard) => shard.diagnostic_state)).toEqual([
      'succeeded',
      'succeeded',
      'succeeded',
      'succeeded',
    ]);
    expectNoForbiddenDiagnosticFields(aggregate);

    for (const shardId of ['smoke', 'chromium', 'chromium-serial', 'visual']) {
      const shardRoot = path.join(result.sessionRoot, 'shards', shardId);
      expect(existsSync(path.join(shardRoot, 'result.json'))).toBe(true);
      expect(readFileSync(path.join(shardRoot, 'evidence', 'playwright.stdout.log'), 'utf8')).toContain(shardId);
      expect(readFileSync(path.join(shardRoot, 'evidence', 'playwright.stderr.log'), 'utf8')).toContain(shardId);
      expectNoForbiddenDiagnosticFields(readJson(path.join(shardRoot, 'result.json')));
    }
  });

  it('documents the stable mock session start/run-shard/finish CLI in help output', async () => {
    const stdout = captureStdout();

    const exitCode = await runSessionRunnerCli(['session', '--help'], { stdout: stdout.writer });

    expect(exitCode).toBe(0);
    expect(stdout.read()).toContain('session start --kind=mock --run-root=<path> --port-family=<id>');
    expect(stdout.read()).toContain('session run-shard --session-root=<path> --shard=<id>');
    expect(stdout.read()).toContain('session finish --session-root=<path>');
    expect(stdout.read()).toContain('run --kind=mock');
  });

  it('runs a stable mock session through start, run-shard, and finish using persisted metadata', async () => {
    const tempRoot = createTempGitRoot('mock-lane-session-cli-');
    const runRoot = runRootFor(tempRoot, 'mock-session-cli');
    const calls: string[] = [];
    const driver: MockLaneSessionDriver = {
      async startServer(session) {
        calls.push(`start:${session.portFamily}:${session.port}`);
      },
      async warmRoutes(session) {
        calls.push(`warm:${session.baseUrl}`);
      },
      async runPlaywrightShard(session, shard) {
        calls.push(`playwright:${session.portFamily}:${shard.id}`);
        return {
          exitCode: 0,
          listenerLost: false,
          transientFailure: false,
          stdout: `stdout ${shard.id}`,
          stderr: `stderr ${shard.id}`,
        };
      },
      async stopServer(session) {
        calls.push(`stop:${session.portFamily}`);
      },
    };
    const stdout = captureStdout();

    await expect(runSessionRunnerCli([
      'session',
      'start',
      '--kind=mock',
      `--run-root=${runRoot}`,
      '--port-family=mock-cli-family',
      '--port=3997',
      '--shards=smoke',
    ], { driver, stdout: stdout.writer })).resolves.toBe(0);

    expect(existsSync(path.join(runRoot, 'session.json'))).toBe(true);
    expect(stdout.read()).toContain(`session_root=${runRoot}`);

    await expect(runSessionRunnerCli([
      'session',
      'run-shard',
      `--session-root=${runRoot}`,
      '--shard=smoke',
    ], { driver, stdout: stdout.writer })).resolves.toBe(0);

    await expect(runSessionRunnerCli([
      'session',
      'finish',
      `--session-root=${runRoot}`,
    ], { driver, stdout: stdout.writer })).resolves.toBe(0);

    expect(calls).toEqual([
      'start:mock-cli-family:3997',
      'warm:http://127.0.0.1:3997',
      'playwright:mock-cli-family:smoke',
      'stop:mock-cli-family',
    ]);
    expect(existsSync(path.join(runRoot, 'aggregate.json'))).toBe(true);
    expect(stdout.read()).toContain(`aggregate=${path.join(runRoot, 'aggregate.json')}`);

    const aggregate = readJson(path.join(runRoot, 'aggregate.json')) as {
      final_exit_code: number;
      fixed_cost: { startup_count: number; route_warm_count: number };
      port_family: string;
      shard_order: string[];
      shards: Array<{ diagnostic_state: string; shard_id: string }>;
    };
    expect(aggregate.final_exit_code).toBe(0);
    expect(aggregate.fixed_cost).toEqual({ startup_count: 1, route_warm_count: 1 });
    expect(aggregate.port_family).toBe('mock-cli-family');
    expect(aggregate.shard_order).toEqual(['smoke']);
    expect(aggregate.shards).toEqual([
      expect.objectContaining({ diagnostic_state: 'succeeded', shard_id: 'smoke' }),
    ]);
    expectNoForbiddenDiagnosticFields(aggregate);
  });

  it('does not retry assertion failures or let cleanup failures replace the failing shard exit code', async () => {
    const tempRoot = createTempGitRoot('mock-lane-session-failure-');
    const calls: string[] = [];

    const driver: MockLaneSessionDriver = {
      async startServer() {
        calls.push('start');
      },
      async warmRoutes() {
        calls.push('warm');
      },
      async runPlaywrightShard(_session, shard) {
        calls.push(`playwright:${shard.id}`);
        return {
          exitCode: shard.id === 'chromium' ? 23 : 0,
          listenerLost: false,
          transientFailure: false,
          stdout: `stdout ${shard.id}`,
          stderr: `stderr ${shard.id}`,
        };
      },
      async stopServer() {
        calls.push('stop');
        throw new Error('cleanup failed');
      },
    };

    const result = await runMockLaneSession({
      driver,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      preset: 'default',
      rootDir: tempRoot,
      runId: 'mock-session-failure-test',
      runRoot: runRootFor(tempRoot, 'mock-session-failure-test'),
    });

    expect(result.exitCode).toBe(23);
    expect(calls).toEqual(['start', 'warm', 'playwright:smoke', 'playwright:chromium', 'stop']);

    const aggregate = readJson(path.join(result.sessionRoot, 'aggregate.json')) as {
      diagnostics: { cleanup_errors: Array<{ message: string }> };
      shards: Array<{ diagnostic_state: string; exit_code: number | null; shard_id: string }>;
    };
    expect(aggregate.shards).toEqual([
      expect.objectContaining({ diagnostic_state: 'succeeded', exit_code: 0, shard_id: 'smoke' }),
      expect.objectContaining({ diagnostic_state: 'failed', exit_code: 23, shard_id: 'chromium' }),
      expect.objectContaining({ diagnostic_state: 'not_run', exit_code: null, shard_id: 'chromium-serial' }),
    ]);
    expect(aggregate.diagnostics.cleanup_errors[0]?.message).toContain('cleanup failed');
    expectNoForbiddenDiagnosticFields(aggregate);
  });

  it('aborts through the shared finalize path and does not leave lane owner, pid, or current alias files', async () => {
    const tempRoot = createTempGitRoot('mock-lane-session-abort-');
    const abortController = new AbortController();
    const calls: string[] = [];

    const driver: MockLaneSessionDriver = {
      async startServer(session) {
        calls.push('start');
        writeFileSync(session.pidFile, '12345\n');
        abortController.abort(new MockLaneSessionAbortError('SIGTERM', 143));
        await new Promise(() => {
          // Keep the launch promise pending so the AbortSignal must drive cleanup.
        });
      },
      async warmRoutes() {
        calls.push('warm');
      },
      async runPlaywrightShard(_session, shard) {
        calls.push(`playwright:${shard.id}`);
        return {
          exitCode: 0,
          listenerLost: false,
          transientFailure: false,
          stdout: '',
          stderr: '',
        };
      },
      async stopServer(session) {
        calls.push('stop');
        rmSync(session.pidFile, { force: true });
      },
    };

    const result = await runMockLaneSession({
      driver,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      rootDir: tempRoot,
      runId: 'mock-session-abort-test',
      runRoot: runRootFor(tempRoot, 'mock-session-abort-test'),
      signal: abortController.signal,
    });

    expect(result.exitCode).toBe(143);
    expect(calls).toEqual(['start', 'stop']);
    expect(existsSync(path.join(result.sessionRoot, '.lane-owner.env'))).toBe(false);
    expect(existsSync(path.join(result.sessionRoot, 'web.pid'))).toBe(false);
    expect(existsSync(path.join(tempRoot, 'artifacts', 'mock-lane', 'current'))).toBe(false);
    expect(readFileSync(path.join(result.sessionRoot, '.status'), 'utf8').trim()).toBe('failed');

    const aggregate = readJson(path.join(result.sessionRoot, 'aggregate.json')) as {
      diagnostics: { aborted: boolean; abort_reason: string | null };
      final_exit_code: number;
    };
    expect(aggregate.final_exit_code).toBe(143);
    expect(aggregate.diagnostics.aborted).toBe(true);
    expect(aggregate.diagnostics.abort_reason).toContain('SIGTERM');
    expectNoForbiddenDiagnosticFields(aggregate);
  });

  it('fails visual build metadata when git sha cannot be resolved instead of inheriting a parent sha', () => {
    const parentGitRoot = createTempGitRoot('mock-lane-session-parent-git-');
    const tempRoot = path.join(parentGitRoot, 'not-a-git-root');
    mkdirSync(tempRoot, { recursive: true });
    const session = startMockLaneSession({
      rootDir: tempRoot,
      runId: 'mock-session-no-git',
      runRoot: runRootFor(tempRoot, 'mock-session-no-git'),
    });

    expect(() => writeVisualBuildInfo(session, () => new Date('2026-04-29T12:00:00.000Z'))).toThrow(
      /failed to resolve git sha/,
    );
    expect(existsSync(session.visualBaselineBuildInfoFile)).toBe(false);
  });

  it('fails visual build metadata when an existing baseline file belongs to another git sha or run', () => {
    const tempRoot = createTempGitRoot('mock-lane-session-stale-visual-');
    const session = startMockLaneSession({
      rootDir: tempRoot,
      runId: 'mock-session-stale-visual',
      runRoot: runRootFor(tempRoot, 'mock-session-stale-visual'),
    });
    session.visualBaselineBuildInfoFile = path.join(tempRoot, 'stale-visual-build-info.json');
    writeFileSync(
      session.visualBaselineBuildInfoFile,
      JSON.stringify({ git_sha: 'stale-git-sha', run_id: 'other-run' }),
    );

    expect(() => writeVisualBuildInfo(session, () => new Date('2026-04-29T12:00:00.000Z'))).toThrow(
      /stale visual build metadata/,
    );
    const stale = readJson(session.visualBaselineBuildInfoFile) as { git_sha: string; run_id: string };
    expect(stale).toEqual({ git_sha: 'stale-git-sha', run_id: 'other-run' });
  });

  it('marks the attempted shard infra_failed when transient retry restart fails', async () => {
    const tempRoot = createTempGitRoot('mock-lane-session-transient-restart-');
    const calls: string[] = [];

    const driver: MockLaneSessionDriver = {
      async startServer() {
        calls.push('start');
        if (calls.filter((call) => call === 'start').length > 1) {
          throw new Error('restart failed before retry');
        }
      },
      async warmRoutes() {
        calls.push('warm');
      },
      async runPlaywrightShard(_session, shard, attempt) {
        calls.push(`playwright:${shard.id}:${attempt}`);
        return {
          exitCode: 1,
          listenerLost: false,
          transientFailure: true,
          stdout: `stdout ${shard.id} attempt ${attempt}`,
          stderr: `stderr ${shard.id} attempt ${attempt}`,
        };
      },
      async stopServer() {
        calls.push('stop');
      },
    };

    const result = await runMockLaneSession({
      driver,
      maxAttempts: 2,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      rootDir: tempRoot,
      runId: 'mock-session-transient-restart-test',
      runRoot: runRootFor(tempRoot, 'mock-session-transient-restart-test'),
      shards: ['smoke', 'chromium'],
    });

    expect(result.exitCode).toBe(1);
    expect(calls).toEqual(['start', 'warm', 'playwright:smoke:1', 'stop', 'start', 'stop']);

    const aggregate = readJson(path.join(result.sessionRoot, 'aggregate.json')) as {
      diagnostics: { cleanup_errors: Array<{ message: string }> };
      shards: Array<{ diagnostic_state: string; shard_id: string }>;
    };
    expect(aggregate.shards).toEqual([
      expect.objectContaining({ diagnostic_state: 'infra_failed', shard_id: 'smoke' }),
      expect.objectContaining({ diagnostic_state: 'not_run', shard_id: 'chromium' }),
    ]);
    expect(aggregate.diagnostics.cleanup_errors.some((entry) => entry.message.includes('restart failed'))).toBe(true);

    const shardResult = readJson(path.join(result.sessionRoot, 'shards', 'smoke', 'result.json')) as {
      attempts: Array<{ attempt: number; transient_failure: boolean }>;
      diagnostic_state: string;
    };
    expect(shardResult.diagnostic_state).toBe('infra_failed');
    expect(shardResult.attempts).toEqual([expect.objectContaining({ attempt: 1, transient_failure: true })]);
    expect(readFileSync(path.join(result.sessionRoot, 'shards', 'smoke', 'evidence', 'playwright.stdout.log'), 'utf8'))
      .toContain('smoke attempt 1');
    expectNoForbiddenDiagnosticFields(aggregate);
    expectNoForbiddenDiagnosticFields(shardResult);
  });

  it('retries startup after launch failure and clears corrupt Next artifacts before the retry', async () => {
    const tempRoot = createTempRoot('mock-lane-session-startup-retry-');
    const session = startMockLaneSession({
      rootDir: tempRoot,
      runId: 'mock-session-startup-retry',
      runRoot: runRootFor(tempRoot, 'mock-session-startup-retry'),
    });
    const nextDistFile = path.join(tempRoot, session.nextDistDir, 'stale.txt');
    mkdirSync(path.dirname(nextDistFile), { recursive: true });
    writeFileSync(nextDistFile, 'stale next artifact\n');

    let launchCount = 0;
    let stopCount = 0;
    await startServerWithRetry(session, {
      maxAttempts: 2,
      async launchOnce() {
        launchCount += 1;
        if (launchCount === 1) {
          writeFileSync(session.logFile, "Cannot find module './vendor-chunks/next.js'\n");
          throw new Error('first launch failed');
        }
      },
      async stopServer() {
        stopCount += 1;
      },
    });

    expect(launchCount).toBe(2);
    expect(stopCount).toBe(1);
    expect(existsSync(path.join(tempRoot, session.nextDistDir))).toBe(false);
    expect(session.cleanupErrors.some((entry) => entry.message.includes('first launch failed'))).toBe(true);
  });

  it('applies mock lane retention defaults and protects current or active run roots during pruning', async () => {
    setEnv('MOCK_LANE_SESSION_KEEP_SUCCESS', undefined);
    setEnv('MOCK_LANE_KEEP_SUCCESS', undefined);
    setEnv('MOCK_LANE_KEEP_FAILED', undefined);
    const successRoot = createTempGitRoot('mock-lane-session-retention-success-');
    const successDriver: MockLaneSessionDriver = {
      async startServer() {},
      async warmRoutes() {},
      async runPlaywrightShard() {
        return {
          exitCode: 0,
          listenerLost: false,
          transientFailure: false,
          stdout: '',
          stderr: '',
        };
      },
      async stopServer() {},
    };
    const success = await runMockLaneSession({
      driver: successDriver,
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      rootDir: successRoot,
      runId: 'mock-session-retention-success',
      runRoot: runRootFor(successRoot, 'mock-session-retention-success'),
      shards: ['smoke'],
    });
    expect(success.exitCode).toBe(0);
    expect(existsSync(success.sessionRoot)).toBe(true);
    expect(existsSync(path.join(success.sessionRoot, 'aggregate.json'))).toBe(true);
    expect(existsSync(path.join(success.sessionRoot, 'shards', 'smoke', 'result.json'))).toBe(true);
    expect(existsSync(path.join(success.sessionRoot, 'shards', 'smoke', 'evidence'))).toBe(true);

    const failedRoot = createTempGitRoot('mock-lane-session-retention-failed-');
    const failed = await runMockLaneSession({
      driver: {
        async startServer() {},
        async warmRoutes() {},
        async runPlaywrightShard() {
          return {
            exitCode: 7,
            listenerLost: false,
            transientFailure: false,
            stdout: '',
            stderr: '',
          };
        },
        async stopServer() {},
      },
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      rootDir: failedRoot,
      runId: 'mock-session-retention-failed',
      runRoot: runRootFor(failedRoot, 'mock-session-retention-failed'),
      shards: ['smoke'],
    });
    expect(failed.exitCode).toBe(7);
    expect(existsSync(failed.sessionRoot)).toBe(true);
    expect(readFileSync(path.join(failed.sessionRoot, '.status'), 'utf8').trim()).toBe('failed');

    const pruneRoot = createTempRoot('mock-lane-session-retention-prune-');
    const runsRoot = path.join(pruneRoot, 'artifacts', 'mock-lane', 'runs');
    const currentRun = path.join(runsRoot, 'current-run');
    const activeRun = path.join(runsRoot, 'active-run');
    const oldFailedRun = path.join(runsRoot, 'old-failed-run');
    const oldSuccessRun = path.join(runsRoot, 'old-success-run');
    for (const runRoot of [currentRun, activeRun, oldFailedRun]) {
      mkdirSync(runRoot, { recursive: true });
      writeFileSync(path.join(runRoot, '.status'), 'failed\n');
    }
    mkdirSync(oldSuccessRun, { recursive: true });
    writeFileSync(path.join(oldSuccessRun, '.status'), 'success\n');
    mkdirSync(path.join(pruneRoot, 'artifacts', 'mock-lane'), { recursive: true });
    symlinkSync(currentRun, path.join(pruneRoot, 'artifacts', 'mock-lane', 'current'), 'dir');
    writeFileSync(
      path.join(activeRun, '.lane-owner.env'),
      [`lane_name=mock-lane`, `owner_pid=${process.pid}`, `owner_label=test`, ''].join(os.EOL),
    );

    pruneMockLaneRuns(pruneRoot, 0, 24);

    expect(existsSync(currentRun)).toBe(true);
    expect(existsSync(activeRun)).toBe(true);
    expect(existsSync(oldFailedRun)).toBe(false);
    expect(existsSync(oldSuccessRun)).toBe(false);
    expect(existsSync(path.join(pruneRoot, 'artifacts', 'mock-lane', 'current'))).toBe(true);
  });

  it('deletes successful session roots only when session keep-success is explicitly disabled', async () => {
    setEnv('MOCK_LANE_SESSION_KEEP_SUCCESS', '0');
    setEnv('MOCK_LANE_KEEP_SUCCESS', '1');
    const tempRoot = createTempGitRoot('mock-lane-session-retention-delete-success-');

    const result = await runMockLaneSession({
      driver: {
        async startServer() {},
        async warmRoutes() {},
        async runPlaywrightShard() {
          return {
            exitCode: 0,
            listenerLost: false,
            transientFailure: false,
            stdout: '',
            stderr: '',
          };
        },
        async stopServer() {},
      },
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      rootDir: tempRoot,
      runId: 'mock-session-retention-delete-success',
      runRoot: runRootFor(tempRoot, 'mock-session-retention-delete-success'),
      shards: ['smoke'],
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(result.sessionRoot)).toBe(false);
    expect(existsSync(result.aggregatePath)).toBe(false);
  });

  it('ignores legacy keep-success for session retention when session keep-success is unset', async () => {
    setEnv('MOCK_LANE_SESSION_KEEP_SUCCESS', undefined);
    setEnv('MOCK_LANE_KEEP_SUCCESS', 'false');
    const tempRoot = createTempGitRoot('mock-lane-session-retention-legacy-keep-success-');

    const result = await runMockLaneSession({
      driver: {
        async startServer() {},
        async warmRoutes() {},
        async runPlaywrightShard() {
          return {
            exitCode: 0,
            listenerLost: false,
            transientFailure: false,
            stdout: '',
            stderr: '',
          };
        },
        async stopServer() {},
      },
      now: () => new Date('2026-04-29T12:00:00.000Z'),
      rootDir: tempRoot,
      runId: 'mock-session-retention-legacy-keep-success',
      runRoot: runRootFor(tempRoot, 'mock-session-retention-legacy-keep-success'),
      shards: ['smoke'],
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(result.sessionRoot)).toBe(true);
    expect(existsSync(result.aggregatePath)).toBe(true);
  });
});
