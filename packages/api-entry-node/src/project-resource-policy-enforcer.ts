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

type QuotaRuleKey =
  | 'endpoint.daily_token_limit'
  | 'endpoint.requests_per_day'
  | 'source_library.max_total_files'
  | 'source_library.max_file_size_bytes';

type QuotaLimitDecision =
  | {
    allowed: true;
    quota_key?: QuotaRuleKey;
    effective_limit?: number;
    current_usage?: number;
    usage_unit?: 'tokens' | 'requests';
    effective_daily_token_limit?: number;
    current_tokens_today?: number;
    effective_requests_per_day?: number;
    current_requests_today?: number;
    scope?: 'policy' | 'subject';
  }
  | {
    allowed: false;
    reason: 'quota_exceeded';
    quota_key: QuotaRuleKey;
    effective_limit: number;
    current_usage: number;
    usage_unit: 'tokens' | 'requests';
    retry_after_seconds: number;
    effective_daily_token_limit?: number;
    current_tokens_today?: number;
    effective_requests_per_day?: number;
    current_requests_today?: number;
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

function getRequestsPerMinuteRuleKey(resourceType: ResourceType): string | null {
  if (resourceType === 'endpoint') return 'endpoint.requests_per_minute';
  if (resourceType === 'source_library') return 'source_library.requests_per_minute';
  if (resourceType === 'agent') return 'agent.requests_per_minute';
  return null;
}

function getQuotaRuleKeys(resourceType: ResourceType): QuotaRuleKey[] {
  if (resourceType === 'endpoint') return ['endpoint.requests_per_day', 'endpoint.daily_token_limit'];
  return [];
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
  resourceType: ResourceType;
  policy: ProjectResourcePolicyRecord;
}): { value?: number; scope?: 'policy' | 'subject' } {
  const rpmRuleKey = getRequestsPerMinuteRuleKey(args.resourceType);
  if (!rpmRuleKey) return {};
  const baseRules = readPolicyRules(args.policy.rate_limits);
  const subject = getMatchingSubjectRateRules(args);
  const effective = subject.matched ? mergeRateRules(baseRules, subject.rules) : baseRules;
  const rpmRule = effective.find((r) => r.key === rpmRuleKey);
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

function getEffectiveQuotaRule(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  resourceType: ResourceType;
  policy: ProjectResourcePolicyRecord;
}): { key?: QuotaRuleKey; value?: number; scope?: 'policy' | 'subject' } {
  const quotaRuleKeys = getQuotaRuleKeys(args.resourceType);
  if (quotaRuleKeys.length === 0) return {};
  const baseRules = readPolicyRules(args.policy.quota_limits);
  const subject = getMatchingSubjectQuotaRules(args);
  const effective = subject.matched ? mergeQuotaRules(baseRules, subject.rules) : baseRules;
  const quotaRule = quotaRuleKeys
    .map((key) => ({ key, rule: effective.find((r) => r.key === key) }))
    .find((item): item is { key: QuotaRuleKey; rule: PolicyRule } => !!item.rule);
  if (!quotaRule) return {};
  return { key: quotaRule.key, value: quotaRule.rule.value, scope: subject.matched ? 'subject' : 'policy' };
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
  if (!args.policy) {
    return { allowed: true };
  }
  const effective = getEffectiveRequestsPerMinuteRule({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    resourceType: args.resourceType,
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
  if (!args.policy) {
    return { allowed: true };
  }
  const effective = getEffectiveQuotaRule({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    resourceType: args.resourceType,
    policy: args.policy,
  });
  if (!effective.key || !effective.value || effective.value <= 0) {
    return { allowed: true };
  }
  const nowMs = args.nowMs ?? Date.now();
  const facts = await listUsageFacts(args.docStore, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    startTime: startOfUtcDayIso(nowMs),
    endTime: endOfUtcDayIso(nowMs),
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    endUserId: args.userId,
  });
  const currentUsage = facts.reduce((sum, fact) => {
    if (effective.key === 'endpoint.requests_per_day') {
      return sum + (Number.isFinite(fact.requests) ? (fact.requests ?? 0) : 0);
    }
    return sum + (Number.isFinite(fact.tokens_total) ? (fact.tokens_total ?? 0) : 0);
  }, 0);
  if (currentUsage >= effective.value) {
    const now = new Date(nowMs);
    const nextUtcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
    const retryAfterSeconds = Math.max(1, Math.ceil((nextUtcMidnightMs - nowMs) / 1000));
    return {
      allowed: false,
      reason: 'quota_exceeded',
      quota_key: effective.key,
      effective_limit: effective.value,
      current_usage: currentUsage,
      usage_unit: effective.key === 'endpoint.requests_per_day' ? 'requests' : 'tokens',
      retry_after_seconds: retryAfterSeconds,
      ...(effective.key === 'endpoint.requests_per_day'
        ? {
            effective_requests_per_day: effective.value,
            current_requests_today: currentUsage,
          }
        : {
            effective_daily_token_limit: effective.value,
            current_tokens_today: currentUsage,
          }),
      scope: effective.scope ?? 'policy',
    };
  }
  return {
    allowed: true,
    quota_key: effective.key,
    effective_limit: effective.value,
    current_usage: currentUsage,
    usage_unit: effective.key === 'endpoint.requests_per_day' ? 'requests' : 'tokens',
    ...(effective.key === 'endpoint.requests_per_day'
      ? {
          effective_requests_per_day: effective.value,
          current_requests_today: currentUsage,
        }
      : {
          effective_daily_token_limit: effective.value,
          current_tokens_today: currentUsage,
        }),
    scope: effective.scope,
  };
}

type SourceLibraryQuotaDecision =
  | {
    allowed: true;
    effective_max_total_files?: number;
    current_total_files?: number;
    effective_max_file_size_bytes?: number;
    current_file_size_bytes?: number;
    scope?: 'policy' | 'subject';
  }
  | {
    allowed: false;
    reason: 'quota_exceeded';
    quota_key: 'source_library.max_total_files' | 'source_library.max_file_size_bytes';
    effective_limit: number;
    current_usage: number;
    usage_unit: 'files' | 'bytes';
    retry_after_seconds: number;
    effective_max_total_files?: number;
    current_total_files?: number;
    effective_max_file_size_bytes?: number;
    current_file_size_bytes?: number;
    scope: 'policy' | 'subject';
  };

function getEffectiveSourceLibraryQuotaRule(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord;
  key: 'source_library.max_total_files' | 'source_library.max_file_size_bytes';
}): { value?: number; scope?: 'policy' | 'subject' } {
  const baseRules = readPolicyRules(args.policy.quota_limits);
  const subject = getMatchingSubjectQuotaRules(args);
  const effective = subject.matched ? mergeQuotaRules(baseRules, subject.rules) : baseRules;
  const rule = effective.find((item) => item.key === args.key);
  if (!rule) return {};
  return { value: rule.value, scope: subject.matched ? 'subject' : 'policy' };
}

