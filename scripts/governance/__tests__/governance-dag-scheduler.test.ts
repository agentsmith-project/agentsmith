import { describe, expect, it } from 'vitest';

import { findCurrentVerificationCampaignById } from '../current-verification-campaign-manifest';
import {
  assertGovernanceDagTopology,
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
