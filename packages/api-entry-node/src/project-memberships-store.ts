export type ProjectMembershipRecord = {
  project_id: string;
  user_id: string;
  role: string;
  status: 'active' | 'pending' | 'suspended';
  joined_at: string;
  approved_via_join_request_id?: string;
};

const PROJECT_MEMBERSHIPS_BY_PROJECT = new Map<string, Map<string, ProjectMembershipRecord>>();

function projectScopedKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

export function getProjectMembershipsState(
  workspaceId: string,
  projectId: string,
): Map<string, ProjectMembershipRecord> {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_MEMBERSHIPS_BY_PROJECT.get(key);
  if (existing) return existing;
  const next = new Map<string, ProjectMembershipRecord>();
  PROJECT_MEMBERSHIPS_BY_PROJECT.set(key, next);
  return next;
}

export function upsertProjectMembership(
  workspaceId: string,
  projectId: string,
  membership: ProjectMembershipRecord,
): void {
  const state = getProjectMembershipsState(workspaceId, projectId);
  state.set(membership.user_id, membership);
}
