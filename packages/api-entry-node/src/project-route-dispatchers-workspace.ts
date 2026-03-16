import {
  handleWorkspaceDirectoryUsersRoute,
  handleWorkspaceProjectCreatorsRoute,
} from './project-workspace-governance-routes.js';
import type { ProjectRouteContext } from './project-route-types.js';
import { buildWorkspaceMembersFromConfig } from './workspace-permissions.js';

export async function handleWorkspaceRoutes(context: ProjectRouteContext): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    workspaces,
    defaultWorkspace,
    json,
    readBody,
  } = context;

  if (route.kind === 'workspacesCollection' && method === 'GET') {
    json(res, 200, { items: workspaces, total: workspaces.length });
    return true;
  }

  if (route.kind === 'workspaceItem' && method === 'GET' && route.workspaceId) {
    const found = workspaces.find((item) => item.id === route.workspaceId);
    if (!found) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
      return true;
    }
    json(res, 200, found);
    return true;
  }

  if (route.kind === 'workspaceMembers' && method === 'GET' && route.workspaceId) {
    const workspaceRecord = workspaces.find((item) => item.id === route.workspaceId)
      ?? (defaultWorkspace && route.workspaceId === defaultWorkspace.id ? defaultWorkspace : null);
    if (!workspaceRecord) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
      return true;
    }
    const items = buildWorkspaceMembersFromConfig({
      workspaceId: route.workspaceId,
      actorId: user.id,
      actorEmail: user.email,
      actorName: user.name,
      workspaceCreatedAt: workspaceRecord.created_at,
      defaultWorkspaceId: defaultWorkspace?.id,
    });
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (
    route.kind === 'workspaceProjectCreators'
    && (method === 'GET' || method === 'PATCH')
    && route.workspaceId
  ) {
    return handleWorkspaceProjectCreatorsRoute({
      method,
      req,
      res,
      deps,
      user,
      workspaces,
      defaultWorkspace,
      workspaceId: route.workspaceId,
      json,
      readBody,
    });
  }

  if (route.kind === 'workspaceDirectoryUsers' && method === 'GET' && route.workspaceId) {
    return handleWorkspaceDirectoryUsersRoute({
      req,
      res,
      user,
      workspaces,
      defaultWorkspace,
      workspaceId: route.workspaceId,
      json,
    });
  }

  return false;
}
