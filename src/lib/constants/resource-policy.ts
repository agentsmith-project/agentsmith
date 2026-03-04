import type {
  PolicyQuotaLimit,
  PolicyRateLimit,
  PolicyResourceType,
  ResourcePolicy,
  PolicyRule,
  PolicyRuleKey,
} from '@/lib/api/types';

export const RESOURCE_POLICY_RULE_MATRIX: Record<
  PolicyResourceType,
  {
    rate: PolicyRuleKey[];
    quota: PolicyRuleKey[];
  }
> = {
  endpoint: {
    rate: ['endpoint.requests_per_minute', 'endpoint.requests_per_5_hours', 'endpoint.requests_per_day'],
    quota: [
      'endpoint.daily_token_limit',
      'endpoint.spending_usd_per_minute',
      'endpoint.spending_usd_per_5_hours',
      'endpoint.spending_usd_per_day',
    ],
  },
  source_library: { rate: [], quota: [] },
  agent: { rate: [], quota: [] },
};

export type PolicyRuleBucket = 'rate' | 'quota';

export interface ResourcePolicyRuleDefinition {
  key: PolicyRuleKey;
  bucket: PolicyRuleBucket;
  labelKey: string;
  window?: 'day' | null;
  rootInputId: string;
  rootTestId: string;
  subjectPlaceholderKey: string;
}

export const RESOURCE_POLICY_RULE_DEFINITIONS: Record<PolicyResourceType, ResourcePolicyRuleDefinition[]> = {
  endpoint: [
    {
      key: 'endpoint.requests_per_minute',
      bucket: 'rate',
      labelKey: 'rules.endpoint.requests_per_minute',
      rootInputId: 'resource-policy-endpoint-requests-per-minute',
      rootTestId: 'resource-policy__endpoint-requests-per-minute',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.requests_per_minute',
    },
    {
      key: 'endpoint.daily_token_limit',
      bucket: 'quota',
      labelKey: 'rules.endpoint.daily_token_limit',
      window: 'day',
      rootInputId: 'resource-policy-endpoint-daily-tokens',
      rootTestId: 'resource-policy__endpoint-daily-token-limit',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.daily_token_limit',
    },
    {
      key: 'endpoint.requests_per_5_hours',
      bucket: 'rate',
      labelKey: 'rules.endpoint.requests_per_5_hours',
      rootInputId: 'resource-policy-endpoint-requests-per-5-hours',
      rootTestId: 'resource-policy__endpoint-requests-per-5-hours',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.requests_per_5_hours',
    },
    {
      key: 'endpoint.requests_per_day',
      bucket: 'rate',
      labelKey: 'rules.endpoint.requests_per_day',
      window: 'day',
      rootInputId: 'resource-policy-endpoint-requests-per-day',
      rootTestId: 'resource-policy__endpoint-requests-per-day',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.requests_per_day',
    },
    {
      key: 'endpoint.spending_usd_per_minute',
      bucket: 'quota',
      labelKey: 'rules.endpoint.spending_usd_per_minute',
      rootInputId: 'resource-policy-endpoint-spending-usd-per-minute',
      rootTestId: 'resource-policy__endpoint-spending-usd-per-minute',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.spending_usd_per_minute',
    },
    {
      key: 'endpoint.spending_usd_per_5_hours',
      bucket: 'quota',
      labelKey: 'rules.endpoint.spending_usd_per_5_hours',
      rootInputId: 'resource-policy-endpoint-spending-usd-per-5-hours',
      rootTestId: 'resource-policy__endpoint-spending-usd-per-5-hours',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.spending_usd_per_5_hours',
    },
    {
      key: 'endpoint.spending_usd_per_day',
      bucket: 'quota',
      labelKey: 'rules.endpoint.spending_usd_per_day',
      window: 'day',
      rootInputId: 'resource-policy-endpoint-spending-usd-per-day',
      rootTestId: 'resource-policy__endpoint-spending-usd-per-day',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.spending_usd_per_day',
    },
  ],
  source_library: [],
  agent: [],
};

