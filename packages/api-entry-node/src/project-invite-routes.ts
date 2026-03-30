import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { getProjectMembership, upsertProjectMembershipRecord } from './project-member-governance-persistence.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

export interface ProjectInviteRecord {
  id: string;
  token: string;
  workspace_id: string;
  project_id: string;
  invited_email: string;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  expires_at: string;
  created_at: string;
  created_by_user_id: string;
  accepted_at?: string;
  accepted_by_user_id?: string;
  declined_at?: string;
  declined_by_user_id?: string;
}

const PROJECT_INVITE_COLLECTION = 'project_invites';

export class JsonDocProjectInviteRepo {
  constructor(private readonly docStore: JsonDocStorePort) {}

  async getByToken(token: string): Promise<ProjectInviteRecord | null> {
    const items = await this.docStore.list<ProjectInviteRecord>(PROJECT_INVITE_COLLECTION, { token });
    return items[0] ?? null;
  }

  async save(record: ProjectInviteRecord): Promise<void> {
    await this.docStore.upsert(PROJECT_INVITE_COLLECTION, record.id, record);
  }
}

function buildInvitePath(token: string): string {
  return `/join?token=${encodeURIComponent(token)}`;
}

function normalizeInviteStatus(record: ProjectInviteRecord): ProjectInviteRecord {
  if (record.status === 'pending' && new Date(record.expires_at).getTime() <= Date.now()) {
    return { ...record, status: 'expired' };
  }
  return record;
}

export async function handleProjectInviteCreateRoute(args: {
  workspaceId: string;
  projectId: string;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const { workspaceId, projectId, method, req, res, deps, user, json, readBody } = args;
  if (method !== 'POST') {
    return false;
  }
  const body = await readBody(req) as { email?: unknown; expires_in_hours?: unknown };
  const invitedEmail = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!invitedEmail) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'invite_email_required' });
    return true;
  }
  const expiresInHours = typeof body?.expires_in_hours === 'number' && body.expires_in_hours > 0
    ? Math.min(body.expires_in_hours, 24 * 30)
    : 24 * 7;
  const now = new Date();
  const token = `invite_${randomUUID().replace(/-/g, '')}`;
  const record: ProjectInviteRecord = {
    id: `pji_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    token,
    workspace_id: workspaceId,
    project_id: projectId,
    invited_email: invitedEmail,
    status: 'pending',
    expires_at: new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString(),
    created_at: now.toISOString(),
    created_by_user_id: user.id,
  };
  await new JsonDocProjectInviteRepo(deps.docStore).save(record);
  await writeProjectAuditEvent(deps, {
    workspaceId,
    projectId,
    actor: { type: 'user', id: user.id },
    action: 'member.invite.created',
    resourceType: 'member_invite',
    resourceId: record.id,
    requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
    metadata: {
      invited_email: invitedEmail,
      expires_at: record.expires_at,
    },
  });
  json(res, 201, {
    invite_id: record.id,
    invite_url: buildInvitePath(record.token),
    expires_at: record.expires_at,
  });
  return true;
}

export async function handleJoinInviteActionRoute(args: {
  pathname: string;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const { pathname, method, req, res, deps, user, json, readBody } = args;
  if (method !== 'POST' || (pathname !== '/api/v1/join/accept' && pathname !== '/api/v1/join/decline')) {
    return false;
  }
  const body = await readBody(req) as { token?: unknown };
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) {
    json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'invite_token_required' });
    return true;
  }
  const repo = new JsonDocProjectInviteRepo(deps.docStore);
  const found = await repo.getByToken(token);
  if (!found) {
    json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'invite_not_found' });
    return true;
  }
  const invite = normalizeInviteStatus(found);
  if (invite.status !== found.status) {
    await repo.save(invite);
  }
  if (invite.status !== 'pending') {
    json(res, 409, { error_code: 'RESOURCE_CONFLICT', message: 'invite_not_pending' });
    return true;
  }
  if (user.email.trim().toLowerCase() !== invite.invited_email) {
    json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'invite_email_mismatch' });
    return true;
  }
  if (pathname === '/api/v1/join/decline') {
    const declined: ProjectInviteRecord = {
      ...invite,
      status: 'declined',
      declined_at: new Date().toISOString(),
      declined_by_user_id: user.id,
    };
    await repo.save(declined);
    json(res, 200, { ok: true });
    return true;
  }
  const joinedAt = new Date().toISOString();
  const existingMembership = await getProjectMembership(
    deps.docStore,
    invite.workspace_id,
    invite.project_id,
    user.id,
  );
  await upsertProjectMembershipRecord(deps.docStore, invite.workspace_id, invite.project_id, {
    project_id: invite.project_id,
    user_id: user.id,
    status: 'active',
    joined_at: existingMembership?.joined_at ?? joinedAt,
  });
  const accepted: ProjectInviteRecord = {
    ...invite,
    status: 'accepted',
    accepted_at: joinedAt,
    accepted_by_user_id: user.id,
  };
  await repo.save(accepted);
  await writeProjectAuditEvent(deps, {
    workspaceId: invite.workspace_id,
    projectId: invite.project_id,
    actor: { type: 'user', id: user.id },
    action: 'member.invite.accepted',
    resourceType: 'member_invite',
    resourceId: invite.id,
    requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
    metadata: {
      invited_email: invite.invited_email,
    },
  });
  json(res, 200, {
    ok: true,
    workspace_id: invite.workspace_id,
    project_id: invite.project_id,
  });
  return true;
}
