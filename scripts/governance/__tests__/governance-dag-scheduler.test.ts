import { describe, expect, it } from 'vitest';

import { findCurrentVerificationCampaignById } from '../current-verification-campaign-manifest';
import {
  assertGovernanceDagTopology,
  buildGovernanceDagSchedulerShadow,
  runGovernanceDagScheduler,
  validateGovernanceDagTopology,
  type GovernanceDagSchedulerJob,
} from '../governance-dag-scheduler';

function releaseFullSchedulerJobs(): readonly GovernanceDagSchedulerJob[] {
  const campaign = findCurrentVerificationCampaignById('release-full');
  if (!campaign) {
    throw new Error('Missing release-full campaign.');
  }

  return campaign.steps.map((step) => ({
    id: step.id,
    dependsOn: step.dependsOn,
    executionMode: step.executionMode,
  }));
}

describe('governance DAG scheduler', () => {
  it('builds a plan-only scheduler shadow with topology levels and lock-blocked parallel candidates', () => {
    const shadow = buildGovernanceDagSchedulerShadow({
      jobs: [
        {
          id: 'gate-fast',
          dependsOn: [],
          executionMode: 'execute',
          lockIds: ['release-campaign-root-writes'],
        },
        {
          id: 'gate-default',
          dependsOn: ['gate-fast'],
          executionMode: 'execute',
          lockIds: ['release-campaign-root-writes', 'fixed-local-ports'],
        },
        {
          id: 'lane-visual',
          dependsOn: ['gate-fast'],
          executionMode: 'execute',
          lockIds: ['release-campaign-root-writes', 'fixed-local-ports', 'visual-baseline-update'],
        },
        {
          id: 'gate-release-full',
          dependsOn: ['gate-default', 'lane-visual'],
          executionMode: 'aggregate_only',
          lockIds: ['release-campaign-root-writes'],
        },
      ],
      locks: [
        {
          id: 'release-campaign-root-writes',
          mode: 'exclusive',
          reason: 'Campaign root writes must stay single-owner.',
        },
        {
          id: 'fixed-local-ports',
          mode: 'exclusive',
          reason: 'Fixed local ports cannot be shared by concurrent local runs.',
        },
        {
          id: 'visual-baseline-update',
          mode: 'exclusive',
          reason: 'Visual baseline updates mutate repo artifacts.',
        },
      ],
      maxConcurrencyEffective: 1,
    });

    expect(shadow).toMatchObject({
      execution_policy: 'plan_only_shadow',
      execution_enabled: false,
      max_concurrency_effective: 1,
      topology_levels: [
        {
          level_index: 0,
          job_ids: ['gate-fast'],
        },
        {
          level_index: 1,
          job_ids: ['gate-default', 'lane-visual'],
        },
        {
          level_index: 2,
          job_ids: ['gate-release-full'],
        },
      ],
      terminal_aggregate: {
        job_id: 'gate-release-full',
        aggregate_only: true,
        waits_for_job_ids: ['gate-default', 'lane-visual'],
      },
    });
    expect(shadow.parallel_candidates).toEqual([
      {
        level_index: 1,
        candidate_job_ids: ['gate-default', 'lane-visual'],
        runnable_without_lock_conflicts: false,
        reason: 'blocked_by_current_exclusive_locks',
        blocked_by_lock: [
          {
            lock_id: 'release-campaign-root-writes',
            job_ids: ['gate-default', 'lane-visual'],
            reason: 'Campaign root writes must stay single-owner.',
          },
          {
            lock_id: 'fixed-local-ports',
            job_ids: ['gate-default', 'lane-visual'],
            reason: 'Fixed local ports cannot be shared by concurrent local runs.',
          },
        ],
      },
    ]);
    expect(JSON.stringify(shadow)).not.toMatch(/"results"|"verdict"|"claim_id"|"reusable"|"commands_executed"/);
  });

  it('projects the release-full campaign topology with the terminal aggregate last', () => {
    const topology = assertGovernanceDagTopology(releaseFullSchedulerJobs());

    expect(topology.levels).toEqual([
      ['gate-fast'],
      ['gate-default', 'lane-visual'],
      ['gate-release'],
      ['lane-demo-rehearsal', 'lane-cluster-rehearsal'],
      ['gate-release-full'],
    ]);
    expect(topology.terminalJobIds).toEqual(['gate-release-full']);
    expect(topology.orderedJobIds.at(-1)).toBe('gate-release-full');
    expect(topology.edges).toEqual(
      expect.arrayContaining([
        { fromJobId: 'gate-fast', toJobId: 'gate-default' },
        { fromJobId: 'gate-fast', toJobId: 'lane-visual' },
        { fromJobId: 'gate-default', toJobId: 'gate-release' },
        { fromJobId: 'lane-visual', toJobId: 'gate-release' },
        { fromJobId: 'gate-release', toJobId: 'lane-demo-rehearsal' },
        { fromJobId: 'gate-release', toJobId: 'lane-cluster-rehearsal' },
        { fromJobId: 'lane-demo-rehearsal', toJobId: 'gate-release-full' },
        { fromJobId: 'lane-cluster-rehearsal', toJobId: 'gate-release-full' },
      ]),
    );
  });

  it('fails closed for unknown dependencies and cycles', () => {
    const unknownDependency = validateGovernanceDagTopology([
      { id: 'gate-fast', dependsOn: ['missing-step'], executionMode: 'execute' },
    ]);

    expect(unknownDependency.ok).toBe(false);
    if (!unknownDependency.ok) {
      expect(unknownDependency.failures).toEqual([
        expect.objectContaining({
          reason: 'unknown_dependency',
          jobId: 'gate-fast',
          dependencyId: 'missing-step',
        }),
      ]);
    }

    expect(() => assertGovernanceDagTopology([
      { id: 'a', dependsOn: ['b'], executionMode: 'execute' },
      { id: 'b', dependsOn: ['a'], executionMode: 'execute' },
    ])).toThrow(/cycle/i);
  });

  it('always schedules the terminal aggregate after executable failures', () => {
    const executed: string[] = [];
    const skipped: { jobId: string; reasonCode: string; failedJobId: string }[] = [];

    const run = runGovernanceDagScheduler({
      jobs: releaseFullSchedulerJobs(),
      maxConcurrency: 1,
      failFast: true,
      adapter: {
        execute: ({ job }) => {
          executed.push(job.id);
          if (job.id === 'gate-default') {
            return {
              status: 'failed',
              failureClass: 'product_regression',
              summary: 'gate-default failed in scheduler test',
            };
          }
          return {
            status: 'passed',
            failureClass: 'none',
            summary: `${job.id} passed`,
          };
        },
        skip: ({ job, reason }) => {
          skipped.push({
            jobId: job.id,
            reasonCode: reason.code,
            failedJobId: reason.failedJobId,
          });
          return {
            status: 'failed',
            failureClass: reason.failureClass,
            summary: reason.summary,
          };
        },
      },
    });

    expect(executed).toEqual(['gate-fast', 'gate-default', 'gate-release-full']);
    expect(run.terminalJobIds).toEqual(['gate-release-full']);
    expect(run.results.find((result) => result.jobId === 'gate-release-full')?.lifecycle).toBe('completed');
    expect(skipped).toEqual([
      {
        jobId: 'lane-visual',
        reasonCode: 'campaign_fail_fast',
        failedJobId: 'gate-default',
      },
      {
        jobId: 'gate-release',
        reasonCode: 'dependency_failed',
        failedJobId: 'gate-default',
      },
      {
        jobId: 'lane-demo-rehearsal',
        reasonCode: 'dependency_failed',
        failedJobId: 'gate-default',
      },
      {
        jobId: 'lane-cluster-rehearsal',
        reasonCode: 'dependency_failed',
        failedJobId: 'gate-default',
      },
    ]);
  });
});
