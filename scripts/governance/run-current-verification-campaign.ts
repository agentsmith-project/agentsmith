import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  findCurrentVerificationCampaignById,
  type CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';
import {
  evaluateTerminalAggregateOutcome,
  writeTerminalAggregateFallbackResult,
} from './release-campaign-runner';
import {
  nativeResultPath,
  resolveCampaignRoot,
  stepDir,
  tryReadGateResult,
  writeCampaignEvidencePointer,
  writeCampaignGateResult,
} from './release-campaign-io';
import type { CurrentGateResultFailureClass } from './current-gate-result-schema';

function timestampRunId(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function commandEnv(campaignRoot: string, runId: string, step: CurrentVerificationCampaignStep): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RELEASE_CAMPAIGN_RUN_ID: runId,
    RELEASE_CAMPAIGN_ROOT: campaignRoot,
  };
  const nativePath = nativeResultPath(campaignRoot, step);

  if (step.nativeResult && nativePath) {
    env.CURRENT_GATE_RESULT_GATE_ID = step.nativeResult.gateId;
    env.CURRENT_GATE_RESULT_NPM_SCRIPT = step.nativeResult.npmScript ?? step.npmScript;
    env.CURRENT_GATE_RESULT_LINE_KIND = step.lineKind;
    env.CURRENT_GATE_RESULT_EVIDENCE_DIR = join(nativePath, '..');
  }

  if (step.id === 'lane-visual') {
    env.MOCK_RUN_ID = runId;
    env.VISUAL_BASELINE_REVIEW_ROOT = join(stepDir(campaignRoot, step), 'visual-baseline-reviews');
  }

  if (step.id === 'gate-release') {
    const gateReleaseDir = stepDir(campaignRoot, step);
    env.RELEASE_REAL_VISUAL_RUN_ID = runId;
    env.RELEASE_REAL_VISUAL_ARTIFACT_DIR = join(gateReleaseDir, 'backend-real-visual');
    env.RELEASE_REAL_RUN_ROOT = join(gateReleaseDir, 'backend-real-run');
    env.RELEASE_REAL_READY_LOG_DIR = join(gateReleaseDir, 'native');
    env.CURRENT_GATE_RESULT_GATE_ID = 'lane-backend-real-release';
    env.CURRENT_GATE_RESULT_NPM_SCRIPT = 'lane:backend-real:release';
    env.CURRENT_GATE_RESULT_LINE_KIND = 'release_backend_real';
  }

  if (step.id === 'lane-demo-rehearsal') {
    env.SCENARIO_RUNTIME_ROOT = join(campaignRoot, 'scenario-runtime');
    env.DEMO_REHEARSAL_ROOT = join(stepDir(campaignRoot, step), 'scenario');
  }

  if (step.id === 'lane-cluster-rehearsal') {
    env.SCENARIO_RUNTIME_ROOT = join(campaignRoot, 'scenario-runtime');
    env.CLUSTER_REHEARSAL_ROOT = join(stepDir(campaignRoot, step), 'scenario');
  }

  return env;
}

function nativeFailureClass(campaignRoot: string, step: CurrentVerificationCampaignStep): CurrentGateResultFailureClass {
  const path = nativeResultPath(campaignRoot, step);
  if (!path) {
    return step.defaultFailureClass;
  }
  const result = tryReadGateResult(path);
  const failureClass = result.value?.failure_class;
  if (
    failureClass === 'none'
    || failureClass === 'product_regression'
    || failureClass === 'infra_setup_failure'
    || failureClass === 'environment_conflict'
    || failureClass === 'contract_drift'
    || failureClass === 'evidence_missing'
  ) {
    return failureClass === 'none' ? step.defaultFailureClass : failureClass;
  }
  return step.defaultFailureClass;
}

function validateNativeResult(campaignRoot: string, step: CurrentVerificationCampaignStep): string | null {
  const path = nativeResultPath(campaignRoot, step);
  if (!step.nativeResult || !path) {
    return null;
  }
  const result = tryReadGateResult(path);
  if (!result.ok || !result.value) {
    return `native result for ${step.id} is missing or malformed: ${result.error ?? path}`;
  }
  if (result.value.gate_id !== step.nativeResult.gateId) {
    return `native result for ${step.id} has gate_id ${String(result.value.gate_id)} instead of ${step.nativeResult.gateId}`;
  }
  if (result.value.status !== 'passed') {
    return `native result for ${step.id} status is ${String(result.value.status)}`;
  }
  return null;
}

