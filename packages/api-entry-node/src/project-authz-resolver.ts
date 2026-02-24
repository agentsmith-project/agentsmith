import { OWNER_PROJECT_PERMISSIONS, resolveProjectPermissions } from './workspace-permissions.js';
import { getProjectGroupsState } from './project-groups-store.js';
import { getProjectPermissionTemplatesState } from './project-permission-templates-store.js';

export function resolveProjectPermissionsForRequest(args: {
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
}): readonly string[] {
  const { workspaceId, projectId, projectOwnerId, actorUserId } = args;
  if (projectOwnerId === actorUserId) {
    return OWNER_PROJECT_PERMISSIONS;
  }

  const granted = new Set(resolveProjectPermissions(projectOwnerId, actorUserId));
  const groups = getProjectGroupsState(workspaceId, projectId);
  if (groups.length === 0) {
    return [...granted];
  }
  const templates = getProjectPermissionTemplatesState(workspaceId, projectId);
  const templateMap = new Map(templates.map((t) => [t.id, t]));
  for (const group of groups) {
    if (!group.member_ids.includes(actorUserId)) continue;
    const template = templateMap.get(group.permission_template_id);
    if (!template) continue;
    for (const permission of template.permissions) {
      granted.add(permission);
    }
  }
  return [...granted];
}
