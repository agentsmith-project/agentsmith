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
    rate: ['endpoint.requests_per_minute'],
    quota: ['endpoint.daily_token_limit', 'endpoint.requests_per_day'],
  },
  source_library: {
    rate: ['source_library.requests_per_minute'],
    quota: ['source_library.max_total_files', 'source_library.max_file_size_bytes'],
  },
  agent: {
    rate: ['agent.requests_per_minute'],
    quota: [],
  },
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
      key: 'endpoint.requests_per_day',
      bucket: 'quota',
      labelKey: 'rules.endpoint.requests_per_day',
      window: 'day',
      rootInputId: 'resource-policy-endpoint-requests-per-day',
      rootTestId: 'resource-policy__endpoint-requests-per-day',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.requests_per_day',
    },
  ],
  source_library: [
    {
      key: 'source_library.requests_per_minute',
      bucket: 'rate',
      labelKey: 'rules.source_library.requests_per_minute',
      rootInputId: 'resource-policy-library-requests-per-minute',
      rootTestId: 'resource-policy__library-requests-per-minute',
      subjectPlaceholderKey: 'subject_placeholders.source_library.requests_per_minute',
    },
    {
      key: 'source_library.max_total_files',
      bucket: 'quota',
      labelKey: 'rules.source_library.max_total_files',
      rootInputId: 'resource-policy-library-max-files',
      rootTestId: 'resource-policy__library-max-total-files',
      subjectPlaceholderKey: 'subject_placeholders.source_library.max_total_files',
    },
    {
      key: 'source_library.max_file_size_bytes',
      bucket: 'quota',
      labelKey: 'rules.source_library.max_file_size_bytes',
      rootInputId: 'resource-policy-library-max-file-size',
      rootTestId: 'resource-policy__library-max-file-size-bytes',
      subjectPlaceholderKey: 'subject_placeholders.source_library.max_file_size_bytes',
    },
  ],
  agent: [
    {
      key: 'agent.requests_per_minute',
      bucket: 'rate',
      labelKey: 'rules.agent.requests_per_minute',
      rootInputId: 'resource-policy-agent-requests-per-minute',
      rootTestId: 'resource-policy__agent-requests-per-minute',
      subjectPlaceholderKey: 'subject_placeholders.agent.requests_per_minute',
    },
  ],
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
  const allowed = RESOURCE_POLICY_RULE_MATRIX[resourceType];
  const invalidRateKeys = findInvalidRuleKeys(rateLimits?.rules, allowed.rate);
  const invalidQuotaKeys = findInvalidRuleKeys(quotaLimits?.rules, allowed.quota);
  const invalidKeys = [...invalidRateKeys, ...invalidQuotaKeys];

  if (invalidKeys.length > 0) {
    return { valid: false, invalidKeys };
  }

  return { valid: true };
}
