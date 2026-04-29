import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, Socket, type Server } from 'node:net';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  rmSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export type MockLaneSessionPreset = 'default' | 'with-visual';
export type MockLaneShardIsolationLevel = 'process' | 'serialized';
export type MockLaneShardId = 'smoke' | 'chromium' | 'chromium-serial' | 'visual';
export type MockLaneShardDiagnosticState = 'succeeded' | 'failed' | 'infra_failed' | 'not_run';

export interface MockLaneSessionShard {
  id: MockLaneShardId;
  kind: 'mock';
  currentNpmScripts: readonly string[];
  currentGateId: 'lane-mock';
  project: string;
  spec: string | null;
  grep: string | null;
  playwrightArgs: readonly string[];
  isolationLevel: MockLaneShardIsolationLevel;
  mutableResources: readonly string[];
  evidenceOwner: string;
}

export interface MockLaneSession {
  kind: 'mock';
  sessionId: string;
  sessionRoot: string;
  runRoot: string;
  rootDir: string;
  port: number;
  portFamily: string;
  baseUrl: string;
  healthUrl: string;
  shardIds: MockLaneShardId[];
  pidFile: string;
  nextPidFile: string;
  logFile: string;
  nextDevExitMarkerFile: string;
  nextDistDir: string;
  workspaceProvisioningPath: string;
  workspaceRegistryFile: string;
  visualBuildInfoFile: string;
  visualBaselineBuildInfoFile: string;
  visualBaselineBuildFingerprint: string;
  secretProfileDigest: string;
  startedAt: string;
  startupCount: number;
  routeWarmCount: number;
  cleanupErrors: Array<{ message: string }>;
}

export interface MockLanePlaywrightResult {
  exitCode: number;
  listenerLost: boolean;
  transientFailure: boolean;
  stdout: string;
  stderr: string;
}

export interface MockLaneSessionDriver {
  startServer(session: MockLaneSession): Promise<void>;
  warmRoutes(session: MockLaneSession): Promise<void>;
  runPlaywrightShard(
    session: MockLaneSession,
    shard: MockLaneSessionShard,
    attempt: number,
  ): Promise<MockLanePlaywrightResult>;
  stopServer(session: MockLaneSession): Promise<void>;
}

export interface RunMockLaneSessionOptions {
  driver?: MockLaneSessionDriver;
  maxAttempts?: number;
  now?: () => Date;
  port?: number;
  portFamily?: string;
  preset?: MockLaneSessionPreset;
  rootDir?: string;
  runId?: string;
  runRoot?: string;
  shards?: readonly MockLaneShardId[];
  signal?: AbortSignal;
}

export interface RunMockLaneSessionResult {
  exitCode: number;
  sessionRoot: string;
  aggregatePath: string;
}

export interface StartMockLaneSessionResult {
  exitCode: number;
  sessionRoot: string;
  metadataPath: string;
}

export interface RunPersistedMockLaneSessionShardResult {
  exitCode: number;
  sessionRoot: string;
  shardResultPath: string;
}

interface MockLaneShardAttemptRecord {
  attempt: number;
  diagnostic_state: Exclude<MockLaneShardDiagnosticState, 'not_run'>;
  exit_code: number;
  listener_lost: boolean;
  transient_failure: boolean;
  stdout_log: string;
  stderr_log: string;
}

interface MockLaneShardExecution {
  shard: MockLaneSessionShard;
  diagnosticState: Exclude<MockLaneShardDiagnosticState, 'not_run'>;
  exitCode: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number | null;
  attempts: MockLaneShardAttemptRecord[];
}

export class MockLaneSessionAbortError extends Error {
  readonly exitCode: number;

  constructor(reason: string, exitCode = 130) {
    super(`mock lane session aborted: ${reason}`);
    this.name = 'MockLaneSessionAbortError';
    this.exitCode = exitCode;
  }
}

export interface MockLaneServerRetryOptions {
  launchOnce: (attempt: number, maxAttempts: number) => Promise<void>;
  maxAttempts: number;
  stopServer: () => Promise<void>;
}

let activeMockLaneSession: MockLaneSession | null = null;

const DEFAULT_WARM_URLS = [
  '/zh-CN/login',
  '/en-US/login',
  '/en-US/login/workspace',
  '/en-US/workspaces/overview',
  '/en-US/workspaces/ws_default',
  '/en-US/workspaces/ws_default/settings',
  '/en-US/user/profile',
  '/en-US/workspaces/ws_default/projects/proj_001/files',
] as const;

const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'no_proxy',
  'NO_PROXY',
] as const;

export const MOCK_LANE_SESSION_SHARDS = [
  {
    id: 'smoke',
    kind: 'mock',
    currentNpmScripts: [
      'test:e2e',
      'test:e2e:all',
      'test:e2e:lane:mock:smoke',
      'test:e2e:lane:mock:full:with-visual',
    ],
    currentGateId: 'lane-mock',
    project: 'smoke',
    spec: null,
    grep: null,
    playwrightArgs: ['--project=smoke', '--workers=1'],
    isolationLevel: 'process',
    mutableResources: ['mock Next server', 'MSW browser state'],
    evidenceOwner: 'mock-lane-session:shards/smoke',
  },
  {
    id: 'chromium',
    kind: 'mock',
    currentNpmScripts: [
      'test:e2e',
      'test:e2e:all',
      'test:e2e:lane:mock:chromium',
      'test:e2e:lane:mock:full:with-visual',
    ],
    currentGateId: 'lane-mock',
    project: 'chromium',
    spec: null,
    grep: null,
    playwrightArgs: ['--project=chromium', '--workers=4'],
    isolationLevel: 'process',
    mutableResources: ['mock Next server', 'MSW browser state', 'system workspace mock files'],
    evidenceOwner: 'mock-lane-session:shards/chromium',
  },
  {
    id: 'chromium-serial',
    kind: 'mock',
    currentNpmScripts: [
      'test:e2e',
      'test:e2e:all',
      'test:e2e:lane:mock:chromium',
      'test:e2e:lane:mock:full:with-visual',
    ],
    currentGateId: 'lane-mock',
    project: 'chromium-serial',
    spec: null,
    grep: null,
    playwrightArgs: ['--project=chromium-serial', '--workers=1'],
    isolationLevel: 'serialized',
    mutableResources: ['mock Next server', 'system workspace mock files'],
    evidenceOwner: 'mock-lane-session:shards/chromium-serial',
  },
  {
    id: 'visual',
    kind: 'mock',
    currentNpmScripts: [
      'test:e2e:all',
      'test:e2e:lane:mock:visual',
      'test:e2e:lane:mock:full:with-visual',
      'test:visual',
    ],
    currentGateId: 'lane-mock',
    project: 'visual',
    spec: 'e2e/visual.spec.ts',
    grep: null,
    playwrightArgs: ['e2e/visual.spec.ts', '--project=visual', '--workers=1'],
    isolationLevel: 'serialized',
    mutableResources: ['mock Next server', 'visual baseline build metadata'],
    evidenceOwner: 'mock-lane-session:shards/visual',
  },
] as const satisfies readonly MockLaneSessionShard[];

export function buildMockLaneSessionShardPlan(preset: MockLaneSessionPreset): readonly MockLaneSessionShard[] {
  if (preset === 'with-visual') {
    return MOCK_LANE_SESSION_SHARDS;
  }
  return MOCK_LANE_SESSION_SHARDS.filter((shard) => shard.id !== 'visual');
}

function resolveMockLaneSessionShardPlan(
  options: Pick<RunMockLaneSessionOptions, 'preset' | 'shards'>,
): readonly MockLaneSessionShard[] {
  return options.shards
    ? options.shards.map((shardId) => requireShard(shardId))
    : buildMockLaneSessionShardPlan(options.preset ?? 'default');
}