function writeCompletedStep(campaignRoot: string, step: CurrentVerificationCampaignStep, exitStatus: number): boolean {
  let evidenceComplete = true;
  const nativeError = validateNativeResult(campaignRoot, step);
  if (step.evidenceRequired) {
    const evidence = writeCampaignEvidencePointer(campaignRoot, step);
    evidenceComplete = evidence.required_paths.every((candidate) => candidate.exists)
      && (!evidence.native_result || (evidence.native_result.exists && !evidence.native_result.error));
  }

  if (nativeError || !evidenceComplete) {
    writeCampaignGateResult({
      step,
      campaignRoot,
      status: 'failed',
      failureClass: nativeError ? 'contract_drift' : 'evidence_missing',
      stage: 'evidence',
      summary: nativeError
        ? `Release campaign step ${step.id} completed but ${nativeError}.`
        : `Release campaign step ${step.id} completed but required evidence was missing.`,
    });
    return false;
  }

  writeCampaignGateResult({
    step,
    campaignRoot,
    status: exitStatus === 0 ? 'passed' : 'failed',
    failureClass: exitStatus === 0 ? 'none' : nativeFailureClass(campaignRoot, step),
    stage: exitStatus === 0 ? 'complete' : 'execute',
    summary: exitStatus === 0
      ? `Release campaign step ${step.id} passed.`
      : `Release campaign step ${step.id} failed with exit code ${String(exitStatus)}.`,
  });
  return exitStatus === 0;
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const campaignId = args.find((arg) => !arg.startsWith('--')) ?? 'release-full';
  const campaign = findCurrentVerificationCampaignById(campaignId);
  if (!campaign) {
    throw new Error(`Unknown verification campaign: ${campaignId}`);
  }

  const runId = process.env.RELEASE_CAMPAIGN_RUN_ID?.trim() || timestampRunId();
  const campaignRoot = resolveCampaignRoot(runId);

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({
      campaign_id: campaign.id,
      run_id: runId,
      campaign_root: campaignRoot,
      steps: campaign.steps.map((step) => ({
        id: step.id,
        gate_id: step.gateId,
        npm_script: step.npmScript,
        command: step.command,
        execution_mode: step.executionMode,
      })),
    }, null, 2)}\n`);
    return;
  }

  let failed = false;
  for (const step of campaign.steps) {
    if (step.executionMode === 'aggregate_only') {
      continue;
    }
    if (failed) {
      break;
    }

    const result = spawnSync('npm', ['run', step.npmScript], {
      cwd: process.cwd(),
      env: commandEnv(campaignRoot, runId, step),
      stdio: 'inherit',
    });

    if (result.status === 0) {
      failed = !writeCompletedStep(campaignRoot, step, 0);
      continue;
    }

    if (step.evidenceRequired) {
      writeCampaignEvidencePointer(campaignRoot, step);
    }
    writeCampaignGateResult({
      step,
      campaignRoot,
      status: 'failed',
      failureClass: nativeFailureClass(campaignRoot, step),
      stage: 'execute',
      summary: `Release campaign step ${step.id} failed with exit code ${String(result.status ?? 'unknown')}.`,
    });
    failed = true;
  }

  const terminalStep = campaign.steps.find((step) => step.executionMode === 'aggregate_only');
  if (!terminalStep) {
    throw new Error(`Campaign ${campaign.id} is missing an aggregate-only terminal verdict step.`);
  }

  const aggregate = spawnSync('npm', ['run', terminalStep.npmScript], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      RELEASE_CAMPAIGN_RUN_ID: runId,
      RELEASE_CAMPAIGN_ROOT: campaignRoot,
    },
    stdio: 'inherit',
  });

  const aggregateOutcome = evaluateTerminalAggregateOutcome({
    terminalStepId: terminalStep.id,
    hadExecutableStepFailure: failed,
    aggregateResult: aggregate,
  });
  writeTerminalAggregateFallbackResult({
    campaignRoot,
    terminalStep,
    outcome: aggregateOutcome,
  });

  process.exit(aggregateOutcome.exitCode);
}

main();
