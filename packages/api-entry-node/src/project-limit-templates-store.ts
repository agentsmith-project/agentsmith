type LimitTemplateRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  overrides_json: Record<string, unknown>;
  built_in?: boolean;
  created_at: string;
  updated_at: string;
};

const PROJECT_LIMIT_TEMPLATES_BY_PROJECT = new Map<string, LimitTemplateRecord[]>();

function projectScopedKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

export function getProjectLimitTemplatesState(workspaceId: string, projectId: string): LimitTemplateRecord[] {
  const key = projectScopedKey(workspaceId, projectId);
  const items = PROJECT_LIMIT_TEMPLATES_BY_PROJECT.get(key);
  if (items) return items;
  const created: LimitTemplateRecord[] = [];
  PROJECT_LIMIT_TEMPLATES_BY_PROJECT.set(key, created);
  return created;
}

export function setProjectLimitTemplatesState(
  workspaceId: string,
  projectId: string,
  items: LimitTemplateRecord[],
): void {
  PROJECT_LIMIT_TEMPLATES_BY_PROJECT.set(projectScopedKey(workspaceId, projectId), items);
}

export type { LimitTemplateRecord };
