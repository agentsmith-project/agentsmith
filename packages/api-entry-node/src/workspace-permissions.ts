import type { WorkspaceRecord } from './resource-models.js';

export const OWNER_PROJECT_PERMISSIONS = [
  'project:read',
  'project:chat:access',
  'project:notebook:access',
  'project:source:use',
  'project:source:manage',
  'project:endpoint:use',
  'project:endpoint:manage',
  'project:agent:use',
  'project:agent:manage',
  'project:resource_policy:manage',
  'project:credential:manage',
  'project:settings:manage',
  'project:member:view',
  'project:member:manage',
  'project:audit:view',
  'project:usage:view',
] as const;

const OPERATOR_PROJECT_PERMISSIONS = [
  'project:read',
  'project:chat:access',
  'project:source:use',
  'project:source:manage',
  'project:endpoint:use',
  'project:endpoint:manage',
  'project:credential:manage',
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
