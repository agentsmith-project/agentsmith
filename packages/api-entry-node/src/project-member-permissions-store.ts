/**
 * Legacy in-memory member permission store.
 *
 * Production member permission state is persisted via
 * `project-member-governance-persistence.ts`. Keep this file type-only /
 * test-only.
 */
export type ProjectMemberPermissionState = {
  mode: 'template' | 'custom';
  template?: string | null;
  permissions: string[];
};

const PROJECT_MEMBER_PERMISSIONS_BY_PROJECT = new Map<string, Map<string, ProjectMemberPermissionState>>();

function projectScopedKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

export function getProjectMemberPermissionsState(
  workspaceId: string,
  projectId: string,
): Map<string, ProjectMemberPermissionState> {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_MEMBER_PERMISSIONS_BY_PROJECT.get(key);
  if (existing) return existing;
  const next = new Map<string, ProjectMemberPermissionState>();
  PROJECT_MEMBER_PERMISSIONS_BY_PROJECT.set(key, next);
  return next;
}
