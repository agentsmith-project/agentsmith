import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import type { AgentRecord, AgentRunnerStatus } from './resource-models.js';
import { isManagedAgentRunner } from './agent-runner-profile.js';

type AgentPresence = 'online' | 'offline' | 'managed';
type AgentRunnerPublicField =
  | 'mode'
  | 'runner_runtime'
  | 'interaction_kind'
  | 'type'
  | 'execution_preferences'
  | 'execution_preferences_json'
  | 'config.image'
  | 'config._internal_raw_key'
  | 'config._internal_key_id';
const AGENT_RUNNER_READ_PERMISSION = 'project:agent_runner:read';
const AGENT_RUNNER_MANAGE_PERMISSION = 'project:agent_runner:manage';

const UNSUPPORTED_AGENT_RUNNER_FIELDS: AgentRunnerPublicField[] = [
  'mode',
  'runner_runtime',
  'interaction_kind',
  'type',
  'execution_preferences',
  'execution_preferences_json',
  'config.image',
  'config._internal_raw_key',
  'config._internal_key_id',
];

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
    const perms = await resolveVisibleProjectPermissionsForActor({
      docStore: deps.docStore,
      workspaceId,
      projectId,
      projectOwnerId: project.owner_id,
      projectGovernance: project.governance_json,
      actorUserId,
    });
    return new Set(perms);
  } catch {
    return new Set<string>();
  }
}

function canReadAgentRunners(actorPermissions: Set<string>): boolean {
  return actorPermissions.has(AGENT_RUNNER_READ_PERMISSION)
    || actorPermissions.has(AGENT_RUNNER_MANAGE_PERMISSION);
}

function canManageAgentRunners(actorPermissions: Set<string>): boolean {
  return actorPermissions.has(AGENT_RUNNER_MANAGE_PERMISSION);
}

function readUnsupportedAgentRunnerFields(raw: Record<string, unknown>): AgentRunnerPublicField[] {
  const config = readObject(raw.config);
  return UNSUPPORTED_AGENT_RUNNER_FIELDS.filter((field) => (
    Object.prototype.hasOwnProperty.call(raw, field)
    || (field === 'runner_runtime' && Object.prototype.hasOwnProperty.call(config ?? {}, 'runner_runtime'))
    || (field === 'config.image' && Object.prototype.hasOwnProperty.call(config ?? {}, 'image'))
    || (field === 'config._internal_raw_key' && Object.prototype.hasOwnProperty.call(config ?? {}, '_internal_raw_key'))
    || (field === 'config._internal_key_id' && Object.prototype.hasOwnProperty.call(config ?? {}, '_internal_key_id'))
  ));
}

function readAgentRunnerStatus(raw: unknown): AgentRunnerStatus | undefined {
  return raw === 'draft'
    || raw === 'connected'
    || raw === 'ready'
    || raw === 'degraded'
    || raw === 'offline'
    ? raw
    : undefined;
}

function readObject(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : undefined;
}

function resolveAgentRunnerStatusForApi(agent: Pick<AgentRecord, 'runner_provider' | 'presence' | 'status' | 'runner_status'>): AgentRunnerStatus {
  if (agent.runner_status) return agent.runner_status;
  if (agent.status !== 'enabled') return 'offline';
  if (isManagedAgentRunner(agent)) return 'ready';
  if (agent.presence === 'online') return 'ready';
  return 'offline';
}

function readDefaultEndpointId(agent: Pick<AgentRecord, 'default_endpoint_id' | 'config'>): string | undefined {
  const direct = agent.default_endpoint_id?.trim();
  if (direct) return direct;
  const configEndpoint = typeof agent.config?.endpoint_id === 'string'
    ? agent.config.endpoint_id.trim()
    : '';
  return configEndpoint || undefined;
}

function toPublicAgentRunner<T extends AgentRecord>(deps: NodeApiDeps, agent: T) {
  const status = resolveAgentRunnerStatusForApi(agent);
  const diagnostics = agent.diagnostics ?? {};
  return {
    id: agent.id,
    project_id: agent.project_id,
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    is_default: agent.is_default === true,
    status,
    ...(readDefaultEndpointId(agent) ? { default_endpoint_id: readDefaultEndpointId(agent) } : {}),
    capabilities: agent.capabilities ?? {},
    diagnostics: {
      ...diagnostics,
      presence: resolveAgentPresenceForApi({
        managed: isManagedAgentRunner(agent),
        storedPresence: agent.presence,
        socketOnline: deps.agentExecutionService.getAgentOnlineState(agent.id),
      }),
    },
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  };
}

