import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  readReleaseStatus,
  renderReleaseStatus,
} from './release-summary';
import {
  assertSafeReleaseCampaignRunId,
  prepareDefaultReleaseCampaignRoot,
} from './release-campaign-io';
import {
  buildSentinelPreflightEnv,
  renderSentinelPreflightOutput,
  runSentinelPreflightSync,
  type SentinelPreflightResult,
  type SentinelProfile,
} from './sentinel-preflight';
import {
  defaultResourceOwnerPreflightEvidencePath,
  renderResourceOwnerPreflightSummary,
  runResourceOwnerPreflight,
  type ResourceOwnerPreflightResult,
} from './resource-owner-preflight';
import { renderShortFailureProjection } from './status-projection';
import {
  buildRunReadinessCampaignOrchestratorEnv,
  createRunReadinessState,
  updateRunReadinessStateParentObservations,
} from './run-readiness-state';
import {
  createReleaseCleanupFinalizer,
  releaseReadyCleanupDisabled,
  type ReleaseCleanupFinalizer,
} from './release-cleanup-finalizer';

type CliWriteStream = {
  write(chunk: string): unknown;
};

type NpmScriptResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
};

type ReleaseReadyGitCleanGuardResult =
  | {
      ok: true;
      headSha: string;
    }
  | {
      ok: false;
      blocker: string;
      why: string;
      inspectCommand: string;
    };

type ReleaseReadyCleanupContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  campaignRoot: string;
  runId: string;
  gitSha: string;
};

type ReleaseReadyDependencies = {
  stdout?: CliWriteStream;
  stderr?: CliWriteStream;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runNpmScript?: (
    script: string,
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ) => NpmScriptResult;
  gitCleanGuard?: (cwd: string, env: NodeJS.ProcessEnv) => ReleaseReadyGitCleanGuardResult;
  sentinelRunner?: (profile: SentinelProfile, env: NodeJS.ProcessEnv, cwd: string) => SentinelPreflightResult;
  ownerPreflight?: (evidencePath: string, env: NodeJS.ProcessEnv, cwd: string) => ResourceOwnerPreflightResult;
  createCleanupFinalizer?: ((context: ReleaseReadyCleanupContext) => ReleaseCleanupFinalizer) | null;
};

type ReleasePrecheckOperationStatus = 'reused' | 'started';

type ReleasePrecheckOperation = {
  status: ReleasePrecheckOperationStatus;
  startCount: number;
};

type ReleasePrecheckParentObservations = {
  services: {
    real_services_started: 'ready';
    api_web_started: 'ready';
  };
  counts: {
    real_service_start_count: number;
    api_web_start_count: number;
  };
};

type ReleasePrecheckSummaryResult =
  | {
    ok: true;
    observations: ReleasePrecheckParentObservations;
  }
  | {
    ok: false;
    error: string;
  };