export function checkProjectSourceLibraryQuotaLimits(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord | null;
  currentFileCount: number;
  nextFileSizeBytes: number;
}): SourceLibraryQuotaDecision {
  if (!args.policy) {
    return { allowed: true };
  }

  const maxTotalFiles = getEffectiveSourceLibraryQuotaRule({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    policy: args.policy,
    key: 'source_library.max_total_files',
  });
  if (maxTotalFiles.value && args.currentFileCount + 1 > maxTotalFiles.value) {
    return {
      allowed: false,
      reason: 'quota_exceeded',
      quota_key: 'source_library.max_total_files',
      effective_limit: maxTotalFiles.value,
      current_usage: args.currentFileCount + 1,
      usage_unit: 'files',
      retry_after_seconds: 86_400,
      effective_max_total_files: maxTotalFiles.value,
      current_total_files: args.currentFileCount,
      scope: maxTotalFiles.scope ?? 'policy',
    };
  }

  const maxFileSize = getEffectiveSourceLibraryQuotaRule({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    policy: args.policy,
    key: 'source_library.max_file_size_bytes',
  });
  if (maxFileSize.value && args.nextFileSizeBytes > maxFileSize.value) {
    return {
      allowed: false,
      reason: 'quota_exceeded',
      quota_key: 'source_library.max_file_size_bytes',
      effective_limit: maxFileSize.value,
      current_usage: args.nextFileSizeBytes,
      usage_unit: 'bytes',
      retry_after_seconds: 86_400,
      effective_max_file_size_bytes: maxFileSize.value,
      current_file_size_bytes: args.nextFileSizeBytes,
      scope: maxFileSize.scope ?? 'policy',
    };
  }

  return {
    allowed: true,
    effective_max_total_files: maxTotalFiles.value,
    current_total_files: args.currentFileCount,
    effective_max_file_size_bytes: maxFileSize.value,
    current_file_size_bytes: args.nextFileSizeBytes,
    scope: maxTotalFiles.scope ?? maxFileSize.scope,
  };
}

export function __resetProjectResourcePolicyRateCountersForTests(): void {
  RESOURCE_POLICY_RATE_COUNTERS.clear();
}
