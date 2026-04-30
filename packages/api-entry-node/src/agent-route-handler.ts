import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import {
  INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS,
  INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS,
  INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS,
} from '@mbos/contracts';

type AgentPresence = 'online' | 'offline' | 'managed';

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
    return new Set<string>(['project:endpoint:use', 'project:agent:use']);
  }
}

function validateNotebookEndpoint(executionPreferences: Record<string, unknown> | undefined): boolean {
  if (!executionPreferences) return false;
  const notebook = executionPreferences.notebook;
  if (typeof notebook !== 'object' || notebook === null) return false;
  const endpointId = (notebook as Record<string, unknown>).endpoint_id;
  return typeof endpointId === 'string' && endpointId.trim().length > 0;
}

function validateChatEndpoint(executionPreferences: Record<string, unknown> | undefined): boolean {
  if (!executionPreferences) return false;
  const chat = executionPreferences.chat;
  if (typeof chat !== 'object' || chat === null) return false;
  const endpointId = (chat as Record<string, unknown>).endpoint_id;
  return typeof endpointId === 'string' && endpointId.trim().length > 0;
}

function validateExecutionPreferencesForInteractionKind(
  interactionKind: 'chat' | 'notebook',
  executionPreferences: Record<string, unknown> | undefined,
): boolean {
  if (interactionKind === 'chat') return validateChatEndpoint(executionPreferences);
  return validateNotebookEndpoint(executionPreferences);
}

function readInteractionKind(raw: Record<string, unknown>): 'chat' | 'notebook' | undefined {
  return raw.interaction_kind === 'chat' || raw.interaction_kind === 'notebook'
    ? raw.interaction_kind
    : undefined;
}

function hasInteractionKindField(raw: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(raw, 'interaction_kind');
}

function readObject(input: unknown): Record<string, unknown> | undefined {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : undefined;
}

function readOptionalIntegerField(
  config: Record<string, unknown> | undefined,
  key: 'idle_timeout_sec' | 'max_lifetime_sec',
): { value?: number; error?: string } {
  if (!config || config[key] === undefined || config[key] === null) {
    return {};
  }
  const raw = config[key];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
    return { error: `${key}_invalid` };
  }
  return { value: raw };
}

function validateInternalSandboxConfig(config: Record<string, unknown> | undefined): string | null {
  const idle = readOptionalIntegerField(config, 'idle_timeout_sec');
  if (idle.error) return idle.error;
  const maxLifetime = readOptionalIntegerField(config, 'max_lifetime_sec');
  if (maxLifetime.error) return maxLifetime.error;

  const effectiveIdle = idle.value ?? INTERNAL_AGENT_IDLE_TIMEOUT_DEFAULT_SECONDS;

  if (effectiveIdle < INTERNAL_AGENT_IDLE_TIMEOUT_MIN_SECONDS) {
    return 'idle_timeout_sec_too_low';
  }
  if (maxLifetime.value !== undefined && maxLifetime.value < INTERNAL_AGENT_MAX_LIFETIME_MIN_SECONDS) {
    return 'max_lifetime_sec_too_low';
  }
  if (maxLifetime.value !== undefined && maxLifetime.value < effectiveIdle) {
    return 'max_lifetime_sec_lt_idle_timeout_sec';
  }
  return null;
}

function stripInternalConfigFields(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!config) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key.startsWith('_internal_')) continue;
    next[key] = value;
  }
  return next;
}

function sanitizeAgentForApi<T extends { config?: Record<string, unknown> | undefined }>(agent: T): T {
  return {
    ...agent,
    ...(agent.config ? { config: stripInternalConfigFields(agent.config) } : {}),
  };
}

export function resolveAgentPresenceForApi(input: {
  mode: 'external' | 'internal';
  storedPresence?: AgentPresence;
  socketOnline: boolean;
}): AgentPresence {
  if (input.mode === 'internal') {
    return 'managed';
  }
  return input.storedPresence === 'online' || input.socketOnline ? 'online' : 'offline';
}

