import { resolve } from 'node:path';

export type GovernanceRuntimeLockScopeKind =
  | 'campaign_root'
  | 'step_output'
  | 'local_host'
  | 'provider_profile'
  | 'visual_baseline'
  | 'release_latest';

export type GovernanceRuntimeLockMode = 'exclusive';

export interface GovernanceRuntimeLockLeaseRequest {
  lockId: string;
  scopeKind: GovernanceRuntimeLockScopeKind;
  scopeKey: string;
  ownerGroup: string;
  ownerAttemptId: string;
  ownerStepId: string;
  mode: GovernanceRuntimeLockMode;
  campaignId?: string;
  runId?: string;
  campaignRoot?: string;
}

export interface GovernanceRuntimeLockLease {
  leaseId: string;
  lockId: string;
  scopeKind: GovernanceRuntimeLockScopeKind;
  scopeKey: string;
  ownerGroup: string;
  ownerAttemptId: string;
  ownerStepId: string;
  mode: GovernanceRuntimeLockMode;
  campaignId: string | null;
  runId: string | null;
  campaignRoot: string | null;
  acquiredAt: string;
}

export interface GovernanceRuntimeLockConflict {
  lockId: string;
  scopeKind: GovernanceRuntimeLockScopeKind;
  scopeKey: string;
  reason: string;
  existingLease: GovernanceRuntimeLockLease;
}

export type GovernanceRuntimeLockAcquireResult =
  | {
      ok: true;
      lease: GovernanceRuntimeLockLease;
      reentrant: boolean;
    }
  | {
      ok: false;
      conflict: GovernanceRuntimeLockConflict;
    };

export interface ReleaseCampaignLeaseRequestInput {
  campaignId: string;
  runId: string;
  campaignRoot: string;
  stepId: string;
  attemptId: string;
}

export interface BuildExclusiveLeaseRequestInput {
  lockId: string;
  scopeKind: GovernanceRuntimeLockScopeKind;
  scopeKey: string;
  ownerGroup: string;
  ownerAttemptId: string;
  ownerStepId: string;
}

function normalizedCampaignRoot(campaignRoot: string): string {
  return resolve(campaignRoot);
}

function releaseCampaignOwnerGroup(input: Pick<ReleaseCampaignLeaseRequestInput, 'campaignId' | 'runId' | 'campaignRoot'>): string {
  return [
    input.campaignId,
    input.runId,
    normalizedCampaignRoot(input.campaignRoot),
  ].join('|');
}

function releaseCampaignRootScopeKey(campaignRoot: string): string {
  return normalizedCampaignRoot(campaignRoot);
}

function releaseCampaignStepOutputScopeKey(input: Pick<ReleaseCampaignLeaseRequestInput, 'campaignRoot' | 'stepId'>): string {
  return `${normalizedCampaignRoot(input.campaignRoot)}|${input.stepId}`;
}

export function buildReleaseCampaignRootLeaseRequest(
  input: ReleaseCampaignLeaseRequestInput,
): GovernanceRuntimeLockLeaseRequest {
  return {
    lockId: 'release-campaign-root-writes',
    scopeKind: 'campaign_root',
    scopeKey: releaseCampaignRootScopeKey(input.campaignRoot),
    ownerGroup: releaseCampaignOwnerGroup(input),
    ownerAttemptId: input.attemptId,
    ownerStepId: input.stepId,
    mode: 'exclusive',
    campaignId: input.campaignId,
    runId: input.runId,
    campaignRoot: normalizedCampaignRoot(input.campaignRoot),
  };
}

export function buildReleaseCampaignStepOutputLeaseRequest(
  input: ReleaseCampaignLeaseRequestInput,
): GovernanceRuntimeLockLeaseRequest {
  return {
    lockId: 'release-campaign-step-output',
    scopeKind: 'step_output',
    scopeKey: releaseCampaignStepOutputScopeKey(input),
    ownerGroup: releaseCampaignOwnerGroup(input),
    ownerAttemptId: input.attemptId,
    ownerStepId: input.stepId,
    mode: 'exclusive',
    campaignId: input.campaignId,
    runId: input.runId,
    campaignRoot: normalizedCampaignRoot(input.campaignRoot),
  };
}

