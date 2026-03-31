import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { appendUserNotification } from './me-notifications-store.js';
import { getProjectMembership, upsertProjectMembershipRecord } from './project-member-governance-persistence.js';
import { readProjectPermissionContext } from './project-route-handler-utils.js';

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

type JoinRequestCreateResponse =
  | {
    outcome: 'pending';
    join_request_id: string;
  }
  | {
    outcome: 'joined';
    membership_status: 'active';
  };

const PROJECT_JOIN_REQUEST_COLLECTION = 'project_join_requests';

type StoredProjectJoinRequestRecord = ProjectJoinRequestRecord & {
  workspace_id: string;
};

function toStoredRecord(args: {
  workspaceId: string;
  record: ProjectJoinRequestRecord;
}): StoredProjectJoinRequestRecord {
  return {
    workspace_id: args.workspaceId,
    ...args.record,
  };
}

function toPublicRecord(record: StoredProjectJoinRequestRecord): ProjectJoinRequestRecord {
  const { workspace_id: _workspaceId, ...publicRecord } = record;
  return publicRecord;
}

export class JsonDocProjectJoinRequestRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  async listByProject(workspaceId: string, projectId: string): Promise<ProjectJoinRequestRecord[]> {
    const items = await this.docStore.list<StoredProjectJoinRequestRecord>(PROJECT_JOIN_REQUEST_COLLECTION, {
      workspace_id: workspaceId,
      project_id: projectId,
    });
    return items.map(toPublicRecord);
  }

  async getById(
    workspaceId: string,
    projectId: string,
    joinRequestId: string,
  ): Promise<ProjectJoinRequestRecord | null> {
    const item = await this.docStore.get<StoredProjectJoinRequestRecord>(PROJECT_JOIN_REQUEST_COLLECTION, joinRequestId);
    if (!item) return null;
    if (item.workspace_id !== workspaceId || item.project_id !== projectId) {
      return null;
    }
    return toPublicRecord(item);
  }

  async save(workspaceId: string, record: ProjectJoinRequestRecord): Promise<void> {
    await this.docStore.upsert(PROJECT_JOIN_REQUEST_COLLECTION, record.id, toStoredRecord({ workspaceId, record }));
  }
}

export async function listProjectJoinRequests(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
): Promise<ProjectJoinRequestRecord[]> {
  return new JsonDocProjectJoinRequestRepo(docStore).listByProject(workspaceId, projectId);
}

export async function getProjectJoinRequest(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  joinRequestId: string,
): Promise<ProjectJoinRequestRecord | null> {
  return new JsonDocProjectJoinRequestRepo(docStore).getById(workspaceId, projectId, joinRequestId);
}

export async function saveProjectJoinRequest(
  docStore: JsonDocStorePort,
  workspaceId: string,
  record: ProjectJoinRequestRecord,
): Promise<void> {
  await new JsonDocProjectJoinRequestRepo(docStore).save(workspaceId, record);
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
    const items = await listProjectJoinRequests(deps.docStore, workspaceId, projectId);
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (routeKind === 'projectJoinRequests' && method === 'POST') {
    const project = await deps.getProjectUseCase.execute({
      workspaceId,
      projectId,
    });
    if (project.owner_id === user.id) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'Project owner cannot create a join request' });
      return true;
    }
    if (project.visibility !== 'public') {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_join_requires_public_visibility' });
      return true;
    }
    if (project.status !== 'active') {
      json(res, 409, { error_code: 'PROJECT_NOT_JOINABLE', message: 'project_not_active' });
      return true;
    }
    const existingMembership = await getProjectMembership(deps.docStore, workspaceId, projectId, user.id);
    if (existingMembership?.status === 'active') {
      json(res, 409, { error_code: 'ALREADY_PROJECT_MEMBER', message: 'already_project_member' });
      return true;
    }
    const body = await readBody(req) as { reason?: unknown } | null;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    const items = await listProjectJoinRequests(deps.docStore, workspaceId, projectId);
    const existingPending = items.find((item) => item.user_id === user.id && item.status === 'pending');
    if (existingPending) {
      json(res, 409, { error_code: 'JOIN_REQUEST_ALREADY_PENDING', message: 'A pending join request already exists' });
      return true;
    }
    if (project.join_policy === 'open') {
      const joinedAt = new Date().toISOString();
      await upsertProjectMembershipRecord(deps.docStore, workspaceId, projectId, {
        project_id: projectId,
        user_id: user.id,
        user_email: user.email,
        user_name: user.name,
        status: 'active',
        joined_at: joinedAt,
      });
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'member.joined',
        resourceType: 'member',
        resourceId: user.id,
        metadata: {
          joined_via: 'public_open_join',
        },
      });
      json(res, 201, {
        outcome: 'joined',
        membership_status: 'active',
      } satisfies JoinRequestCreateResponse);
      return true;
    }
    const created: ProjectJoinRequestRecord = {
      id: `jr_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      project_id: projectId,
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      reason,
      status: 'pending',
      requested_at: new Date().toISOString(),
    };
    await saveProjectJoinRequest(deps.docStore, workspaceId, created);
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
    json(res, 201, {
      outcome: 'pending',
      join_request_id: created.id,
    } satisfies JoinRequestCreateResponse);
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
    const target = await getProjectJoinRequest(deps.docStore, workspaceId, projectId, joinId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Join request not found' });
      return true;
    }
    const approved: ProjectJoinRequestRecord = {
      ...target,
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      reject_reason: undefined,
    };
    await saveProjectJoinRequest(deps.docStore, workspaceId, approved);
    await upsertProjectMembershipRecord(deps.docStore, workspaceId, projectId, {
      project_id: projectId,
      user_id: approved.user_id,
      user_email: approved.user_email,
      user_name: approved.user_name,
      status: 'active',
      joined_at: approved.reviewed_at,
      approved_via_join_request_id: approved.id,
    });
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.approved',
      resourceType: 'join_request',
      resourceId: approved.id,
      metadata: {
        requested_user_id: approved.user_id,
      },
    });
    let projectName = projectId;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId,
        projectId,
      });
      projectName = project.name;
    } catch {
      projectName = projectId;
    }
    await appendUserNotification(deps.docStore, approved.user_id, {
      type: 'join_request_approved',
      title: 'Project access approved',
      body: `Your request to join ${projectName} was approved. You can now open the project.`,
      link_url: `/workspaces/${workspaceId}/projects/${projectId}/overview`,
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
    const target = await getProjectJoinRequest(deps.docStore, workspaceId, projectId, joinId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Join request not found' });
      return true;
    }
    const rejected: ProjectJoinRequestRecord = {
      ...target,
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: user.id,
      reject_reason: reason,
    };
    await saveProjectJoinRequest(deps.docStore, workspaceId, rejected);
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.join_request.rejected',
      resourceType: 'join_request',
      resourceId: rejected.id,
      metadata: {
        requested_user_id: rejected.user_id,
        reject_reason_present: typeof reason === 'string' && reason.trim().length > 0,
      },
    });
    let projectName = projectId;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId,
        projectId,
      });
      projectName = project.name;
    } catch {
      projectName = projectId;
    }
    await appendUserNotification(deps.docStore, rejected.user_id, {
      type: 'join_request_rejected',
      title: 'Project access request declined',
      body: typeof reason === 'string' && reason.trim().length > 0
        ? `Your request to join ${projectName} was declined. Reason: ${reason.trim()}`
        : `Your request to join ${projectName} was declined.`,
      link_url: `/workspaces/${workspaceId}/projects`,
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}