function toPublicAgent<T extends {
  id: string;
  mode: 'external' | 'internal';
  presence?: AgentPresence;
  config?: Record<string, unknown> | undefined;
}>(deps: NodeApiDeps, agent: T): Omit<T, 'presence'> & { presence: AgentPresence } {
  const sanitized = sanitizeAgentForApi(agent);
  return {
    ...sanitized,
    presence: resolveAgentPresenceForApi({
      mode: agent.mode,
      storedPresence: agent.presence,
      socketOnline: deps.agentExecutionService.getAgentOnlineState(agent.id),
    }),
  };
}

function readInternalImage(config: unknown): string {
  const cfg = readObject(config);
  const image = typeof cfg?.image === 'string' ? cfg.image.trim() : '';
  return image;
}

function readImageRegistryHost(image: string): string {
  const trimmed = image.trim();
  if (!trimmed.includes('/')) return '';
  const firstSegment = trimmed.slice(0, trimmed.indexOf('/'));
  if (firstSegment === 'localhost' || firstSegment.includes('.') || firstSegment.includes(':')) {
    return firstSegment;
  }
  return '';
}

function readImageRepository(image: string): string {
  const trimmed = image.trim();
  if (!trimmed) return '';
  const atIndex = trimmed.indexOf('@');
  if (atIndex >= 0) return trimmed.slice(0, atIndex);
  const slashIndex = trimmed.indexOf('/');
  const colonIndex = trimmed.lastIndexOf(':');
  if (colonIndex > slashIndex) return trimmed.slice(0, colonIndex);
  return trimmed;
}

export function normalizeInternalAgentImageForRuntime(image: string, runtimeImage = process.env.INTERNAL_AGENT_IMAGE ?? ''): string {
  const requested = image.trim();
  const runtime = runtimeImage.trim();
  if (!requested || !runtime) return requested;

  const requestedRepository = readImageRepository(requested);
  const runtimeRepository = readImageRepository(runtime);
  if (requestedRepository && runtimeRepository && requestedRepository === runtimeRepository) {
    return runtime;
  }

  const requestedRegistry = readImageRegistryHost(requested);
  const runtimeRegistry = readImageRegistryHost(runtime);
  if (!requestedRegistry || !runtimeRegistry || requestedRegistry === runtimeRegistry) {
    return requested;
  }

  if (requestedRegistry !== 'localhost:5001') {
    return requested;
  }

  return `${runtimeRegistry}/${requested.slice(requested.indexOf('/') + 1)}`;
}