export function buildExclusiveLeaseRequest(
  input: BuildExclusiveLeaseRequestInput,
): GovernanceRuntimeLockLeaseRequest {
  return {
    lockId: input.lockId,
    scopeKind: input.scopeKind,
    scopeKey: input.scopeKey,
    ownerGroup: input.ownerGroup,
    ownerAttemptId: input.ownerAttemptId,
    ownerStepId: input.ownerStepId,
    mode: 'exclusive',
  };
}

function sameLockScope(
  left: GovernanceRuntimeLockLease,
  right: GovernanceRuntimeLockLeaseRequest,
): boolean {
  return left.lockId === right.lockId
    && left.scopeKind === right.scopeKind
    && left.scopeKey === right.scopeKey;
}

function leaseFromRequest(
  request: GovernanceRuntimeLockLeaseRequest,
  leaseId: string,
): GovernanceRuntimeLockLease {
  return {
    leaseId,
    lockId: request.lockId,
    scopeKind: request.scopeKind,
    scopeKey: request.scopeKey,
    ownerGroup: request.ownerGroup,
    ownerAttemptId: request.ownerAttemptId,
    ownerStepId: request.ownerStepId,
    mode: request.mode,
    campaignId: request.campaignId ?? null,
    runId: request.runId ?? null,
    campaignRoot: request.campaignRoot ? normalizedCampaignRoot(request.campaignRoot) : null,
    acquiredAt: new Date().toISOString(),
  };
}

function conflictResult(
  request: GovernanceRuntimeLockLeaseRequest,
  existingLease: GovernanceRuntimeLockLease,
  reason: string,
): GovernanceRuntimeLockAcquireResult {
  return {
    ok: false,
    conflict: {
      lockId: request.lockId,
      scopeKind: request.scopeKind,
      scopeKey: request.scopeKey,
      reason,
      existingLease,
    },
  };
}

export class GovernanceLockLeaseManager {
  private leases: GovernanceRuntimeLockLease[] = [];

  private nextLeaseNumber = 1;

  acquire(request: GovernanceRuntimeLockLeaseRequest): GovernanceRuntimeLockAcquireResult {
    const sameScopeLeases = this.leases.filter((lease) => sameLockScope(lease, request));
    const sameAttemptLease = sameScopeLeases.find((lease) => lease.ownerAttemptId === request.ownerAttemptId);
    if (sameAttemptLease) {
      return {
        ok: true,
        lease: sameAttemptLease,
        reentrant: true,
      };
    }

    if (request.lockId === 'release-campaign-root-writes' && request.scopeKind === 'campaign_root') {
      const conflictingRun = sameScopeLeases.find((lease) => lease.ownerGroup !== request.ownerGroup);
      if (conflictingRun) {
        return conflictResult(
          request,
          conflictingRun,
          `campaign root ${request.scopeKey} is already leased by a different campaign run.`,
        );
      }

      const lease = this.createLease(request);
      return {
        ok: true,
        lease,
        reentrant: sameScopeLeases.length > 0,
      };
    }

    if (request.scopeKind === 'step_output') {
      const conflictingStepWriter = sameScopeLeases[0];
      if (conflictingStepWriter) {
        return conflictResult(
          request,
          conflictingStepWriter,
          `step output scope ${request.scopeKey} is already leased by another attempt.`,
        );
      }
    } else {
      const conflictingLease = sameScopeLeases[0];
      if (conflictingLease) {
        return conflictResult(
          request,
          conflictingLease,
          `lock ${request.lockId} scope ${request.scopeKey} is already leased.`,
        );
      }
    }

    const lease = this.createLease(request);
    return {
      ok: true,
      lease,
      reentrant: false,
    };
  }

  release(leaseId: string): boolean {
    const before = this.leases.length;
    this.leases = this.leases.filter((lease) => lease.leaseId !== leaseId);
    return this.leases.length !== before;
  }

  releaseMany(leaseIds: readonly string[]): void {
    for (const leaseId of leaseIds) {
      this.release(leaseId);
    }
  }

  activeLeases(): readonly GovernanceRuntimeLockLease[] {
    return this.leases.map((lease) => ({ ...lease }));
  }

  private createLease(request: GovernanceRuntimeLockLeaseRequest): GovernanceRuntimeLockLease {
    const lease = leaseFromRequest(
      request,
      `lease-${String(this.nextLeaseNumber).padStart(6, '0')}`,
    );
    this.nextLeaseNumber += 1;
    this.leases.push(lease);
    return lease;
  }
}
