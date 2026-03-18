import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import {
  appendProjectMemberChangeHistory,
  deleteProjectGroup,
  deleteProjectMemberPermissionState,
  deleteProjectMembershipRecord,
  deleteProjectPermissionTemplate,
  getProjectMembership,
  getProjectMemberPermissionState,
  listProjectGroups,
  listProjectMemberChangeHistory,
  listProjectPermissionTemplates,
  saveProjectGroup,
  saveProjectPermissionTemplate,
  setProjectAdminGroupMembersPersisted,
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';
import {
  isBuiltInProjectGroupId,
  isBuiltInProjectTemplateId,
} from './project-governance-model.js';
import { readProjectPermissionContext, readRequestId } from './project-route-handler-utils.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

async function appendMemberChange(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
  actorId: string;
  actorEmail: string;
  changeType: 'permissions' | 'resource_policy' | 'group' | 'membership';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
}): Promise<void> {
  await appendProjectMemberChangeHistory(
    args.deps.docStore,
    args.workspaceId,
    args.projectId,
    args.userId,
    {
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      actor_id: args.actorId,
      actor_email: args.actorEmail,
      change_type: args.changeType,
      changes: args.changes,
    },
  );
}

async function clearMemberGovernanceState(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  userId: string;
  projectOwnerId?: string | null;
}): Promise<void> {
  const groups = await listProjectGroups(args.deps.docStore, args.workspaceId, args.projectId, args.projectOwnerId);
  for (const group of groups) {
    if (!group.member_ids.includes(args.userId)) continue;
    if (isBuiltInProjectGroupId(group.id)) {
      if (group.id === 'grp_project_admins') {
        await setProjectAdminGroupMembersPersisted({
          docStore: args.deps.docStore,
          workspaceId: args.workspaceId,
          projectId: args.projectId,
          memberIds: group.member_ids.filter((memberId) => memberId !== args.userId),
        });
      }
      continue;
    }
    await saveProjectGroup(args.deps.docStore, args.workspaceId, args.projectId, {
      ...group,
      member_ids: group.member_ids.filter((memberId) => memberId !== args.userId),
      updated_at: new Date().toISOString(),
    });
  }
  await deleteProjectMemberPermissionState(args.deps.docStore, args.workspaceId, args.projectId, args.userId);
}

async function requireMembershipUpdatePermission(args: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
}) {
  const projectPermissionContext = await readProjectPermissionContext(args);
  if (!projectPermissionContext || !projectPermissionContext.permissions.includes('project:membership:update')) {
    return null;
  }
  return projectPermissionContext;
}

export async function handleProjectPermissionTemplatesRoute(args: {
  routeKind: 'projectPermissionTemplates' | 'projectPermissionTemplateItem';
  method: string;
  workspaceId: string;
  projectId: string;
  templateId?: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const { routeKind, method, workspaceId, projectId, templateId, req, res, deps, user, json, readBody } = args;

  if (routeKind === 'projectPermissionTemplates' && method === 'GET') {
    json(res, 200, { items: await listProjectPermissionTemplates(deps.docStore, workspaceId, projectId) });
    return true;
  }

  if (routeKind === 'projectPermissionTemplates' && method === 'POST') {
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };
    if (!body || typeof body.name !== 'string' || body.name.trim().length === 0 || !Array.isArray(body.permissions)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'name and permissions are required' });
      return true;
    }
    const permissions = body.permissions.filter((v): v is string => typeof v === 'string');
    const now = new Date().toISOString();
    const created = {
      id: `pt_${Math.random().toString(36).slice(2, 10)}`,
      project_id: projectId,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      permissions,
      built_in: false,
      created_at: now,
      updated_at: now,
    };
    await saveProjectPermissionTemplate(deps.docStore, workspaceId, projectId, created);
    json(res, 200, created);
    return true;
  }

  if (routeKind === 'projectPermissionTemplateItem' && method === 'PATCH' && templateId) {
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permissions?: string[];
    };
    const items = await listProjectPermissionTemplates(deps.docStore, workspaceId, projectId);
    const item = items.find((it) => it.id === templateId);
    if (!item) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Permission template not found' });
      return true;
    }
    if (item.built_in || isBuiltInProjectTemplateId(item.id)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be modified' });
      return true;
    }
    if (typeof body.name === 'string') item.name = body.name;
    if (typeof body.description === 'string' || body.description === undefined) item.description = body.description;
    if (Array.isArray(body.permissions)) {
      item.permissions = body.permissions.filter((v): v is string => typeof v === 'string');
    }
    item.updated_at = new Date().toISOString();
    await saveProjectPermissionTemplate(deps.docStore, workspaceId, projectId, item);
    json(res, 200, item);
    return true;
  }

  if (routeKind === 'projectPermissionTemplateItem' && method === 'DELETE' && templateId) {
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const items = await listProjectPermissionTemplates(deps.docStore, workspaceId, projectId);
    const target = items.find((it) => it.id === templateId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Permission template not found' });
      return true;
    }
    if (target.built_in || isBuiltInProjectTemplateId(target.id)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be deleted' });
      return true;
    }
    await deleteProjectPermissionTemplate(deps.docStore, workspaceId, projectId, templateId);
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}

