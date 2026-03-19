/**
 * Legacy in-memory permission template store.
 *
 * Production permission templates are persisted via
 * `project-member-governance-persistence.ts`. This module is retained only for
 * legacy type/test compatibility.
 */
import {
  PROJECT_BUILT_IN_TEMPLATES,
} from './project-governance-model.js';

export type ProjectPermissionTemplateRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permissions: string[];
  built_in?: boolean;
  editable?: boolean;
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
  const now = new Date().toISOString();
  const next: ProjectPermissionTemplateRecord[] = Object.values(PROJECT_BUILT_IN_TEMPLATES).map((template) => ({
    id: template.id,
    project_id: projectId,
    name: template.name,
    description: template.description,
    permissions: [...template.permissions],
    built_in: true,
    editable: false,
    created_at: now,
    updated_at: now,
  }));
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
