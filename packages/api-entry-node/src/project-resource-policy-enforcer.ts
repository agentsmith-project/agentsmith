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
  | 'endpoint.spending_usd_per_minute'
  | 'endpoint.spending_usd_per_5_hours'
  | 'endpoint.spending_usd_per_day'
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

function readPolicyRulesRaw(input: unknown): PolicyRule[] {
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
    .map((rule) => ({ key: rule.key, value: rule.value }));
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
  if (resourceType === 'endpoint') return ['endpoint.daily_token_limit'];
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
      usage_unit: 'tokens',
      retry_after_seconds: retryAfterSeconds,
      effective_daily_token_limit: effective.value,
      current_tokens_today: currentUsage,
      scope: effective.scope ?? 'policy',
    };
  }
  return {
    allowed: true,
    quota_key: effective.key,
    effective_limit: effective.value,
    current_usage: currentUsage,
    usage_unit: 'tokens',
    effective_daily_token_limit: effective.value,
    current_tokens_today: currentUsage,
    scope: effective.scope,
  };
}

type EndpointRateRuleKey =
  | 'endpoint.requests_per_minute'
  | 'endpoint.requests_per_5_hours'
  | 'endpoint.requests_per_day';

type EndpointSpendingRuleKey =
  | 'endpoint.spending_usd_per_minute'
  | 'endpoint.spending_usd_per_5_hours'
  | 'endpoint.spending_usd_per_day';

type EndpointRateLimitDecision =
  | {
    allowed: true;
    limits?: Array<{
      key: EndpointRateRuleKey;
      effective_limit: number;
      current_requests: number;
      window_seconds: number;
      scope: 'policy' | 'subject';
    }>;
  }
  | {
    allowed: false;
    reason: 'rate_limited';
    rate_key: EndpointRateRuleKey;
    effective_limit: number;
    current_requests: number;
    retry_after_seconds: number;
    window_seconds: number;
    scope: 'policy' | 'subject';
  };

type EndpointSpendingLimitDecision =
  | {
    allowed: true;
    limits?: Array<{
      key: EndpointSpendingRuleKey;
      effective_limit_usd: number;
      current_spending_usd: number;
      window_seconds: number;
      scope: 'policy' | 'subject';
    }>;
  }
  | {
    allowed: false;
    reason: 'spending_limited';
    spending_key: EndpointSpendingRuleKey;
    effective_limit_usd: number;
    current_spending_usd: number;
    retry_after_seconds: number;
    window_seconds: number;
    scope: 'policy' | 'subject';
  };

