import type { JsonDocStorePort } from '@mbos/ports';
import { listUsageFacts } from './audit-usage-store.js';
import { readMemberEndpointDailyTokenLimit } from './project-member-quota-store.js';

type MemberQuotaDecision =
  | { allowed: true; effective_daily_token_limit?: number; current_tokens_today?: number }
  | {
    allowed: false;
    reason: 'quota_exceeded';
    retry_after_seconds: number;
    effective_daily_token_limit: number;
    current_tokens_today: number;
  };

function startOfUtcDayIso(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function endOfUtcDayIso(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)).toISOString();
}

export async function checkMemberEndpointDailyTokenQuota(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  endpointId: string;
  userId: string;
  nowMs?: number;
}): Promise<MemberQuotaDecision> {
  const limit = readMemberEndpointDailyTokenLimit(args.workspaceId, args.projectId, args.userId);
  if (!limit || limit <= 0) return { allowed: true };
  const nowMs = args.nowMs ?? Date.now();
  const facts = await listUsageFacts(args.docStore, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    startTime: startOfUtcDayIso(nowMs),
    endTime: endOfUtcDayIso(nowMs),
    resourceType: 'endpoint',
    resourceId: args.endpointId,
    endUserId: args.userId,
  });
  const currentTokensToday = facts.reduce((sum, fact) => sum + (typeof fact.tokens_total === 'number' ? fact.tokens_total : 0), 0);
  if (currentTokensToday >= limit) {
    const now = new Date(nowMs);
    const nextUtcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
    return {
      allowed: false,
      reason: 'quota_exceeded',
      retry_after_seconds: Math.max(1, Math.ceil((nextUtcMidnightMs - nowMs) / 1000)),
      effective_daily_token_limit: limit,
      current_tokens_today: currentTokensToday,
    };
  }
  return {
    allowed: true,
    effective_daily_token_limit: limit,
    current_tokens_today: currentTokensToday,
  };
}
