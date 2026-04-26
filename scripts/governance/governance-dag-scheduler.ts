import type { CurrentGateResultFailureClass } from './current-gate-result-schema';
import type { CurrentVerificationCampaignExecutionMode } from './current-verification-campaign-manifest';

export type GovernanceDagValidationFailureReason =
  | 'duplicate_job_id'
  | 'unknown_dependency'
  | 'cycle';

export type GovernanceDagSkipReasonCode = 'dependency_failed' | 'campaign_fail_fast';

export interface GovernanceDagSchedulerJob {
  id: string;
  dependsOn: readonly string[];
  executionMode: CurrentVerificationCampaignExecutionMode;
}

export interface GovernanceDagEdge {
  fromJobId: string;
  toJobId: string;
}

export interface GovernanceDagTopology {
  orderedJobIds: readonly string[];
  levels: readonly (readonly string[])[];
  terminalJobIds: readonly string[];
  edges: readonly GovernanceDagEdge[];
}

export interface GovernanceDagValidationFailure {
  reason: GovernanceDagValidationFailureReason;
  message: string;
  jobId?: string;
  dependencyId?: string;
}

export type GovernanceDagTopologyValidationResult =
  | {
      ok: true;
      value: GovernanceDagTopology;
    }
  | {
      ok: false;
      failures: readonly GovernanceDagValidationFailure[];
    };

export interface GovernanceDagAdapterOutcome {
  status: 'passed' | 'failed';
  failureClass: CurrentGateResultFailureClass;
  summary: string;
}

export interface GovernanceDagSkipReason {
  code: GovernanceDagSkipReasonCode;
  failedJobId: string;
  failedDependencyId: string | null;
  failureClass: CurrentGateResultFailureClass;
  summary: string;
}

export interface GovernanceDagAdapterExecuteInput {
  job: GovernanceDagSchedulerJob;
}

export interface GovernanceDagAdapterSkipInput {
  job: GovernanceDagSchedulerJob;
  reason: GovernanceDagSkipReason;
}

export interface GovernanceDagSchedulerAdapter {
  execute(input: GovernanceDagAdapterExecuteInput): GovernanceDagAdapterOutcome;
  skip(input: GovernanceDagAdapterSkipInput): GovernanceDagAdapterOutcome;
}

export interface GovernanceDagSchedulerInput {
  jobs: readonly GovernanceDagSchedulerJob[];
  adapter: GovernanceDagSchedulerAdapter;
  maxConcurrency?: number;
  failFast?: boolean;
}

export type GovernanceDagJobLifecycle = 'completed' | 'failed' | 'skipped';

export interface GovernanceDagJobResult {
  jobId: string;
  lifecycle: GovernanceDagJobLifecycle;
  status: 'passed' | 'failed';
  failureClass: CurrentGateResultFailureClass;
  summary: string;
  skipReason: GovernanceDagSkipReason | null;
}

export interface GovernanceDagSchedulerRun {
  topology: GovernanceDagTopology;
  maxConcurrency: number;
  failFast: boolean;
  terminalJobIds: readonly string[];
  results: readonly GovernanceDagJobResult[];
}

interface FailedJobRecord {
  jobId: string;
  dependencyJobId: string;
  failureClass: CurrentGateResultFailureClass;
}

function jobIsTerminal(job: GovernanceDagSchedulerJob): boolean {
  return job.executionMode === 'aggregate_only';
}

function stableJobIndex(jobs: readonly GovernanceDagSchedulerJob[]): Map<string, number> {
  return new Map(jobs.map((job, index) => [job.id, index]));
}

function pushFailure(
  failures: GovernanceDagValidationFailure[],
  failure: GovernanceDagValidationFailure,
): void {
  failures.push(failure);
}

function validateJobIds(jobs: readonly GovernanceDagSchedulerJob[]): GovernanceDagValidationFailure[] {
  const failures: GovernanceDagValidationFailure[] = [];
  const seen = new Set<string>();

  for (const job of jobs) {
    if (seen.has(job.id)) {
      pushFailure(failures, {
        reason: 'duplicate_job_id',
        jobId: job.id,
        message: `Duplicate DAG job id: ${job.id}`,
      });
      continue;
    }
    seen.add(job.id);
  }

  return failures;
}

function validateDependencies(jobs: readonly GovernanceDagSchedulerJob[]): GovernanceDagValidationFailure[] {
  const failures: GovernanceDagValidationFailure[] = [];
  const ids = new Set(jobs.map((job) => job.id));

  for (const job of jobs) {
    for (const dependencyId of job.dependsOn) {
      if (!ids.has(dependencyId)) {
        pushFailure(failures, {
          reason: 'unknown_dependency',
          jobId: job.id,
          dependencyId,
          message: `DAG job ${job.id} depends on unknown job ${dependencyId}.`,
        });
      }
    }
  }

  return failures;
}

