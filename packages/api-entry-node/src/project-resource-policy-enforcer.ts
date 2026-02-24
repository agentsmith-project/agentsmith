import type { JsonDocStorePort } from '@mbos/ports';
import type { ProjectResourcePolicyRecord } from './project-resource-policy-store.js';
import { getProjectGroupIdsForUser } from './project-groups-store.js';
import { listUsageFacts } from './audit-usage-store.js';

type ResourceType = 'endpoint' | 'source_library' | 'agent';

type PolicyRule = {
  key: string;
  value: number;
};

type RateLimitDecision =
  | { allowed: true; effective_limit_per_minute?: number; scope?: 'policy' | 'subject' }
  | { allowed: false; reason: 'rate_limited'; retry_after_seconds: number; effective_limit_per_minute: number; scope: 'policy' | 'subject' };

type QuotaLimitDecision =
  | { allowed: true; effective_daily_token_limit?: number; current_tokens_today?: number; scope?: 'policy' | 'subject' }
  | {
    allowed: false;
    reason: 'quota_exceeded';
    retry_after_seconds: number;
    effective_daily_token_limit: number;
    current_tokens_today: number;
    scope: 'policy' | 'subject';
  };

const RESOURCE_POLICY_RATE_COUNTERS = new Map<string, number>();

function minuteBucket(nowMs: number): number {
  return Math.floor(nowMs / 60_000);
}

function counterKey(args: {
  workspaceId: string;
  projectId: string;
  resourceType: ResourceType;
  resourceId: string;
  userId: string;
  bucket: number;
}) {
  return `${args.workspaceId}:${args.projectId}:${args.resourceType}:${args.resourceId}:${args.userId}:${args.bucket}`;
}

function readPolicyRules(input: unknown): PolicyRule[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const rules = (input as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(
      (rule): rule is { key: string; value: number } =>
        !!rule
        && typeof rule === 'object'
        && typeof (rule as { key?: unknown }).key === 'string'
        && typeof (rule as { value?: unknown }).value === 'number'
        && Number.isFinite((rule as { value: number }).value)
        && (rule as { value: number }).value > 0,
    )
    .map((rule) => ({ key: rule.key, value: Math.floor(rule.value) }));
}

function mergeRateRules(base: PolicyRule[], overrides: PolicyRule[]): PolicyRule[] {
  const map = new Map<string, PolicyRule>();
  for (const rule of base) map.set(rule.key, rule);
  for (const rule of overrides) map.set(rule.key, rule);
  return Array.from(map.values());
}

function mergeQuotaRules(base: PolicyRule[], overrides: PolicyRule[]): PolicyRule[] {
  const map = new Map<string, PolicyRule>();
  for (const rule of base) map.set(rule.key, rule);
  for (const rule of overrides) map.set(rule.key, rule);
  return Array.from(map.values());
}

function getMatchingSubjectRateRules(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord;
}): { rules: PolicyRule[]; matched: boolean } {
  const userRules = args.policy.allowed_subjects
    .filter((s) => s.subject_type === 'user' && s.subject_id === args.userId)
    .flatMap((s) => readPolicyRules(s.rate_limits));
  const groupIds = getProjectGroupIdsForUser(args.workspaceId, args.projectId, args.userId);
  const groupRules = args.policy.allowed_subjects
    .filter((s) => s.subject_type === 'group' && groupIds.includes(s.subject_id))
    .flatMap((s) => readPolicyRules(s.rate_limits));
  const merged = mergeRateRules(userRules, groupRules);
  return { rules: merged, matched: merged.length > 0 };
}

function getEffectiveRequestsPerMinuteRule(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord;
}): { value?: number; scope?: 'policy' | 'subject' } {
  const baseRules = readPolicyRules(args.policy.rate_limits);
  const subject = getMatchingSubjectRateRules(args);
  const effective = subject.matched ? mergeRateRules(baseRules, subject.rules) : baseRules;
  const rpmRule = effective.find((r) => r.key === 'endpoint.requests_per_minute');
  if (!rpmRule) return {};
  return { value: rpmRule.value, scope: subject.matched ? 'subject' : 'policy' };
}

