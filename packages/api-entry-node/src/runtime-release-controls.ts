import type {
  RuntimeRouteApprovalChecklist,
  RuntimeRouteReleaseRecord,
  RuntimeRouteRolloutPolicy,
} from './runtime-store.js';

export function createDraftRuntimeRelease(existing?: RuntimeRouteReleaseRecord): RuntimeRouteReleaseRecord {
  return {
    status: 'draft',
    rollout_policy: existing?.rollout_policy,
  };
}

export function isApprovalChecklistComplete(checklist: RuntimeRouteApprovalChecklist): boolean {
  return checklist.owner_verified && checklist.observability_verified && checklist.rollback_verified;
}

export function normalizeRuntimeRolloutPolicy(
  policy: RuntimeRouteRolloutPolicy,
): RuntimeRouteRolloutPolicy {
  if (policy.mode === 'canary') {
    const rawPercent = typeof policy.canary_percent === 'number' ? policy.canary_percent : 10;
    return {
      mode: 'canary',
      canary_percent: Math.min(100, Math.max(1, Math.round(rawPercent))),
    };
  }
  return {
    mode: 'full',
  };
}
