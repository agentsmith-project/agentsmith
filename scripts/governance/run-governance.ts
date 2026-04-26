import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  findCurrentVerificationCampaignById,
} from './current-verification-campaign-manifest';
import {
  writeGovernanceRunSummary,
} from './governance-run-summary';
import {
  buildGovernanceRunPlan,
  GOVERNANCE_RUN_PLAN_FILE_NAME,
  renderGovernanceRunPlanSummary,
  validateGovernanceRunPlan,
  type GovernanceRunPlanValidationFailure,
} from './governance-run-plan';
import {
  assertGovernanceRunGoal,
} from './governance-run-goal-selector';
import {
  resolveCampaignRoot,
  resolveCampaignRunId,
} from './release-campaign-io';
import {
  runReleaseCampaignExecution,
} from './release-campaign-execution';

interface ParsedGovernanceRunArgs {
  subcommand: 'run';
  goal: string;
  reportRoot?: string;
  run: boolean;
  jobId?: string;
}

function isCliEntrypoint(fileName: string): boolean {
  return Boolean(process.argv[1]?.replaceAll('\\', '/').endsWith(`/governance/${fileName}`));
}

function parseGovernanceRunArgs(argv: readonly string[]): ParsedGovernanceRunArgs {
  const [subcommand, ...args] = argv;
  if (subcommand !== 'run') {
    throw new Error('governance runner shell adapter only supports the internal run subcommand.');
  }

  let goal = 'release';
  let reportRoot: string | undefined;
  let run = false;
  let jobId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--goal' && next) {
      goal = next;
      index += 1;
    } else if (arg.startsWith('--goal=')) {
      goal = arg.slice('--goal='.length);
    } else if (arg === '--report-root' && next) {
      reportRoot = next;
      index += 1;
    } else if (arg.startsWith('--report-root=')) {
      reportRoot = arg.slice('--report-root='.length);
    } else if (arg === '--job-id' && next) {
      jobId = next;
      index += 1;
    } else if (arg.startsWith('--job-id=')) {
      jobId = arg.slice('--job-id='.length);
    } else if (arg === '--run') {
      run = true;
    } else {
      throw new Error(`unknown governance runner shell adapter argument: ${arg}`);
    }
  }

  return {
    subcommand,
    goal,
    reportRoot,
    run,
    jobId,
  };
}

function unsupportedRunMessage(goal: string): string {
  return [
    `governance run --goal=${goal} --run is not supported by this plan-only slice.`,
    `Use \`npm run verify -- --goal=${goal} --run\` for non-release execution.`,
    'This adapter only delegates release --run to the release campaign engine.',
  ].join(' ');
}

function timestampRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function hasExplicitCampaignRoot(): boolean {
  return Boolean(process.env.RELEASE_CAMPAIGN_ROOT?.trim());
}

function resolveGovernanceCampaignRunId(campaignRoot: string): string {
  if (!hasExplicitCampaignRoot()) {
    return resolveCampaignRunId(campaignRoot);
  }

  const originalRunId = process.env.RELEASE_CAMPAIGN_RUN_ID;
  delete process.env.RELEASE_CAMPAIGN_RUN_ID;

  try {
    return resolveCampaignRunId(campaignRoot);
  } finally {
    if (originalRunId === undefined) {
      delete process.env.RELEASE_CAMPAIGN_RUN_ID;
    } else {
      process.env.RELEASE_CAMPAIGN_RUN_ID = originalRunId;
    }
  }
}

function withReleaseCampaignEnvironment<T>(input: {
  campaignRoot: string;
  runId: string;
  action: () => T;
}): T {
  const originalRoot = process.env.RELEASE_CAMPAIGN_ROOT;
  const originalRunId = process.env.RELEASE_CAMPAIGN_RUN_ID;

  process.env.RELEASE_CAMPAIGN_ROOT = input.campaignRoot;
  process.env.RELEASE_CAMPAIGN_RUN_ID = input.runId;

  try {
    return input.action();
  } finally {
    if (originalRoot === undefined) {
      delete process.env.RELEASE_CAMPAIGN_ROOT;
    } else {
      process.env.RELEASE_CAMPAIGN_ROOT = originalRoot;
    }
    if (originalRunId === undefined) {
      delete process.env.RELEASE_CAMPAIGN_RUN_ID;
    } else {
      process.env.RELEASE_CAMPAIGN_RUN_ID = originalRunId;
    }
  }
}

function writePlanFile(reportRoot: string, content: string): string {
  mkdirSync(reportRoot, { recursive: true });
  const outputPath = path.join(reportRoot, GOVERNANCE_RUN_PLAN_FILE_NAME);
  writeFileSync(outputPath, content);
  return outputPath;
}

function formatPlanValidationFailure(failure: GovernanceRunPlanValidationFailure): string {
  return `${failure.path}: ${failure.reason}`;
}

function assertValidPlanBeforeWrite(plan: unknown): void {
  const validation = validateGovernanceRunPlan(plan);

  if (!validation.ok) {
    throw new Error([
      'governance runner shell plan validation failed before writing output.',
      ...validation.failures.map(formatPlanValidationFailure),
    ].join(' '));
  }
}

export function runGovernanceCli(argv: readonly string[] = process.argv.slice(2)): number {
  try {
    const options = parseGovernanceRunArgs(argv);
    assertGovernanceRunGoal(options.goal);
    if (!options.reportRoot?.trim()) {
      throw new Error('report root is required for governance runner shell plan output.');
    }
    if (options.run && options.goal !== 'release') {
      throw new Error(unsupportedRunMessage(options.goal));
    }
    if (options.run && options.jobId) {
      throw new Error('partial job execution is not supported for governance run --goal=release --run.');
    }

    const plan = buildGovernanceRunPlan({
      goal: options.goal,
      reportRoot: options.reportRoot,
      jobId: options.jobId,
    });
    assertValidPlanBeforeWrite(plan);
    const outputPath = writePlanFile(options.reportRoot, `${JSON.stringify(plan, null, 2)}\n`);

    process.stdout.write(renderGovernanceRunPlanSummary(plan, outputPath));
    if (options.run) {
      const campaign = findCurrentVerificationCampaignById('release-full');
      if (!campaign) {
        throw new Error('release-full verification campaign is not registered.');
      }

      const requestedRunId = process.env.RELEASE_CAMPAIGN_RUN_ID?.trim() || timestampRunId();
      const campaignRoot = resolveCampaignRoot(requestedRunId);
      const runId = resolveGovernanceCampaignRunId(campaignRoot);
      let exitCode = 1;
      let campaignEngineInvoked = false;
      let campaignExecutionReturned = false;

      try {
        campaignEngineInvoked = true;
        const result = withReleaseCampaignEnvironment({
          campaignRoot,
          runId,
          action: () => runReleaseCampaignExecution({
            campaign,
            campaignRoot,
            runId,
            cwd: process.cwd(),
            env: process.env,
            maxConcurrency: 1,
          }),
        });
        campaignExecutionReturned = true;
        exitCode = result.exitCode;
      } finally {
        const summaryPath = writeGovernanceRunSummary({
          goal: 'release',
          reportRoot: options.reportRoot,
          planSource: outputPath,
          campaignId: 'release-full',
          campaignRoot,
          campaignRunId: runId,
          campaignEngineInvoked,
          campaignExecutionReturned,
        });
        process.stdout.write(`Governance runner audit summary: ${summaryPath}\n`);
      }

      return exitCode;
    }
    return 0;
  } catch (error) {
    process.stderr.write(`[governance-runner] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (isCliEntrypoint('run-governance.ts')) {
  process.exit(runGovernanceCli());
}