export async function runMockLaneSession(
  options: RunMockLaneSessionOptions = {},
): Promise<RunMockLaneSessionResult> {
  const now = options.now ?? (() => new Date());
  const driver = options.driver ?? new DefaultMockLaneSessionDriver();
  const plan = resolveMockLaneSessionShardPlan(options);
  const session = startMockLaneSession(options, now);
  const executions: MockLaneShardExecution[] = [];
  let finalExitCode = 0;
  let startupFailed = false;
  let abortReason: string | null = null;

  try {
    throwIfAborted(options.signal);
    await withAbort(driver.startServer(session), options.signal);
    session.startupCount += 1;
    throwIfAborted(options.signal);
    await withAbort(driver.warmRoutes(session), options.signal);
    session.routeWarmCount += 1;
    throwIfAborted(options.signal);
    writeVisualBuildInfo(session, now);

    for (const shard of plan) {
      throwIfAborted(options.signal);
      const execution = await runMockLaneSessionShard({
        driver,
        maxAttempts: options.maxAttempts ?? parsePositiveInteger(process.env.MOCK_LANE_MAX_ATTEMPTS, 3),
        now,
        session,
        shard,
        signal: options.signal,
      });
      executions.push(execution);

      if (execution.exitCode !== 0) {
        finalExitCode = execution.exitCode;
        break;
      }
    }
  } catch (error) {
    startupFailed = executions.length === 0;
    if (isAbortError(error)) {
      finalExitCode = error.exitCode;
      abortReason = error.message;
    } else {
      finalExitCode = 1;
      session.cleanupErrors.push({ message: errorMessage(error) });
    }
  }

  return finishMockLaneSession({
    abortReason,
    driver,
    executions,
    finalExitCode,
    now,
    plan,
    session,
    startupFailed,
  });
}

export function startMockLaneSession(
  options: RunMockLaneSessionOptions,
  now: () => Date = () => new Date(),
): MockLaneSession {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const runId = options.runId ?? generateRunId('mock-session');
  const runRoot = path.resolve(options.runRoot ?? path.join(rootDir, 'artifacts', 'mock-lane', 'runs', runId));
  const port = options.port ?? parsePositiveInteger(process.env.PORT_WEB, 3001);
  const baseUrl = `http://127.0.0.1:${port}`;

  mkdirSync(runRoot, { recursive: true });
  prepareCurrentLink(rootDir, runRoot);
  writeStatus(runRoot, 'incomplete');

  const session: MockLaneSession = {
    kind: 'mock',
    sessionId: runId,
    sessionRoot: runRoot,
    runRoot,
    rootDir,
    port,
    portFamily: options.portFamily ?? process.env.MOCK_LANE_PORT_FAMILY ?? `mock:${port}`,
    baseUrl,
    healthUrl: `${baseUrl}/zh-CN/login`,
    shardIds: resolveMockLaneSessionShardPlan(options).map((shard) => shard.id),
    pidFile: path.join(runRoot, 'web.pid'),
    nextPidFile: path.join(runRoot, 'next-dev.pid'),
    logFile: path.join(runRoot, 'web.log'),
    nextDevExitMarkerFile: path.join(runRoot, 'next-dev-exit.json'),
    nextDistDir: process.env.MOCK_NEXT_DIST_DIR ?? `artifacts/mock-lane/runs/${runId}/next-dist`,
    workspaceProvisioningPath:
      process.env.MOCK_WORKSPACE_PROVISIONING_PATH
      ?? `artifacts/mock-lane/runs/${runId}/system-workspace-provisioning.mock`,
    workspaceRegistryFile:
      process.env.MOCK_WORKSPACE_REGISTRY_FILE
      ?? `artifacts/mock-lane/runs/${runId}/system-workspaces.json`,
    visualBuildInfoFile: path.join(runRoot, 'visual-build-info.json'),
    visualBaselineBuildInfoFile: process.env.VISUAL_BASELINE_BUILD_INFO_FILE ?? path.join(runRoot, 'visual-build-info.json'),
    visualBaselineBuildFingerprint: process.env.VISUAL_BASELINE_BUILD_FINGERPRINT ?? '',
    secretProfileDigest: digestSecretProfile(),
    startedAt: now().toISOString(),
    startupCount: 0,
    routeWarmCount: 0,
    cleanupErrors: [],
  };

  writeLaneOwner(session, process.pid, 'session-runner.ts');
  writeSessionMetadata(session, null);
  activeMockLaneSession = session;

  return session;
}

export async function runMockLaneSessionShard(options: {
  driver: MockLaneSessionDriver;
  maxAttempts: number;
  now: () => Date;
  session: MockLaneSession;
  shard: MockLaneSessionShard;
  signal?: AbortSignal;
}): Promise<MockLaneShardExecution> {
  const { driver, maxAttempts, now, session, shard, signal } = options;
  const shardRoot = path.join(session.sessionRoot, 'shards', shard.id);
  const evidenceRoot = path.join(shardRoot, 'evidence');
  const attempts: MockLaneShardAttemptRecord[] = [];
  const startedAt = now().toISOString();
  let attempt = 1;
  let result: MockLanePlaywrightResult | null = null;

  mkdirSync(evidenceRoot, { recursive: true });

  while (attempt <= maxAttempts) {
    throwIfAborted(signal);
    result = await withAbort(driver.runPlaywrightShard(session, shard, attempt), signal);
    const diagnosticState = result.exitCode === 0 ? 'succeeded' : result.listenerLost ? 'infra_failed' : 'failed';
    const stdoutLog = path.join('evidence', `playwright.attempt-${attempt}.stdout.log`);
    const stderrLog = path.join('evidence', `playwright.attempt-${attempt}.stderr.log`);

    writeFileSync(path.join(shardRoot, stdoutLog), redactLog(result.stdout));
    writeFileSync(path.join(shardRoot, stderrLog), redactLog(result.stderr));
    attempts.push({
      attempt,
      diagnostic_state: diagnosticState,
      exit_code: result.exitCode,
      listener_lost: result.listenerLost,
      transient_failure: result.transientFailure,
      stdout_log: stdoutLog,
      stderr_log: stderrLog,
    });

    if (result.exitCode === 0 || (!result.listenerLost && !result.transientFailure)) {
      break;
    }

    if (attempt >= maxAttempts) {
      break;
    }

    await withAbort(driver.stopServer(session), signal).catch((error: unknown) => {
      session.cleanupErrors.push({ message: errorMessage(error) });
    });
    try {
      throwIfAborted(signal);
      await withAbort(driver.startServer(session), signal);
      session.startupCount += 1;
      throwIfAborted(signal);
      await withAbort(driver.warmRoutes(session), signal);
      session.routeWarmCount += 1;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      session.cleanupErrors.push({ message: errorMessage(error) });
      const execution = buildShardExecution({
        attempts,
        diagnosticState: 'infra_failed',
        exitCode: 1,
        finishedAt: now().toISOString(),
        shard,
        startedAt,
      });
      writeShardResult(session, execution);
      copyLatestAttemptLogs(session, execution);
      return execution;
    }
    attempt += 1;
  }

  const finishedAt = now().toISOString();
  const exitCode = result?.exitCode ?? 1;
  const diagnosticState: Exclude<MockLaneShardDiagnosticState, 'not_run'> = exitCode === 0
    ? 'succeeded'
    : result?.listenerLost
      ? 'infra_failed'
      : 'failed';
  const execution = buildShardExecution({
    attempts,
    diagnosticState,
    exitCode,
    finishedAt,
    shard,
    startedAt,
  });

  writeShardResult(session, execution);
  copyLatestAttemptLogs(session, execution);

  return execution;
}

function buildShardExecution(options: {
  attempts: MockLaneShardAttemptRecord[];
  diagnosticState: Exclude<MockLaneShardDiagnosticState, 'not_run'>;
  exitCode: number;
  finishedAt: string;
  shard: MockLaneSessionShard;
  startedAt: string;
}): MockLaneShardExecution {
  const { attempts, diagnosticState, exitCode, finishedAt, shard, startedAt } = options;
  return {
    attempts,
    diagnosticState,
    durationMs: dateDurationMs(startedAt, finishedAt),
    exitCode,
    finishedAt,
    shard,
    startedAt,
  };
}

export async function finishMockLaneSession(options: {
  abortReason: string | null;
  driver: MockLaneSessionDriver;
  executions: readonly MockLaneShardExecution[];
  finalExitCode: number;
  now: () => Date;
  plan: readonly MockLaneSessionShard[];
  session: MockLaneSession;
  startupFailed: boolean;
}): Promise<RunMockLaneSessionResult> {
  const { abortReason, driver, executions, finalExitCode, now, plan, session, startupFailed } = options;
  let exitCode = finalExitCode;

  try {
    await driver.stopServer(session);
  } catch (error) {
    session.cleanupErrors.push({ message: errorMessage(error) });
    if (exitCode === 0) {
      exitCode = 1;
    }
  }

  const finishedAt = now().toISOString();
  writeAggregate({
    executions,
    finishedAt,
    finalExitCode: exitCode,
    plan,
    session,
    startupFailed,
    abortReason,
  });
  writeSessionMetadata(session, finishedAt);
  writeStatus(session.runRoot, exitCode === 0 ? 'success' : 'failed');
  clearLaneOwner(session);
  removeCurrentLinkIfMatches(session.rootDir, session.runRoot);
  applyRunRetention(session, exitCode);
  if (activeMockLaneSession?.runRoot === session.runRoot) {
    activeMockLaneSession = null;
  }

  return {
    aggregatePath: path.join(session.sessionRoot, 'aggregate.json'),
    exitCode,
    sessionRoot: session.sessionRoot,
  };
}

