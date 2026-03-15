import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { upsertProjectMembership } from './project-memberships-store.js';
import { projectScopedKey, readProjectPermissionContext } from './project-source-route-handler-utils.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

export interface ProjectJoinRequestRecord {
  id: string;
  project_id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  requested_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  reject_reason?: string;
}

const PROJECT_JOIN_REQUESTS_BY_PROJECT = new Map<string, ProjectJoinRequestRecord[]>();

export function resetProjectJoinRequestsState(): void {
  PROJECT_JOIN_REQUESTS_BY_PROJECT.clear();
}

export function getProjectJoinRequestsState(workspaceId: string, projectId: string): ProjectJoinRequestRecord[] {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_JOIN_REQUESTS_BY_PROJECT.get(key);
  if (existing) return existing;
  const items: ProjectJoinRequestRecord[] = [];
  PROJECT_JOIN_REQUESTS_BY_PROJECT.set(key, items);
  return items;
}

export async function handleProjectJoinRequestsRoute(args: {
  routeKind: 'projectJoinRequests' | 'projectJoinRequestApprove' | 'projectJoinRequestReject';
  workspaceId: string;
  projectId: string;
  joinId?: string;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const {
    routeKind,
    workspaceId,
    projectId,
    joinId,
    method,
    req,
    res,
    deps,
    user,
    json,
    readBody,
  } = args;

  if (routeKind === 'projectJoinRequests' && method === 'GET') {
    const items = getProjectJoinRequestsState(workspaceId, projectId);
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (routeKind === 'projectJoinRequests' && method === 'POST') {
    let projectOwnerId: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId,
        projectId,
      });
      projectOwnerId = project.owner_id;
    } catch {
      // Keep local governance route usable in partially wired dev setups.
    }
    if (projectOwnerId === user.id) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'Project owner cannot create a join request' });
      return true;
    }
    const body = await readBody(req) as { reason?: unknown } | null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const items = getProjectJoinRequestsState(workspaceId, projectId);
    const existingPending = items.find((item) => item.user_id === user.id && item.status === 'pending');
    if (existingPending) {
      json(res, 409, { error_code: 'JOIN_REQUEST_ALREADY_PENDING', message: 'A pending join request already exists' });
      return true;
    }
    const created: ProjectJoinRequestRecord = {
      id: `jr_${Math.random().toString(36).slice(2, 10)}`,
      project_id: projectId,
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      reason,
      status: 'pending',
      requested_at: new Date().toISOString(),
    };
    items.push(created);
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.created',
      resourceType: 'join_request',
      resourceId: created.id,
      metadata: {
        requested_user_id: user.id,
        reason_present: created.reason.length > 0,
      },
    });
    json(res, 201, created);
    return true;
  }

  if (routeKind === 'projectJoinRequestApprove' && method === 'POST' && joinId) {
    const projectPermissionContext = await readProjectPermissionContext({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext || !projectPermissionContext.permissions.includes('project:membership:update')) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const items = getProjectJoinRequestsState(workspaceId, projectId);
    const target = items.find((item) => item.id === joinId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Join request not found' });
      return true;
    }
    target.status = 'approved';
    target.reviewed_at = new Date().toISOString();
    target.reviewed_by = user.id;
    target.reject_reason = undefined;
    upsertProjectMembership(workspaceId, projectId, {
      project_id: projectId,
      user_id: target.user_id,
      status: 'active',
      joined_at: target.reviewed_at,
      approved_via_join_request_id: target.id,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.approved',
      resourceType: 'join_request',
      resourceId: target.id,
      metadata: {
        requested_user_id: target.user_id,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'projectJoinRequestReject' && method === 'POST' && joinId) {
    const projectPermissionContext = await readProjectPermissionContext({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext || !projectPermissionContext.permissions.includes('project:membership:update')) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const body = await readBody(req);
    const reason = typeof (body as { reason?: unknown } | null)?.reason === 'string'
      ? (body as { reason?: string }).reason
      : undefined;
    const items = getProjectJoinRequestsState(workspaceId, projectId);
    const target = items.find((item) => item.id === joinId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Join request not found' });
      return true;
    }
    target.status = 'rejected';
    target.reviewed_at = new Date().toISOString();
    target.reviewed_by = user.id;
    target.reject_reason = reason;
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.rejected',
      resourceType: 'join_request',
      resourceId: target.id,
      metadata: {
        requested_user_id: target.user_id,
        reject_reason_present: typeof reason === 'string' && reason.trim().length > 0,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}
