import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import {
  resolveKeycloakDirectoryUsersByIds,
  searchKeycloakDirectoryUsers,
} from './keycloak-user-directory.js';
import {
  buildWorkspaceMembersFromConfig,
  resolveWorkspacePermissions,
} from './workspace-permissions.js';
import type { WorkspaceRecordLike } from './project-handler-types.js';
import {
  getRegisteredWorkspaceConfig,
  updateRegisteredWorkspaceProjectCreators,
} from './workspace-registry.js';
import { readRequestId } from './project-route-handler-utils.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

function findWorkspaceRecord(args: {
  workspaces: WorkspaceRecordLike[];
  workspaceId: string;
  defaultWorkspace?: WorkspaceRecordLike;
}) {
  const { workspaces, workspaceId, defaultWorkspace } = args;
  return workspaces.find((item) => item.id === workspaceId)
    ?? (defaultWorkspace && workspaceId === defaultWorkspace.id ? defaultWorkspace : null);
}

function listWorkspaceProjectCreators(args: {
  workspaceId: string;
  user: AuthenticatedUser;
  defaultWorkspace?: WorkspaceRecordLike;
  workspaceCreatedAt: string;
}) {
  const { workspaceId, user, defaultWorkspace, workspaceCreatedAt } = args;
  return buildWorkspaceMembersFromConfig({
    workspaceId,
    actorId: user.id,
    actorEmail: user.email,
    actorName: user.name,
    workspaceCreatedAt,
    defaultWorkspaceId: defaultWorkspace?.id,
  })
    .filter((member) => (
      member.permissions.includes('workspace:project:create')
      && !member.permissions.includes('workspace:governance:update')
    ))
    .map((member) => ({
      id: member.user_id,
      user_id: member.user_id,
      name: member.name,
      email: member.email,
    }));
}

function getWorkspaceDirectoryConfig(workspaceId: string) {
  const config = getRegisteredWorkspaceConfig(workspaceId);
  const idpUrl = config?.idp?.url?.trim() ?? '';
  const idpRealm = config?.idp?.realm?.trim() ?? '';
  if (!idpUrl || !idpRealm) {
    throw Object.assign(new Error('workspace_directory_not_configured'), {
      code: 'WORKSPACE_DIRECTORY_NOT_CONFIGURED',
    });
  }
  return {
    url: idpUrl,
    realm: idpRealm,
  };
}

export async function handleWorkspaceProjectCreatorsRoute(args: {
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  workspaces: WorkspaceRecordLike[];
  defaultWorkspace?: WorkspaceRecordLike;
  workspaceId: string;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const {
    method,
    req,
    res,
    deps,
    user,
    workspaces,
    defaultWorkspace,
    workspaceId,
    json,
    readBody,
  } = args;
  const workspaceRecord = findWorkspaceRecord({ workspaces, workspaceId, defaultWorkspace });
  if (!workspaceRecord) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
    return true;
  }

  const actorPermissions = resolveWorkspacePermissions({
    workspaceId,
    actorId: user.id,
    actorEmail: user.email,
    defaultWorkspaceId: defaultWorkspace?.id,
  });
  if (!actorPermissions.includes('workspace:governance:update')) {
    json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'workspace_admin_required' });
    return true;
  }

  if (method === 'GET') {
    const items = listWorkspaceProjectCreators({
      workspaceId,
      user,
      defaultWorkspace,
      workspaceCreatedAt: workspaceRecord.created_at,
    });
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (method === 'PATCH') {
    const requestId = readRequestId(req);
    const currentItems = listWorkspaceProjectCreators({
      workspaceId,
      user,
      defaultWorkspace,
      workspaceCreatedAt: workspaceRecord.created_at,
    }).map((member) => member.user_id);
    const body = await readBody(req) as { project_creator_user_ids?: unknown };
    if (!body || !Array.isArray(body.project_creator_user_ids)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'project_creator_user_ids must be an array' });
      return true;
    }
    const nextCreatorIds = body.project_creator_user_ids
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    try {
      const directoryConfig = getWorkspaceDirectoryConfig(workspaceId);
      const resolvedCreators = await resolveKeycloakDirectoryUsersByIds({
        url: directoryConfig.url,
        realm: directoryConfig.realm,
        userIds: nextCreatorIds,
      });
      updateRegisteredWorkspaceProjectCreators(workspaceId, resolvedCreators);
      const previousSet = new Set(currentItems);
      const nextSet = new Set(nextCreatorIds);
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId: '__workspace__',
        actor: { type: 'user', id: user.id },
        action: 'workspace.project_creators.updated',
        requestId,
        resourceType: 'workspace',
        resourceId: workspaceId,
        metadata: {
          added_identifiers: [...nextSet].filter((item) => !previousSet.has(item)),
          removed_identifiers: [...previousSet].filter((item) => !nextSet.has(item)),
          total_identifiers: nextCreatorIds.length,
        },
      });
      json(res, 200, {
        items: resolvedCreators.map((creator) => ({
          id: creator.user_id,
          user_id: creator.user_id,
          name: creator.name ?? creator.email,
          email: creator.email,
        })),
        total: resolvedCreators.length,
      });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';
      if (code === 'WORKSPACE_NOT_FOUND') {
        json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
        return true;
      }
      if (code === 'DIRECTORY_USER_NOT_FOUND') {
        json(res, 422, { error_code: 'DIRECTORY_USER_NOT_FOUND', message: 'directory_user_not_found' });
        return true;
      }
      if (code === 'WORKSPACE_DIRECTORY_NOT_CONFIGURED' || code === 'KEYCLOAK_DIRECTORY_UNAVAILABLE') {
        json(res, 503, { error_code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE', message: 'keycloak_directory_unavailable' });
        return true;
      }
      throw error;
    }
    return true;
  }

  return false;
}

export async function handleWorkspaceDirectoryUsersRoute(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  user: AuthenticatedUser;
  workspaces: WorkspaceRecordLike[];
  defaultWorkspace?: WorkspaceRecordLike;
  workspaceId: string;
  json: JsonResponder;
}): Promise<boolean> {
  const { req, res, user, workspaces, defaultWorkspace, workspaceId, json } = args;
  const workspaceRecord = findWorkspaceRecord({ workspaces, workspaceId, defaultWorkspace });
  if (!workspaceRecord) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
    return true;
  }

  const actorPermissions = resolveWorkspacePermissions({
    workspaceId,
    actorId: user.id,
    actorEmail: user.email,
    defaultWorkspaceId: defaultWorkspace?.id,
  });
  if (!actorPermissions.includes('workspace:governance:update')) {
    json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'workspace_admin_required' });
    return true;
  }

  const requestUrl = new URL(req.url ?? '/', 'http://localhost');
  const query = requestUrl.searchParams.get('query')?.trim() ?? '';
  if (query.length < 2) {
    json(res, 200, { items: [], total: 0 });
    return true;
  }

  try {
    const directoryConfig = getWorkspaceDirectoryConfig(workspaceId);
    const items = await searchKeycloakDirectoryUsers({
      url: directoryConfig.url,
      realm: directoryConfig.realm,
      query,
    });
    json(res, 200, { items, total: items.length });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: string }).code)
      : '';
    if (code === 'WORKSPACE_DIRECTORY_NOT_CONFIGURED' || code === 'KEYCLOAK_DIRECTORY_UNAVAILABLE') {
      json(res, 503, { error_code: 'KEYCLOAK_DIRECTORY_UNAVAILABLE', message: 'keycloak_directory_unavailable' });
      return true;
    }
    throw error;
  }
  return true;
}