export async function startPersistedMockLaneSession(
  options: RunMockLaneSessionOptions = {},
): Promise<StartMockLaneSessionResult> {
  const now = options.now ?? (() => new Date());
  const driver = options.driver ?? new DefaultMockLaneSessionDriver();
  const session = startMockLaneSession(options, now);

  try {
    throwIfAborted(options.signal);
    await withAbort(driver.startServer(session), options.signal);
    session.startupCount += 1;
    throwIfAborted(options.signal);
    await withAbort(driver.warmRoutes(session), options.signal);
    session.routeWarmCount += 1;
    throwIfAborted(options.signal);
    writeVisualBuildInfo(session, now);
    writeSessionMetadata(session, null);
    activeMockLaneSession = null;
    return {
      exitCode: 0,
      metadataPath: path.join(session.sessionRoot, 'session.json'),
      sessionRoot: session.sessionRoot,
    };
  } catch (error) {
    session.cleanupErrors.push({ message: errorMessage(error) });
    try {
      await driver.stopServer(session);
    } catch (cleanupError) {
      session.cleanupErrors.push({ message: errorMessage(cleanupError) });
    }
    writeSessionMetadata(session, now().toISOString());
    writeStatus(session.runRoot, 'failed');
    clearLaneOwner(session);
    removeCurrentLinkIfMatches(session.rootDir, session.runRoot);
    activeMockLaneSession = null;
    throw error;
  }
}

export async function runPersistedMockLaneSessionShard(options: {
  driver?: MockLaneSessionDriver;
  maxAttempts?: number;
  now?: () => Date;
  sessionRoot: string;
  shardId: MockLaneShardId;
  signal?: AbortSignal;
}): Promise<RunPersistedMockLaneSessionShardResult> {
  const now = options.now ?? (() => new Date());
  const driver = options.driver ?? new DefaultMockLaneSessionDriver();
  const session = readMockLaneSessionMetadata(options.sessionRoot);

  if (!session.shardIds.includes(options.shardId)) {
    throw new Error(`mock lane shard ${options.shardId} is not part of session ${session.sessionId}`);
  }

  const shard = requireShard(options.shardId);
  const execution = await runMockLaneSessionShard({
    driver,
    maxAttempts: options.maxAttempts ?? parsePositiveInteger(process.env.MOCK_LANE_MAX_ATTEMPTS, 3),
    now,
    session,
    shard,
    signal: options.signal,
  });

  writeSessionMetadata(session, null);

  return {
    exitCode: execution.exitCode,
    sessionRoot: session.sessionRoot,
    shardResultPath: path.join(session.sessionRoot, 'shards', shard.id, 'result.json'),
  };
}

export async function finishPersistedMockLaneSession(options: {
  driver?: MockLaneSessionDriver;
  now?: () => Date;
  sessionRoot: string;
}): Promise<RunMockLaneSessionResult> {
  const now = options.now ?? (() => new Date());
  const driver = options.driver ?? new DefaultMockLaneSessionDriver();
  const session = readMockLaneSessionMetadata(options.sessionRoot);
  const plan = session.shardIds.map((shardId) => requireShard(shardId));
  const executions = readPersistedShardExecutions(session, plan);
  const firstFailedExecution = executions.find((execution) => execution.exitCode !== 0);
  const hasMissingShardResult = executions.length < plan.length;
  const finalExitCode = firstFailedExecution?.exitCode ?? (hasMissingShardResult ? 1 : 0);

  return finishMockLaneSession({
    abortReason: null,
    driver,
    executions,
    finalExitCode,
    now,
    plan,
    session,
    startupFailed: false,
  });
}

export class DefaultMockLaneSessionDriver implements MockLaneSessionDriver {
  private webProcess: ChildProcess | null = null;
  private playwrightProcess: ChildProcess | null = null;

  async startServer(session: MockLaneSession): Promise<void> {
    await runNextGeneratedRootNormalize(session.rootDir);
    await startServerWithRetry(session, {
      launchOnce: (attempt, maxAttempts) => this.startServerOnceReady(session, attempt, maxAttempts),
      maxAttempts: parsePositiveInteger(process.env.MOCK_LANE_MAX_ATTEMPTS, 3),
      stopServer: () => this.stopServer(session),
    });
  }

  async warmRoutes(session: MockLaneSession): Promise<void> {
    const warmRoutes = parseWarmRoutes(process.env.MOCK_LANE_WARM_URLS);
    for (const route of warmRoutes) {
      await warmRoute(session, route, parsePositiveInteger(process.env.MOCK_LANE_WARM_ROUTE_ATTEMPTS, 15));
    }
    await waitForStableHealth(session, 2, 20);
  }

  async runPlaywrightShard(
    session: MockLaneSession,
    shard: MockLaneSessionShard,
    _attempt: number,
  ): Promise<MockLanePlaywrightResult> {
    const result = await spawnPlaywright(session, shard, this);
    if (shard.id === 'visual' && result.exitCode === 0) {
      const reviewResult = spawnSync('npx', ['tsx', 'scripts/governance/write-visual-baseline-reviews.ts'], {
        cwd: session.rootDir,
        encoding: 'utf8',
        env: cleanProcessEnv({
          ...process.env,
          VISUAL_BASELINE_BUILD_FINGERPRINT: session.visualBaselineBuildFingerprint,
          VISUAL_BASELINE_BUILD_INFO_FILE: session.visualBaselineBuildInfoFile,
        }),
      });

      if ((reviewResult.status ?? 1) !== 0) {
        return {
          exitCode: reviewResult.status ?? 1,
          listenerLost: false,
          transientFailure: false,
          stdout: `${result.stdout}${reviewResult.stdout ?? ''}`,
          stderr: `${result.stderr}${reviewResult.stderr ?? ''}`,
        };
      }
    }

    return result;
  }

  async stopServer(session: MockLaneSession): Promise<void> {
    const pids = [
      this.playwrightProcess?.pid,
      readPidFile(session.nextPidFile),
      this.webProcess?.pid ?? readPidFile(session.pidFile),
    ].filter((pid): pid is number => typeof pid === 'number' && Number.isFinite(pid) && pid > 0);

    for (const pid of pids) {
      await stopProcessGroup(pid);
    }

    rmSync(path.join(session.rootDir, session.workspaceProvisioningPath), { recursive: true, force: true });
    rmSync(session.pidFile, { force: true });
    rmSync(session.nextPidFile, { force: true });
    await runNextGeneratedRootFinalize(session.rootDir);
    this.playwrightProcess = null;
    this.webProcess = null;
  }

  setPlaywrightProcess(child: ChildProcess | null): void {
    this.playwrightProcess = child;
  }

  private async startServerOnceReady(
    session: MockLaneSession,
    launchAttempt: number,
    maxLaunchAttempts: number,
  ): Promise<void> {
    let selectedPort = session.port;
    if (!(await isPortBindable(selectedPort))) {
      selectedPort = await pickFreePort(selectedPort);
      rebindSessionPort(session, selectedPort);
    }

    mkdirSync(path.dirname(session.logFile), { recursive: true });
    rmSync(path.join(session.rootDir, session.workspaceProvisioningPath), { recursive: true, force: true });
    rmSync(session.nextDevExitMarkerFile, { force: true });
    rmSync(path.join(session.rootDir, session.nextDistDir), { recursive: true, force: true });
    writeFileSync(
      session.logFile,
      [
        `[mock-lane-session] ===== launch attempt ${launchAttempt}/${maxLaunchAttempts} `,
        `on :${session.port} at ${new Date().toISOString()} =====${os.EOL}`,
      ].join(''),
      { flag: 'a' },
    );

    const logFd = openSync(session.logFile, 'a');
    const child = spawn('bash', ['scripts/run-next-dev-safe.sh', '--port', String(session.port)], {
      cwd: session.rootDir,
      detached: true,
      env: cleanProcessEnv({
        ...process.env,
        AGENTSMITH_ENABLE_TEST_ROUTES: 'true',
        MONGO_DB_NAME: process.env.MONGO_DB_NAME ?? 'mbos',
        MONGO_URL: process.env.MONGO_URL ?? 'mongodb://mbos:mbos_dev_password@localhost:17017/admin',
        NEXT_DEV_EXIT_MARKER_FILE: session.nextDevExitMarkerFile,
        NEXT_DEV_PID_FILE: session.nextPidFile,
        NEXT_DIST_DIR: session.nextDistDir,
        NEXT_GENERATED_ROOT_ALLOWED_ACTIVE_RUN_ROOT: session.runRoot,
        NEXT_GENERATED_ROOT_MANAGED: '1',
        NEXT_MAX_OLD_SPACE_SIZE: process.env.NEXT_MAX_OLD_SPACE_SIZE ?? '6144',
        NEXT_PUBLIC_MSW_STRICT_READY: 'true',
        NEXT_PUBLIC_USE_MSW: 'true',
        SYSTEM_WORKSPACE_PROVISIONING_PATH: session.workspaceProvisioningPath,
        SYSTEM_WORKSPACE_REGISTRY_FILE: session.workspaceRegistryFile,
        SYSTEM_WORKSPACE_REGISTRY_MODE: 'file',
      }),
      stdio: ['ignore', logFd, logFd],
    });
    closeSync(logFd);
    this.webProcess = child;
    child.unref();
    writeFileSync(session.pidFile, `${child.pid ?? ''}${os.EOL}`);

    if (!(await waitHttpOk(session, 120))) {
      await this.stopServer(session);
      throw new Error(`web server is not ready at ${session.healthUrl}`);
    }
  }
}

