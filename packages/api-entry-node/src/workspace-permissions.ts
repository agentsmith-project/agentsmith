import type { WorkspaceRecord } from './resource-models.js';

export const OWNER_PROJECT_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent:manage',
  'project:agent:public',
  'project:manage',
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

export function buildWorkspaceRecords(): WorkspaceRecord[] {
  const now = new Date().toISOString();
  const workspaceId = process.env.MBOS_DEFAULT_WORKSPACE_ID ?? 'ws_default';
  const workspaceName = process.env.MBOS_DEFAULT_WORKSPACE_NAME ?? 'Default Workspace';
  return [{
    id: workspaceId,
    name: workspaceName,
    created_at: now,
    updated_at: now,
  }];
}
