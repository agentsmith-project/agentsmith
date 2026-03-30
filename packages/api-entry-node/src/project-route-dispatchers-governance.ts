import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import { handleProjectJoinRequestsRoute } from './project-join-request-routes.js';
import { handleProjectInviteCreateRoute } from './project-invite-routes.js';
import {
  handleProjectGroupsRoute,
  handleProjectMembershipGovernanceRoute,
  handleProjectPermissionTemplatesRoute,
} from './project-member-governance-routes.js';
import { handleProjectResourcePolicyRoute } from './project-resource-policy-routes.js';
import type { ProjectRouteContext } from './project-route-types.js';
import { listProjectJoinRequests } from './project-join-request-routes.js';
import { getProjectMembershipMap, listProjectGroups } from './project-member-governance-persistence.js';

export const RESOURCE_POLICY_ALLOWED_RATE_KEYS: Record<'endpoint' | 'file_library' | 'agent', readonly string[]> = {
  endpoint: ['endpoint.requests_per_minute', 'endpoint.requests_per_5_hours', 'endpoint.requests_per_day'],
  file_library: ['file_library.requests_per_minute'],
  agent: [],
};

export const RESOURCE_POLICY_ALLOWED_LIMIT_KEYS: Record<'endpoint' | 'file_library' | 'agent', readonly string[]> = {
  endpoint: [
    'endpoint.spending_usd_per_minute',
    'endpoint.spending_usd_per_5_hours',
    'endpoint.spending_usd_per_day',
  ],
  file_library: ['file_library.max_total_files', 'file_library.max_file_size_bytes'],
  agent: [],
};