export async function startServerWithRetry(
  session: MockLaneSession,
  options: MockLaneServerRetryOptions,
): Promise<void> {
  const maxAttempts = options.maxAttempts > 0 ? options.maxAttempts : 3;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await options.launchOnce(attempt, maxAttempts);
      return;
    } catch (error) {
      lastError = error;
      session.cleanupErrors.push({
        message: `web launch attempt ${attempt}/${maxAttempts} failed: ${errorMessage(error)}`,
      });

      if (attempt >= maxAttempts) {
        break;
      }

      try {
        await options.stopServer();
      } catch (stopError) {
        session.cleanupErrors.push({
          message: `web launch cleanup after attempt ${attempt} failed: ${errorMessage(stopError)}`,
        });
      }
      resetNextDevArtifactsIfCorrupt(session);
    }
  }

  throw new Error(`web server is not ready at ${session.healthUrl}: ${errorMessage(lastError)}`);
}

async function spawnPlaywright(
  session: MockLaneSession,
  shard: MockLaneSessionShard,
  driver: DefaultMockLaneSessionDriver,
): Promise<MockLanePlaywrightResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let listenerLost = false;
    const child = spawn('npx', ['playwright', 'test', ...shard.playwrightArgs], {
      cwd: session.rootDir,
      env: cleanProcessEnv({
        ...process.env,
        BASE_URL: session.baseUrl,
        NEXT_PUBLIC_MSW_STRICT_READY: 'true',
        NEXT_PUBLIC_USE_MSW: 'true',
        PW_EXCLUDE_LANE_REAL: 'true',
        VISUAL_BASELINE_BUILD_FINGERPRINT: session.visualBaselineBuildFingerprint,
        VISUAL_BASELINE_BUILD_INFO_FILE: session.visualBaselineBuildInfoFile,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    driver.setPlaywrightProcess(child);
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      process.stderr.write(text);
    });

    const watchdog = setInterval(() => {
      void isPortListening(session.port).then((listening) => {
        if (!listening && child.exitCode === null) {
          listenerLost = true;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }, 2_000).unref();
        }
      });
    }, 2_000);

    child.on('close', (code) => {
      clearInterval(watchdog);
      driver.setPlaywrightProcess(null);
      const exitCode = code ?? 1;
      resolve({
        exitCode,
        listenerLost,
        transientFailure: listenerLost || isTransientPlaywrightFailure(`${stdout}${stderr}`),
        stdout,
        stderr,
      });
    });

    child.on('error', (error) => {
      clearInterval(watchdog);
      driver.setPlaywrightProcess(null);
      resolve({
        exitCode: 1,
        listenerLost,
        transientFailure: false,
        stdout,
        stderr: `${stderr}${errorMessage(error)}${os.EOL}`,
      });
    });
  });
}

function requireShard(shardId: MockLaneShardId): MockLaneSessionShard {
  const shard = MOCK_LANE_SESSION_SHARDS.find((candidate) => candidate.id === shardId);
  if (!shard) {
    throw new Error(`unknown mock lane shard: ${shardId}`);
  }
  return shard;
}

function writeShardResult(session: MockLaneSession, execution: MockLaneShardExecution): void {
  const shardRoot = path.join(session.sessionRoot, 'shards', execution.shard.id);
  const payload = {
    schema_version: 1,
    diagnostic_only: true,
    session_id: session.sessionId,
    shard_id: execution.shard.id,
    kind: execution.shard.kind,
    current_gate_id: execution.shard.currentGateId,
    current_npm_scripts: execution.shard.currentNpmScripts,
    project: execution.shard.project,
    spec: execution.shard.spec,
    grep: execution.shard.grep,
    isolation_level: execution.shard.isolationLevel,
    mutable_resources: execution.shard.mutableResources,
    evidence_owner: execution.shard.evidenceOwner,
    command: {
      binary: 'npx',
      args: ['playwright', 'test', ...execution.shard.playwrightArgs],
    },
    diagnostic_state: execution.diagnosticState,
    exit_code: execution.exitCode,
    started_at: execution.startedAt,
    finished_at: execution.finishedAt,
    duration_ms: execution.durationMs,
    attempts: execution.attempts,
    evidence: {
      directory: 'evidence',
      stdout_log: 'evidence/playwright.stdout.log',
      stderr_log: 'evidence/playwright.stderr.log',
    },
  };

  mkdirSync(shardRoot, { recursive: true });
  writeJson(path.join(shardRoot, 'result.json'), payload);
}

function copyLatestAttemptLogs(session: MockLaneSession, execution: MockLaneShardExecution): void {
  const latestAttempt = execution.attempts.at(-1);
  if (!latestAttempt) {
    return;
  }
  const shardRoot = path.join(session.sessionRoot, 'shards', execution.shard.id);
  writeFileSync(
    path.join(shardRoot, 'evidence', 'playwright.stdout.log'),
    readFileSync(path.join(shardRoot, latestAttempt.stdout_log), 'utf8'),
  );
  writeFileSync(
    path.join(shardRoot, 'evidence', 'playwright.stderr.log'),
    readFileSync(path.join(shardRoot, latestAttempt.stderr_log), 'utf8'),
  );
}

function writeAggregate(options: {
  abortReason: string | null;
  executions: readonly MockLaneShardExecution[];
  finalExitCode: number;
  finishedAt: string;
  plan: readonly MockLaneSessionShard[];
  session: MockLaneSession;
  startupFailed: boolean;
}): void {
  const { abortReason, executions, finalExitCode, finishedAt, plan, session, startupFailed } = options;
  const executionByShard = new Map(executions.map((execution) => [execution.shard.id, execution]));
  const shards = plan.map((shard) => {
    const execution = executionByShard.get(shard.id);
    if (!execution) {
      return {
        shard_id: shard.id,
        project: shard.project,
        spec: shard.spec,
        diagnostic_state: startupFailed ? 'infra_failed' : 'not_run',
        exit_code: null,
        result_path: path.join('shards', shard.id, 'result.json'),
        evidence_dir: path.join('shards', shard.id, 'evidence'),
      };
    }
    return {
      shard_id: shard.id,
      project: shard.project,
      spec: shard.spec,
      diagnostic_state: execution.diagnosticState,
      exit_code: execution.exitCode,
      result_path: path.join('shards', shard.id, 'result.json'),
      evidence_dir: path.join('shards', shard.id, 'evidence'),
    };
  });
  const commandExitCodes = shards
    .map((shard) => shard.exit_code)
    .filter((exitCode): exitCode is number => typeof exitCode === 'number');

  writeJson(path.join(session.sessionRoot, 'aggregate.json'), {
    schema_version: 1,
    diagnostic_only: true,
    kind: session.kind,
    session_id: session.sessionId,
    session_root: session.sessionRoot,
    run_root: session.runRoot,
    port_family: session.portFamily,
    base_url: session.baseUrl,
    started_at: session.startedAt,
    finished_at: finishedAt,
    fixed_cost: {
      startup_count: session.startupCount,
      route_warm_count: session.routeWarmCount,
    },
    shard_order: plan.map((shard) => shard.id),
    shards,
    counts: {
      total: plan.length,
      exit_code_zero: commandExitCodes.filter((exitCode) => exitCode === 0).length,
      nonzero_exit_code: commandExitCodes.filter((exitCode) => exitCode !== 0).length,
      not_run: shards.filter((shard) => shard.diagnostic_state === 'not_run').length,
      infra_failed: shards.filter((shard) => shard.diagnostic_state === 'infra_failed').length,
    },
    diagnostics: {
      aborted: abortReason !== null,
      abort_reason: abortReason,
      cleanup_errors: session.cleanupErrors,
    },
    final_exit_code: finalExitCode,
  });
}

