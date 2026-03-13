import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import {
  buildWorkspaceMembersFromConfig,
  resolveWorkspacePermissions,
} from './workspace-permissions.js';
import type { WorkspaceRecordLike } from './project-source-handler-types.js';
import { updateRegisteredWorkspaceProjectCreators } from './workspace-registry.js';
import { readRequestId } from './project-source-route-handler-utils.js';

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
  workspaces: WorkspaceRecordLike[];
  defaultWorkspace?: WorkspaceRecordLike;
  workspaceCreatedAt: string;
}) {
  const { workspaceId, user, workspaces, defaultWorkspace, workspaceCreatedAt } = args;
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
      workspaces,
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
      workspaces,
      defaultWorkspace,
      workspaceCreatedAt: workspaceRecord.created_at,
    }).map((member) => member.user_id);
    const body = await readBody(req) as { project_creators?: unknown };
    if (!body || !Array.isArray(body.project_creators)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'project_creators must be an array' });
      return true;
    }
    const nextCreators = body.project_creators
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    try {
      updateRegisteredWorkspaceProjectCreators(workspaceId, nextCreators);
      const previousSet = new Set(currentItems);
      const nextSet = new Set(nextCreators);
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
          total_identifiers: nextCreators.length,
        },
      });
      json(res, 200, {
        items: nextCreators.map((identifier) => ({
          id: identifier,
          user_id: identifier,
          name: identifier,
          email: identifier.includes('@') ? identifier : `${identifier}@workspace.local`,
        })),
        total: nextCreators.length,
      });
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: string }).code)
        : '';
      if (code === 'WORKSPACE_NOT_FOUND') {
        json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'workspace_not_found' });
        return true;
      }
      throw error;
    }
    return true;
  }

  return false;
}
