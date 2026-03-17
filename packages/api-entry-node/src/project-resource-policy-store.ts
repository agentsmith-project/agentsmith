import { getAllProjectGroupIdsForUser } from './project-groups-store.js';

type SubjectType = 'group' | 'user';
type ResourceType = 'endpoint' | 'file_library' | 'agent';

type PolicyRuleRecord = {
  key: string;
  value: number;
  window?: 'day';
};

export type ProjectResourcePolicyRecord = {
  resource_type: ResourceType;
  resource_id: string;
  access_mode: 'allow_all_members' | 'allow_list';
  allowed_subjects: Array<{
    subject_type: SubjectType;
    subject_id: string;
    rate_limits?: Record<string, unknown>;
    spending_limits?: Record<string, unknown>;
    updated_at?: string;
  }>;
  rate_limits?: Record<string, unknown>;
  spending_limits?: Record<string, unknown>;
};

const PROJECT_RESOURCE_POLICIES_BY_PROJECT = new Map<string, Map<string, ProjectResourcePolicyRecord>>();

const DEFAULT_ENDPOINT_RATE_RULES: PolicyRuleRecord[] = [
  { key: 'endpoint.requests_per_minute', value: 120 },
  { key: 'endpoint.requests_per_5_hours', value: 6000 },
  { key: 'endpoint.requests_per_day', value: 20000, window: 'day' },
];

const DEFAULT_ENDPOINT_SPENDING_RULES: PolicyRuleRecord[] = [
  { key: 'endpoint.spending_usd_per_minute', value: 5 },
  { key: 'endpoint.spending_usd_per_5_hours', value: 100 },
  { key: 'endpoint.spending_usd_per_day', value: 400, window: 'day' },
];

function projectScopedKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

function policyKey(resourceType: string, resourceId: string) {
  return `${resourceType}:${resourceId}`;
}

function getProjectPolicyState(workspaceId: string, projectId: string) {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_RESOURCE_POLICIES_BY_PROJECT.get(key);
  if (existing) return existing;
  const map = new Map<string, ProjectResourcePolicyRecord>();
  PROJECT_RESOURCE_POLICIES_BY_PROJECT.set(key, map);
  return map;
}

function readPolicyRules(input: unknown): PolicyRuleRecord[] {
  if (!input || typeof input !== 'object') return [];
  const rules = (input as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];
  return rules.flatMap((rule) => {
    if (!rule || typeof rule !== 'object') return [];
    const key = typeof (rule as { key?: unknown }).key === 'string'
      ? (rule as { key: string }).key
      : null;
    const value = typeof (rule as { value?: unknown }).value === 'number'
      ? (rule as { value: number }).value
      : null;
    const window = (rule as { window?: unknown }).window === 'day' ? 'day' : undefined;
    if (!key || value === null) return [];
    return [{ key, value, ...(window ? { window } : {}) }];
  });
}

function toRulePayload(rules: PolicyRuleRecord[]): Record<string, unknown> | undefined {
  if (rules.length === 0) return undefined;
  return {
    rules: rules.map((rule) => ({
      key: rule.key,
      value: rule.value,
      ...(rule.window ? { window: rule.window } : {}),
    })),
  };
}

function mergePolicyRules(base: PolicyRuleRecord[], overrides: PolicyRuleRecord[]): PolicyRuleRecord[] {
  const merged = new Map<string, PolicyRuleRecord>();
  for (const rule of base) {
    merged.set(rule.key, rule);
  }
  for (const rule of overrides) {
    merged.set(rule.key, rule);
  }
  return Array.from(merged.values());
}

function buildDefaultPolicy(resourceType: ResourceType, resourceId: string): ProjectResourcePolicyRecord {
  if (resourceType === 'endpoint') {
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: toRulePayload(DEFAULT_ENDPOINT_RATE_RULES),
      spending_limits: toRulePayload(DEFAULT_ENDPOINT_SPENDING_RULES),
    };
  }
  return {
    resource_type: resourceType,
    resource_id: resourceId,
    access_mode: 'allow_all_members',
    allowed_subjects: [],
  };
}

export function getProjectResourcePolicy(
  workspaceId: string,
  projectId: string,
  resourceType: ResourceType,
  resourceId: string,
): ProjectResourcePolicyRecord | null {
  return getProjectPolicyState(workspaceId, projectId).get(policyKey(resourceType, resourceId)) ?? null;
}

export function listProjectResourcePolicies(
  workspaceId: string,
  projectId: string,
  resourceType?: ResourceType,
): ProjectResourcePolicyRecord[] {
  const policies = Array.from(getProjectPolicyState(workspaceId, projectId).values());
  if (!resourceType) {
    return policies;
  }
  return policies.filter((policy) => policy.resource_type === resourceType);
}

export function upsertProjectResourcePolicy(
  workspaceId: string,
  projectId: string,
  policy: ProjectResourcePolicyRecord,
): void {
  getProjectPolicyState(workspaceId, projectId).set(policyKey(policy.resource_type, policy.resource_id), policy);
}

export function getProjectResourcePolicyOrDefault(
  workspaceId: string,
  projectId: string,
  resourceType: ResourceType,
  resourceId: string,
): ProjectResourcePolicyRecord {
  const existing = getProjectResourcePolicy(workspaceId, projectId, resourceType, resourceId);
  const defaults = buildDefaultPolicy(resourceType, resourceId);
  if (!existing) {
    return defaults;
  }
  if (resourceType !== 'endpoint') {
    return existing;
  }
  return {
    ...existing,
    rate_limits: toRulePayload(
      mergePolicyRules(
        readPolicyRules(defaults.rate_limits),
        readPolicyRules(existing.rate_limits),
      ),
    ),
    spending_limits: toRulePayload(
      mergePolicyRules(
        readPolicyRules(defaults.spending_limits),
        readPolicyRules(existing.spending_limits),
      ),
    ),
  };
}

export function isProjectResourceAccessAllowedForUser(args: {
  workspaceId: string;
  projectId: string;
  resourceType: ResourceType;
  resourceId: string;
  userId: string;
}): { allowed: boolean; policy: ProjectResourcePolicyRecord | null; reason?: 'not_in_allow_list' } {
  const policy = getProjectResourcePolicy(args.workspaceId, args.projectId, args.resourceType, args.resourceId);
  if (!policy || policy.access_mode === 'allow_all_members') {
    return { allowed: true, policy };
  }
  const userMatch = policy.allowed_subjects.some(
    (subject) => subject.subject_type === 'user' && subject.subject_id === args.userId,
  );
  if (userMatch) {
    return { allowed: true, policy };
  }
  const userGroupIds = getAllProjectGroupIdsForUser({
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.userId,
  });
  if (
    userGroupIds.length > 0
    && policy.allowed_subjects.some(
      (subject) => subject.subject_type === 'group' && userGroupIds.includes(subject.subject_id),
    )
  ) {
    return { allowed: true, policy };
  }
  return { allowed: false, policy, reason: 'not_in_allow_list' };
}