function writeSessionMetadata(session: MockLaneSession, finishedAt: string | null): void {
  writeJson(path.join(session.sessionRoot, 'session.json'), {
    schema_version: 1,
    diagnostic_only: true,
    kind: session.kind,
    session_id: session.sessionId,
    session_root: session.sessionRoot,
    run_root: session.runRoot,
    root_dir: session.rootDir,
    port: session.port,
    pid_file: session.pidFile,
    next_pid_file: session.nextPidFile,
    log_file: session.logFile,
    next_dev_exit_marker_file: session.nextDevExitMarkerFile,
    port_family: session.portFamily,
    secret_profile_digest: session.secretProfileDigest,
    started_at: session.startedAt,
    finished_at: finishedAt,
    base_url: session.baseUrl,
    health_url: session.healthUrl,
    next_dist_dir: session.nextDistDir,
    workspace_provisioning_path: session.workspaceProvisioningPath,
    workspace_registry_file: session.workspaceRegistryFile,
    visual_build_info_file: session.visualBuildInfoFile,
    visual_baseline_build_info_file: session.visualBaselineBuildInfoFile,
    visual_baseline_build_fingerprint: session.visualBaselineBuildFingerprint,
    startup_count: session.startupCount,
    route_warm_count: session.routeWarmCount,
    cleanup_errors: session.cleanupErrors,
    shard_ids: session.shardIds,
    shard_order: session.shardIds,
  });
}

function readMockLaneSessionMetadata(sessionRoot: string): MockLaneSession {
  const metadataPath = path.join(path.resolve(sessionRoot), 'session.json');
  const metadata = readJsonObject(metadataPath);
  const resolvedSessionRoot = readOptionalString(metadata, 'session_root') ?? path.resolve(sessionRoot);
  const baseUrl = readRequiredString(metadata, 'base_url', metadataPath);
  const port = readOptionalNumber(metadata, 'port') ?? portFromBaseUrl(baseUrl, metadataPath);

  return {
    kind: 'mock',
    sessionId: readRequiredString(metadata, 'session_id', metadataPath),
    sessionRoot: resolvedSessionRoot,
    runRoot: readOptionalString(metadata, 'run_root') ?? resolvedSessionRoot,
    rootDir: readRequiredString(metadata, 'root_dir', metadataPath),
    port,
    portFamily: readRequiredString(metadata, 'port_family', metadataPath),
    baseUrl,
    healthUrl: readOptionalString(metadata, 'health_url') ?? `${baseUrl}/zh-CN/login`,
    shardIds: readShardIds(metadata.shard_ids ?? metadata.shard_order),
    pidFile: readOptionalString(metadata, 'pid_file') ?? path.join(resolvedSessionRoot, 'web.pid'),
    nextPidFile: readOptionalString(metadata, 'next_pid_file') ?? path.join(resolvedSessionRoot, 'next-dev.pid'),
    logFile: readOptionalString(metadata, 'log_file') ?? path.join(resolvedSessionRoot, 'web.log'),
    nextDevExitMarkerFile:
      readOptionalString(metadata, 'next_dev_exit_marker_file') ?? path.join(resolvedSessionRoot, 'next-dev-exit.json'),
    nextDistDir: readRequiredString(metadata, 'next_dist_dir', metadataPath),
    workspaceProvisioningPath:
      readOptionalString(metadata, 'workspace_provisioning_path')
      ?? `artifacts/mock-lane/runs/${readRequiredString(metadata, 'session_id', metadataPath)}/system-workspace-provisioning.mock`,
    workspaceRegistryFile:
      readOptionalString(metadata, 'workspace_registry_file')
      ?? `artifacts/mock-lane/runs/${readRequiredString(metadata, 'session_id', metadataPath)}/system-workspaces.json`,
    visualBuildInfoFile:
      readOptionalString(metadata, 'visual_build_info_file') ?? path.join(resolvedSessionRoot, 'visual-build-info.json'),
    visualBaselineBuildInfoFile:
      readOptionalString(metadata, 'visual_baseline_build_info_file')
      ?? path.join(resolvedSessionRoot, 'visual-build-info.json'),
    visualBaselineBuildFingerprint: readOptionalString(metadata, 'visual_baseline_build_fingerprint') ?? '',
    secretProfileDigest: readRequiredString(metadata, 'secret_profile_digest', metadataPath),
    startedAt: readRequiredString(metadata, 'started_at', metadataPath),
    startupCount: readOptionalNumber(metadata, 'startup_count') ?? 0,
    routeWarmCount: readOptionalNumber(metadata, 'route_warm_count') ?? 0,
    cleanupErrors: readCleanupErrors(metadata.cleanup_errors),
  };
}

function readPersistedShardExecutions(
  session: MockLaneSession,
  plan: readonly MockLaneSessionShard[],
): MockLaneShardExecution[] {
  const executions: MockLaneShardExecution[] = [];

  for (const shard of plan) {
    const resultPath = path.join(session.sessionRoot, 'shards', shard.id, 'result.json');
    if (!existsSync(resultPath)) {
      continue;
    }

    const result = readJsonObject(resultPath);
    const diagnosticState = readRequiredDiagnosticState(result.diagnostic_state, resultPath);
    executions.push({
      attempts: readShardAttempts(result.attempts, resultPath),
      diagnosticState,
      durationMs: readOptionalNumber(result, 'duration_ms'),
      exitCode: readRequiredNumber(result, 'exit_code', resultPath),
      finishedAt: readRequiredString(result, 'finished_at', resultPath),
      shard,
      startedAt: readRequiredString(result, 'started_at', resultPath),
    });
  }

  return executions;
}

export function writeVisualBuildInfo(session: MockLaneSession, now: () => Date): void {
  const gitSha = resolveVisualBuildGitSha(session.rootDir);

  assertVisualBuildInfoIsCurrent(session, gitSha);

  const fingerprint = session.visualBaselineBuildFingerprint
    || createHash('sha256')
      .update(`${session.sessionId}|${gitSha}|${session.nextDistDir}|${session.port}`)
      .digest('hex');

  session.visualBaselineBuildFingerprint = fingerprint;
  writeJson(session.visualBaselineBuildInfoFile, {
    lane: 'mock-lane',
    run_id: session.sessionId,
    git_sha: gitSha,
    fingerprint,
    started_at: now().toISOString(),
    base_url: session.baseUrl,
    next_dist_dir: session.nextDistDir,
  });
}

