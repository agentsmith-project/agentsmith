import type {
  PolicyQuotaLimit,
  PolicyRateLimit,
  PolicyResourceType,
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
    rate: [],
    quota: ['endpoint.daily_token_limit'],
  },
  source_library: {
    rate: [],
    quota: ['source_library.max_total_files', 'source_library.max_file_size_bytes'],
  },
  agent: {
    rate: ['agent.max_concurrency'],
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
      key: 'endpoint.daily_token_limit',
      bucket: 'quota',
      labelKey: 'rules.endpoint.daily_token_limit',
      window: 'day',
      rootInputId: 'resource-policy-endpoint-daily-tokens',
      rootTestId: 'resource-policy__endpoint-daily-token-limit',
      subjectPlaceholderKey: 'subject_placeholders.endpoint.daily_token_limit',
    },
  ],
  source_library: [
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
      key: 'agent.max_concurrency',
      bucket: 'rate',
      labelKey: 'rules.agent.max_concurrency',
      rootInputId: 'resource-policy-agent-concurrency',
      rootTestId: 'resource-policy__agent-max-concurrency',
      subjectPlaceholderKey: 'subject_placeholders.agent.max_concurrency',
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
