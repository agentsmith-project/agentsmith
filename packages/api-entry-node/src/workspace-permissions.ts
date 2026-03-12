import type { WorkspaceRecord } from './resource-models.js';
import { readRegisteredWorkspaces } from './workspace-registry.js';

export const OWNER_PROJECT_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent:manage',
  'project:agent:public',
  'project:manage',
] as const;

export const PROJECT_ADMIN_PROJECT_PERMISSIONS = [
  ...OWNER_PROJECT_PERMISSIONS,
] as const;

const OPERATOR_PROJECT_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent:manage',
] as const;

export const OWNER_WORKSPACE_PERMISSIONS = [
  'workspace:read',
  'workspace:project:create',
  'workspace:governance:update',
] as const;

export function resolveProjectPermissions(ownerId: string, actorId: string): readonly string[] {
  if (ownerId === actorId) {
    return OWNER_PROJECT_PERMISSIONS;
  }
  return OPERATOR_PROJECT_PERMISSIONS;
}

export function readProjectAdminIds(governanceJson: unknown): string[] {
  if (typeof governanceJson !== 'object' || governanceJson === null) return [];
  const rawAdmins = (governanceJson as Record<string, unknown>).project_admins;
  if (!Array.isArray(rawAdmins)) return [];

  const ids: string[] = [];
  for (const item of rawAdmins) {
    if (typeof item === 'string' && item.trim().length > 0) {
      ids.push(item.trim());
      continue;
    }
    if (typeof item === 'object' && item !== null) {
      const maybeId = (item as Record<string, unknown>).id;
      if (typeof maybeId === 'string' && maybeId.trim().length > 0) {
        ids.push(maybeId.trim());
      }
    }
  }
  return Array.from(new Set(ids));
}

export function isProjectAdmin(governanceJson: unknown, actorId: string): boolean {
  return readProjectAdminIds(governanceJson).includes(actorId);
}

export function buildWorkspaceRecords(): WorkspaceRecord[] {
  const now = new Date().toISOString();
  const workspaceId = process.env.MBOS_DEFAULT_WORKSPACE_ID ?? 'ws_default';
  const workspaceName = process.env.MBOS_DEFAULT_WORKSPACE_NAME ?? 'Default Workspace';
  const defaults: WorkspaceRecord[] = [{
    id: workspaceId,
    name: workspaceName,
    created_at: now,
    updated_at: now,
  }];
  const merged = new Map<string, WorkspaceRecord>();
  for (const item of defaults) {
    merged.set(item.id, item);
  }
  for (const item of readRegisteredWorkspaces()) {
    merged.set(item.id, item);
  }
  return [...merged.values()];
}