function resolveVisualBuildGitSha(rootDir: string): string {
  const gitEnv = buildSessionRootGitEnv(rootDir);
  const topLevelResult = spawnSync('git', ['-C', rootDir, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    env: gitEnv,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const topLevel = topLevelResult.stdout.trim();
  if ((topLevelResult.status ?? 1) !== 0 || !topLevel || path.resolve(topLevel) !== path.resolve(rootDir)) {
    throw new Error('failed to resolve git sha for visual build metadata');
  }

  const gitResult = spawnSync('git', ['-C', rootDir, 'rev-parse', '--verify', 'HEAD^{commit}'], {
    encoding: 'utf8',
    env: gitEnv,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const gitSha = gitResult.stdout.trim();
  if ((gitResult.status ?? 1) !== 0 || !gitSha) {
    throw new Error('failed to resolve git sha for visual build metadata');
  }

  return gitSha;
}

function buildSessionRootGitEnv(rootDir: string): NodeJS.ProcessEnv {
  const gitEnv = cleanProcessEnv(process.env);
  const ceilingDirectory = path.dirname(path.resolve(rootDir));
  gitEnv.GIT_CEILING_DIRECTORIES = gitEnv.GIT_CEILING_DIRECTORIES
    ? `${ceilingDirectory}${path.delimiter}${gitEnv.GIT_CEILING_DIRECTORIES}`
    : ceilingDirectory;
  delete gitEnv.GIT_COMMON_DIR;
  delete gitEnv.GIT_DIR;
  delete gitEnv.GIT_INDEX_FILE;
  delete gitEnv.GIT_WORK_TREE;
  return gitEnv;
}

function assertVisualBuildInfoIsCurrent(session: MockLaneSession, gitSha: string): void {
  if (!existsSync(session.visualBaselineBuildInfoFile)) {
    return;
  }

  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(session.visualBaselineBuildInfoFile, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`failed to read existing visual build metadata: ${errorMessage(error)}`);
  }

  if (!existing || typeof existing !== 'object') {
    throw new Error(`stale visual build metadata detected in ${session.visualBaselineBuildInfoFile}`);
  }

  const record = existing as Record<string, unknown>;
  const existingGitSha = typeof record.git_sha === 'string' ? record.git_sha : '';
  const existingRunId = typeof record.run_id === 'string' ? record.run_id : '';
  if ((existingGitSha && existingGitSha !== gitSha) || (existingRunId && existingRunId !== session.sessionId)) {
    throw new Error(`stale visual build metadata detected in ${session.visualBaselineBuildInfoFile}`);
  }
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}${os.EOL}`);
}

function readJsonObject(filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`failed to read JSON object from ${filePath}: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`expected JSON object in ${filePath}`);
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readRequiredString(record: Record<string, unknown>, key: string, source: string): string {
  const value = readOptionalString(record, key);
  if (value === null) {
    throw new Error(`missing required string ${key} in ${source}`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readRequiredNumber(record: Record<string, unknown>, key: string, source: string): number {
  const value = readOptionalNumber(record, key);
  if (value === null) {
    throw new Error(`missing required number ${key} in ${source}`);
  }
  return value;
}

function readOptionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function portFromBaseUrl(baseUrl: string, source: string): number {
  try {
    const parsed = new URL(baseUrl);
    const port = Number.parseInt(parsed.port, 10);
    if (Number.isFinite(port) && port > 0) {
      return port;
    }
  } catch {
    // Report the source below with a stable error.
  }
  throw new Error(`failed to resolve port from base_url in ${source}`);
}

function readShardIds(value: unknown): MockLaneShardId[] {
  if (!Array.isArray(value)) {
    return buildMockLaneSessionShardPlan('default').map((shard) => shard.id);
  }

  return value.map((item) => {
    if (typeof item !== 'string' || !isMockLaneShardId(item)) {
      throw new Error(`unknown mock lane shard in session metadata: ${String(item)}`);
    }
    return item;
  });
}

function readCleanupErrors(value: unknown): Array<{ message: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.message !== 'string') {
      return [];
    }
    return [{ message: item.message }];
  });
}

function readRequiredDiagnosticState(
  value: unknown,
  source: string,
): Exclude<MockLaneShardDiagnosticState, 'not_run'> {
  if (value === 'succeeded' || value === 'failed' || value === 'infra_failed') {
    return value;
  }
  throw new Error(`missing required diagnostic_state in ${source}`);
}

function readShardAttempts(value: unknown, source: string): MockLaneShardAttemptRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`missing required attempts in ${source}`);
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new Error(`invalid shard attempt in ${source}`);
    }

    return {
      attempt: readRequiredNumber(item, 'attempt', source),
      diagnostic_state: readRequiredDiagnosticState(item.diagnostic_state, source),
      exit_code: readRequiredNumber(item, 'exit_code', source),
      listener_lost: readRequiredBoolean(item, 'listener_lost', source),
      transient_failure: readRequiredBoolean(item, 'transient_failure', source),
      stdout_log: readRequiredString(item, 'stdout_log', source),
      stderr_log: readRequiredString(item, 'stderr_log', source),
    };
  });
}

function readRequiredBoolean(record: Record<string, unknown>, key: string, source: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`missing required boolean ${key} in ${source}`);
  }
  return value;
}

function writeStatus(runRoot: string, value: 'failed' | 'incomplete' | 'success'): void {
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(path.join(runRoot, '.status'), `${value}${os.EOL}`);
}

function readStatus(runRoot: string): 'failed' | 'incomplete' | 'success' {
  try {
    const value = readFileSync(path.join(runRoot, '.status'), 'utf8').trim();
    if (value === 'failed' || value === 'success' || value === 'incomplete') {
      return value;
    }
  } catch {
    return 'incomplete';
  }
  return 'incomplete';
}

function applyRunRetention(session: MockLaneSession, exitCode: number): void {
  const keepSuccess = parseSessionKeepSuccess();
  const keepFailed = parseBooleanFlag(process.env.MOCK_LANE_KEEP_FAILED, true);
  const keepRecent = parseNonnegativeInteger(process.env.MOCK_LANE_KEEP_RECENT, 5);
  const staleHours = parseNonnegativeInteger(process.env.MOCK_LANE_PRUNE_STALE_HOURS, 24);
  let retainedCurrentRunRoot: string | null = session.runRoot;

  if (exitCode === 0 && !keepSuccess) {
    rmSync(session.runRoot, { recursive: true, force: true });
    retainedCurrentRunRoot = null;
  } else if (exitCode !== 0 && !keepFailed) {
    rmSync(session.runRoot, { recursive: true, force: true });
    retainedCurrentRunRoot = null;
  }

  pruneMockLaneRuns(session.rootDir, keepRecent, staleHours, retainedCurrentRunRoot ? [retainedCurrentRunRoot] : []);
}

function parseSessionKeepSuccess(): boolean {
  const sessionValue = parseOptionalBooleanFlag(process.env.MOCK_LANE_SESSION_KEEP_SUCCESS);
  if (sessionValue !== null) {
    return sessionValue;
  }

  return true;
}

export function pruneMockLaneRuns(
  rootDir: string,
  keepRecent: number,
  staleHours: number,
  protectedRunRoots: readonly string[] = [],
): void {
  const runsRoot = path.join(rootDir, 'artifacts', 'mock-lane', 'runs');
  mkdirSync(runsRoot, { recursive: true });

  const normalizedKeepRecent = keepRecent >= 0 ? keepRecent : 5;
  const normalizedStaleHours = staleHours >= 0 ? staleHours : 24;
  const staleCutoffMs = Date.now() - normalizedStaleHours * 60 * 60 * 1_000;
  const currentRunRoot = currentMockLaneRunRoot(rootDir);
  const protectedRunRootSet = new Set(protectedRunRoots.map((runRoot) => path.resolve(runRoot)));
  const failedRunRoots: string[] = [];

  for (const runRoot of listRunRoots(runsRoot)) {
    if (isProtectedRunRoot(runRoot, currentRunRoot, protectedRunRootSet)) {
      continue;
    }

    const status = readStatus(runRoot);
    if (status === 'success') {
      rmSync(runRoot, { recursive: true, force: true });
    } else if (status === 'incomplete') {
      const stat = safeStat(runRoot);
      if (!stat || stat.mtimeMs < staleCutoffMs) {
        rmSync(runRoot, { recursive: true, force: true });
      }
    } else {
      failedRunRoots.push(runRoot);
    }
  }

  failedRunRoots
    .sort((left, right) => (safeStat(right)?.mtimeMs ?? 0) - (safeStat(left)?.mtimeMs ?? 0))
    .forEach((runRoot, index) => {
      if (index >= normalizedKeepRecent && !isProtectedRunRoot(runRoot, currentRunRoot, protectedRunRootSet)) {
        rmSync(runRoot, { recursive: true, force: true });
      }
    });

  pruneLegacyMockLaneAliases(rootDir, normalizedStaleHours);
}

function currentMockLaneRunRoot(rootDir: string): string | null {
  const currentPath = path.join(rootDir, 'artifacts', 'mock-lane', 'current');
  const currentStat = safeLstat(currentPath);
  if (!currentStat?.isSymbolicLink()) {
    return null;
  }

  try {
    return path.resolve(path.dirname(currentPath), readlinkSync(currentPath));
  } catch {
    return null;
  }
}

function listRunRoots(runsRoot: string): string[] {
  try {
    return readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runsRoot, entry.name));
  } catch {
    return [];
  }
}

function isProtectedRunRoot(
  runRoot: string,
  currentRunRoot: string | null,
  protectedRunRoots: ReadonlySet<string>,
): boolean {
  if (protectedRunRoots.has(path.resolve(runRoot))) {
    return true;
  }
  if (currentRunRoot && path.resolve(runRoot) === path.resolve(currentRunRoot)) {
    return true;
  }
  return isActiveRunRoot(runRoot);
}