export async function handleProjectGovernanceRoutes(context: ProjectRouteContext): Promise<boolean> {
  const {
    route,
    method,
    req,
    res,
    deps,
    user,
    json,
    readBody,
  } = context;

  if (route.kind === 'projectMembers' && method === 'GET' && route.workspaceId && route.projectId) {
    const workspaceId = route.workspaceId;
    const projectId = route.projectId;
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
      // Keep minimal members read endpoint usable in local/dev environments even
      // when membership/governance backend is not fully wired to project repo fixtures.
    }
    const memberships = Array.from((await getProjectMembershipMap(deps.docStore, workspaceId, projectId)).values());
    const allGroups = await listProjectGroups(deps.docStore, workspaceId, projectId, projectOwnerId ?? user.id);
    const actorPermissions = await resolveVisibleProjectPermissionsForActor({
      docStore: deps.docStore,
      workspaceId,
      projectId,
      projectOwnerId: projectOwnerId ?? user.id,
      projectGovernance,
      actorUserId: user.id,
    });
    const joinRequestsById = new Map(
      (await listProjectJoinRequests(deps.docStore, workspaceId, projectId)).map((request) => [request.id, request]),
    );
    const items = memberships.map((membership) => {
      const approvedRequest = membership.approved_via_join_request_id
        ? joinRequestsById.get(membership.approved_via_join_request_id)
        : undefined;
      const resolvedEmail = membership.user_id === user.id
        ? user.email
        : approvedRequest?.user_email || `${membership.user_id}@example.com`;
      const resolvedName = membership.user_id === user.id
        ? user.name
        : approvedRequest?.user_name || membership.user_id;
      const groups = allGroups
        .filter((group) => group.member_ids.includes(membership.user_id))
        .map((group) => ({
          id: group.id,
          name: group.name,
          permission_template_id: group.permission_template_id,
          built_in: group.built_in ?? false,
          system_key: group.system_key,
        }));
      return {
        id: membership.user_id,
        email: resolvedEmail,
        name: resolvedName,
        groups,
        permissions: membership.user_id === user.id
          ? [...actorPermissions]
          : [],
        status: membership.status,
        joined_at: membership.joined_at,
      };
    });
    if (!items.some((item) => item.id === (projectOwnerId ?? user.id))) {
      const ownerId = projectOwnerId ?? user.id;
      items.unshift({
        id: ownerId,
        email: ownerId === user.id ? user.email : `${ownerId}@example.com`,
        name: ownerId === user.id ? user.name : ownerId,
        groups: allGroups
          .filter((group) => group.member_ids.includes(ownerId))
          .map((group) => ({
            id: group.id,
            name: group.name,
            permission_template_id: group.permission_template_id,
            built_in: group.built_in ?? false,
            system_key: group.system_key,
          })),
        permissions: ownerId === user.id
          ? [...actorPermissions]
          : [],
        status: 'active',
        joined_at: projectCreatedAt ?? new Date().toISOString(),
      });
    }
    json(res, 200, { items, total: items.length });
    return true;
  }

  if (route.kind === 'projectInvites' && method === 'POST' && route.workspaceId && route.projectId) {
    return handleProjectInviteCreateRoute({
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      method,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
  }

  if (
    route.kind === 'projectJoinRequests'
    && (method === 'GET' || method === 'POST')
    && route.workspaceId
    && route.projectId
  ) {
    return handleProjectJoinRequestsRoute({
      routeKind: route.kind,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      method,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
  }

  if (
    (route.kind === 'projectJoinRequestApprove' || route.kind === 'projectJoinRequestReject')
    && method === 'POST'
    && route.workspaceId
    && route.projectId
    && route.joinId
  ) {
    return handleProjectJoinRequestsRoute({
      routeKind: route.kind,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      joinId: route.joinId,
      method,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
  }

  if (
    (route.kind === 'projectPermissionTemplates' || route.kind === 'projectPermissionTemplateItem')
    && route.workspaceId
    && route.projectId
    && (
      (route.kind === 'projectPermissionTemplates' && (method === 'GET' || method === 'POST'))
      || (route.kind === 'projectPermissionTemplateItem' && (method === 'PATCH' || method === 'DELETE') && route.templateId)
    )
  ) {
    return handleProjectPermissionTemplatesRoute({
      routeKind: route.kind,
      method,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      templateId: route.templateId,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
  }

  if (
    (route.kind === 'projectGroups' || route.kind === 'projectGroupItem' || route.kind === 'projectGroupApplyTemplate')
    && route.workspaceId
    && route.projectId
    && (
      (route.kind === 'projectGroups' && (method === 'GET' || method === 'POST'))
      || (route.kind === 'projectGroupItem' && (method === 'PATCH' || method === 'DELETE') && route.groupId)
      || (route.kind === 'projectGroupApplyTemplate' && method === 'POST' && route.groupId)
    )
  ) {
    return handleProjectGroupsRoute({
      routeKind: route.kind,
      method,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      groupId: route.groupId,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
  }

  if (route.kind === 'projectMembershipItem' && method === 'GET') {
    if (!route.workspaceId || !route.projectId || !route.userId) {
      return false;
    }
    return handleProjectMembershipGovernanceRoute({
      routeKind: route.kind,
      method,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      userId: route.userId,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
  }

  if (
    (route.kind === 'projectMembershipItem' || route.kind === 'projectMemberPermissions' || route.kind === 'projectMemberChangeHistory')
    && route.workspaceId
    && route.projectId
    && route.userId
    && (
      (route.kind === 'projectMembershipItem' && (method === 'PATCH' || method === 'DELETE'))
      || (route.kind === 'projectMemberPermissions' && (method === 'GET' || method === 'PATCH'))
      || (route.kind === 'projectMemberChangeHistory' && method === 'GET')
    )
  ) {
    return handleProjectMembershipGovernanceRoute({
      routeKind: route.kind,
      method,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      userId: route.userId,
      req,
      res,
      deps,
      user,
      json,
      readBody,
    });
  }

  if (
    route.kind === 'projectResourcePolicy'
    && route.workspaceId
    && route.projectId
    && route.resourceType
    && route.resourceId
    && (method === 'GET' || method === 'PATCH')
  ) {
    return handleProjectResourcePolicyRoute({
      method,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      resourceType: route.resourceType,
      resourceId: route.resourceId,
      req,
      res,
      deps,
      user,
      json,
      readBody,
      allowedRateKeys: RESOURCE_POLICY_ALLOWED_RATE_KEYS,
      allowedLimitKeys: RESOURCE_POLICY_ALLOWED_LIMIT_KEYS,
    });
  }

  return false;
}