export async function handleProjectGroupsRoute(args: {
  routeKind: 'projectGroups' | 'projectGroupItem' | 'projectGroupApplyTemplate';
  method: string;
  workspaceId: string;
  projectId: string;
  groupId?: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const { routeKind, method, workspaceId, projectId, groupId, req, res, deps, user, json, readBody } = args;

  if (routeKind === 'projectGroups' && method === 'GET') {
    let projectOwnerId: string | null = null;
    try {
      const project = await deps.getProjectUseCase.execute({ workspaceId, projectId });
      projectOwnerId = project.owner_id;
    } catch {
      projectOwnerId = null;
    }
    json(res, 200, { items: await listProjectGroups(deps.docStore, workspaceId, projectId, projectOwnerId) });
    return true;
  }

  if (routeKind === 'projectGroups' && method === 'POST') {
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    };
    if (!body || typeof body.name !== 'string' || body.name.trim().length === 0 || typeof body.permission_template_id !== 'string') {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'name and permission_template_id are required' });
      return true;
    }
    const now = new Date().toISOString();
    const created = {
      id: `grp_${Math.random().toString(36).slice(2, 10)}`,
      project_id: projectId,
      name: body.name.trim(),
      description: typeof body.description === 'string' ? body.description : undefined,
      permission_template_id: body.permission_template_id,
      member_ids: Array.isArray(body.member_ids) ? body.member_ids.filter((v): v is string => typeof v === 'string') : [],
      created_at: now,
      updated_at: now,
    };
    await saveProjectGroup(deps.docStore, workspaceId, projectId, created);
    json(res, 200, created);
    return true;
  }

  if (routeKind === 'projectGroupItem' && method === 'PATCH' && groupId) {
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const body = await readBody(req) as {
      name?: string;
      description?: string;
      permission_template_id?: string;
      member_ids?: string[];
    };
    const groups = await listProjectGroups(deps.docStore, workspaceId, projectId);
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Group not found' });
      return true;
    }
    if (isBuiltInProjectGroupId(groupId)) {
      if (groupId !== 'grp_project_admins') {
        json(res, 409, { error_code: 'CONFLICT', message: 'Built-in groups cannot be modified from this route' });
        return true;
      }
      if (!Array.isArray(body.member_ids)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'member_ids are required for built-in admin group updates' });
        return true;
      }
      const nextMemberIds = Array.from(new Set(body.member_ids.filter((v): v is string => typeof v === 'string')));
      await setProjectAdminGroupMembersPersisted({
        docStore: deps.docStore,
        workspaceId,
        projectId,
        memberIds: nextMemberIds,
      });
      const updatedGroups = await listProjectGroups(deps.docStore, workspaceId, projectId);
      const updatedGroup = updatedGroups.find((item) => item.id === groupId);
      json(res, 200, updatedGroup ?? group);
      return true;
    }
    if (typeof body.name === 'string') group.name = body.name;
    if (typeof body.description === 'string' || body.description === undefined) group.description = body.description;
    if (typeof body.permission_template_id === 'string') group.permission_template_id = body.permission_template_id;
    if (Array.isArray(body.member_ids)) {
      group.member_ids = body.member_ids.filter((v): v is string => typeof v === 'string');
    }
    group.updated_at = new Date().toISOString();
    await saveProjectGroup(deps.docStore, workspaceId, projectId, group);
    json(res, 200, group);
    return true;
  }

  if (routeKind === 'projectGroupItem' && method === 'DELETE' && groupId) {
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    if (isBuiltInProjectGroupId(groupId)) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in groups cannot be deleted' });
      return true;
    }
    await deleteProjectGroup(deps.docStore, workspaceId, projectId, groupId);
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'projectGroupApplyTemplate' && method === 'POST' && groupId) {
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const body = await readBody(req) as { member_ids?: string[] };
    const groups = await listProjectGroups(deps.docStore, workspaceId, projectId);
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Group not found' });
      return true;
    }
    const memberIds = Array.isArray(body.member_ids) ? body.member_ids.filter((v): v is string => typeof v === 'string') : group.member_ids;
    json(res, 200, {
      applied_count: memberIds.length,
      results: memberIds.map((memberId) => ({ member_id: memberId, status: 'applied' })),
    });
    return true;
  }

  return false;
}