function buildReadyLevel(
  remaining: Set<string>,
  completed: ReadonlySet<string>,
  jobsById: ReadonlyMap<string, GovernanceDagSchedulerJob>,
  indexes: ReadonlyMap<string, number>,
): string[] {
  return [...remaining]
    .filter((jobId) => {
      const job = jobsById.get(jobId);
      if (!job) {
        return false;
      }
      return job.dependsOn.every((dependencyId) => completed.has(dependencyId));
    })
    .sort((left, right) => (indexes.get(left) ?? 0) - (indexes.get(right) ?? 0));
}

function buildTopology(jobs: readonly GovernanceDagSchedulerJob[]): GovernanceDagTopologyValidationResult {
  const failures = [
    ...validateJobIds(jobs),
    ...validateDependencies(jobs),
  ];
  if (failures.length > 0) {
    return {
      ok: false,
      failures,
    };
  }

  const indexes = stableJobIndex(jobs);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const remaining = new Set(jobs.map((job) => job.id));
  const completed = new Set<string>();
  const levels: string[][] = [];
  const orderedJobIds: string[] = [];

  while (remaining.size > 0) {
    const ready = buildReadyLevel(remaining, completed, jobsById, indexes);
    if (ready.length === 0) {
      const cycleJobIds = [...remaining].sort((left, right) => (indexes.get(left) ?? 0) - (indexes.get(right) ?? 0));
      return {
        ok: false,
        failures: [
          {
            reason: 'cycle',
            message: `DAG contains a cycle or unsatisfied dependency among jobs: ${cycleJobIds.join(', ')}.`,
          },
        ],
      };
    }

    levels.push(ready);
    for (const jobId of ready) {
      remaining.delete(jobId);
      completed.add(jobId);
      orderedJobIds.push(jobId);
    }
  }

  return {
    ok: true,
    value: {
      orderedJobIds,
      levels,
      terminalJobIds: jobs.filter(jobIsTerminal).map((job) => job.id),
      edges: jobs.flatMap((job) => job.dependsOn.map((dependencyId) => ({
        fromJobId: dependencyId,
        toJobId: job.id,
      }))),
    },
  };
}

export function validateGovernanceDagTopology(
  jobs: readonly GovernanceDagSchedulerJob[],
): GovernanceDagTopologyValidationResult {
  return buildTopology(jobs);
}

export function assertGovernanceDagTopology(
  jobs: readonly GovernanceDagSchedulerJob[],
): GovernanceDagTopology {
  const validation = validateGovernanceDagTopology(jobs);
  if (validation.ok) {
    return validation.value;
  }

  throw new Error(validation.failures.map((failure) => failure.message).join(' '));
}

function resultLifecycle(outcome: GovernanceDagAdapterOutcome): GovernanceDagJobLifecycle {
  return outcome.status === 'passed' ? 'completed' : 'failed';
}

function firstFailedDependency(
  job: GovernanceDagSchedulerJob,
  resultByJobId: ReadonlyMap<string, GovernanceDagJobResult>,
): FailedJobRecord | null {
  for (const dependencyId of job.dependsOn) {
    const result = resultByJobId.get(dependencyId);
    if (result && result.status !== 'passed') {
      return {
        jobId: result.skipReason?.failedJobId ?? dependencyId,
        dependencyJobId: dependencyId,
        failureClass: result.failureClass,
      };
    }
  }
  return null;
}

function dependenciesAreSettled(
  job: GovernanceDagSchedulerJob,
  pendingJobIds: ReadonlySet<string>,
): boolean {
  return job.dependsOn.every((dependencyId) => !pendingJobIds.has(dependencyId));
}

function dependenciesPassed(
  job: GovernanceDagSchedulerJob,
  resultByJobId: ReadonlyMap<string, GovernanceDagJobResult>,
): boolean {
  return job.dependsOn.every((dependencyId) => resultByJobId.get(dependencyId)?.status === 'passed');
}

function dependencyFailedReason(
  job: GovernanceDagSchedulerJob,
  failedDependency: FailedJobRecord,
): GovernanceDagSkipReason {
  const rootCauseSuffix = failedDependency.jobId === failedDependency.dependencyJobId
    ? ''
    : ` after ${failedDependency.jobId} failed`;
  return {
    code: 'dependency_failed',
    failedJobId: failedDependency.jobId,
    failedDependencyId: failedDependency.dependencyJobId,
    failureClass: failedDependency.failureClass,
    summary: `Campaign step ${job.id} was skipped because dependency ${failedDependency.dependencyJobId} did not pass${rootCauseSuffix}.`,
  };
}