function normalizeInternalConfig(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!config) return config;
  const image = typeof config.image === 'string' ? config.image.trim() : '';
  if (!image) return config;
  const normalizedImage = normalizeInternalAgentImageForRuntime(image);
  if (normalizedImage === image) return config;
  return {
    ...config,
    image: normalizedImage,
  };
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
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const items = await deps.agentResourceService.listVisibleAgents(
      route.workspaceId,
      route.projectId,
      user.id,
      canManageAgents,
    );
    json(res, 200, {
      items: items.map((item) => toPublicAgent(deps, item)),
      total: items.length,
      page: 1,
      page_size: items.length,
      has_more: false,
    });
    return true;
  }

  if (route.kind === 'agents' && method === 'POST') {
    const raw = (await readBody(req)) as Record<string, unknown>;
    const name = String(raw.name ?? '').trim();
    if (!name) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_name_required' });
      return true;
    }
    const interactionKind = readInteractionKind(raw);
    if (!interactionKind) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_interaction_kind_required' });
      return true;
    }
    const executionPreferences =
      typeof raw.execution_preferences_json === 'object' && raw.execution_preferences_json !== null
        ? (raw.execution_preferences_json as Record<string, unknown>)
        : (typeof raw.execution_preferences === 'object' && raw.execution_preferences !== null
          ? (raw.execution_preferences as Record<string, unknown>)
          : undefined);
    if (!validateExecutionPreferencesForInteractionKind(interactionKind, executionPreferences)) {
      json(
        res,
        422,
        {
          error_code: 'VALIDATION_ERROR',
          message: interactionKind === 'chat'
            ? 'agent_chat_endpoint_required'
            : 'agent_notebook_endpoint_required',
        },
      );
      return true;
    }
    const mode = raw.mode === 'internal' ? 'internal' : 'external';
    if (mode === 'internal') {
      if (!deps.internalAgentPodManager) {
        json(res, 422, { error_code: 'AGENT_SANDBOX_NOT_CONFIGURED', message: 'agent_sandbox_not_configured' });
        return true;
      }
      const internalConfig = readObject(raw.config);
      if (!readInternalImage(internalConfig)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_internal_image_required' });
        return true;
      }
      const validationError = validateInternalSandboxConfig(internalConfig);
      if (validationError) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: validationError });
        return true;
      }
    }
    const created = await deps.agentResourceService.createAgent(route.workspaceId, route.projectId, {
      name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      mode,
      interaction_kind: interactionKind,
      status: raw.status === 'disabled' ? 'disabled' : 'enabled',
      execution_preferences_json: executionPreferences,
      config: normalizeInternalConfig(readObject(raw.config)) as never,
      capabilities:
        typeof raw.capabilities === 'object' && raw.capabilities !== null
          ? (raw.capabilities as Record<string, unknown>) as never
          : undefined,
      owner_id: user.id,
      admin_id: user.id,
      visibility: 'private',
    });
    let responseAgent = created;
    if (mode === 'internal') {
      const createdKey = await deps.agentResourceService.createAgentKey(
        route.workspaceId,
        route.projectId,
        created.id,
      );
      const currentConfig = readObject(created.config) ?? {};
      const updated = await deps.agentResourceService.updateAgent(route.workspaceId, route.projectId, created.id, {
        config: {
          ...currentConfig,
          _internal_key_id: createdKey.record.id,
          _internal_raw_key: createdKey.key,
        } as never,
      });
      if (updated) {
        responseAgent = updated;
      }
    }
    json(res, 201, toPublicAgent(deps, responseAgent));
    return true;
  }

  if (route.kind === 'agentItem' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageAgents)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_not_visible' });
      return true;
    }
    json(res, 200, toPublicAgent(deps, item));
    return true;
  }

  if (route.kind === 'agentItem' && method === 'PATCH') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const canPublicAgent = actorPermissions.has('project:agent:public');
    const existing = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!existing) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(existing, user.id, canManageAgents)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const raw = (await readBody(req)) as Record<string, unknown>;
    if (raw.visibility !== undefined && raw.visibility !== existing.visibility && !canPublicAgent) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_public_forbidden' });
      return true;
    }
    const executionPreferences =
      typeof raw.execution_preferences_json === 'object' && raw.execution_preferences_json !== null
        ? (raw.execution_preferences_json as Record<string, unknown>)
        : (typeof raw.execution_preferences === 'object' && raw.execution_preferences !== null
          ? (raw.execution_preferences as Record<string, unknown>)
          : undefined);
    const requestedInteractionKind = readInteractionKind(raw);
    if (hasInteractionKindField(raw) && !requestedInteractionKind) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_interaction_kind_required' });
      return true;
    }
    const effectiveInteractionKind = requestedInteractionKind ?? existing.interaction_kind;
    if (!effectiveInteractionKind) {
      json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_interaction_kind_required' });
      return true;
    }
    const effectiveExecutionPreferences = executionPreferences ?? readObject(existing.execution_preferences_json);
    if (
      (requestedInteractionKind !== undefined || executionPreferences !== undefined)
      && !validateExecutionPreferencesForInteractionKind(effectiveInteractionKind, effectiveExecutionPreferences)
    ) {
      json(
        res,
        422,
        {
          error_code: 'VALIDATION_ERROR',
          message: effectiveInteractionKind === 'chat'
            ? 'agent_chat_endpoint_required'
            : 'agent_notebook_endpoint_required',
        },
      );
      return true;
    }
    const existingConfig = readObject(existing.config) ?? {};
    const incomingConfig = readObject(raw.config);
    let mergedConfig = incomingConfig
      ? {
        ...existingConfig,
        ...incomingConfig,
      }
      : undefined;
    mergedConfig = normalizeInternalConfig(mergedConfig);
    const requestedMode = raw.mode === 'internal' || raw.mode === 'external'
      ? raw.mode
      : existing.mode;
    if (requestedMode === 'internal') {
      if (!deps.internalAgentPodManager) {
        json(res, 422, { error_code: 'AGENT_SANDBOX_NOT_CONFIGURED', message: 'agent_sandbox_not_configured' });
        return true;
      }
      const effectiveConfig = mergedConfig ?? existingConfig;
      if (!readInternalImage(effectiveConfig)) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: 'agent_internal_image_required' });
        return true;
      }
    }
    if (requestedMode === 'internal') {
      const validationError = validateInternalSandboxConfig(mergedConfig);
      if (validationError) {
        json(res, 422, { error_code: 'VALIDATION_ERROR', message: validationError });
        return true;
      }
      const currentRawKey = typeof existingConfig._internal_raw_key === 'string'
        ? existingConfig._internal_raw_key
        : '';
      const nextRawKey = typeof mergedConfig?._internal_raw_key === 'string'
        ? mergedConfig._internal_raw_key
        : currentRawKey;
      if (!nextRawKey) {
        const createdKey = await deps.agentResourceService.createAgentKey(
          route.workspaceId,
          route.projectId,
          route.agentId,
        );
        mergedConfig = {
          ...(mergedConfig ?? existingConfig),
          _internal_key_id: createdKey.record.id,
          _internal_raw_key: createdKey.key,
        };
      }
    }
    const updated = await deps.agentResourceService.updateAgent(route.workspaceId, route.projectId, route.agentId, {
      name: typeof raw.name === 'string' ? raw.name : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      mode: raw.mode === 'internal' || raw.mode === 'external' ? raw.mode : undefined,
      interaction_kind: requestedInteractionKind,
      presence:
        raw.presence === 'online' || raw.presence === 'offline' || raw.presence === 'managed'
          ? raw.presence
          : undefined,
      status: raw.status === 'enabled' || raw.status === 'disabled' ? raw.status : undefined,
      admin_id: canManageAgents && typeof raw.admin_id === 'string' ? raw.admin_id : undefined,
      visibility:
        raw.visibility === 'public' || raw.visibility === 'private'
          ? raw.visibility
          : undefined,
      execution_preferences_json: executionPreferences,
      config: mergedConfig as never,
      capabilities:
        typeof raw.capabilities === 'object' && raw.capabilities !== null
          ? (raw.capabilities as Record<string, unknown>) as never
          : undefined,
    });
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    json(res, 200, toPublicAgent(deps, updated));
    return true;
  }

  if (route.kind === 'agentItem' && method === 'DELETE') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const existing = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!existing) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(existing, user.id, canManageAgents)) {
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
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageAgents)) {
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

  if (route.kind === 'agentExecutionConfig' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageAgents)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_not_visible' });
      return true;
    }
    json(res, 200, {
      project_id: route.projectId,
      agent_id: route.agentId,
      execution_preferences: item.execution_preferences_json ?? {},
      schema_version: 1,
    });
    return true;
  }

  if (route.kind === 'agentConnectionInfo' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canAccessAgent(item, user.id, canManageAgents)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_not_visible' });
      return true;
    }
    json(res, 200, deps.agentResourceService.buildConnectionInfo(item));
    return true;
  }

  if (route.kind === 'agentKeys' && method === 'GET') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(item, user.id, canManageAgents)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_manage_forbidden' });
      return true;
    }
    const keys = await deps.agentResourceService.listAgentKeys(route.workspaceId, route.projectId, route.agentId);
    json(res, 200, { items: keys.map(toPublicKeyRecord), total: keys.length });
    return true;
  }

  if (route.kind === 'agentKeys' && method === 'POST') {
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(item, user.id, canManageAgents)) {
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
    const canManageAgents = actorPermissions.has('project:agent:manage');
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (!deps.agentResourceService.canManageAgent(item, user.id, canManageAgents)) {
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
