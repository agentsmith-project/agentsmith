import { spawnSync, type StdioOptions } from 'node:child_process';
import { join, resolve } from 'node:path';

import type { CurrentGateResultFailureClass } from './current-gate-result-schema';
import type {
  CurrentVerificationCampaignDefinition,
  CurrentVerificationCampaignStep,
} from './current-verification-campaign-manifest';
import {
  listCurrentResourceLocks,
  type CurrentResourceLockCategory,
  type CurrentResourceLockDefinition,
} from './current-resource-lock-manifest';
import {
  buildExclusiveLeaseRequest,
  buildReleaseCampaignRootLeaseRequest,
  buildReleaseCampaignStepOutputLeaseRequest,
  GovernanceLockLeaseManager,
  type GovernanceRuntimeLockLeaseRequest,
} from './governance-lock-lease-manager';
import {
  runGovernanceDagScheduler,
  type GovernanceDagAdapterOutcome,
  type GovernanceDagSchedulerJob,
  type GovernanceDagSkipReason,
} from './governance-dag-scheduler';
import {
  evaluateTerminalAggregateOutcome,
  type ReleaseCampaignSpawnResult,
  type TerminalAggregateOutcome,
  writeTerminalAggregateFallbackResult,
} from './release-campaign-runner';
import {
  nativeResultPath,
  prepareReleaseCampaignRootForWrite,
  resultPath,
  stepDir,
  tryReadGateResult,
  writeCampaignEvidencePointer,
  writeCampaignGateResult,
} from './release-campaign-io';
import {
  isDefaultReleaseRunsCampaignRoot,
  writeReleaseSummaryForCampaign,
} from './release-summary';
import {
  ensureRunReadinessState,
  resolveReadinessGitSha,
} from './run-readiness-state';