function isActiveRunRoot(runRoot: string): boolean {
  const ownerFile = path.join(runRoot, '.lane-owner.env');
  if (!existsSync(ownerFile)) {
    return false;
  }

  const ownerPid = parseLaneOwnerPid(ownerFile);
  if (ownerPid === null) {
    return true;
  }

  try {
    process.kill(ownerPid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseLaneOwnerPid(ownerFile: string): number | null {
  let content = '';
  try {
    content = readFileSync(ownerFile, 'utf8');
  } catch {
    return null;
  }

  const match = /^owner_pid=(\d+)$/m.exec(content);
  if (!match) {
    return null;
  }

  const pid = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function pruneLegacyMockLaneAliases(rootDir: string, staleHours: number): void {
  const laneRoot = path.join(rootDir, 'artifacts', 'mock-lane');
  const staleCutoffMs = Date.now() - staleHours * 60 * 60 * 1_000;
  const legacyDirs = listRunRoots(laneRoot)
    .filter((dir) => path.basename(dir).includes('-legacy-'))
    .sort((left, right) => (safeStat(right)?.mtimeMs ?? 0) - (safeStat(left)?.mtimeMs ?? 0));

  legacyDirs.forEach((dir, index) => {
    const stat = safeStat(dir);
    if (index > 0 || !stat || stat.mtimeMs < staleCutoffMs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

function prepareCurrentLink(rootDir: string, runRoot: string): void {
  const currentPath = path.join(rootDir, 'artifacts', 'mock-lane', 'current');
  mkdirSync(path.dirname(currentPath), { recursive: true });
  const currentStat = safeLstat(currentPath);
  if (currentStat) {
    try {
      if (currentStat.isSymbolicLink()) {
        unlinkSync(currentPath);
      } else {
        throw new Error('current mock lane alias is not a symlink');
      }
    } catch {
      const legacyPath = `${currentPath}-legacy-${timestampForPath()}`;
      renameSync(currentPath, legacyPath);
    }
  }
  symlinkSync(runRoot, currentPath, 'dir');
}

function removeCurrentLinkIfMatches(rootDir: string, runRoot: string): void {
  const currentPath = path.join(rootDir, 'artifacts', 'mock-lane', 'current');
  const currentStat = safeLstat(currentPath);
  if (!currentStat?.isSymbolicLink()) {
    return;
  }
  let target = '';
  try {
    target = path.resolve(path.dirname(currentPath), readlinkSync(currentPath));
  } catch {
    return;
  }
  if (path.resolve(target) === path.resolve(runRoot)) {
    rmSync(currentPath, { force: true });
  }
}

function safeLstat(filePath: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(filePath);
  } catch {
    return null;
  }
}

function safeStat(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function writeLaneOwner(session: MockLaneSession, ownerPid: number, ownerLabel: string): void {
  writeFileSync(
    path.join(session.runRoot, '.lane-owner.env'),
    [
      'lane_name=mock-lane',
      `owner_pid=${ownerPid}`,
      `owner_label=${ownerLabel}`,
      `started_at=${session.startedAt}`,
      '',
    ].join(os.EOL),
  );
}

function clearLaneOwner(session: MockLaneSession): void {
  rmSync(path.join(session.runRoot, '.lane-owner.env'), { force: true });
}

export function cleanupMockLaneSessionSync(session: MockLaneSession, status: 'failed' | 'incomplete' = 'failed'): void {
  for (const pid of [
    readPidFile(session.nextPidFile),
    readPidFile(session.pidFile),
  ]) {
    if (pid) {
      stopProcessGroupSync(pid);
    }
  }

  rmSync(path.join(session.rootDir, session.workspaceProvisioningPath), { recursive: true, force: true });
  rmSync(session.pidFile, { force: true });
  rmSync(session.nextPidFile, { force: true });
  clearLaneOwner(session);
  removeCurrentLinkIfMatches(session.rootDir, session.runRoot);
  if (existsSync(session.runRoot)) {
    writeStatus(session.runRoot, status);
  }
}

function readPidFile(filePath: string): number | null {
  try {
    const value = Number.parseInt(readFileSync(filePath, 'utf8').trim(), 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function waitHttpOk(session: MockLaneSession, maxAttempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!(await isPortListening(session.port))) {
      await sleep(1_000);
      continue;
    }
    const status = await httpStatus(session.healthUrl);
    if (status === 200) {
      return true;
    }
    await sleep(1_000);
  }
  return false;
}

async function waitForStableHealth(
  session: MockLaneSession,
  consecutiveTarget: number,
  maxChecks: number,
): Promise<void> {
  let consecutive = 0;
  for (let attempt = 0; attempt < maxChecks; attempt += 1) {
    const status = await httpStatus(session.healthUrl);
    if (status === 200) {
      consecutive += 1;
      if (consecutive >= consecutiveTarget) {
        return;
      }
    } else {
      consecutive = 0;
    }
    await sleep(1_000);
  }
  throw new Error(`mock web did not stay healthy after route warm-up: ${session.healthUrl}`);
}

async function warmRoute(session: MockLaneSession, route: string, attempts: number): Promise<void> {
  const url = `${session.baseUrl}${route}`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await httpStatus(url);
    if (status === 200 || status === 307 || status === 308) {
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`route ${route} did not warm successfully after ${attempts} attempts`);
}

function httpStatus(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(
      parsed,
      {
        method: 'GET',
        timeout: 5_000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? null);
      },
    );
    request.on('error', () => resolve(null));
    request.on('timeout', () => {
      request.destroy();
      resolve(null);
    });
    request.end();
  });
}

async function isPortBindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server: Server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, '127.0.0.1');
  });
}

async function pickFreePort(preferredPort: number): Promise<number> {
  if (await isPortBindable(preferredPort)) {
    return preferredPort;
  }
  for (let port = 3010; port <= 3099; port += 1) {
    if (await isPortBindable(port)) {
      return port;
    }
  }
  throw new Error('failed to find a free port for mock lane session');
}

function rebindSessionPort(session: MockLaneSession, port: number): void {
  session.port = port;
  session.portFamily = `mock:${port}`;
  session.baseUrl = `http://127.0.0.1:${port}`;
  session.healthUrl = `${session.baseUrl}/zh-CN/login`;
}

export function resetNextDevArtifactsIfCorrupt(session: MockLaneSession): boolean {
  let logContent = '';
  try {
    logContent = readFileSync(session.logFile, 'utf8');
  } catch {
    return false;
  }

  if (!logContent.includes("Cannot find module './vendor-chunks/next.js'")) {
    return false;
  }

  rmSync(path.join(session.rootDir, session.nextDistDir), { recursive: true, force: true });
  return true;
}

async function stopProcessGroup(pid: number): Promise<void> {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }
  await sleep(500);
  try {
    process.kill(-pid, 0);
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      return;
    }
  }
}

function stopProcessGroupSync(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      return;
    }
  }
}

async function runNextGeneratedRootNormalize(rootDir: string): Promise<void> {
  const result = spawnSync(
    'bash',
    [
      '-lc',
      'source scripts/lib/next-generated-root-state.sh && next_generated_root_normalize',
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: cleanProcessEnv(process.env),
    },
  );
  if ((result.status ?? 1) !== 0) {
    throw new Error(`next generated root normalize failed: ${result.stderr || result.stdout}`);
  }
}

async function runNextGeneratedRootFinalize(rootDir: string): Promise<void> {
  const result = spawnSync(
    'bash',
    [
      '-lc',
      'source scripts/lib/next-generated-root-state.sh && next_generated_root_finalize_lane_cleanup',
    ],
    {
      cwd: rootDir,
      encoding: 'utf8',
      env: cleanProcessEnv(process.env),
    },
  );
  if ((result.status ?? 0) !== 0) {
    throw new Error(`next generated root finalize failed: ${result.stderr || result.stdout}`);
  }
}

function parseWarmRoutes(raw: string | undefined): readonly string[] {
  if (!raw) {
    return DEFAULT_WARM_URLS;
  }
  return raw.split(/\r?\n/).map((route) => route.trim()).filter(Boolean);
}

function cleanProcessEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...env };
  for (const key of PROXY_ENV_KEYS) {
    delete nextEnv[key];
  }
  return nextEnv;
}

