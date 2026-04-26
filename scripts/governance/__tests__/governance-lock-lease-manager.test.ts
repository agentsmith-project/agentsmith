import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GovernanceLockLeaseManager,
  buildExclusiveLeaseRequest,
  buildReleaseCampaignRootLeaseRequest,
  buildReleaseCampaignStepOutputLeaseRequest,
} from '../governance-lock-lease-manager';

function withTempRoot<T>(action: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), 'agentsmith-lock-lease-'));
  try {
    return action(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('governance lock lease manager', () => {
  it('allows same run and same campaign root to reenter the campaign root lease for sibling steps', () => {
    withTempRoot((campaignRoot) => {
      const manager = new GovernanceLockLeaseManager();
      const first = manager.acquire(buildReleaseCampaignRootLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-001',
        campaignRoot,
        stepId: 'gate-default',
        attemptId: 'attempt-gate-default',
      }));
      const sibling = manager.acquire(buildReleaseCampaignRootLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-001',
        campaignRoot,
        stepId: 'lane-visual',
        attemptId: 'attempt-lane-visual',
      }));

      expect(first.ok).toBe(true);
      expect(sibling.ok).toBe(true);
      if (sibling.ok) {
        expect(sibling.reentrant).toBe(true);
      }
      expect(manager.activeLeases()).toHaveLength(2);
    });
  });

  it('rejects a different run that tries to reuse the same campaign root', () => {
    withTempRoot((campaignRoot) => {
      const manager = new GovernanceLockLeaseManager();
      const first = manager.acquire(buildReleaseCampaignRootLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-001',
        campaignRoot,
        stepId: 'gate-default',
        attemptId: 'attempt-1',
      }));
      const secondRun = manager.acquire(buildReleaseCampaignRootLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-002',
        campaignRoot,
        stepId: 'lane-visual',
        attemptId: 'attempt-2',
      }));

      expect(first.ok).toBe(true);
      expect(secondRun.ok).toBe(false);
      if (!secondRun.ok) {
        expect(secondRun.conflict.reason).toContain('campaign root');
        expect(secondRun.conflict.existingLease.runId).toBe('run-001');
      }
    });
  });

  it('allows different campaign roots to run without sharing a root lease', () => {
    withTempRoot((leftRoot) => withTempRoot((rightRoot) => {
      const manager = new GovernanceLockLeaseManager();
      const left = manager.acquire(buildReleaseCampaignRootLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-001',
        campaignRoot: leftRoot,
        stepId: 'gate-default',
        attemptId: 'attempt-left',
      }));
      const right = manager.acquire(buildReleaseCampaignRootLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-002',
        campaignRoot: rightRoot,
        stepId: 'gate-default',
        attemptId: 'attempt-right',
      }));

      expect(left.ok).toBe(true);
      expect(right.ok).toBe(true);
      expect(manager.activeLeases()).toHaveLength(2);
    }));
  });

  it('rejects concurrent writes to the same campaign step output scope', () => {
    withTempRoot((campaignRoot) => {
      const manager = new GovernanceLockLeaseManager();
      const first = manager.acquire(buildReleaseCampaignStepOutputLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-001',
        campaignRoot,
        stepId: 'lane-visual',
        attemptId: 'attempt-1',
      }));
      const secondAttempt = manager.acquire(buildReleaseCampaignStepOutputLeaseRequest({
        campaignId: 'release-full',
        runId: 'run-001',
        campaignRoot,
        stepId: 'lane-visual',
        attemptId: 'attempt-2',
      }));

      expect(first.ok).toBe(true);
      expect(secondAttempt.ok).toBe(false);
      if (!secondAttempt.ok) {
        expect(secondAttempt.conflict.reason).toContain('step output');
      }
    });
  });

  it('conflicts local host, provider profile, visual baseline, and release latest pointer leases by scope', () => {
    const cases = [
      buildExclusiveLeaseRequest({
        lockId: 'fixed-local-ports',
        scopeKind: 'local_host',
        scopeKey: 'localhost',
        ownerAttemptId: 'attempt-local-1',
        ownerGroup: 'local-run-1',
        ownerStepId: 'gate-release',
      }),
      buildExclusiveLeaseRequest({
        lockId: 'backend-real-provider-quota',
        scopeKind: 'provider_profile',
        scopeKey: 'provider:release-real-default',
        ownerAttemptId: 'attempt-provider-1',
        ownerGroup: 'provider-run-1',
        ownerStepId: 'gate-release',
      }),
      buildExclusiveLeaseRequest({
        lockId: 'visual-baseline-update',
        scopeKind: 'visual_baseline',
        scopeKey: 'visual-baseline:update',
        ownerAttemptId: 'attempt-visual-1',
        ownerGroup: 'visual-run-1',
        ownerStepId: 'lane-visual',
      }),
      buildExclusiveLeaseRequest({
        lockId: 'release-latest-pointer',
        scopeKind: 'release_latest',
        scopeKey: 'artifacts/release-runs/latest.json',
        ownerAttemptId: 'attempt-latest-1',
        ownerGroup: 'release-run-1',
        ownerStepId: 'release-summary-finalize',
      }),
    ] as const;

    for (const firstRequest of cases) {
      const manager = new GovernanceLockLeaseManager();
      const first = manager.acquire(firstRequest);
      const second = manager.acquire({
        ...firstRequest,
        ownerAttemptId: `${firstRequest.ownerAttemptId}-other`,
        ownerGroup: `${firstRequest.ownerGroup}-other`,
      });

      expect(first.ok, firstRequest.lockId).toBe(true);
      expect(second.ok, firstRequest.lockId).toBe(false);
      if (!second.ok) {
        expect(second.conflict.lockId).toBe(firstRequest.lockId);
      }
    }
  });
});
