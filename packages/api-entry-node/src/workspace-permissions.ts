import type { WorkspaceRecord } from './resource-models.js';
import {
  bindRegisteredWorkspaceAdminIfMatched,
  getRegisteredWorkspaceConfig,
  readRegisteredWorkspaces,
} from './workspace-registry.js';
import {
  WORKSPACE_BUILT_IN_GROUPS,
  WORKSPACE_BUILT_IN_TEMPLATE_IDS,
} from './workspace-governance-model.js';

export const OWNER_PROJECT_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent:manage',
  'project:agent:public',
  'project:audit:read',
  'project:files:update',
  'project:governance:update',
  'project:membership:update',
  'project:admins:update',
  'project:lifecycle:update',
] as const;

export const PROJECT_ADMIN_PROJECT_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent:manage',
  'project:agent:public',
  'project:audit:read',
  'project:files:update',
  'project:governance:update',
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

function identifierMatches(actorId: string, actorEmail: string | undefined, identifier: string | undefined): boolean {
  if (!identifier) return false;
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return false;
  return actorId.trim().toLowerCase() === normalized || actorEmail?.trim().toLowerCase() === normalized;
}

function snapshotMatchesActor(
  actorId: string,
  actorEmail: string | undefined,
  snapshot: { user_id: string; email: string } | undefined,
): boolean {
  if (!snapshot) return false;
  const normalizedActorId = actorId.trim().toLowerCase();
  const normalizedActorEmail = actorEmail?.trim().toLowerCase();
  return normalizedActorId === snapshot.user_id.trim().toLowerCase()
    || normalizedActorEmail === snapshot.email.trim().toLowerCase();
}

export async function resolveWorkspacePermissions(args: {
  workspaceId: string;
  actorId: string;
  actorEmail?: string;
  defaultWorkspaceId?: string;
}): Promise<readonly string[]> {
  const { workspaceId, actorId, actorEmail, defaultWorkspaceId } = args;
  const registered = await bindRegisteredWorkspaceAdminIfMatched({
    workspaceId,
    actorId,
    actorEmail,
  }) ?? await getRegisteredWorkspaceConfig(workspaceId);
  if (registered) {
    if (
      (registered.workspace_admin_user_id && registered.workspace_admin && snapshotMatchesActor(actorId, actorEmail, {
        user_id: registered.workspace_admin_user_id,
        email: registered.workspace_admin,
      }))
      || identifierMatches(actorId, actorEmail, registered.workspace_admin)
    ) {
      return OWNER_WORKSPACE_PERMISSIONS;
    }
    if ((registered.project_creators ?? []).some((entry) => snapshotMatchesActor(actorId, actorEmail, entry))) {
      return PROJECT_CREATOR_WORKSPACE_PERMISSIONS;
    }
    return MEMBER_WORKSPACE_PERMISSIONS;
  }
  return MEMBER_WORKSPACE_PERMISSIONS;
}

export async function buildWorkspaceMembersFromConfig(args: {
  workspaceId: string;
  actorId: string;
  actorEmail: string;
  actorName: string;
  workspaceCreatedAt: string;
  defaultWorkspaceId?: string;
}): Promise<Array<{
  id: string;
  user_id: string;
  name: string;
  email: string;
  groups: Array<{
    id: string;
    name: string;
    permission_template_id: string;
    built_in: boolean;
    system_key?: string;
  }>;
  permissions: readonly string[];
  status: 'active';
  joined_at: string;
}>> {
  const { workspaceId, actorId, actorEmail, actorName, workspaceCreatedAt, defaultWorkspaceId } = args;
  const registered = await bindRegisteredWorkspaceAdminIfMatched({
    workspaceId,
    actorId,
    actorEmail,
    actorName,
  }) ?? await getRegisteredWorkspaceConfig(workspaceId);
  const members = new Map<string, {
    id: string;
    user_id: string;
    name: string;
    email: string;
    groups: Array<{
      id: string;
      name: string;
      permission_template_id: string;
      built_in: boolean;
      system_key?: string;
    }>;
    permissions: readonly string[];
    status: 'active';
    joined_at: string;
  }>();

  const pushMember = (
    member: { user_id: string; email: string; name: string | null },
    group: typeof WORKSPACE_BUILT_IN_GROUPS.owner | typeof WORKSPACE_BUILT_IN_GROUPS.projectCreators,
    permissions: readonly string[],
  ) => {
    const userId = member.user_id.trim();
    if (!userId) return;
    const key = userId.toLowerCase();
    members.set(key, {
      id: `wm_${userId}`,
      user_id: userId,
      name: member.name || member.email || userId,
      email: member.email,
      groups: [{
        id: group.id,
        name: group.name,
        permission_template_id: group.permission_template_id,
        built_in: true,
        system_key: group.system_key,
      }],
      permissions,
      status: 'active',
      joined_at: workspaceCreatedAt,
    });
  };

  if (registered?.workspace_admin_user_id && registered.workspace_admin) {
    pushMember(
      {
        user_id: registered.workspace_admin_user_id,
        email: registered.workspace_admin,
        name: registered.workspace_admin_name ?? null,
      },
      WORKSPACE_BUILT_IN_GROUPS.owner,
      OWNER_WORKSPACE_PERMISSIONS,
    );
  } else if (registered?.workspace_admin) {
    pushMember(
      {
        user_id: registered.workspace_admin,
        email: registered.workspace_admin.includes('@')
          ? registered.workspace_admin
          : `${registered.workspace_admin}@workspace.local`,
        name: registered.workspace_admin,
      },
      WORKSPACE_BUILT_IN_GROUPS.owner,
      OWNER_WORKSPACE_PERMISSIONS,
    );
  }
  for (const creator of registered?.project_creators ?? []) {
    if (registered?.workspace_admin_user_id && creator.user_id === registered.workspace_admin_user_id) {
      continue;
    }
    pushMember(creator, WORKSPACE_BUILT_IN_GROUPS.projectCreators, PROJECT_CREATOR_WORKSPACE_PERMISSIONS);
  }

  const actorPermissions = await resolveWorkspacePermissions({
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
    groups: actorPermissions.includes('workspace:governance:update')
      ? [{
          id: WORKSPACE_BUILT_IN_GROUPS.owner.id,
          name: WORKSPACE_BUILT_IN_GROUPS.owner.name,
          permission_template_id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.owner,
          built_in: true,
          system_key: 'owner',
        }]
      : actorPermissions.includes('workspace:project:create')
        ? [{
            id: WORKSPACE_BUILT_IN_GROUPS.projectCreators.id,
            name: WORKSPACE_BUILT_IN_GROUPS.projectCreators.name,
            permission_template_id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.projectCreator,
            built_in: true,
            system_key: 'project_creators',
          }]
        : [{
            id: WORKSPACE_BUILT_IN_GROUPS.members.id,
            name: WORKSPACE_BUILT_IN_GROUPS.members.name,
            permission_template_id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.member,
            built_in: true,
            system_key: 'members',
          }],
    permissions: actorPermissions,
    status: 'active',
    joined_at: workspaceCreatedAt,
  });

  return [...members.values()];
}

export async function buildWorkspaceRecords(): Promise<WorkspaceRecord[]> {
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
  for (const item of await readRegisteredWorkspaces()) {
    merged.set(item.id, item);
  }
  return [...merged.values()];
}
