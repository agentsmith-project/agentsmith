import { spawnSync } from 'node:child_process';
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
  createRunReadinessState,
  resolveReadinessGitSha,
  updateRunReadinessStateField,
} from './run-readiness-state';

type CliWriteStream = {
  write(chunk: string): unknown;
};

type NpmScriptResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
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
  sentinelRunner?: (profile: SentinelProfile, env: NodeJS.ProcessEnv, cwd: string) => SentinelPreflightResult;
  ownerPreflight?: (evidencePath: string, env: NodeJS.ProcessEnv, cwd: string) => ResourceOwnerPreflightResult;
};

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
  const sentinelRunner = dependencies.sentinelRunner ?? defaultSentinelRunner;
  const ownerPreflight = dependencies.ownerPreflight ?? defaultOwnerPreflight;
  const defaultRunId = timestampRunId();
  const preflightEnv = env.RELEASE_CAMPAIGN_RUN_ID === undefined
    ? { ...env, RELEASE_CAMPAIGN_RUN_ID: defaultRunId }
    : env;

  const ownerPreflightEvidencePath = defaultResourceOwnerPreflightEvidencePath({
    target: 'release-ready',
    env: preflightEnv,
    cwd,
  });
  const ownerPreflightResult = ownerPreflight(ownerPreflightEvidencePath, env, cwd);
  if (!ownerPreflightResult.ok) {
    stdout.write(renderResourceOwnerPreflightSummary(ownerPreflightResult, {
      title: 'AgentSmith Release Readiness',
      rerunCommand: 'npm run release:ready',
    }));
    return 1;
  }

  let campaignContext: ReturnType<typeof resolveReleaseReadyCampaignContext>;
  try {
    campaignContext = resolveReleaseReadyCampaignContext(env, defaultRunId);
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
    ...env,
    RELEASE_CAMPAIGN_RUN_ID: campaignContext.runId,
    RELEASE_CAMPAIGN_ROOT: campaignContext.campaignRoot,
  };
  const readiness = createRunReadinessState({
    scope: 'release',
    root: campaignContext.campaignRoot,
    gitSha: resolveReadinessGitSha(cwd),
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

  const precheck = runNpmScript('test:release:precheck', [], releaseReadyEnv);

  if (precheck.status !== 0) {
    const exitCode = typeof precheck.status === 'number' ? precheck.status : 1;
    stdout.write(renderNotStarted({
      blocker: 'release_precheck',
      stage: 'preflight',
      why: `release precheck failed with ${describeExit(precheck.status, precheck.signal)}.`,
      next: 'fix the release precheck issue, then run: npm run release:ready',
      logs: 'see the release precheck output above.',
    }));
    return exitCode;
  }
  updateRunReadinessStateField({
    statePath: readiness.statePath,
    invocationId: readiness.state.invocation_id,
    processNonce: readiness.state.process_nonce,
    inputDigest: readiness.state.input_digest,
    envDigest: readiness.state.env_digest.digest,
    gitSha: readiness.state.git_sha,
    field: 'integration_deps_ready',
    status: 'ready',
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
    return 1;
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
    return 1;
  }

  const campaignEnv = {
    ...releaseReadyEnv,
  };

  const campaign = runNpmScript('release:campaign:full', argv, campaignEnv);

  const status = readReleaseStatus({ campaignRoot: campaignContext.campaignRoot });
  const statusExitCode = status.kind === 'ready' ? 0 : 1;
  stdout.write(renderReleaseStatus(status).replace('AgentSmith Release Status', 'AgentSmith Release Readiness'));
  const campaignExitCode = typeof campaign.status === 'number' ? campaign.status : 1;
  return campaignExitCode === 0 ? statusExitCode : campaignExitCode;
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