export interface BuildReleaseCampaignCommandEnvInput {
  campaignRoot: string;
  runId: string;
  step: CurrentVerificationCampaignStep;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface ReleaseCampaignExecutionInput {
  campaign: CurrentVerificationCampaignDefinition;
  campaignRoot: string;
  runId: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  maxConcurrency?: number;
  lockManager?: GovernanceLockLeaseManager;
  writeSummary?: boolean;
}

export interface ReleaseCampaignExecutionResult {
  exitCode: number;
  terminalOutcome: TerminalAggregateOutcome;
}

interface CampaignStepWriteOutcome {
  passed: boolean;
  failureClass: CurrentGateResultFailureClass;
}

interface AcquiredLeases {
  ok: true;
  leaseIds: readonly string[];
}

interface LeaseConflict {
  ok: false;
  failureClass: CurrentGateResultFailureClass;
  summary: string;
}

type StepLeaseResult = AcquiredLeases | LeaseConflict;

const STEP_SPECIFIC_AGGREGATE_ENV_KEYS = [
  'DEFAULT_GATE_PROFILE',
  'DEFAULT_GATE_REUSE_FAST_EVIDENCE',
  'WORKSPACE_PROJECT_DEFAULT_GATE_SKIP_FOCUSED_VISUAL',
  'GOVERNANCE_DEFAULT_GATE_SKIP_FOCUSED_VISUAL',
  'BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE',
  'AGENT_TASK_REAL_SMOKE_SKIP_SHARED_PREFLIGHT',
  'MOCK_RUN_ID',
  'VISUAL_BASELINE_REVIEW_ROOT',
  'RELEASE_REAL_VISUAL_RUN_ID',
  'RELEASE_REAL_VISUAL_ARTIFACT_DIR',
  'RELEASE_REAL_RUN_ROOT',
  'RELEASE_REAL_READY_LOG_DIR',
  'UNIFIED_DEPLOY_RELEASE_ROOT_DIR',
  'UNIFIED_DEPLOY_RELEASE_SITE_ENV',
  'UNIFIED_DEPLOY_AGENT_TASK_POLLS',
  'UNIFIED_DEPLOY_AGENT_TASK_POLL_INTERVAL_MS',
  'LOCAL_RUNTIME_LINE_KIND',
  'LOCAL_RUNTIME_OWNER_TOKEN',
] as const;

const STEP_SPECIFIC_AGGREGATE_ENV_PREFIXES = [
  'CURRENT_GATE_RESULT_',
] as const;

const RUNTIME_LEASE_CATEGORIES = new Set<CurrentResourceLockCategory>([
  'substrate',
  'lifecycle',
  'port',
  'provider_quota',
  'secret_profile',
  'visual_baseline',
]);

const RUNTIME_LEASE_EXCLUDED_LOCK_IDS = new Set([
  'release-campaign-root-writes',
  'release-latest-pointer',
]);

function nativeResultFailureClass(campaignRoot: string, step: CurrentVerificationCampaignStep): CurrentGateResultFailureClass {
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

function writtenFailureClass(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
): CurrentGateResultFailureClass {
  const result = tryReadGateResult(resultPath(campaignRoot, step));
  const failureClass = result.value?.failure_class;
  if (
    failureClass === 'product_regression'
    || failureClass === 'infra_setup_failure'
    || failureClass === 'environment_conflict'
    || failureClass === 'contract_drift'
    || failureClass === 'evidence_missing'
  ) {
    return failureClass;
  }
  return step.defaultFailureClass;
}

function isNonNoneFailureClass(value: unknown): value is Exclude<CurrentGateResultFailureClass, 'none'> {
  return value === 'product_regression'
    || value === 'infra_setup_failure'
    || value === 'environment_conflict'
    || value === 'contract_drift'
    || value === 'evidence_missing';
}

function evidenceFailureClass(
  evidence: ReturnType<typeof writeCampaignEvidencePointer> | null,
): CurrentGateResultFailureClass {
  if (!evidence) {
    return 'evidence_missing';
  }

  const explicitFailure = evidence.required_paths.find((candidate) =>
    !candidate.exists && isNonNoneFailureClass(candidate.failure_class),
  )?.failure_class;
  if (isNonNoneFailureClass(explicitFailure)) {
    return explicitFailure;
  }

  if (evidence.native_result && (!evidence.native_result.exists || evidence.native_result.error)) {
    return 'evidence_missing';
  }

  return 'evidence_missing';
}

function writeCompletedStep(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  exitStatus: number,
): CampaignStepWriteOutcome {
  let evidenceComplete = true;
  let evidence: ReturnType<typeof writeCampaignEvidencePointer> | null = null;
  const nativeError = validateNativeResult(campaignRoot, step);
  if (step.evidenceRequired) {
    evidence = writeCampaignEvidencePointer(campaignRoot, step);
    evidenceComplete = evidence.required_paths.every((candidate) => candidate.exists)
      && (!evidence.native_result || (evidence.native_result.exists && !evidence.native_result.error));
  }

  if (nativeError || !evidenceComplete) {
    const failureClass = nativeError ? 'contract_drift' : evidenceFailureClass(evidence);
    writeCampaignGateResult({
      step,
      campaignRoot,
      status: 'failed',
      failureClass,
      stage: 'evidence',
      summary: nativeError
        ? `Release campaign step ${step.id} completed but ${nativeError}.`
        : `Release campaign step ${step.id} completed but required evidence was missing.`,
    });
    return {
      passed: false,
      failureClass,
    };
  }

  writeCampaignGateResult({
    step,
    campaignRoot,
    status: exitStatus === 0 ? 'passed' : 'failed',
    failureClass: exitStatus === 0 ? 'none' : nativeResultFailureClass(campaignRoot, step),
    stage: exitStatus === 0 ? 'complete' : 'execute',
    summary: exitStatus === 0
      ? `Release campaign step ${step.id} passed.`
      : `Release campaign step ${step.id} failed with exit code ${String(exitStatus)}.`,
  });
  return {
    passed: exitStatus === 0,
    failureClass: exitStatus === 0 ? 'none' : nativeResultFailureClass(campaignRoot, step),
  };
}

function writeSkippedStep(
  campaignRoot: string,
  step: CurrentVerificationCampaignStep,
  reason: GovernanceDagSkipReason,
): void {
  if (step.evidenceRequired) {
    writeCampaignEvidencePointer(campaignRoot, step);
  }
  writeCampaignGateResult({
    step,
    campaignRoot,
    status: 'failed',
    failureClass: reason.failureClass,
    stage: 'skipped',
    summary: reason.summary,
  });
}

export function buildReleaseCampaignCommandEnv(
  input: BuildReleaseCampaignCommandEnvInput,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(input.baseEnv ?? process.env),
    RELEASE_CAMPAIGN_RUN_ID: input.runId,
    RELEASE_CAMPAIGN_ROOT: input.campaignRoot,
  };
  const nativePath = nativeResultPath(input.campaignRoot, input.step);

  if (input.step.nativeResult && nativePath) {
    env.CURRENT_GATE_RESULT_GATE_ID = input.step.nativeResult.gateId;
    env.CURRENT_GATE_RESULT_NPM_SCRIPT = input.step.nativeResult.npmScript ?? input.step.npmScript;
    env.CURRENT_GATE_RESULT_LINE_KIND = input.step.lineKind;
    env.CURRENT_GATE_RESULT_EVIDENCE_DIR = join(nativePath, '..');
  }

  if (input.step.id === 'gate-default') {
    env.DEFAULT_GATE_PROFILE = 'campaign_after_gate_fast';
    env.DEFAULT_GATE_REUSE_FAST_EVIDENCE = '1';
    const releaseRoot = join(input.campaignRoot, 'unified-deploy');
    env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR = releaseRoot;
    env.UNIFIED_DEPLOY_RELEASE_SITE_ENV = join(releaseRoot, 'local-kind-site.env');
  }

  if (input.step.id === 'lane-visual') {
    env.MOCK_RUN_ID = input.runId;
    env.VISUAL_BASELINE_REVIEW_ROOT = join(stepDir(input.campaignRoot, input.step), 'visual-baseline-reviews');
  }

  if (input.step.id === 'gate-release') {
    const gateReleaseDir = stepDir(input.campaignRoot, input.step);
    env.BACKEND_REAL_REUSE_DEFAULT_GATE_EVIDENCE = '1';
    env.RELEASE_REAL_VISUAL_RUN_ID = input.runId;
    env.RELEASE_REAL_VISUAL_ARTIFACT_DIR = join(gateReleaseDir, 'backend-real-visual');
    env.RELEASE_REAL_RUN_ROOT = join(gateReleaseDir, 'backend-real-run');
    env.RELEASE_REAL_READY_LOG_DIR = join(gateReleaseDir, 'native');
    env.CURRENT_GATE_RESULT_GATE_ID = 'lane-backend-real-release';
    env.CURRENT_GATE_RESULT_NPM_SCRIPT = 'lane:backend-real:release';
    env.CURRENT_GATE_RESULT_LINE_KIND = 'release_backend_real';
  }

  if (input.step.id.startsWith('lane-unified-deploy-')) {
    const releaseRoot = join(input.campaignRoot, 'unified-deploy');
    env.UNIFIED_DEPLOY_RELEASE_ROOT_DIR = releaseRoot;
    env.UNIFIED_DEPLOY_RELEASE_SITE_ENV = join(releaseRoot, 'local-kind-site.env');
  }

  return env;
}

export function buildReleaseCampaignAggregateEnv(input: {
  campaignRoot: string;
  runId: string;
  baseEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...(input.baseEnv ?? process.env),
  };

  for (const key of Object.keys(env)) {
    if (STEP_SPECIFIC_AGGREGATE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete env[key];
    }
  }
  for (const key of STEP_SPECIFIC_AGGREGATE_ENV_KEYS) {
    delete env[key];
  }

  env.RELEASE_CAMPAIGN_RUN_ID = input.runId;
  env.RELEASE_CAMPAIGN_ROOT = input.campaignRoot;
  return env;
}

function schedulerJobs(campaign: CurrentVerificationCampaignDefinition): readonly GovernanceDagSchedulerJob[] {
  return campaign.steps.map((step) => ({
    id: step.id,
    dependsOn: step.dependsOn,
    executionMode: step.executionMode,
  }));
}

function spawnNpmScript(input: {
  npmScript: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio: StdioOptions;
}): ReleaseCampaignSpawnResult {
  return spawnSync('npm', ['run', input.npmScript], {
    cwd: input.cwd,
    env: input.env,
    stdio: input.stdio,
  });
}

function acquireLeases(
  lockManager: GovernanceLockLeaseManager,
  requests: readonly GovernanceRuntimeLockLeaseRequest[],
): StepLeaseResult {
  const leaseIds: string[] = [];
  for (const request of requests) {
    const acquire = lockManager.acquire(request);
    if (!acquire.ok) {
      lockManager.releaseMany(leaseIds);
      return {
        ok: false,
        failureClass: 'environment_conflict',
        summary: `Release campaign lock conflict for ${request.ownerStepId}: ${acquire.conflict.reason}`,
      };
    }
    leaseIds.push(acquire.lease.leaseId);
  }

  return {
    ok: true,
    leaseIds,
  };
}

function baseStepLeaseRequests(input: {
  campaignId: string;
  runId: string;
  campaignRoot: string;
  stepId: string;
}): readonly GovernanceRuntimeLockLeaseRequest[] {
  const attemptId = `${input.runId}:${input.stepId}`;
  return [
    buildReleaseCampaignRootLeaseRequest({
      campaignId: input.campaignId,
      runId: input.runId,
      campaignRoot: input.campaignRoot,
      stepId: input.stepId,
      attemptId,
    }),
    buildReleaseCampaignStepOutputLeaseRequest({
      campaignId: input.campaignId,
      runId: input.runId,
      campaignRoot: input.campaignRoot,
      stepId: input.stepId,
      attemptId,
    }),
  ];
}

function stepGateIds(step: CurrentVerificationCampaignStep): ReadonlySet<string> {
  return new Set([
    step.gateId,
    ...(step.nativeResult?.gateId ? [step.nativeResult.gateId] : []),
  ]);
}

function stepNpmScripts(step: CurrentVerificationCampaignStep): ReadonlySet<string> {
  return new Set([
    step.npmScript,
    ...(step.nativeResult?.npmScript ? [step.nativeResult.npmScript] : []),
  ]);
}

function lockAppliesToStep(
  lock: CurrentResourceLockDefinition,
  step: CurrentVerificationCampaignStep,
): boolean {
  const gateIds = stepGateIds(step);
  const npmScripts = stepNpmScripts(step);

  return Boolean(
    lock.appliesTo.gateIds?.some((gateId) => gateIds.has(gateId))
      || lock.appliesTo.npmScripts?.some((npmScript) => npmScripts.has(npmScript)),
  );
}

function runtimeLockScopeKind(
  lock: CurrentResourceLockDefinition,
): GovernanceRuntimeLockLeaseRequest['scopeKind'] | null {
  switch (lock.category) {
    case 'substrate':
    case 'lifecycle':
    case 'port':
      return 'local_host';
    case 'provider_quota':
    case 'secret_profile':
      return 'provider_profile';
    case 'visual_baseline':
      return 'visual_baseline';
    default:
      return null;
  }
}

function providerProfileScopeKey(
  lock: CurrentResourceLockDefinition,
  step: CurrentVerificationCampaignStep,
): string {
  if (
    lock.id === 'backend-real-provider-quota'
    && (step.gateId === 'gate-release' || step.nativeResult?.gateId === 'lane-backend-real-release')
  ) {
    return 'backend-real-release';
  }
  if (
    lock.id === 'provider-secret-profile'
    && (step.gateId === 'gate-release' || step.nativeResult?.gateId === 'lane-backend-real-release')
  ) {
    return 'backend-real-managed-secret';
  }

  return lock.appliesTo.providerProfiles?.[0] ?? lock.id;
}

function runtimeLockScopeKey(
  lock: CurrentResourceLockDefinition,
  step: CurrentVerificationCampaignStep,
): string {
  switch (lock.category) {
    case 'substrate':
    case 'lifecycle':
    case 'port':
      return `local-host:${lock.id}`;
    case 'provider_quota':
    case 'secret_profile':
      return providerProfileScopeKey(lock, step);
    case 'visual_baseline':
      return `repo:${lock.id}`;
    default:
      return lock.id;
  }
}

function shouldProjectRuntimeLock(
  lock: CurrentResourceLockDefinition,
  step: CurrentVerificationCampaignStep,
): boolean {
  return lock.mode === 'exclusive'
    && !RUNTIME_LEASE_EXCLUDED_LOCK_IDS.has(lock.id)
    && RUNTIME_LEASE_CATEGORIES.has(lock.category)
    && lockAppliesToStep(lock, step)
    && runtimeLockScopeKind(lock) !== null;
}

export function buildReleaseCampaignRuntimeLeaseRequests(input: {
  campaignId: string;
  runId: string;
  campaignRoot: string;
  step: CurrentVerificationCampaignStep;
}): readonly GovernanceRuntimeLockLeaseRequest[] {
  const baseRequests = baseStepLeaseRequests({
    campaignId: input.campaignId,
    runId: input.runId,
    campaignRoot: input.campaignRoot,
    stepId: input.step.id,
  });
  const ownerGroup = `${input.campaignId}|${input.runId}|${resolve(input.campaignRoot)}`;
  const ownerAttemptId = `${input.runId}:${input.step.id}`;

  const runtimeRequests = listCurrentResourceLocks()
    .filter((lock) => shouldProjectRuntimeLock(lock, input.step))
    .map((lock) => {
      const scopeKind = runtimeLockScopeKind(lock);
      if (!scopeKind) {
        throw new Error(`Current resource lock ${lock.id} does not have a runtime lease scope mapping.`);
      }
      return buildExclusiveLeaseRequest({
        lockId: lock.id,
        scopeKind,
        scopeKey: runtimeLockScopeKey(lock, input.step),
        ownerGroup,
        ownerAttemptId,
        ownerStepId: input.step.id,
      });
    });

  return [
    ...baseRequests,
    ...runtimeRequests,
  ];
}

function releaseLatestPointerLeaseRequest(input: {
  campaignId: string;
  runId: string;
  campaignRoot: string;
}): GovernanceRuntimeLockLeaseRequest {
  return buildExclusiveLeaseRequest({
    lockId: 'release-latest-pointer',
    scopeKind: 'release_latest',
    scopeKey: resolve('artifacts', 'release-runs', 'latest.json'),
    ownerGroup: `${input.campaignId}|${input.runId}|${resolve(input.campaignRoot)}`,
    ownerAttemptId: `${input.runId}:release-summary-finalize`,
    ownerStepId: 'release-summary-finalize',
  });
}

function failedAdapterOutcome(
  failureClass: CurrentGateResultFailureClass,
  summary: string,
): GovernanceDagAdapterOutcome {
  return {
    status: 'failed',
    failureClass,
    summary,
  };
}

export function runReleaseCampaignExecution(input: ReleaseCampaignExecutionInput): ReleaseCampaignExecutionResult {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? process.env;
  const stdio = input.stdio ?? 'inherit';
  const lockManager = input.lockManager ?? new GovernanceLockLeaseManager();
  const campaignRoot = prepareReleaseCampaignRootForWrite({
    campaignRoot: input.campaignRoot,
    runId: input.runId,
    env,
  });
  const campaignIdentityEnv: NodeJS.ProcessEnv = {
    ...env,
    RELEASE_CAMPAIGN_RUN_ID: input.runId,
    RELEASE_CAMPAIGN_ROOT: campaignRoot,
  };
  const readiness = ensureRunReadinessState({
    scope: 'release',
    root: campaignRoot,
    gitSha: resolveReadinessGitSha(cwd),
    input: {
      campaign_root: campaignRoot,
      run_id: input.runId,
    },
    env: campaignIdentityEnv,
  });
  const campaignExecutionEnv: NodeJS.ProcessEnv = {
    ...campaignIdentityEnv,
    ...readiness.env,
  };
  const stepById = new Map(input.campaign.steps.map((step) => [step.id, step]));
  const terminalStep = input.campaign.steps.find((step) => step.executionMode === 'aggregate_only');
  if (!terminalStep) {
    throw new Error(`Campaign ${input.campaign.id} is missing an aggregate-only terminal verdict step.`);
  }

  let hadExecutableStepFailure = false;
  const terminalState: { outcome: TerminalAggregateOutcome | null } = {
    outcome: null,
  };

  runGovernanceDagScheduler({
    jobs: schedulerJobs(input.campaign),
    maxConcurrency: input.maxConcurrency ?? 1,
    failFast: true,
    adapter: {
      execute: ({ job }) => {
        const step = stepById.get(job.id);
        if (!step) {
          throw new Error(`Unknown release campaign step: ${job.id}`);
        }

        const leaseResult = acquireLeases(
          lockManager,
          buildReleaseCampaignRuntimeLeaseRequests({
            campaignId: input.campaign.id,
            runId: input.runId,
            campaignRoot,
            step,
          }),
        );
        if (!leaseResult.ok) {
          if (step.executionMode !== 'aggregate_only') {
            if (step.evidenceRequired) {
              writeCampaignEvidencePointer(campaignRoot, step);
            }
            writeCampaignGateResult({
              step,
              campaignRoot,
              status: 'failed',
              failureClass: leaseResult.failureClass,
              stage: 'execute',
              summary: leaseResult.summary,
            });
            hadExecutableStepFailure = true;
          }
          return failedAdapterOutcome(leaseResult.failureClass, leaseResult.summary);
        }

        try {
          if (step.executionMode === 'aggregate_only') {
            const aggregate = spawnNpmScript({
              npmScript: step.npmScript,
              cwd,
              env: buildReleaseCampaignAggregateEnv({
                campaignRoot,
                runId: input.runId,
                baseEnv: campaignExecutionEnv,
              }),
              stdio,
            });

            terminalState.outcome = evaluateTerminalAggregateOutcome({
              terminalStepId: step.id,
              hadExecutableStepFailure,
              aggregateResult: aggregate,
            });
            writeTerminalAggregateFallbackResult({
              campaignRoot,
              terminalStep: step,
              outcome: terminalState.outcome,
            });

            return {
              status: terminalState.outcome.exitCode === 0 ? 'passed' : 'failed',
              failureClass: terminalState.outcome.failureClass,
              summary: terminalState.outcome.summary,
            };
          }

          const result = spawnNpmScript({
            npmScript: step.npmScript,
            cwd,
            env: buildReleaseCampaignCommandEnv({
              campaignRoot,
              runId: input.runId,
              step,
              baseEnv: campaignExecutionEnv,
            }),
            stdio,
          });

          if (result.status === 0) {
            const outcome = writeCompletedStep(campaignRoot, step, 0);
            if (!outcome.passed) {
              hadExecutableStepFailure = true;
            }
            return {
              status: outcome.passed ? 'passed' : 'failed',
              failureClass: outcome.failureClass,
              summary: outcome.passed
                ? `Release campaign step ${step.id} passed.`
                : `Release campaign step ${step.id} failed during evidence validation.`,
            };
          }

          if (step.evidenceRequired) {
            writeCampaignEvidencePointer(campaignRoot, step);
          }
          writeCampaignGateResult({
            step,
            campaignRoot,
            status: 'failed',
            failureClass: nativeResultFailureClass(campaignRoot, step),
            stage: 'execute',
            summary: `Release campaign step ${step.id} failed with exit code ${String(result.status ?? 'unknown')}.`,
          });
          hadExecutableStepFailure = true;
          return {
            status: 'failed',
            failureClass: writtenFailureClass(campaignRoot, step),
            summary: `Release campaign step ${step.id} failed with exit code ${String(result.status ?? 'unknown')}.`,
          };
        } finally {
          lockManager.releaseMany(leaseResult.leaseIds);
        }
      },
      skip: ({ job, reason }) => {
        const step = stepById.get(job.id);
        if (!step) {
          throw new Error(`Unknown release campaign step: ${job.id}`);
        }
        if (step.executionMode === 'aggregate_only') {
          throw new Error('Release campaign terminal aggregate must not be skipped.');
        }
        writeSkippedStep(campaignRoot, step, reason);
        hadExecutableStepFailure = true;
        return {
          status: 'failed',
          failureClass: reason.failureClass,
          summary: reason.summary,
        };
      },
    },
  });

  const completedTerminalOutcome = terminalState.outcome;
  if (!completedTerminalOutcome) {
    throw new Error(`Campaign ${input.campaign.id} did not execute terminal aggregate ${terminalStep.id}.`);
  }

  if (input.writeSummary ?? true) {
    let latestLeaseIds: readonly string[] = [];
    const shouldWriteLatest = isDefaultReleaseRunsCampaignRoot(campaignRoot);
    if (shouldWriteLatest) {
      const latestLease = acquireLeases(lockManager, [
        releaseLatestPointerLeaseRequest({
          campaignId: input.campaign.id,
          runId: input.runId,
          campaignRoot,
        }),
      ]);
      if (!latestLease.ok) {
        throw new Error(latestLease.summary);
      }
      latestLeaseIds = latestLease.leaseIds;
    }

    try {
      writeReleaseSummaryForCampaign({
        campaignRoot,
        writeLatest: shouldWriteLatest,
      });
    } catch (error) {
      console.error(`[release:campaign:full] failed to write release summary: ${error instanceof Error ? error.message : String(error)}`);
      return {
        exitCode: completedTerminalOutcome.exitCode === 0 ? 1 : completedTerminalOutcome.exitCode,
        terminalOutcome: completedTerminalOutcome,
      };
    } finally {
      lockManager.releaseMany(latestLeaseIds);
    }
  }

  return {
    exitCode: completedTerminalOutcome.exitCode,
    terminalOutcome: completedTerminalOutcome,
  };
}