export function resolveAgentPresenceForApi(input: {
  managed: boolean;
  storedPresence?: AgentPresence;
  socketOnline: boolean;
}): AgentPresence {
  if (input.managed) {
    return 'managed';
  }
  return input.storedPresence === 'online' || input.socketOnline ? 'online' : 'offline';
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
    agent_runner_id: item.agent_id,
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
    if (!canReadAgentRunners(actorPermissions)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_forbidden' });
      return true;
    }
    const items = await deps.agentResourceService.listAgents(route.workspaceId, route.projectId);
    json(res, 200, {
      items: items.map((item) => toPublicAgentRunner(deps, item)),
      total: items.length,
      page: 1,
      page_size: items.length,
      has_more: false,
    });
    return true;
  }

  if (route.kind === 'agents' && method === 'POST') {
    const raw = (await readBody(req)) as Record<string, unknown>;
    const unsupportedFields = readUnsupportedAgentRunnerFields(raw);
    if (unsupportedFields.length > 0) {
      json(res, 400, {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      });
      return true;
    }
    const name = String(raw.name ?? '').trim();
    if (!name) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_name_required' });
      return true;
    }
    const requestedStatus = readAgentRunnerStatus(raw.status);
    const defaultEndpointId = typeof raw.default_endpoint_id === 'string' ? raw.default_endpoint_id.trim() : '';
    const created = await deps.agentResourceService.createAgent(route.workspaceId, route.projectId, {
      name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      status: requestedStatus === 'offline' ? 'disabled' : 'enabled',
      presence: 'managed',
      runner_status: requestedStatus ?? 'draft',
      is_default: raw.is_default === true,
      default_endpoint_id: defaultEndpointId || undefined,
      execution_preferences_json: defaultEndpointId
        ? { agent_task: { endpoint_id: defaultEndpointId, wire_api: 'openai_responses' } }
        : undefined,
      diagnostics:
        typeof raw.diagnostics === 'object' && raw.diagnostics !== null && !Array.isArray(raw.diagnostics)
          ? raw.diagnostics as Record<string, unknown>
          : undefined,
      capabilities:
        typeof raw.capabilities === 'object' && raw.capabilities !== null
          ? (raw.capabilities as Record<string, unknown>)
          : undefined,
      owner_id: user.id,
      admin_id: user.id,
      visibility: 'private',
    });
    if (created.is_default) {
      await deps.agentResourceService.clearDefaultAgentRunnersExcept(route.workspaceId, route.projectId, created.id);
    }
    let responseAgent = created;
    json(res, 201, toPublicAgentRunner(deps, responseAgent));
    return true;
  }

  if (route.kind === 'agentItem' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    if (!canReadAgentRunners(actorPermissions)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_forbidden' });
      return true;
    }
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    json(res, 200, toPublicAgentRunner(deps, item));
    return true;
  }

  if (route.kind === 'agentItem' && method === 'PATCH') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageRunners = canManageAgentRunners(actorPermissions);
    const existing = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!existing) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!canManageRunners) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const raw = (await readBody(req)) as Record<string, unknown>;
    const unsupportedFields = readUnsupportedAgentRunnerFields(raw);
    if (unsupportedFields.length > 0) {
      json(res, 400, {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      });
      return true;
    }
    const updated = await deps.agentResourceService.updateAgent(route.workspaceId, route.projectId, route.agentId, {
      name: typeof raw.name === 'string' ? raw.name : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      is_default: typeof raw.is_default === 'boolean' ? raw.is_default : undefined,
      default_endpoint_id: typeof raw.default_endpoint_id === 'string' ? raw.default_endpoint_id.trim() : undefined,
      runner_status: readAgentRunnerStatus(raw.status),
      status: raw.status === 'offline' ? 'disabled' : raw.status ? 'enabled' : undefined,
      presence:
        raw.status === 'ready' || raw.status === 'connected'
          ? 'online'
          : raw.status === 'offline'
            ? 'offline'
        : raw.presence === 'online' || raw.presence === 'offline' || raw.presence === 'managed'
          ? raw.presence
          : undefined,
      admin_id: typeof raw.admin_id === 'string' ? raw.admin_id : undefined,
      visibility:
        raw.visibility === 'public' || raw.visibility === 'private'
          ? raw.visibility
          : undefined,
      capabilities:
        typeof raw.capabilities === 'object' && raw.capabilities !== null
          ? (raw.capabilities as Record<string, unknown>) as never
          : undefined,
    });
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (updated.is_default) {
      await deps.agentResourceService.clearDefaultAgentRunnersExcept(route.workspaceId, route.projectId, updated.id);
    }
    json(res, 200, toPublicAgentRunner(deps, updated));
    return true;
  }

  if (route.kind === 'agentItem' && method === 'DELETE') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageRunners = canManageAgentRunners(actorPermissions);
    const existing = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!existing) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!canManageRunners) {
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
    if (!canReadAgentRunners(actorPermissions)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_forbidden' });
      return true;
    }
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
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

  if (route.kind === 'agentExecutionConfig' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    if (!canManageAgentRunners(actorPermissions)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    json(res, 200, {
      project_id: route.projectId,
      agent_runner_id: route.agentId,
      execution_preferences: item.execution_preferences_json ?? {},
      schema_version: 1,
    });
    return true;
  }

  if (route.kind === 'agentConnectionInfo' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    if (!canManageAgentRunners(actorPermissions)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    json(res, 200, deps.agentResourceService.buildConnectionInfo(item));
    return true;
  }

  if (route.kind === 'agentKeys' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageRunners = canManageAgentRunners(actorPermissions);
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!canManageRunners) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const keys = await deps.agentResourceService.listAgentKeys(route.workspaceId, route.projectId, route.agentId);
    json(res, 200, { items: keys.map(toPublicKeyRecord), total: keys.length });
    return true;
  }

  if (route.kind === 'agentKeys' && method === 'POST') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageRunners = canManageAgentRunners(actorPermissions);
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!canManageRunners) {
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
    const canManageRunners = canManageAgentRunners(actorPermissions);
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!canManageRunners) {
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
