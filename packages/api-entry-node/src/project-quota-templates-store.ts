type QuotaTemplateRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  overrides_json: Record<string, unknown>;
  built_in?: boolean;
  created_at: string;
  updated_at: string;
};

const PROJECT_QUOTA_TEMPLATES_BY_PROJECT = new Map<string, QuotaTemplateRecord[]>();

function projectScopedKey(workspaceId: string, projectId: string): string {
  return `${workspaceId}:${projectId}`;
}

export function getProjectQuotaTemplatesState(workspaceId: string, projectId: string): QuotaTemplateRecord[] {
  const key = projectScopedKey(workspaceId, projectId);
  const items = PROJECT_QUOTA_TEMPLATES_BY_PROJECT.get(key);
  if (items) return items;
  const created: QuotaTemplateRecord[] = [];
  PROJECT_QUOTA_TEMPLATES_BY_PROJECT.set(key, created);
  return created;
}

export function setProjectQuotaTemplatesState(
  workspaceId: string,
  projectId: string,
  items: QuotaTemplateRecord[],
): void {
  PROJECT_QUOTA_TEMPLATES_BY_PROJECT.set(projectScopedKey(workspaceId, projectId), items);
}

export type { QuotaTemplateRecord };
