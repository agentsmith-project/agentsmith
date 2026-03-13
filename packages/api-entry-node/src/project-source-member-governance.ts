import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import type { NodeApiDeps } from './node-api-deps.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import {
  getProjectGroupsState,
  setProjectGroupsState,
} from './project-groups-store.js';
import { getProjectMemberPermissionsState } from './project-member-permissions-store.js';
import {
  getProjectMembershipsState,
} from './project-memberships-store.js';
import {
  getProjectPermissionTemplatesState,
  setProjectPermissionTemplatesState,
} from './project-permission-templates-store.js';
import { isProjectAdmin } from './workspace-permissions.js';
import { projectScopedKey, readProjectPermissionContext, readRequestId } from './project-source-route-handler-utils.js';

type JsonResponder = (res: http.ServerResponse, statusCode: number, body: unknown) => void;

type MemberChangeRecord = {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  change_type: 'permissions' | 'resource_policy' | 'role' | 'membership';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
};

const PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT = new Map<string, Map<string, MemberChangeRecord[]>>();

export function getMemberChangeHistoryState(workspaceId: string, projectId: string) {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT.get(key);
  if (existing) return existing;
  const map = new Map<string, MemberChangeRecord[]>();
  PROJECT_MEMBER_CHANGE_HISTORY_BY_PROJECT.set(key, map);
  return map;
}

