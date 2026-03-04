type SubjectType = 'group' | 'user';
type ResourceType = 'endpoint' | 'source_library' | 'agent';

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

export function getProjectResourcePolicy(
  workspaceId: string,
  projectId: string,
  resourceType: ResourceType,
  resourceId: string,
): ProjectResourcePolicyRecord | null {
  return getProjectPolicyState(workspaceId, projectId).get(policyKey(resourceType, resourceId)) ?? null;
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
  return (
    getProjectResourcePolicy(workspaceId, projectId, resourceType, resourceId)
    ?? {
      resource_type: resourceType,
      resource_id: resourceId,
      access_mode: 'allow_all_members',
      allowed_subjects: [],
    }
  );
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
  const userGroupIds = getProjectGroupIdsForUser(args.workspaceId, args.projectId, args.userId);
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
import { getProjectGroupIdsForUser } from './project-groups-store.js';
