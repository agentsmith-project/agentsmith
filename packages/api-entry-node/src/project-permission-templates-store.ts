export type ProjectPermissionTemplateRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permissions: string[];
  built_in?: boolean;
  created_at: string;
  updated_at: string;
};

const PROJECT_PERMISSION_TEMPLATES_BY_PROJECT = new Map<string, ProjectPermissionTemplateRecord[]>();

function projectScopedKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

export function getProjectPermissionTemplatesState(workspaceId: string, projectId: string): ProjectPermissionTemplateRecord[] {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.get(key);
  if (existing) return existing;
  const next: ProjectPermissionTemplateRecord[] = [];
  PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.set(key, next);
  return next;
}

export function setProjectPermissionTemplatesState(
  workspaceId: string,
  projectId: string,
  templates: ProjectPermissionTemplateRecord[],
): void {
  PROJECT_PERMISSION_TEMPLATES_BY_PROJECT.set(projectScopedKey(workspaceId, projectId), templates);
}