function clearMemberGovernanceState(workspaceId: string, projectId: string, userId: string): void {
  const groups = getProjectGroupsState(workspaceId, projectId);
  let groupsChanged = false;
  for (const group of groups) {
    if (!group.member_ids.includes(userId)) continue;
    group.member_ids = group.member_ids.filter((memberId) => memberId !== userId);
    group.updated_at = new Date().toISOString();
    groupsChanged = true;
  }
  if (groupsChanged) {
    setProjectGroupsState(workspaceId, projectId, groups);
  }
  getProjectMemberPermissionsState(workspaceId, projectId).delete(userId);
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
    json(res, 200, { items: getProjectPermissionTemplatesState(workspaceId, projectId) });
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
    const items = getProjectPermissionTemplatesState(workspaceId, projectId);
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
    items.push(created);
    setProjectPermissionTemplatesState(workspaceId, projectId, items);
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
    const items = getProjectPermissionTemplatesState(workspaceId, projectId);
    const item = items.find((it) => it.id === templateId);
    if (!item) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Permission template not found' });
      return true;
    }
    if (item.built_in) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be modified' });
      return true;
    }
    if (typeof body.name === 'string') item.name = body.name;
    if (typeof body.description === 'string' || body.description === undefined) item.description = body.description;
    if (Array.isArray(body.permissions)) {
      item.permissions = body.permissions.filter((v): v is string => typeof v === 'string');
    }
    item.updated_at = new Date().toISOString();
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
    const items = getProjectPermissionTemplatesState(workspaceId, projectId);
    const target = items.find((it) => it.id === templateId);
    if (!target) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Permission template not found' });
      return true;
    }
    if (target.built_in) {
      json(res, 409, { error_code: 'CONFLICT', message: 'Built-in templates cannot be deleted' });
      return true;
    }
    setProjectPermissionTemplatesState(
      workspaceId,
      projectId,
      items.filter((it) => it.id !== templateId),
    );
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
    json(res, 200, { items: getProjectGroupsState(workspaceId, projectId) });
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
    const groups = getProjectGroupsState(workspaceId, projectId);
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
    groups.push(created);
    setProjectGroupsState(workspaceId, projectId, groups);
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
    const groups = getProjectGroupsState(workspaceId, projectId);
    const group = groups.find((g) => g.id === groupId);
    if (!group) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'Group not found' });
      return true;
    }
    if (typeof body.name === 'string') group.name = body.name;
    if (typeof body.description === 'string' || body.description === undefined) group.description = body.description;
    if (typeof body.permission_template_id === 'string') group.permission_template_id = body.permission_template_id;
    if (Array.isArray(body.member_ids)) {
      group.member_ids = body.member_ids.filter((v): v is string => typeof v === 'string');
    }
    group.updated_at = new Date().toISOString();
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
    const groups = getProjectGroupsState(workspaceId, projectId);
    const next = groups.filter((g) => g.id !== groupId);
    setProjectGroupsState(workspaceId, projectId, next);
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
    const groups = getProjectGroupsState(workspaceId, projectId);
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
    const membership = getProjectMembershipsState(workspaceId, projectId).get(userId);
    const isCurrentUser = userId === user.id;
    const role = membership?.role ?? (projectOwnerId === userId ? 'owner' : 'developer');
    const effectiveRole = projectOwnerId === userId
      ? 'owner'
      : (isProjectAdmin(projectGovernance, userId) ? 'admin' : role);
    json(res, 200, {
      project_id: projectId,
      user_id: userId,
      role: effectiveRole,
      permissions: isCurrentUser
        ? [
          ...resolveVisibleProjectPermissionsForActor({
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
    const memberships = getProjectMembershipsState(workspaceId, projectId);
    const existing = memberships.get(userId);
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
      memberships.set(userId, {
        project_id: projectId,
        user_id: userId,
        role: 'developer',
        status: 'active',
        joined_at: new Date().toISOString(),
      });
    } else {
      prevStatus = existing.status;
      existing.status = body.status;
      memberships.set(userId, existing);
    }

    const historyState = getMemberChangeHistoryState(workspaceId, projectId);
    const items = historyState.get(userId) ?? [];
    items.unshift({
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      actor_id: user.id,
      actor_email: user.email,
      change_type: 'membership',
      changes: {
        updated: {
          status: { from: prevStatus ?? 'missing', to: body.status },
        },
      },
    });
    historyState.set(userId, items);

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
    const memberships = getProjectMembershipsState(workspaceId, projectId);
    const existing = memberships.get(userId);
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
    memberships.delete(userId);
    clearMemberGovernanceState(workspaceId, projectId, userId);

    const historyState = getMemberChangeHistoryState(workspaceId, projectId);
    const items = historyState.get(userId) ?? [];
    items.unshift({
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      actor_id: user.id,
      actor_email: user.email,
      change_type: 'membership',
      changes: {
        updated: {
          status: { from: existing.status, to: 'removed' },
        },
      },
    });
    historyState.set(userId, items);

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
    const state = getProjectMemberPermissionsState(workspaceId, projectId);
    const current = state.get(userId);
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
    const state = getProjectMemberPermissionsState(workspaceId, projectId);
    const prev = state.get(userId) ?? { mode: 'custom' as const, template: null, permissions: [] };
    const nextPermissions = Array.isArray(body.permissions)
      ? body.permissions.filter((v): v is string => typeof v === 'string')
      : prev.permissions;
    const nextTemplate = body.mode === 'template'
      ? (typeof body.template === 'string' || body.template === null ? body.template : prev.template ?? null)
      : null;
    state.set(userId, {
      mode: body.mode,
      template: nextTemplate,
      permissions: nextPermissions,
    });
    const historyState = getMemberChangeHistoryState(workspaceId, projectId);
    const items = historyState.get(userId) ?? [];
    items.unshift({
      id: `chg_${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      actor_id: user.id,
      actor_email: user.email,
      change_type: 'permissions',
      changes: {
        updated: {
          mode: { from: prev.mode, to: body.mode },
          template: { from: prev.template ?? null, to: nextTemplate },
        },
        added: nextPermissions.filter((p) => !prev.permissions.includes(p)),
        removed: prev.permissions.filter((p) => !nextPermissions.includes(p)),
      },
    });
    historyState.set(userId, items);
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
    const state = getMemberChangeHistoryState(workspaceId, projectId);
    json(res, 200, { items: state.get(userId) ?? [] });
    return true;
  }

  return false;
}
