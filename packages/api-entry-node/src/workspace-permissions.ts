import type { WorkspaceRecord } from './resource-models.js';
import { getRegisteredWorkspaceConfig, readRegisteredWorkspaces } from './workspace-registry.js';

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

export const PROJECT_CREATOR_WORKSPACE_PERMISSIONS = [
  'workspace:read',
  'workspace:project:create',
] as const;

export const MEMBER_WORKSPACE_PERMISSIONS = [
  'workspace:read',
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

function identifierMatches(actorId: string, actorEmail: string | undefined, identifier: string | undefined): boolean {
  if (!identifier) return false;
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return false;
  return actorId.trim().toLowerCase() === normalized || actorEmail?.trim().toLowerCase() === normalized;
}

export function resolveWorkspacePermissions(args: {
  workspaceId: string;
  actorId: string;
  actorEmail?: string;
  defaultWorkspaceId?: string;
}): readonly string[] {
  const { workspaceId, actorId, actorEmail, defaultWorkspaceId } = args;
  const registered = getRegisteredWorkspaceConfig(workspaceId);
  if (registered) {
    if (identifierMatches(actorId, actorEmail, registered.workspace_admin)) {
      return OWNER_WORKSPACE_PERMISSIONS;
    }
    if ((registered.project_creators ?? []).some((entry) => identifierMatches(actorId, actorEmail, entry))) {
      return PROJECT_CREATOR_WORKSPACE_PERMISSIONS;
    }
    return MEMBER_WORKSPACE_PERMISSIONS;
  }
  return MEMBER_WORKSPACE_PERMISSIONS;
}

export function buildWorkspaceMembersFromConfig(args: {
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  actorName: string;
  workspaceCreatedAt: string;
  defaultWorkspaceId?: string;
}): Array<{
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'developer' | 'user';
  governance_group: 'wheel' | 'user';
  permissions: readonly string[];
  status: 'active';
  joined_at: string;
}> {
  const { workspaceId, actorId, actorEmail, actorName, workspaceCreatedAt, defaultWorkspaceId } = args;
  const registered = getRegisteredWorkspaceConfig(workspaceId);
  const members = new Map<string, {
    id: string;
    user_id: string;
    name: string;
    email: string;
    role: 'owner' | 'admin' | 'developer' | 'user';
    governance_group: 'wheel' | 'user';
    permissions: readonly string[];
    status: 'active';
    joined_at: string;
  }>();

  const pushMember = (identifier: string, role: 'admin' | 'developer', permissions: readonly string[]) => {
    const trimmed = identifier.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    members.set(key, {
      id: `wm_${trimmed}`,
      user_id: trimmed,
      name: trimmed,
      email: trimmed.includes('@') ? trimmed : `${trimmed}@workspace.local`,
      role,
      governance_group: role === 'admin' ? 'wheel' : 'user',
      permissions,
      status: 'active',
      joined_at: workspaceCreatedAt,
    });
  };

  if (registered?.workspace_admin) {
    pushMember(registered.workspace_admin, 'admin', OWNER_WORKSPACE_PERMISSIONS);
  }
  for (const identifier of registered?.project_creators ?? []) {
    if (registered?.workspace_admin && identifierMatches(identifier, undefined, registered.workspace_admin)) {
      continue;
    }
    pushMember(identifier, 'developer', PROJECT_CREATOR_WORKSPACE_PERMISSIONS);
  }

  const actorPermissions = resolveWorkspacePermissions({
    workspaceId,
    actorId,
    actorEmail,
    defaultWorkspaceId,
  });
  const actorKey = actorId.trim().toLowerCase();
  members.set(actorKey, {
    id: `wm_${actorId}`,
    user_id: actorId,
    name: actorName,
    email: actorEmail,
    role: actorPermissions.includes('workspace:governance:update')
      ? 'admin'
      : actorPermissions.includes('workspace:project:create')
        ? 'developer'
        : 'user',
    governance_group: actorPermissions.includes('workspace:governance:update') ? 'wheel' : 'user',
    permissions: actorPermissions,
    status: 'active',
    joined_at: workspaceCreatedAt,
  });

  return [...members.values()];
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
