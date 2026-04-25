import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import {
  isDefaultReleaseRunsCampaignRoot,
  readReleaseStatus,
  renderReleaseStatus,
  writeReleaseSummaryForCampaign,
} from './release-summary';

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

function renderNotStarted(reason: string): string {
  return [
    'AgentSmith Release Readiness',
    '',
    'Automated release verdict: NOT STARTED',
    'Blocked before: release campaign',
    `Why: ${reason}`,
    'Next: fix the release precheck issue, then run: npm run release:ready',
    'Evidence: no campaign evidence was produced; no release verdict was written.',
    'Logs: see the release precheck output above.',
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

export function runReleaseReady(argv: readonly string[] = process.argv.slice(2)): number {
  const precheck = spawnSync('npm', ['run', 'test:release:precheck'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (precheck.status !== 0) {
    const exitCode = typeof precheck.status === 'number' ? precheck.status : 1;
    process.stdout.write(renderNotStarted(`release precheck failed with ${describeExit(precheck.status, precheck.signal)}.`));
    return exitCode;
  }

  const campaignContext = resolveReleaseReadyCampaignContext(process.env);
  const campaignEnv = {
    ...process.env,
    RELEASE_CAMPAIGN_RUN_ID: campaignContext.runId,
    RELEASE_CAMPAIGN_ROOT: campaignContext.campaignRoot,
  };

  const campaign = spawnSync('npm', ['run', 'release:campaign:full', ...argv], {
    cwd: process.cwd(),
    env: campaignEnv,
    stdio: 'inherit',
  });

  let statusExitCode = 0;
  try {
    writeReleaseSummaryForCampaign({
      campaignRoot: campaignContext.campaignRoot,
      writeLatest: !campaignContext.explicitCampaignRoot
        && isDefaultReleaseRunsCampaignRoot(campaignContext.campaignRoot),
    });
  } catch (error) {
    statusExitCode = 1;
    process.stderr.write(`[release:ready] failed to write release summary: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  process.stdout.write(renderReleaseStatus(
    readReleaseStatus({ campaignRoot: campaignContext.campaignRoot }),
  ).replace('AgentSmith Release Status', 'AgentSmith Release Readiness'));
  const campaignExitCode = typeof campaign.status === 'number' ? campaign.status : 1;
  return campaignExitCode === 0 ? statusExitCode : campaignExitCode;
}

if (isCliEntrypoint('release-ready.ts')) {
  process.exit(runReleaseReady());
}
