import {
  findCurrentVerificationCampaignById,
} from './current-verification-campaign-manifest';
import {
  assertGovernanceDagTopology,
} from './governance-dag-scheduler';
import {
  runReleaseCampaignExecution,
} from './release-campaign-execution';
import {
  resolveCampaignRoot,
} from './release-campaign-io';

interface ParsedCampaignCliArgs {
  campaignId: string;
  dryRun: boolean;
}

function timestampRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function parseArgs(argv: readonly string[]): ParsedCampaignCliArgs {
  return {
    dryRun: argv.includes('--dry-run'),
    campaignId: argv.find((arg) => !arg.startsWith('--')) ?? 'release-full',
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const campaign = findCurrentVerificationCampaignById(options.campaignId);
  if (!campaign) {
    throw new Error(`Unknown verification campaign: ${options.campaignId}`);
  }

  const runId = process.env.RELEASE_CAMPAIGN_RUN_ID?.trim() || timestampRunId();
  const campaignRoot = resolveCampaignRoot(runId);
  const topology = assertGovernanceDagTopology(campaign.steps.map((step) => ({
    id: step.id,
    dependsOn: step.dependsOn,
    executionMode: step.executionMode,
  })));

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({
      campaign_id: campaign.id,
      run_id: runId,
      campaign_root: campaignRoot,
      scheduler: {
        kind: 'governance_dag_scheduler',
        max_concurrency: 1,
        fail_fast: true,
        levels: topology.levels,
        terminal_job_ids: topology.terminalJobIds,
      },
      steps: campaign.steps.map((step) => ({
        id: step.id,
        gate_id: step.gateId,
        npm_script: step.npmScript,
        command: step.command,
        timeout_ms: step.timeoutMs,
        execution_mode: step.executionMode,
        ...(step.observationPolicy
          ? {
              observation_policy: {
                theme: step.observationPolicy.theme,
                backoff: step.observationPolicy.backoff,
                interval_ms: step.observationPolicy.intervalMs,
                evidence_focus: step.observationPolicy.evidenceFocus,
                state_convergence: step.observationPolicy.stateConvergence,
              },
            }
          : {}),
      })),
    }, null, 2)}\n`);
    return;
  }

  const result = runReleaseCampaignExecution({
    campaign,
    campaignRoot,
    runId,
    cwd: process.cwd(),
    env: process.env,
    maxConcurrency: 1,
  });
  process.exit(result.exitCode);
}

main();
