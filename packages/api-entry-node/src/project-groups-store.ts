export type ProjectGroupRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permission_template_id: string;
  member_ids: string[];
  created_at: string;
  updated_at: string;
};

const PROJECT_GROUPS_BY_PROJECT = new Map<string, ProjectGroupRecord[]>();

function projectScopedKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

export function getProjectGroupsState(workspaceId: string, projectId: string): ProjectGroupRecord[] {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_GROUPS_BY_PROJECT.get(key);
  if (existing) return existing;
  const next: ProjectGroupRecord[] = [];
  PROJECT_GROUPS_BY_PROJECT.set(key, next);
  return next;
}

export function setProjectGroupsState(workspaceId: string, projectId: string, groups: ProjectGroupRecord[]): void {
  PROJECT_GROUPS_BY_PROJECT.set(projectScopedKey(workspaceId, projectId), groups);
}

export function getProjectGroupIdsForUser(workspaceId: string, projectId: string, userId: string): string[] {
  const groups = getProjectGroupsState(workspaceId, projectId);
  return groups.filter((group) => group.member_ids.includes(userId)).map((group) => group.id);
}