const RELEASE_PRECHECK_SUMMARY_SCHEMA = 'agentsmith.release-local-precheck/v1';
const RELEASE_PRECHECK_SUMMARY_RELATIVE_PATH = join('release-local-precheck', 'precheck-summary.json');
const RELEASE_PRECHECK_REQUIRED_CHECKS = [
  'dependency_services_ready',
  'api_minimal_ready',
  'web_minimal_ready',
  'public_auth_token_smoke',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function describeExit(status: number | null, signal: NodeJS.Signals | null): string {
  if (typeof status === 'number') {
    return `exit code ${status}`;
  }
  if (signal) {
    return `signal ${signal}`;
  }
  return 'unknown exit status';
}

function renderNotStarted(options: {
  blocker: string;
  stage: string;
  why: string;
  next: string;
  logs: string;
}): string {
  return [
    'AgentSmith Release Readiness',
    '',
    renderShortFailureProjection({
      verdict: 'BLOCKED',
      blocker: options.blocker,
      stage: options.stage,
      why: options.why,
      inspectCommand: options.logs,
      rerunCommand: 'npm run release:ready',
      evidencePath: 'no campaign evidence was produced; no release verdict was written.',
    }).trimEnd(),
    '',
  ].join('\n');
}

function timestampRunId(): string {
  return `release-ready-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

function runGitCommand(cwd: string, args: readonly string[]): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
}

function firstLine(value: string): string {
  return value.trim().split(/\r?\n/u)[0]?.trim() ?? '';
}

function parsePrecheckOperation(value: unknown, fieldPath: string): {
  ok: true;
  operation: ReleasePrecheckOperation;
} | {
  ok: false;
  error: string;
} {
  if (!isRecord(value)) {
    return { ok: false, error: `${fieldPath} must be an object` };
  }
  const status = value.status;
  if (status !== 'reused' && status !== 'started') {
    return { ok: false, error: `${fieldPath}.status must be reused or started` };
  }
  const startCount = value.start_count;
  if (typeof startCount !== 'number' || !Number.isInteger(startCount) || startCount < 0) {
    return { ok: false, error: `${fieldPath}.start_count must be a non-negative integer` };
  }
  if (status === 'reused' && startCount !== 0) {
    return { ok: false, error: `${fieldPath}.start_count must be 0 when status is reused` };
  }
  if (status === 'started' && startCount !== 1) {
    return { ok: false, error: `${fieldPath}.start_count must be 1 when status is started` };
  }
  return {
    ok: true,
    operation: {
      status,
      startCount,
    },
  };
}

function parseReleasePrecheckSummary(
  value: unknown,
  expectedCampaign: {
    runId: string;
    campaignRoot: string;
  },
): ReleasePrecheckSummaryResult {
  if (!isRecord(value)) {
    return { ok: false, error: 'release local precheck summary must be a JSON object' };
  }
  if (value.schema_version !== RELEASE_PRECHECK_SUMMARY_SCHEMA) {
    return {
      ok: false,
      error: `release local precheck summary schema_version must be ${RELEASE_PRECHECK_SUMMARY_SCHEMA}`,
    };
  }
  if (value.status !== 'passed') {
    return { ok: false, error: 'release local precheck summary status must be passed' };
  }
  if (!Array.isArray(value.checks) || !value.checks.every((entry) => typeof entry === 'string')) {
    return { ok: false, error: 'release local precheck summary checks must be a string array' };
  }
  for (const requiredCheck of RELEASE_PRECHECK_REQUIRED_CHECKS) {
    if (!value.checks.includes(requiredCheck)) {
      return { ok: false, error: `release local precheck summary is missing check: ${requiredCheck}` };
    }
  }
  if (!isRecord(value.observed_operations)) {
    return { ok: false, error: 'release local precheck summary observed_operations must be an object' };
  }

  const dependencyServices = parsePrecheckOperation(
    value.observed_operations.dependency_services,
    'observed_operations.dependency_services',
  );
  if (!dependencyServices.ok) {
    return { ok: false, error: dependencyServices.error };
  }
  const apiWeb = parsePrecheckOperation(value.observed_operations.api_web, 'observed_operations.api_web');
  if (!apiWeb.ok) {
    return { ok: false, error: apiWeb.error };
  }
  if (typeof value.campaign_root !== 'string' || value.campaign_root.trim().length === 0) {
    return { ok: false, error: 'release local precheck summary campaign_root is required' };
  }
  if (resolve(value.campaign_root) !== resolve(expectedCampaign.campaignRoot)) {
    return { ok: false, error: 'release local precheck summary campaign_root must match current RELEASE_CAMPAIGN_ROOT' };
  }
  if (typeof value.campaign_run_id !== 'string' || value.campaign_run_id.trim().length === 0) {
    return { ok: false, error: 'release local precheck summary campaign_run_id is required' };
  }
  if (value.campaign_run_id !== expectedCampaign.runId) {
    return { ok: false, error: 'release local precheck summary campaign_run_id must match current RELEASE_CAMPAIGN_RUN_ID' };
  }

  return {
    ok: true,
    observations: {
      services: {
        real_services_started: 'ready',
        api_web_started: 'ready',
      },
      counts: {
        real_service_start_count: dependencyServices.operation.startCount,
        api_web_start_count: apiWeb.operation.startCount,
      },
    },
  };
}

function readReleasePrecheckSummary(expectedCampaign: {
  runId: string;
  campaignRoot: string;
}): ReleasePrecheckSummaryResult {
  const campaignRoot = expectedCampaign.campaignRoot;
  const summaryPath = join(campaignRoot, RELEASE_PRECHECK_SUMMARY_RELATIVE_PATH);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(summaryPath, 'utf8')) as unknown;
  } catch {
    return {
      ok: false,
      error: `release local precheck summary cannot be read at ${RELEASE_PRECHECK_SUMMARY_RELATIVE_PATH}`,
    };
  }
  return parseReleasePrecheckSummary(parsed, expectedCampaign);
}

function defaultGitCleanGuard(cwd: string): ReleaseReadyGitCleanGuardResult {
  const head = runGitCommand(cwd, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const headSha = firstLine(head.stdout);
  if (head.status !== 0 || !/^[0-9a-f]{40,64}$/iu.test(headSha)) {
    return {
      ok: false,
      blocker: 'release_git_clean_guard',
      why: 'release:ready requires a traceable git HEAD before release sign-off.',
      inspectCommand: 'git rev-parse --verify HEAD',
    };
  }

  const status = runGitCommand(cwd, ['status', '--porcelain=v1', '--untracked-files=normal']);
  if (status.status !== 0) {
    return {
      ok: false,
      blocker: 'release_git_clean_guard',
      why: 'release:ready could not verify the git worktree state.',
      inspectCommand: 'git status --short',
    };
  }
  if (status.stdout.trim().length > 0) {
    return {
      ok: false,
      blocker: 'release_git_clean_guard',
      why: 'release:ready requires a clean git worktree before release sign-off.',
      inspectCommand: 'git status --short',
    };
  }

  return {
    ok: true,
    headSha,
  };
}

function resolveReleaseReadyCampaignContext(
  env: NodeJS.ProcessEnv,
  defaultRunId = timestampRunId(),
): {
  runId: string;
  campaignRoot: string;
  explicitCampaignRoot: boolean;
} {
  const explicitCampaignRoot = Boolean(env.RELEASE_CAMPAIGN_ROOT?.trim());
  const runId = env.RELEASE_CAMPAIGN_RUN_ID !== undefined
    ? assertSafeReleaseCampaignRunId(env.RELEASE_CAMPAIGN_RUN_ID)
    : defaultRunId;
  const releaseRunsRoot = resolve(env.RELEASE_RUNS_ROOT?.trim() || join('artifacts', 'release-runs'));
  const campaignRoot = explicitCampaignRoot
    ? resolve(env.RELEASE_CAMPAIGN_ROOT!)
    : prepareDefaultReleaseCampaignRoot(runId, { releaseRunsRoot });

  return {
    runId,
    campaignRoot,
    explicitCampaignRoot,
  };
}

export function runReleaseReady(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: ReleaseReadyDependencies = {},
): number {
  const stdout = dependencies.stdout ?? process.stdout;
  const env = dependencies.env ?? process.env;
  const cwd = dependencies.cwd ?? process.cwd();
  const runNpmScript = dependencies.runNpmScript ?? defaultRunNpmScript;
  const gitCleanGuard = dependencies.gitCleanGuard ?? defaultGitCleanGuard;
  const sentinelRunner = dependencies.sentinelRunner ?? defaultSentinelRunner;
  const ownerPreflight = dependencies.ownerPreflight ?? defaultOwnerPreflight;
  const cleanupFinalizerFactory = dependencies.createCleanupFinalizer === undefined
    ? defaultCreateCleanupFinalizer
    : dependencies.createCleanupFinalizer;
  const defaultRunId = timestampRunId();

  const gitGuard = gitCleanGuard(cwd, env);
  if (!gitGuard.ok) {
    stdout.write(renderNotStarted({
      blocker: gitGuard.blocker,
      stage: 'preflight',
      why: gitGuard.why,
      next: 'commit or stash local changes, then run: npm run release:ready',
      logs: gitGuard.inspectCommand,
    }));
    return 1;
  }

  const guardedEnv = {
    ...env,
    AGENTSMITH_RELEASE_READY_GIT_SHA: gitGuard.headSha,
  };
  const preflightEnv = guardedEnv.RELEASE_CAMPAIGN_RUN_ID === undefined
    ? { ...guardedEnv, RELEASE_CAMPAIGN_RUN_ID: defaultRunId }
    : guardedEnv;

  const ownerPreflightEvidencePath = defaultResourceOwnerPreflightEvidencePath({
    target: 'release-ready',
    env: preflightEnv,
    cwd,
  });
  const ownerPreflightResult = ownerPreflight(ownerPreflightEvidencePath, guardedEnv, cwd);
  if (!ownerPreflightResult.ok) {
    stdout.write(renderResourceOwnerPreflightSummary(ownerPreflightResult, {
      title: 'AgentSmith Release Readiness',
      rerunCommand: 'npm run release:ready',
    }));
    return 1;
  }

  let campaignContext: ReturnType<typeof resolveReleaseReadyCampaignContext>;
  try {
    campaignContext = resolveReleaseReadyCampaignContext(guardedEnv, defaultRunId);
  } catch (error) {
    stdout.write(renderNotStarted({
      blocker: 'release_campaign_context',
      stage: 'preflight',
      why: error instanceof Error ? error.message : String(error),
      next: 'fix the release campaign run id, then run: npm run release:ready',
      logs: 'no campaign evidence was produced.',
    }));
    return 1;
  }
  const campaignBaseEnv = {
    ...guardedEnv,
    RELEASE_CAMPAIGN_RUN_ID: campaignContext.runId,
    RELEASE_CAMPAIGN_ROOT: campaignContext.campaignRoot,
  };
  const readiness = createRunReadinessState({
    scope: 'release',
    root: campaignContext.campaignRoot,
    gitSha: gitGuard.headSha,
    input: {
      campaign_root: campaignContext.campaignRoot,
      run_id: campaignContext.runId,
    },
    env: campaignBaseEnv,
  });
  const releaseReadyEnv = {
    ...campaignBaseEnv,
    ...readiness.env,
  };

  const cleanupFinalizer = !releaseReadyCleanupDisabled(releaseReadyEnv) && cleanupFinalizerFactory
    ? cleanupFinalizerFactory({
      cwd,
      env: releaseReadyEnv,
      campaignRoot: campaignContext.campaignRoot,
      runId: campaignContext.runId,
      gitSha: gitGuard.headSha,
    })
    : null;
  let signalCleanupDisposer: (() => void) | null = null;
  if (cleanupFinalizer && isCliEntrypoint('release-ready.ts')) {
    signalCleanupDisposer = armCleanupSignalHandlers(cleanupFinalizer);
  }
  let exitCode = 1;

  try {
    const precheck = runNpmScript('test:release:precheck', [], releaseReadyEnv);

    if (precheck.status !== 0) {
      exitCode = typeof precheck.status === 'number' ? precheck.status : 1;
      stdout.write(renderNotStarted({
        blocker: 'release_precheck',
        stage: 'preflight',
        why: `release precheck failed with ${describeExit(precheck.status, precheck.signal)}.`,
        next: 'fix the release precheck issue, then run: npm run release:ready',
        logs: 'see the release precheck output above.',
      }));
      return exitCode;
    }
    const precheckSummary = readReleasePrecheckSummary({
      runId: campaignContext.runId,
      campaignRoot: campaignContext.campaignRoot,
    });
    if (!precheckSummary.ok) {
      stdout.write(renderNotStarted({
        blocker: 'release_precheck_summary',
        stage: 'preflight',
        why: precheckSummary.error,
        next: 'rerun release precheck through npm run release:ready so the campaign records operational counts.',
        logs: `inspect ${RELEASE_PRECHECK_SUMMARY_RELATIVE_PATH} in the campaign evidence.`,
      }));
      return exitCode;
    }
    updateRunReadinessStateParentObservations({
      statePath: readiness.statePath,
      invocationId: readiness.state.invocation_id,
      processNonce: readiness.state.process_nonce,
      inputDigest: readiness.state.input_digest,
      envDigest: readiness.state.env_digest.digest,
      gitSha: readiness.state.git_sha,
      writerToken: readiness.writerToken,
      services: precheckSummary.observations.services,
      counts: precheckSummary.observations.counts,
    });
    let sentinelResult: SentinelPreflightResult;
    try {
      sentinelResult = sentinelRunner('release-ready', releaseReadyEnv, cwd);
    } catch {
      stdout.write(renderNotStarted({
        blocker: 'sentinel_preflight',
        stage: 'preflight',
        why: 'sentinel preflight unavailable for release-ready.',
        next: 'fix the release-ready sentinel issue, then run: npm run release:ready',
        logs: 'see the sentinel preflight output above.',
      }));
      return exitCode;
    }
    if (sentinelResult.exitCode !== 0) {
      stdout.write(renderSentinelPreflightOutput(sentinelResult.output));
      stdout.write(renderNotStarted({
        blocker: 'sentinel_preflight',
        stage: 'preflight',
        why: 'sentinel preflight failed for release-ready.',
        next: 'fix the release-ready sentinel issue, then run: npm run release:ready',
        logs: 'see the redacted sentinel diagnostic above.',
      }));
      return exitCode;
    }

    const campaignEnv = {
      ...releaseReadyEnv,
      ...buildRunReadinessCampaignOrchestratorEnv({
        statePath: readiness.statePath,
        state: readiness.state,
        writerToken: readiness.writerToken,
      }),
    };

    const campaign = runNpmScript('release:campaign:full', argv, campaignEnv);

    const status = readReleaseStatus({ campaignRoot: campaignContext.campaignRoot });
    const statusExitCode = status.kind === 'ready' ? 0 : 1;
    stdout.write(renderReleaseStatus(status).replace('AgentSmith Release Status', 'AgentSmith Release Readiness'));
    const campaignExitCode = typeof campaign.status === 'number' ? campaign.status : 1;
    exitCode = campaignExitCode === 0 ? statusExitCode : campaignExitCode;
    return exitCode;
  } finally {
    signalCleanupDisposer?.();
    cleanupFinalizer?.finalize(exitCode === 0 ? 'success' : 'failure');
  }
}

function armCleanupSignalHandlers(cleanupFinalizer: ReleaseCleanupFinalizer): () => void {
  const signals = ['SIGINT', 'SIGTERM'] as const;
  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of signals) {
    const handler = (): void => {
      cleanupFinalizer.finalize('interrupted');
      for (const [registeredSignal, registeredHandler] of handlers) {
        process.removeListener(registeredSignal, registeredHandler);
      }
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    handlers.set(signal, handler);
    process.once(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) {
      process.removeListener(signal, handler);
    }
  };
}

function defaultCreateCleanupFinalizer(context: ReleaseReadyCleanupContext): ReleaseCleanupFinalizer {
  return createReleaseCleanupFinalizer({
    cwd: context.cwd,
    env: context.env,
    campaignRoot: context.campaignRoot,
  });
}

function defaultRunNpmScript(
  script: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): NpmScriptResult {
  const result = spawnSync('npm', ['run', script, ...args], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  });
  return {
    status: result.status,
    signal: result.signal,
  };
}

function defaultSentinelRunner(
  profile: SentinelProfile,
  env: NodeJS.ProcessEnv,
  cwd: string,
): SentinelPreflightResult {
  return runSentinelPreflightSync({
    profile,
    env: buildSentinelPreflightEnv({ profile, env, cwd }),
  });
}

function defaultOwnerPreflight(
  evidencePath: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): ResourceOwnerPreflightResult {
  return runResourceOwnerPreflight({
    target: 'release-ready',
    evidencePath,
    env,
    cwd,
  });
}

if (isCliEntrypoint('release-ready.ts')) {
  process.exit(runReleaseReady());
}