export function getRuleDefinitionsForResource(resourceType: PolicyResourceType): ResourcePolicyRuleDefinition[] {
  return RESOURCE_POLICY_RULE_DEFINITIONS[resourceType];
}

export function getRuleLabel(key: PolicyRuleKey): string {
  const definition = Object.values(RESOURCE_POLICY_RULE_DEFINITIONS)
    .flat()
    .find((item) => item.key === key);
  return definition?.labelKey ?? key;
}

export function mergeRuleSets(baseRules: PolicyRule[], subjectRules: PolicyRule[]): PolicyRule[] {
  const merged = new Map<PolicyRuleKey, PolicyRule>();
  for (const rule of baseRules) {
    merged.set(rule.key, rule);
  }
  for (const rule of subjectRules) {
    merged.set(rule.key, rule);
  }
  return Array.from(merged.values());
}

export type ResourcePolicyStatus = 'default' | 'overridden' | 'allow_list';

export interface ResourcePolicyStatusMeta {
  status: ResourcePolicyStatus;
  labelKey: 'resource_status.default' | 'resource_status.overridden' | 'resource_status.allow_list';
  reasonKey:
    | 'resource_status_reason.default'
    | 'resource_status_reason.overridden'
    | 'resource_status_reason.allow_list';
}

export function getResourcePolicyStatus(policy: ResourcePolicy | undefined): ResourcePolicyStatusMeta {
  if (!policy) {
    return {
      status: 'default',
      labelKey: 'resource_status.default',
      reasonKey: 'resource_status_reason.default',
    };
  }

  if (policy.access_mode === 'allow_list') {
    return {
      status: 'allow_list',
      labelKey: 'resource_status.allow_list',
      reasonKey: 'resource_status_reason.allow_list',
    };
  }

  const hasSubjectOverrides = policy.allowed_subjects.length > 0;
  const hasRootRateRules = (policy.rate_limits?.rules.length ?? 0) > 0;
  const hasRootQuotaRules = (policy.quota_limits?.rules.length ?? 0) > 0;
  if (hasSubjectOverrides || hasRootRateRules || hasRootQuotaRules) {
    return {
      status: 'overridden',
      labelKey: 'resource_status.overridden',
      reasonKey: 'resource_status_reason.overridden',
    };
  }

  return {
    status: 'default',
    labelKey: 'resource_status.default',
    reasonKey: 'resource_status_reason.default',
  };
}

function findInvalidRuleKeys(
  rules: Array<{ key: PolicyRuleKey }> | undefined,
  allowedKeys: PolicyRuleKey[]
): PolicyRuleKey[] {
  if (!rules || rules.length === 0) return [];
  return rules
    .map((rule) => rule.key)
    .filter((key) => !allowedKeys.includes(key));
}

export function validatePolicyRulesForResource(
  resourceType: PolicyResourceType,
  rateLimits?: PolicyRateLimit,
  quotaLimits?: PolicyQuotaLimit
): { valid: true } | { valid: false; invalidKeys: PolicyRuleKey[] } {
  if (resourceType !== 'endpoint') {
    const unsupportedKeys = [
      ...(rateLimits?.rules?.map((rule) => rule.key) ?? []),
      ...(quotaLimits?.rules?.map((rule) => rule.key) ?? []),
    ];
    return {
      valid: false,
      invalidKeys: unsupportedKeys,
    };
  }
  const allowed = RESOURCE_POLICY_RULE_MATRIX[resourceType];
  const invalidRateKeys = findInvalidRuleKeys(rateLimits?.rules, allowed.rate);
  const invalidQuotaKeys = findInvalidRuleKeys(quotaLimits?.rules, allowed.quota);
  const invalidKeys = [...invalidRateKeys, ...invalidQuotaKeys];

  if (invalidKeys.length > 0) {
    return { valid: false, invalidKeys };
  }

  return { valid: true };
}