function endpointRateWindowMsForKey(key: EndpointRateRuleKey): number {
  if (key === 'endpoint.requests_per_minute') return 60_000;
  if (key === 'endpoint.requests_per_5_hours') return 5 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function endpointSpendingWindowMsForKey(key: EndpointSpendingRuleKey): number {
  if (key === 'endpoint.spending_usd_per_minute') return 60_000;
  if (key === 'endpoint.spending_usd_per_5_hours') return 5 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function isEndpointRateRuleKey(key: string): key is EndpointRateRuleKey {
  return key === 'endpoint.requests_per_minute'
    || key === 'endpoint.requests_per_5_hours'
    || key === 'endpoint.requests_per_day';
}

function isEndpointSpendingRuleKey(key: string): key is EndpointSpendingRuleKey {
  return key === 'endpoint.spending_usd_per_minute'
    || key === 'endpoint.spending_usd_per_5_hours'
    || key === 'endpoint.spending_usd_per_day';
}

function estimateRetryAfterSecondsFromFacts(
  nowMs: number,
  windowMs: number,
  facts: Array<{ timestamp: string }>,
): number {
  let oldestMs = Number.NaN;
  for (const fact of facts) {
    const ts = Date.parse(fact.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (!Number.isFinite(oldestMs) || ts < oldestMs) oldestMs = ts;
  }
  if (!Number.isFinite(oldestMs)) return Math.max(1, Math.ceil(windowMs / 1000));
  return Math.max(1, Math.ceil((oldestMs + windowMs - nowMs) / 1000));
}

function resolveEndpointRateRules(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord;
}): Array<{ key: EndpointRateRuleKey; value: number; scope: 'policy' | 'subject' }> {
  const baseRules = readPolicyRules(args.policy.rate_limits).filter((rule) => isEndpointRateRuleKey(rule.key));
  const subject = getMatchingSubjectRateRules(args);
  const effective = subject.matched ? mergeRateRules(baseRules, subject.rules) : baseRules;
  return effective
    .filter((rule) => isEndpointRateRuleKey(rule.key))
    .map((rule) => ({
      key: rule.key,
      value: rule.value,
      scope: subject.matched ? 'subject' : 'policy',
    }));
}

function resolveEndpointSpendingRules(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord;
}): Array<{ key: EndpointSpendingRuleKey; value: number; scope: 'policy' | 'subject' }> {
  const baseRules = readPolicyRulesRaw(args.policy.quota_limits).filter((rule) => isEndpointSpendingRuleKey(rule.key));
  const userRules = args.policy.allowed_subjects
    .filter((s) => s.subject_type === 'user' && s.subject_id === args.userId)
    .flatMap((s) => readPolicyRulesRaw(s.quota_limits))
    .filter((rule) => isEndpointSpendingRuleKey(rule.key));
  const groupIds = getProjectGroupIdsForUser(args.workspaceId, args.projectId, args.userId);
  const groupRules = args.policy.allowed_subjects
    .filter((s) => s.subject_type === 'group' && groupIds.includes(s.subject_id))
    .flatMap((s) => readPolicyRulesRaw(s.quota_limits))
    .filter((rule) => isEndpointSpendingRuleKey(rule.key));
  const subjectMatched = userRules.length > 0 || groupRules.length > 0;
  const effective = subjectMatched ? mergeQuotaRules(baseRules, mergeQuotaRules(userRules, groupRules)) : baseRules;
  return effective
    .filter((rule) => isEndpointSpendingRuleKey(rule.key))
    .map((rule) => ({
      key: rule.key,
      value: rule.value,
      scope: subjectMatched ? 'subject' : 'policy',
    }));
}

function estimateUsageFactCostUsd(args: {
  fact: {
    metadata_json?: Record<string, unknown>;
    tokens_total?: number;
  };
  estimatedCostPerTokenUsd?: number;
}): number {
  const metadata = args.fact.metadata_json;
  if (metadata) {
    const direct = metadata.cost_usd;
    if (typeof direct === 'number' && Number.isFinite(direct) && direct >= 0) return direct;
    const estimated = metadata.estimated_cost;
    if (typeof estimated === 'number' && Number.isFinite(estimated) && estimated >= 0) return estimated;
  }
  if (
    typeof args.fact.tokens_total === 'number'
    && Number.isFinite(args.fact.tokens_total)
    && args.fact.tokens_total > 0
    && typeof args.estimatedCostPerTokenUsd === 'number'
    && Number.isFinite(args.estimatedCostPerTokenUsd)
    && args.estimatedCostPerTokenUsd > 0
  ) {
    return args.fact.tokens_total * args.estimatedCostPerTokenUsd;
  }
  return 0;
}

export async function checkProjectEndpointRateLimitsForUser(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  resourceId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord | null;
  nowMs?: number;
}): Promise<EndpointRateLimitDecision> {
  if (!args.policy) return { allowed: true };
  const rules = resolveEndpointRateRules({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    policy: args.policy,
  });
  if (rules.length === 0) return { allowed: true };
  const nowMs = args.nowMs ?? Date.now();
  const maxWindowMs = Math.max(...rules.map((rule) => endpointRateWindowMsForKey(rule.key)));
  const facts = await listUsageFacts(args.docStore, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    startTime: new Date(nowMs - maxWindowMs).toISOString(),
    endTime: new Date(nowMs).toISOString(),
    resourceType: 'endpoint',
    resourceId: args.resourceId,
    endUserId: args.userId,
    result: 'ok',
  });

  const details: Array<{
    key: EndpointRateRuleKey;
    effective_limit: number;
    current_requests: number;
    window_seconds: number;
    scope: 'policy' | 'subject';
  }> = [];
  for (const rule of rules) {
    const windowMs = endpointRateWindowMsForKey(rule.key);
    const windowStartMs = nowMs - windowMs;
    const currentRequests = facts.reduce((sum, fact) => {
      const ts = Date.parse(fact.timestamp);
      if (!Number.isFinite(ts) || ts < windowStartMs) return sum;
      return sum + (Number.isFinite(fact.requests) ? (fact.requests ?? 0) : 0);
    }, 0);
    details.push({
      key: rule.key,
      effective_limit: rule.value,
      current_requests: currentRequests,
      window_seconds: Math.floor(windowMs / 1000),
      scope: rule.scope,
    });
    if (currentRequests >= rule.value) {
      return {
        allowed: false,
        reason: 'rate_limited',
        rate_key: rule.key,
        effective_limit: rule.value,
        current_requests: currentRequests,
        retry_after_seconds: estimateRetryAfterSecondsFromFacts(nowMs, windowMs, facts),
        window_seconds: Math.floor(windowMs / 1000),
        scope: rule.scope,
      };
    }
  }
  return { allowed: true, limits: details };
}

