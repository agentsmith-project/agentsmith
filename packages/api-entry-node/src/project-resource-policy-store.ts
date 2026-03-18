import type { JsonDocStorePort } from '@mbos/ports';
import { getAllProjectGroupIdsForUserPersisted } from './project-member-governance-persistence.js';

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

const PROJECT_RESOURCE_POLICY_COLLECTION = 'project_resource_policies';

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

type StoredProjectResourcePolicyRecord = ProjectResourcePolicyRecord & {
  id: string;
  workspace_id: string;
  project_id: string;
};

function policyKey(resourceType: string, resourceId: string) {
  return `${resourceType}:${resourceId}`;
}

function buildStoredPolicyRecord(args: {
  workspaceId: string;
  projectId: string;
  policy: ProjectResourcePolicyRecord;
}): StoredProjectResourcePolicyRecord {
  return {
    id: policyKey(args.policy.resource_type, args.policy.resource_id),
    workspace_id: args.workspaceId,
    project_id: args.projectId,
    ...args.policy,
  };
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

function toPublicPolicy(record: StoredProjectResourcePolicyRecord): ProjectResourcePolicyRecord {
  return {
    resource_type: record.resource_type,
    resource_id: record.resource_id,
    access_mode: record.access_mode,
    allowed_subjects: record.allowed_subjects.map((subject) => ({ ...subject })),
    rate_limits: record.rate_limits,
    spending_limits: record.spending_limits,
  };
}

export class JsonDocProjectResourcePolicyRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  async getByResource(
    workspaceId: string,
    projectId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<ProjectResourcePolicyRecord | null> {
    const stored = await this.docStore.get<StoredProjectResourcePolicyRecord>(
      PROJECT_RESOURCE_POLICY_COLLECTION,
      policyKey(resourceType, resourceId),
    );
    if (!stored) return null;
    if (stored.workspace_id !== workspaceId || stored.project_id !== projectId) {
      return null;
    }
    return toPublicPolicy(stored);
  }

  async listByProject(
    workspaceId: string,
    projectId: string,
    resourceType?: ResourceType,
  ): Promise<ProjectResourcePolicyRecord[]> {
    const items = await this.docStore.list<StoredProjectResourcePolicyRecord>(
      PROJECT_RESOURCE_POLICY_COLLECTION,
      {
        workspace_id: workspaceId,
        project_id: projectId,
        ...(resourceType ? { resource_type: resourceType } : {}),
      },
    );
    return items.map(toPublicPolicy);
  }

  async save(
    workspaceId: string,
    projectId: string,
    policy: ProjectResourcePolicyRecord,
  ): Promise<void> {
    const stored = buildStoredPolicyRecord({ workspaceId, projectId, policy });
    await this.docStore.upsert(PROJECT_RESOURCE_POLICY_COLLECTION, stored.id, stored);
  }
}

export async function getProjectResourcePolicy(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  resourceType: ResourceType,
  resourceId: string,
): Promise<ProjectResourcePolicyRecord | null> {
  return new JsonDocProjectResourcePolicyRepo(docStore).getByResource(
    workspaceId,
    projectId,
    resourceType,
    resourceId,
  );
}

export async function listProjectResourcePolicies(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  resourceType?: ResourceType,
): Promise<ProjectResourcePolicyRecord[]> {
  return new JsonDocProjectResourcePolicyRepo(docStore).listByProject(workspaceId, projectId, resourceType);
}

export async function upsertProjectResourcePolicy(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  policy: ProjectResourcePolicyRecord,
): Promise<void> {
  await new JsonDocProjectResourcePolicyRepo(docStore).save(workspaceId, projectId, policy);
}

export async function getProjectResourcePolicyOrDefault(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  resourceType: ResourceType,
  resourceId: string,
): Promise<ProjectResourcePolicyRecord> {
  const existing = await getProjectResourcePolicy(docStore, workspaceId, projectId, resourceType, resourceId);
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

export async function isProjectResourceAccessAllowedForUser(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  resourceType: ResourceType;
  resourceId: string;
  userId: string;
}): Promise<{ allowed: boolean; policy: ProjectResourcePolicyRecord | null; reason?: 'not_in_allow_list' }> {
  const policy = await getProjectResourcePolicy(
    args.docStore,
    args.workspaceId,
    args.projectId,
    args.resourceType,
    args.resourceId,
  );
  if (!policy || policy.access_mode === 'allow_all_members') {
    return { allowed: true, policy };
  }
  const userMatch = policy.allowed_subjects.some(
    (subject) => subject.subject_type === 'user' && subject.subject_id === args.userId,
  );
  if (userMatch) {
    return { allowed: true, policy };
  }
  const userGroupIds = await getAllProjectGroupIdsForUserPersisted({
    docStore: args.docStore,
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