function redactLog(content: string): string {
  return content
    .replace(
      /((?:[A-Za-z0-9_.-]*)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|admin[_-]?token|oauth(?:[_-]?token)?|client[_-]?secret|password|ticket|managed[_-]?credentials?|cookie|authorization)(?:[A-Za-z0-9_.-]*)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\bBearer\s+[^\s"',}]+|[^\s"',}]+)/gi,
      '$1[redacted]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9][A-Za-z0-9_-]{6,}/gi, 'sk-[redacted]');
}

function isTransientPlaywrightFailure(content: string): boolean {
  return /ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE|ECONNRESET|EPIPE|socket hang up|Target closed/.test(content);
}

function digestSecretProfile(): string {
  const keys = [
    'NEXT_PUBLIC_USE_MSW',
    'NEXT_PUBLIC_MSW_STRICT_READY',
    'SYSTEM_WORKSPACE_REGISTRY_MODE',
  ];
  const material = keys.map((key) => `${key}=${process.env[key] ?? ''}`).join('\n');
  return createHash('sha256').update(material).digest('hex');
}

function generateRunId(prefix: string): string {
  return `${prefix}-${timestampForPath()}-${process.pid}-${Math.floor(Math.random() * 100000)}`;
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function dateDurationMs(startedAt: string, finishedAt: string): number | null {
  const started = Date.parse(startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) {
    return null;
  }
  return Math.max(0, finished - started);
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw || !/^[0-9]+$/.test(raw)) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return value > 0 ? value : fallback;
}

function parseNonnegativeInteger(raw: string | undefined, fallback: number): number {
  if (!raw || !/^[0-9]+$/.test(raw)) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return value >= 0 ? value : fallback;
}

function parseBooleanFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw === '1' || raw.toLowerCase() === 'true';
}

function parseOptionalBooleanFlag(raw: string | undefined): boolean | null {
  if (raw === undefined || raw === '') {
    return null;
  }
  return parseBooleanFlag(raw, false);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortErrorFromReason(signal.reason);
  }
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(abortErrorFromReason(signal.reason));
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function abortErrorFromReason(reason: unknown): MockLaneSessionAbortError {
  if (reason instanceof MockLaneSessionAbortError) {
    return reason;
  }
  if (reason instanceof Error) {
    return new MockLaneSessionAbortError(reason.message);
  }
  if (typeof reason === 'string' && reason) {
    return new MockLaneSessionAbortError(reason);
  }
  return new MockLaneSessionAbortError('AbortSignal');
}

function isAbortError(error: unknown): error is MockLaneSessionAbortError {
  return error instanceof MockLaneSessionAbortError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type SessionRunnerCliCommand = 'finish' | 'help' | 'run' | 'run-shard' | 'start';

interface ParsedCliArgs {
  command: SessionRunnerCliCommand;
  options: RunMockLaneSessionOptions;
  sessionRoot?: string;
  shardId?: MockLaneShardId;
}

function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const normalizedArgv = argv[0] === 'session' ? argv.slice(1) : argv;
  const [maybeCommand, ...rest] = normalizedArgv;
  const command = maybeCommand && !maybeCommand.startsWith('--') ? maybeCommand : 'run';
  if (!isSessionRunnerCliCommand(command)) {
    throw new Error(`unsupported session-runner command in this mock slice: ${command}`);
  }

  const args = maybeCommand && !maybeCommand.startsWith('--') ? rest : normalizedArgv;
  const options: RunMockLaneSessionOptions = {};
  let sessionRoot: string | undefined;
  let shardId: MockLaneShardId | undefined;

  for (const arg of args) {
    if (arg === '--include-visual' || arg === '--visual') {
      options.preset = 'with-visual';
    } else if (arg === '--preset=default') {
      options.preset = 'default';
    } else if (arg === '--preset=with-visual' || arg === '--preset=all' || arg === '--preset=full-with-visual') {
      options.preset = 'with-visual';
    } else if (arg.startsWith('--run-id=')) {
      options.runId = arg.slice('--run-id='.length);
    } else if (arg.startsWith('--run-root=')) {
      options.runRoot = arg.slice('--run-root='.length);
    } else if (arg.startsWith('--port=')) {
      options.port = parsePositiveInteger(arg.slice('--port='.length), 3001);
    } else if (arg.startsWith('--port-family=')) {
      options.portFamily = arg.slice('--port-family='.length);
    } else if (arg.startsWith('--shards=')) {
      options.shards = arg.slice('--shards='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          if (!isMockLaneShardId(value)) {
            throw new Error(`unknown mock lane shard: ${value}`);
          }
          return value;
        });
    } else if (arg.startsWith('--session-root=')) {
      sessionRoot = arg.slice('--session-root='.length);
    } else if (arg.startsWith('--shard=')) {
      const value = arg.slice('--shard='.length);
      if (!isMockLaneShardId(value)) {
        throw new Error(`unknown mock lane shard: ${value}`);
      }
      shardId = value;
    } else if (arg === '--kind=mock') {
      continue;
    } else if (arg.startsWith('--kind=')) {
      throw new Error('mock lane session runner only supports --kind=mock in this slice');
    } else if (arg === '--help' || arg === '-h') {
      return { command: 'help', options };
    } else {
      throw new Error(`unknown session-runner argument: ${arg}`);
    }
  }

  if (command === 'start') {
    if (!options.runRoot) {
      throw new Error('session start requires --run-root=<path>');
    }
    if (!options.portFamily) {
      throw new Error('session start requires --port-family=<id>');
    }
  } else if (command === 'run-shard') {
    if (!sessionRoot) {
      throw new Error('session run-shard requires --session-root=<path>');
    }
    if (!shardId) {
      throw new Error('session run-shard requires --shard=<id>');
    }
  } else if (command === 'finish' && !sessionRoot) {
    throw new Error('session finish requires --session-root=<path>');
  }

  return { command, options, sessionRoot, shardId };
}

function isMockLaneShardId(value: string): value is MockLaneShardId {
  return MOCK_LANE_SESSION_SHARDS.some((shard) => shard.id === value);
}

function isSessionRunnerCliCommand(value: string): value is SessionRunnerCliCommand {
  return value === 'finish' || value === 'help' || value === 'run' || value === 'run-shard' || value === 'start';
}

interface SessionRunnerCliDependencies {
  driver?: MockLaneSessionDriver;
  now?: () => Date;
  stdout?: {
    write(chunk: string): unknown;
  };
}

export async function runSessionRunnerCli(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: SessionRunnerCliDependencies = {},
): Promise<number> {
  const { command, options, sessionRoot, shardId } = parseCliArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  if (command === 'help') {
    stdout.write(
      [
        'Usage:',
        '  session start --kind=mock --run-root=<path> --port-family=<id>',
        '  session run-shard --session-root=<path> --shard=<id>',
        '  session finish --session-root=<path>',
        '  tsx scripts/governance/session-runner.ts run --kind=mock --preset=default',
        '  tsx scripts/governance/session-runner.ts run --kind=mock --preset=with-visual',
        '',
        'Mock is implemented in this slice. backend-real is intentionally rejected until its runner exists.',
        'The aggregate run command remains a clean one-process adapter for existing mock npm entries.',
        '',
      ].join(os.EOL),
    );
    return 0;
  }

  const abortController = new AbortController();
  const removeTerminationHooks = installMockLaneSessionTerminationHooks(abortController);
  try {
    if (command === 'start') {
      const result = await startPersistedMockLaneSession({
        ...options,
        driver: dependencies.driver,
        now: dependencies.now,
        signal: abortController.signal,
      });
      stdout.write(`[mock-lane-session] session_root=${result.sessionRoot}${os.EOL}`);
      return result.exitCode;
    }

    if (command === 'run-shard') {
      const result = await runPersistedMockLaneSessionShard({
        driver: dependencies.driver,
        now: dependencies.now,
        sessionRoot: sessionRoot ?? '',
        shardId: shardId ?? 'smoke',
        signal: abortController.signal,
      });
      stdout.write(`[mock-lane-session] shard=${shardId} result=${result.shardResultPath}${os.EOL}`);
      return result.exitCode;
    }

    if (command === 'finish') {
      const result = await finishPersistedMockLaneSession({
        driver: dependencies.driver,
        now: dependencies.now,
        sessionRoot: sessionRoot ?? '',
      });
      stdout.write(`[mock-lane-session] aggregate=${result.aggregatePath}${os.EOL}`);
      return result.exitCode;
    }

    const result = await runMockLaneSession({
      ...options,
      driver: dependencies.driver,
      now: dependencies.now,
      signal: abortController.signal,
    });
    stdout.write(`[mock-lane-session] aggregate=${result.aggregatePath}${os.EOL}`);
    return result.exitCode;
  } finally {
    removeTerminationHooks();
  }
}

export function installMockLaneSessionTerminationHooks(abortController: AbortController): () => void {
  const abortFromSignal = (signal: NodeJS.Signals, exitCode: number) => {
    if (abortController.signal.aborted) {
      process.exitCode = exitCode;
      return;
    }
    abortController.abort(new MockLaneSessionAbortError(signal, exitCode));
  };
  const onSigint = () => abortFromSignal('SIGINT', 130);
  const onSigterm = () => abortFromSignal('SIGTERM', 143);
  const onExit = () => {
    if (activeMockLaneSession) {
      cleanupMockLaneSessionSync(activeMockLaneSession, 'failed');
    }
  };

  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  process.once('exit', onExit);

  return () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    process.off('exit', onExit);
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSessionRunnerCli()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`[mock-lane-session] ERROR: ${errorMessage(error)}${os.EOL}`);
      process.exitCode = 1;
    });
}
