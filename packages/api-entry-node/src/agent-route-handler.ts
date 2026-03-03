import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';

interface AgentRouteHandlerArgs {
  route: ProjectsRoute;
  method: string;
  req: http.IncomingMessage;
  res: http.ServerResponse;
  deps: NodeApiDeps;
  user: AuthenticatedUser;
  json: (res: http.ServerResponse, statusCode: number, body: unknown) => void;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

async function resolveActorPermissions(
  deps: NodeApiDeps,
  workspaceId: string,
  projectId: string,
  actorUserId: string,
): Promise<Set<string>> {
  try {
    const project = await deps.getProjectUseCase.execute({ workspaceId, projectId });
    const perms = resolveVisibleProjectPermissionsForActor({
      workspaceId,
      projectId,
      projectOwnerId: project.owner_id,
      actorUserId,
    });
    return new Set(perms);
  } catch {
    return new Set<string>(['project:endpoint:use', 'project:agent:manage']);
  }
}

function validateNotebookEndpoint(runtimePreferences: Record<string, unknown> | undefined): boolean {
  if (!runtimePreferences) return false;
  const notebook = runtimePreferences.notebook;
  if (typeof notebook !== 'object' || notebook === null) return false;
  const endpointId = (notebook as Record<string, unknown>).endpoint_id;
  return typeof endpointId === 'string' && endpointId.trim().length > 0;
}

function toPublicKeyRecord(item: {
  id: string;
  agent_id: string;
  key_prefix: string;
  status: 'active' | 'suspended' | 'revoked' | 'expired';
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
}) {
  return {
    id: item.id,
    agent_id: item.agent_id,
    key_prefix: item.key_prefix,
    status: item.status,
    created_at: item.created_at,
    expires_at: item.expires_at,
    last_used_at: item.last_used_at,
  };
}

export async function handleAgentRoute(args: AgentRouteHandlerArgs): Promise<boolean> {
  const { route, method, req, res, deps, user, json, readBody } = args;

  if (route.kind === 'agents' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const items = await deps.agentResourceService.listVisibleAgents(
      route.workspaceId,
      route.projectId,
      user.id,
      canManageProject,
    );
    json(res, 200, { items, total: items.length, page: 1, page_size: items.length, has_more: false });
    return true;
  }

  if (route.kind === 'agents' && method === 'POST') {
    const raw = (await readBody(req)) as Record<string, unknown>;
    const name = String(raw.name ?? '').trim();
    if (!name) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_name_required' });
      return true;
    }
    const runtimePreferences =
      typeof raw.runtime_preferences_json === 'object' && raw.runtime_preferences_json !== null
        ? (raw.runtime_preferences_json as Record<string, unknown>)
        : (typeof raw.runtime_preferences === 'object' && raw.runtime_preferences !== null
          ? (raw.runtime_preferences as Record<string, unknown>)
          : undefined);
    if (
      (raw.interaction_mode === 'notebook' || raw.interaction_mode === 'both')
      && !validateNotebookEndpoint(runtimePreferences)
    ) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_notebook_endpoint_required' });
      return true;
    }
    const created = await deps.agentResourceService.createAgent(route.workspaceId, route.projectId, {
      name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      mode: raw.mode === 'internal' ? 'internal' : 'external',
      interaction_mode:
        raw.interaction_mode === 'chat' || raw.interaction_mode === 'notebook' || raw.interaction_mode === 'both'
          ? raw.interaction_mode
          : 'both',
      status: raw.status === 'disabled' ? 'disabled' : 'enabled',
      config: typeof raw.config === 'object' && raw.config !== null ? (raw.config as Record<string, unknown>) as never : undefined,
      runtime_preferences_json: runtimePreferences,
      capabilities:
        typeof raw.capabilities === 'object' && raw.capabilities !== null
          ? (raw.capabilities as Record<string, unknown>) as never
          : undefined,
      owner_id: user.id,
      admin_id: user.id,
      visibility: 'private',
    });
    json(res, 201, created);
    return true;
  }

  if (route.kind === 'agentItem' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_not_visible' });
      return true;
    }
    json(res, 200, item);
    return true;
  }

  if (route.kind === 'agentItem' && method === 'PATCH') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const canPublicAgent = canManageProject || actorPermissions.has('project:agent:public');
    const existing = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!existing) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(existing, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const raw = (await readBody(req)) as Record<string, unknown>;
    if (raw.visibility !== undefined && raw.visibility !== existing.visibility && !canPublicAgent) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_public_forbidden' });
      return true;
    }
    const runtimePreferences =
      typeof raw.runtime_preferences_json === 'object' && raw.runtime_preferences_json !== null
        ? (raw.runtime_preferences_json as Record<string, unknown>)
        : (typeof raw.runtime_preferences === 'object' && raw.runtime_preferences !== null
          ? (raw.runtime_preferences as Record<string, unknown>)
          : undefined);
    const requestedInteraction =
      raw.interaction_mode === 'chat' || raw.interaction_mode === 'notebook' || raw.interaction_mode === 'both'
        ? raw.interaction_mode
        : undefined;
    if ((requestedInteraction === 'notebook' || requestedInteraction === 'both') && !validateNotebookEndpoint(runtimePreferences)) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_notebook_endpoint_required' });
      return true;
    }
    const updated = await deps.agentResourceService.updateAgent(route.workspaceId, route.projectId, route.agentId, {
      name: typeof raw.name === 'string' ? raw.name : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      mode: raw.mode === 'internal' || raw.mode === 'external' ? raw.mode : undefined,
      interaction_mode:
        raw.interaction_mode === 'chat' || raw.interaction_mode === 'notebook' || raw.interaction_mode === 'both'
          ? raw.interaction_mode
          : undefined,
      presence:
        raw.presence === 'online' || raw.presence === 'offline' || raw.presence === 'managed'
          ? raw.presence
          : undefined,
      status: raw.status === 'enabled' || raw.status === 'disabled' ? raw.status : undefined,
      admin_id: canManageProject && typeof raw.admin_id === 'string' ? raw.admin_id : undefined,
      visibility:
        raw.visibility === 'public' || raw.visibility === 'private'
          ? raw.visibility
          : undefined,
      runtime_preferences_json: runtimePreferences,
      capabilities:
        typeof raw.capabilities === 'object' && raw.capabilities !== null
          ? (raw.capabilities as Record<string, unknown>) as never
          : undefined,
    });
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    json(res, 200, updated);
    return true;
  }

  if (route.kind === 'agentItem' && method === 'DELETE') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const existing = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!existing) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(existing, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const deleted = await deps.agentResourceService.deleteAgent(route.workspaceId, route.projectId, route.agentId);
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    json(res, 200, { success: true });
    return true;
  }

  if (route.kind === 'agentDiagnostics' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_not_visible' });
      return true;
    }
    const diagnostics = await deps.agentResourceService.getDiagnostics(
      route.workspaceId,
      route.projectId,
      route.agentId,
    );
    json(res, 200, diagnostics);
    return true;
  }

  if (route.kind === 'agentRuntimeConfig' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_not_visible' });
      return true;
    }
    json(res, 200, {
      project_id: route.projectId,
      agent_id: route.agentId,
      runtime_preferences: item.runtime_preferences_json ?? {},
      schema_version: 1,
    });
    return true;
  }

  if (route.kind === 'agentConnectionInfo' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_not_visible' });
      return true;
    }
    json(res, 200, deps.agentResourceService.buildConnectionInfo(route.agentId));
    return true;
  }

  if (route.kind === 'agentKeys' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(item, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const keys = await deps.agentResourceService.listAgentKeys(route.workspaceId, route.projectId, route.agentId);
    json(res, 200, { items: keys.map(toPublicKeyRecord), total: keys.length });
    return true;
  }

  if (route.kind === 'agentKeys' && method === 'POST') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(item, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const created = await deps.agentResourceService.createAgentKey(route.workspaceId, route.projectId, route.agentId);
    json(res, 201, {
      ...toPublicKeyRecord(created.record),
      key: created.key,
    });
    return true;
  }

  if (route.kind === 'agentKeyItem' && method === 'DELETE') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageProject = actorPermissions.has('project:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(item, user.id, canManageProject)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const ok = await deps.agentResourceService.revokeAgentKey(
      route.workspaceId,
      route.projectId,
      route.agentId,
      route.keyId,
    );
    if (!ok) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_key_not_found' });
      return true;
    }
    json(res, 200, { success: true });
    return true;
  }

  return false;
}