export async function checkProjectEndpointSpendingLimitsForUser(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  resourceId: string;
  userId: string;
  policy: ProjectResourcePolicyRecord | null;
  estimatedCostPerTokenUsd?: number;
  nowMs?: number;
}): Promise<EndpointSpendingLimitDecision> {
  if (!args.policy) return { allowed: true };
  const rules = resolveEndpointSpendingRules({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
    policy: args.policy,
  });
  if (rules.length === 0) return { allowed: true };
  const nowMs = args.nowMs ?? Date.now();
  const maxWindowMs = Math.max(...rules.map((rule) => endpointSpendingWindowMsForKey(rule.key)));
  const facts = await listUsageFacts(args.docStore, {
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    startTime: new Date(nowMs - maxWindowMs).toISOString(),
    endTime: new Date(nowMs).toISOString(),
    resourceType: 'endpoint',
    resourceId: args.resourceId,
    endUserId: args.userId,
    result: 'ok',
  });

  const details: Array<{
    key: EndpointSpendingRuleKey;
    effective_limit_usd: number;
    current_spending_usd: number;
    window_seconds: number;
    scope: 'policy' | 'subject';
  }> = [];
  for (const rule of rules) {
    const windowMs = endpointSpendingWindowMsForKey(rule.key);
    const windowStartMs = nowMs - windowMs;
    const currentSpendingUsd = facts.reduce((sum, fact) => {
      const ts = Date.parse(fact.timestamp);
      if (!Number.isFinite(ts) || ts < windowStartMs) return sum;
      return sum + estimateUsageFactCostUsd({
        fact,
        estimatedCostPerTokenUsd: args.estimatedCostPerTokenUsd,
      });
    }, 0);
    details.push({
      key: rule.key,
      effective_limit_usd: rule.value,
      current_spending_usd: Number(currentSpendingUsd.toFixed(6)),
      window_seconds: Math.floor(windowMs / 1000),
      scope: rule.scope,
    });
    if (currentSpendingUsd >= rule.value) {
      return {
        allowed: false,
        reason: 'spending_limited',
        spending_key: rule.key,
        effective_limit_usd: rule.value,
        current_spending_usd: Number(currentSpendingUsd.toFixed(6)),
        retry_after_seconds: estimateRetryAfterSecondsFromFacts(nowMs, windowMs, facts),
        window_seconds: Math.floor(windowMs / 1000),
        scope: rule.scope,
      };
    }
  }
  return { allowed: true, limits: details };
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