function getMatchingSubjectQuotaRules(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord;
}): { rules: PolicyRule[]; matched: boolean } {
  const userRules = args.policy.allowed_subjects
    .filter((s) => s.subject_type === 'user' && s.subject_id === args.userId)
    .flatMap((s) => readPolicyRules(s.quota_limits));
  const groupIds = getProjectGroupIdsForUser(args.workspaceId, args.projectId, args.userId);
  const groupRules = args.policy.allowed_subjects
    .filter((s) => s.subject_type === 'group' && groupIds.includes(s.subject_id))
    .flatMap((s) => readPolicyRules(s.quota_limits));
  const merged = mergeQuotaRules(userRules, groupRules);
  return { rules: merged, matched: merged.length > 0 };
}

function getEffectiveDailyTokenLimitRule(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord;
}): { value?: number; scope?: 'policy' | 'subject' } {
  const baseRules = readPolicyRules(args.policy.quota_limits);
  const subject = getMatchingSubjectQuotaRules(args);
  const effective = subject.matched ? mergeQuotaRules(baseRules, subject.rules) : baseRules;
  const quotaRule = effective.find((r) => r.key === 'endpoint.daily_token_limit');
  if (!quotaRule) return {};
  return { value: quotaRule.value, scope: subject.matched ? 'subject' : 'policy' };
}

export function checkAndConsumeProjectResourceRateLimitsForUser(args: {
  workspaceId: string;
  projectId: string;
  resourceType: ResourceType;
  resourceId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord | null;
  nowMs?: number;
}): RateLimitDecision {
  if (!args.policy || args.resourceType !== 'endpoint') {
    return { allowed: true };
  }
  const effective = getEffectiveRequestsPerMinuteRule({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    policy: args.policy,
  });
  if (!effective.value || effective.value <= 0) {
    return { allowed: true };
  }
  const nowMs = args.nowMs ?? Date.now();
  const bucket = minuteBucket(nowMs);
  const key = counterKey({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    userId: args.userId,
    bucket,
  });
  const current = RESOURCE_POLICY_RATE_COUNTERS.get(key) ?? 0;
  if (current >= effective.value) {
    const nextMinuteMs = (bucket + 1) * 60_000;
    const retryAfterSeconds = Math.max(1, Math.ceil((nextMinuteMs - nowMs) / 1000));
    return {
      allowed: false,
      reason: 'rate_limited',
      retry_after_seconds: retryAfterSeconds,
      effective_limit_per_minute: effective.value,
      scope: effective.scope ?? 'policy',
    };
  }
  RESOURCE_POLICY_RATE_COUNTERS.set(key, current + 1);
  return { allowed: true, effective_limit_per_minute: effective.value, scope: effective.scope };
}

function startOfUtcDayIso(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function endOfUtcDayIso(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)).toISOString();
}

export async function checkProjectResourceQuotaLimitsForUser(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  resourceType: ResourceType;
  resourceId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord | null;
  nowMs?: number;
}): Promise<QuotaLimitDecision> {
  if (!args.policy || args.resourceType !== 'endpoint') {
    return { allowed: true };
  }
  const effective = getEffectiveDailyTokenLimitRule({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    policy: args.policy,
  });
  if (!effective.value || effective.value <= 0) {
    return { allowed: true };
  }
  const nowMs = args.nowMs ?? Date.now();
  const facts = await listUsageFacts(args.docStore, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    startTime: startOfUtcDayIso(nowMs),
    endTime: endOfUtcDayIso(nowMs),
    resourceType: 'endpoint',
    resourceId: args.resourceId,
    endUserId: args.userId,
  });
  const currentTokensToday = facts.reduce((sum, fact) => sum + (Number.isFinite(fact.tokens_total) ? (fact.tokens_total ?? 0) : 0), 0);
  if (currentTokensToday >= effective.value) {
    const now = new Date(nowMs);
    const nextUtcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
    const retryAfterSeconds = Math.max(1, Math.ceil((nextUtcMidnightMs - nowMs) / 1000));
    return {
      allowed: false,
      reason: 'quota_exceeded',
      retry_after_seconds: retryAfterSeconds,
      effective_daily_token_limit: effective.value,
      current_tokens_today: currentTokensToday,
      scope: effective.scope ?? 'policy',
    };
  }
  return {
    allowed: true,
    effective_daily_token_limit: effective.value,
    current_tokens_today: currentTokensToday,
    scope: effective.scope,
  };
}

export function __resetProjectResourcePolicyRateCountersForTests(): void {
  RESOURCE_POLICY_RATE_COUNTERS.clear();
}
