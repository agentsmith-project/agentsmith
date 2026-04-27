import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import {
  readReleaseStatus,
  renderReleaseStatus,
} from './release-summary';
import {
  buildSentinelPreflightEnv,
  renderSentinelPreflightOutput,
  runSentinelPreflightSync,
  type SentinelPreflightResult,
  type SentinelProfile,
} from './sentinel-preflight';

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

function renderNotStarted(reason: string, options: {
  next: string;
  logs: string;
}): string {
  return [
    'AgentSmith Release Readiness',
    '',
    'Automated release verdict: NOT STARTED',
    'Blocked before: release campaign',
    `Why: ${reason}`,
    `Next: ${options.next}`,
    'Evidence: no campaign evidence was produced; no release verdict was written.',
    `Logs: ${options.logs}`,
    '',
  ].join('\n');
}

function timestampRunId(): string {
  return `release-ready-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

function resolveReleaseReadyCampaignContext(env: NodeJS.ProcessEnv): {
  runId: string;
  campaignRoot: string;
  explicitCampaignRoot: boolean;
} {
  const explicitCampaignRoot = Boolean(env.RELEASE_CAMPAIGN_ROOT?.trim());
  const runId = env.RELEASE_CAMPAIGN_RUN_ID?.trim() || timestampRunId();
  const releaseRunsRoot = resolve(env.RELEASE_RUNS_ROOT?.trim() || join('artifacts', 'release-runs'));
  const campaignRoot = explicitCampaignRoot
    ? resolve(env.RELEASE_CAMPAIGN_ROOT!)
    : join(releaseRunsRoot, runId);

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

  const precheck = runNpmScript('test:release:precheck', [], env);

  if (precheck.status !== 0) {
    const exitCode = typeof precheck.status === 'number' ? precheck.status : 1;
    stdout.write(renderNotStarted(`release precheck failed with ${describeExit(precheck.status, precheck.signal)}.`, {
      next: 'fix the release precheck issue, then run: npm run release:ready',
      logs: 'see the release precheck output above.',
    }));
    return exitCode;
  }

  let sentinelResult: SentinelPreflightResult;
  try {
    sentinelResult = sentinelRunner('release-ready', env, cwd);
  } catch {
    stdout.write(renderNotStarted('sentinel preflight unavailable for release-ready.', {
      next: 'fix the release-ready sentinel issue, then run: npm run release:ready',
      logs: 'see the sentinel preflight output above.',
    }));
    return 1;
  }
  if (sentinelResult.exitCode !== 0) {
    stdout.write(renderSentinelPreflightOutput(sentinelResult.output));
    stdout.write(renderNotStarted('sentinel preflight failed for release-ready.', {
      next: 'fix the release-ready sentinel issue, then run: npm run release:ready',
      logs: 'see the redacted sentinel diagnostic above.',
    }));
    return 1;
  }

  const campaignContext = resolveReleaseReadyCampaignContext(env);
  const campaignEnv = {
    ...env,
    RELEASE_CAMPAIGN_RUN_ID: campaignContext.runId,
    RELEASE_CAMPAIGN_ROOT: campaignContext.campaignRoot,
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

if (isCliEntrypoint('release-ready.ts')) {
  process.exit(runReleaseReady());
}