function campaignFailFastReason(
  job: GovernanceDagSchedulerJob,
  failedStep: FailedJobRecord,
): GovernanceDagSkipReason {
  return {
    code: 'campaign_fail_fast',
    failedJobId: failedStep.jobId,
    failedDependencyId: null,
    failureClass: failedStep.failureClass,
    summary: `Campaign step ${job.id} was skipped by campaign fail-fast after ${failedStep.jobId} failed; this step had no failed dependency at scheduling time.`,
  };
}

function appendResult(
  results: GovernanceDagJobResult[],
  resultByJobId: Map<string, GovernanceDagJobResult>,
  result: GovernanceDagJobResult,
): void {
  results.push(result);
  resultByJobId.set(result.jobId, result);
}

function completedResult(
  job: GovernanceDagSchedulerJob,
  outcome: GovernanceDagAdapterOutcome,
): GovernanceDagJobResult {
  return {
    jobId: job.id,
    lifecycle: resultLifecycle(outcome),
    status: outcome.status,
    failureClass: outcome.failureClass,
    summary: outcome.summary,
    skipReason: null,
  };
}

function skippedResult(
  job: GovernanceDagSchedulerJob,
  reason: GovernanceDagSkipReason,
  outcome: GovernanceDagAdapterOutcome,
): GovernanceDagJobResult {
  return {
    jobId: job.id,
    lifecycle: 'skipped',
    status: outcome.status,
    failureClass: outcome.failureClass,
    summary: outcome.summary,
    skipReason: reason,
  };
}

export function runGovernanceDagScheduler(input: GovernanceDagSchedulerInput): GovernanceDagSchedulerRun {
  const topology = assertGovernanceDagTopology(input.jobs);
  const maxConcurrency = input.maxConcurrency ?? 1;
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error(`maxConcurrency must be a positive integer, received ${String(maxConcurrency)}.`);
  }

  const failFast = input.failFast ?? true;
  const jobsById = new Map(input.jobs.map((job) => [job.id, job]));
  const pendingJobIds = new Set(topology.orderedJobIds);
  const results: GovernanceDagJobResult[] = [];
  const resultByJobId = new Map<string, GovernanceDagJobResult>();
  let firstExecutableFailure: FailedJobRecord | null = null;

  while (pendingJobIds.size > 0) {
    let progress = false;
    let executedThisPass = 0;

    for (const jobId of topology.orderedJobIds) {
      if (!pendingJobIds.has(jobId)) {
        continue;
      }

      const job = jobsById.get(jobId);
      if (!job) {
        throw new Error(`DAG scheduler lost job metadata for ${jobId}.`);
      }

      if (jobIsTerminal(job)) {
        if (!dependenciesAreSettled(job, pendingJobIds)) {
          continue;
        }
        const outcome = input.adapter.execute({ job });
        const result = completedResult(job, outcome);
        appendResult(results, resultByJobId, result);
        pendingJobIds.delete(job.id);
        progress = true;
        executedThisPass += 1;
        if (executedThisPass >= maxConcurrency) {
          break;
        }
        continue;
      }

      const failedDependency = firstFailedDependency(job, resultByJobId);
      if (failedDependency) {
        const reason = dependencyFailedReason(job, failedDependency);
        const outcome = input.adapter.skip({ job, reason });
        appendResult(results, resultByJobId, skippedResult(job, reason, outcome));
        pendingJobIds.delete(job.id);
        progress = true;
        continue;
      }

      if (!dependenciesPassed(job, resultByJobId)) {
        continue;
      }

      if (failFast && firstExecutableFailure) {
        const reason = campaignFailFastReason(job, firstExecutableFailure);
        const outcome = input.adapter.skip({ job, reason });
        appendResult(results, resultByJobId, skippedResult(job, reason, outcome));
        pendingJobIds.delete(job.id);
        progress = true;
        continue;
      }

      const outcome = input.adapter.execute({ job });
      const result = completedResult(job, outcome);
      appendResult(results, resultByJobId, result);
      pendingJobIds.delete(job.id);
      progress = true;
      executedThisPass += 1;

      if (outcome.status === 'failed' && !firstExecutableFailure) {
        firstExecutableFailure = {
          jobId: job.id,
          dependencyJobId: job.id,
          failureClass: outcome.failureClass,
        };
      }

      if (executedThisPass >= maxConcurrency) {
        break;
      }
    }

    if (!progress) {
      throw new Error('DAG scheduler made no progress; this should be unreachable after topology validation.');
    }
  }

  return {
    topology,
    maxConcurrency,
    failFast,
    terminalJobIds: topology.terminalJobIds,
    results,
  };
}