export async function handleProjectMembershipGovernanceRoute(args: {
  routeKind: 'projectMembershipItem' | 'projectMemberPermissions' | 'projectMemberChangeHistory';
  method: string;
  workspaceId: string;
  projectId: string;
  userId: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: JsonResponder;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}): Promise<boolean> {
  const { routeKind, method, workspaceId, projectId, userId, req, res, deps, user, json, readBody } = args;

  if (routeKind === 'projectMembershipItem' && method === 'GET') {
    let projectOwnerId: string | null = null;
    let projectCreatedAt: string | null = null;
    let projectGovernance: unknown = undefined;
    try {
      const project = await deps.getProjectUseCase.execute({
        workspaceId,
        projectId,
      });
      projectOwnerId = project.owner_id;
      projectCreatedAt = project.created_at;
      projectGovernance = project.governance_json;
    } catch {
      // Keep minimal membership read endpoint usable in local/dev fixtures.
    }
    const membership = await getProjectMembership(deps.docStore, workspaceId, projectId, userId);
    const isCurrentUser = userId === user.id;
    const effectiveGroups = (await listProjectGroups(deps.docStore, workspaceId, projectId, projectOwnerId)).filter(
      (group) => group.member_ids.includes(userId),
    ).map((group) => ({
      id: group.id,
      name: group.name,
      permission_template_id: group.permission_template_id,
      built_in: group.built_in ?? false,
      system_key: group.system_key,
    }));
    json(res, 200, {
      project_id: projectId,
      user_id: userId,
      groups: effectiveGroups,
      permissions: isCurrentUser
        ? [
          ...await resolveVisibleProjectPermissionsForActor({
            docStore: deps.docStore,
            workspaceId,
            projectId,
            projectOwnerId: projectOwnerId ?? user.id,
            projectGovernance,
            actorUserId: user.id,
          }),
        ]
        : [],
      status: membership?.status ?? 'active',
      joined_at: membership?.joined_at ?? projectCreatedAt ?? new Date().toISOString(),
    });
    return true;
  }

  if (routeKind === 'projectMembershipItem' && method === 'PATCH') {
    const requestId = readRequestId(req);
    const body = await readBody(req) as { status?: 'active' | 'suspended' };
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: body?.status === 'suspended' ? 'member.membership.suspended' : 'member.membership.activated',
        result: 'error',
        requestId,
        resourceType: 'membership',
        resourceId: userId,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'project_owner_required',
        metadata: {
          target_user_id: userId,
          next_status: body?.status,
        },
      });
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    if (!body || (body.status !== 'active' && body.status !== 'suspended')) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'status must be active or suspended' });
      return true;
    }
    if (userId === projectPermissionContext.ownerId) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: body.status === 'suspended' ? 'member.membership.suspended' : 'member.membership.activated',
        result: 'error',
        requestId,
        resourceType: 'membership',
        resourceId: userId,
        errorCode: 'CONFLICT',
        errorMessage: 'project_owner_membership_cannot_be_modified',
        metadata: {
          target_user_id: userId,
          next_status: body.status,
        },
      });
      json(res, 409, { error_code: 'CONFLICT', message: 'project_owner_membership_cannot_be_modified' });
      return true;
    }
    const existing = await getProjectMembership(deps.docStore, workspaceId, projectId, userId);
    let prevStatus: 'active' | 'pending' | 'suspended' | null = null;
    if (!existing) {
      if (body.status !== 'active') {
        await writeProjectAuditEvent(deps, {
          workspaceId,
          projectId,
          actor: { type: 'user', id: user.id },
          action: body.status === 'suspended' ? 'member.membership.suspended' : 'member.membership.activated',
          result: 'error',
          requestId,
          resourceType: 'membership',
          resourceId: userId,
          errorCode: 'NOT_FOUND',
          errorMessage: 'membership_not_found',
          metadata: {
            target_user_id: userId,
            next_status: body.status,
          },
        });
        json(res, 404, { error_code: 'NOT_FOUND', message: 'membership_not_found' });
        return true;
      }
      await upsertProjectMembershipRecord(deps.docStore, workspaceId, projectId, {
        project_id: projectId,
        user_id: userId,
        status: 'active',
        joined_at: new Date().toISOString(),
      });
    } else {
      prevStatus = existing.status;
      await upsertProjectMembershipRecord(deps.docStore, workspaceId, projectId, {
        ...existing,
        status: body.status,
      });
    }

    await appendMemberChange({
      deps,
      workspaceId,
      projectId,
      userId,
      actorId: user.id,
      actorEmail: user.email,
      changeType: 'membership',
      changes: {
        updated: {
          status: { from: prevStatus ?? 'missing', to: body.status },
        },
      },
    });

    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: body.status === 'suspended' ? 'member.membership.suspended' : 'member.membership.activated',
      requestId,
      resourceType: 'membership',
      resourceId: userId,
      metadata: {
        target_user_id: userId,
        previous_status: prevStatus ?? 'missing',
        next_status: body.status,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'projectMembershipItem' && method === 'DELETE') {
    const requestId = readRequestId(req);
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'member.membership.removed',
        result: 'error',
        requestId,
        resourceType: 'membership',
        resourceId: userId,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'project_owner_required',
        metadata: {
          target_user_id: userId,
        },
      });
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    if (userId === projectPermissionContext.ownerId) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'member.membership.removed',
        result: 'error',
        requestId,
        resourceType: 'membership',
        resourceId: userId,
        errorCode: 'CONFLICT',
        errorMessage: 'project_owner_membership_cannot_be_removed',
        metadata: {
          target_user_id: userId,
        },
      });
      json(res, 409, { error_code: 'CONFLICT', message: 'project_owner_membership_cannot_be_removed' });
      return true;
    }
    const existing = await getProjectMembership(deps.docStore, workspaceId, projectId, userId);
    if (!existing) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'member.membership.removed',
        result: 'error',
        requestId,
        resourceType: 'membership',
        resourceId: userId,
        errorCode: 'NOT_FOUND',
        errorMessage: 'membership_not_found',
        metadata: {
          target_user_id: userId,
        },
      });
      json(res, 404, { error_code: 'NOT_FOUND', message: 'membership_not_found' });
      return true;
    }
    await deleteProjectMembershipRecord(deps.docStore, workspaceId, projectId, userId);
    await clearMemberGovernanceState({
      deps,
      workspaceId,
      projectId,
      userId,
      projectOwnerId: projectPermissionContext.ownerId,
    });

    await appendMemberChange({
      deps,
      workspaceId,
      projectId,
      userId,
      actorId: user.id,
      actorEmail: user.email,
      changeType: 'membership',
      changes: {
        updated: {
          status: { from: existing.status, to: 'removed' },
        },
      },
    });

    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.membership.removed',
      requestId,
      resourceType: 'membership',
      resourceId: userId,
      metadata: {
        target_user_id: userId,
        previous_status: existing.status,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'projectMemberPermissions' && method === 'GET') {
    const current = await getProjectMemberPermissionState(deps.docStore, workspaceId, projectId, userId);
    json(res, 200, {
      platform_permissions: current?.permissions ?? [],
      resource_permissions: undefined,
    });
    return true;
  }

  if (routeKind === 'projectMemberPermissions' && method === 'PATCH') {
    const requestId = readRequestId(req);
    const projectPermissionContext = await requireMembershipUpdatePermission({
      deps,
      workspaceId,
      projectId,
      actorUserId: user.id,
    });
    if (!projectPermissionContext) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'member.permissions.updated',
        result: 'error',
        requestId,
        resourceType: 'member',
        resourceId: userId,
        errorCode: 'PERMISSION_DENIED',
        errorMessage: 'project_owner_required',
        metadata: {
          target_user_id: userId,
        },
      });
      json(res, 403, { error_code: 'PERMISSION_DENIED', message: 'project_owner_required' });
      return true;
    }
    const body = await readBody(req) as {
      template?: string | null;
      permissions?: string[];
      mode?: 'template' | 'custom';
    };
    if (!body || (body.mode !== 'template' && body.mode !== 'custom')) {
      await writeProjectAuditEvent(deps, {
        workspaceId,
        projectId,
        actor: { type: 'user', id: user.id },
        action: 'member.permissions.updated',
        result: 'error',
        requestId,
        resourceType: 'member',
        resourceId: userId,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'mode is required',
        metadata: {
          target_user_id: userId,
        },
      });
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'mode is required' });
      return true;
    }
    const prev = await getProjectMemberPermissionState(deps.docStore, workspaceId, projectId, userId)
      ?? { mode: 'custom' as const, template: null, permissions: [] };
    const nextPermissions = Array.isArray(body.permissions)
      ? body.permissions.filter((v): v is string => typeof v === 'string')
      : prev.permissions;
    const nextTemplate = body.mode === 'template'
      ? (typeof body.template === 'string' || body.template === null ? body.template : prev.template ?? null)
      : null;
    await upsertProjectMemberPermissionState(deps.docStore, workspaceId, projectId, userId, {
      mode: body.mode,
      template: nextTemplate,
      permissions: nextPermissions,
    });
    await appendMemberChange({
      deps,
      workspaceId,
      projectId,
      userId,
      actorId: user.id,
      actorEmail: user.email,
      changeType: 'permissions',
      changes: {
        updated: {
          mode: { from: prev.mode, to: body.mode },
          template: { from: prev.template ?? null, to: nextTemplate },
        },
        added: nextPermissions.filter((p) => !prev.permissions.includes(p)),
        removed: prev.permissions.filter((p) => !nextPermissions.includes(p)),
      },
    });
    await writeProjectAuditEvent(deps, {
      workspaceId,
      projectId,
      actor: { type: 'user', id: user.id },
      action: 'member.permissions.updated',
      requestId,
      resourceType: 'member',
      resourceId: userId,
      metadata: {
        target_user_id: userId,
        mode: {
          from: prev.mode,
          to: body.mode,
        },
        template: {
          from: prev.template ?? null,
          to: nextTemplate,
        },
        permissions_added: nextPermissions.filter((p) => !prev.permissions.includes(p)),
        permissions_removed: prev.permissions.filter((p) => !nextPermissions.includes(p)),
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  if (routeKind === 'projectMemberChangeHistory' && method === 'GET') {
    json(res, 200, { items: await listProjectMemberChangeHistory(deps.docStore, workspaceId, projectId, userId) });
    return true;
  }

  return false;
}
