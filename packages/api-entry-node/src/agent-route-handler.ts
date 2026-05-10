import type http from 'node:http';
import type { ProjectsRoute } from './projects-route-match.js';
import type { NodeApiDeps } from './node-api-deps.js';
import type { AuthenticatedUser } from './auth.js';
import { resolveVisibleProjectPermissionsForActor } from './project-authz-engine.js';
import type { AgentRecord, AgentRunnerStatus } from './resource-models.js';
import { isDeveloperAgentRunner, isManagedAgentRunner } from './agent-runner-profile.js';
import { writeProjectAuditEvent } from './audit-usage-recorders.js';
import { dispatchDeveloperRunnerTestTaskRun } from './agent-runner-test-task-command.js';
import {
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
  DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
  isDeveloperRunnerTaskHomeBindingAvailable,
} from './developer-runner-workspace-blocker.js';

type AgentPresence = 'online' | 'offline' | 'managed';
type AgentRunnerPublicField =
  | 'kind'
  | 'mode'
  | 'runner_runtime'
  | 'interaction_kind'
  | 'type'
  | 'execution_preferences'
  | 'execution_preferences_json'
  | 'is_default'
  | 'default_endpoint_id'
  | 'status'
  | 'diagnostics'
  | 'capabilities'
  | 'presence'
  | 'runner_status'
  | 'admin_id'
  | 'owner_id'
  | 'visibility'
  | 'config';
type AgentRunnerKind = 'system_managed' | 'developer';
type AgentRunnerSource = 'system' | 'developer';
type AgentRunnerItemActionOperation =
  | 'set_project_default'
  | 'bind_to_task'
  | 'run_test_task'
  | 'edit'
  | 'disable'
  | 'delete'
  | 'issue_connection_key'
  | 'revoke_connection_key'
  | 'test_connection'
  | 'view_diagnostics';
type AgentRunnerCollectionActionOperation = 'create_developer_runner';
type AgentRunnerActionOperation =
  | AgentRunnerItemActionOperation
  | AgentRunnerCollectionActionOperation;
type AgentRunnerActionDangerLevel = 'none' | 'medium' | 'high';
type AgentRunnerActionAffordance = {
  operation: AgentRunnerActionOperation;
  visible: boolean;
  allowed: boolean;
  reason_code?: string;
  required_permissions: string[];
  danger_level: AgentRunnerActionDangerLevel;
};
const AGENT_RUNNER_READ_PERMISSION = 'project:agent_runner:read';
const AGENT_RUNNER_MANAGE_PERMISSION = 'project:agent_runner:manage';
const AGENT_TASK_USE_PERMISSION = 'project:agent_task:use';
const AGENT_TEST_CONNECTION_DEFAULT_TIMEOUT_MS = 1000;
const AGENT_TEST_CONNECTION_MIN_TIMEOUT_MS = 100;
const AGENT_TEST_CONNECTION_MAX_TIMEOUT_MS = 10_000;
const RUNNER_TEST_TASK_DISPATCH_SUPPORTED = isDeveloperRunnerTaskHomeBindingAvailable();
const AGENT_TEST_CONNECTION_ALLOWED_FIELDS = new Set(['timeout_ms']);
const AGENT_RUNNER_TEST_TASK_ALLOWED_FIELDS = new Set(['intent']);

const UNSUPPORTED_AGENT_RUNNER_FIELDS: AgentRunnerPublicField[] = [
  'kind',
  'mode',
  'runner_runtime',
  'interaction_kind',
  'type',
  'execution_preferences',
  'execution_preferences_json',
  'is_default',
  'default_endpoint_id',
  'status',
  'diagnostics',
  'capabilities',
  'presence',
  'runner_status',
  'admin_id',
  'owner_id',
  'visibility',
  'config',
];
const CREATE_AGENT_RUNNER_ALLOWED_FIELDS = new Set(['name', 'description', 'kind']);
const UPDATE_AGENT_RUNNER_ALLOWED_FIELDS = new Set(['name', 'description']);

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

function readUnsupportedAgentRunnerFields(
  raw: Record<string, unknown>,
  allowedFields: Set<string>,
): string[] {
  const knownUnsupportedFields = UNSUPPORTED_AGENT_RUNNER_FIELDS.filter((field) => {
    if (field === 'kind') {
      return Object.prototype.hasOwnProperty.call(raw, field) && raw.kind !== 'developer';
    }
    return Object.prototype.hasOwnProperty.call(raw, field) && !allowedFields.has(field);
  });
  const unknownUnsupportedFields = Object.keys(raw).filter((field) => (
    !allowedFields.has(field)
    && !UNSUPPORTED_AGENT_RUNNER_FIELDS.includes(field as AgentRunnerPublicField)
  ));
  return [...knownUnsupportedFields, ...unknownUnsupportedFields];
}

function resolveAgentRunnerKind(agent: Pick<AgentRecord, 'runner_provider'>): AgentRunnerKind {
  return isDeveloperAgentRunner(agent) ? 'developer' : 'system_managed';
}

function resolveAgentRunnerSource(agent: Pick<AgentRecord, 'runner_provider'>): AgentRunnerSource {
  return isDeveloperAgentRunner(agent) ? 'developer' : 'system';
}

function buildActionAffordance(
  operation: AgentRunnerActionOperation,
  input: Omit<AgentRunnerActionAffordance, 'operation'>,
): AgentRunnerActionAffordance {
  return {
    operation,
    ...input,
  };
}

function permissionDeniedReason(allowed: boolean): string | undefined {
  return allowed ? undefined : 'permission_denied';
}

function resolveDeveloperActionUnavailableReason(input: {
  canUseAction: boolean;
  connectionOnline: boolean;
  ready: boolean;
  taskExecutionCapable?: boolean;
  dispatchSupported?: boolean;
}): string | undefined {
  if (!input.canUseAction) return 'permission_denied';
  if (input.dispatchSupported === false) return DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE;
  if (!input.connectionOnline) return 'agent_runner_disconnected';
  if (!input.ready) return 'agent_runner_unavailable';
  if (input.taskExecutionCapable === false) return 'agent_runner_capability_mismatch';
  return undefined;
}

export function buildAgentRunnerActionAffordances(
  agent: Pick<AgentRecord, 'runner_provider' | 'is_default' | 'status' | 'runner_status' | 'presence' | 'capabilities'>,
  actorPermissions: Set<string>,
  input?: {
    connectionOnline?: boolean;
    testTaskDispatchSupported?: boolean;
  },
): Record<AgentRunnerItemActionOperation, AgentRunnerActionAffordance> {
  const readOnly = isManagedAgentRunner(agent);
  const canRead = canReadAgentRunners(actorPermissions);
  const canManage = canManageAgentRunners(actorPermissions);
  const canUseTasks = actorPermissions.has(AGENT_TASK_USE_PERMISSION);
  const ready = resolveAgentRunnerStatusForApi(agent) === 'ready';
  const developerRunner = isDeveloperAgentRunner(agent);
  const systemManagedRunner = isManagedAgentRunner(agent);
  const connectionOnline = !developerRunner || input?.connectionOnline === true || agent.presence === 'online';
  const taskExecutionCapable = agent.capabilities?.task_execution !== false;
  const testTaskDispatchSupported = input?.testTaskDispatchSupported ?? RUNNER_TEST_TASK_DISPATCH_SUPPORTED;
  const developerTaskHomeBindingAvailable = !developerRunner || isDeveloperRunnerTaskHomeBindingAvailable();
  const systemReadOnlyReason = 'system_managed_read_only';
  const actionUnavailableReason = 'action_not_available';
  const selectRequiredPermissions = developerRunner
    ? [AGENT_TASK_USE_PERMISSION, AGENT_RUNNER_MANAGE_PERMISSION]
    : agent.is_default === true
      ? [AGENT_TASK_USE_PERMISSION]
      : [AGENT_TASK_USE_PERMISSION, AGENT_RUNNER_READ_PERMISSION];
  const selectAllowed = ready
    && developerTaskHomeBindingAvailable
    && canUseTasks
    && (
      developerRunner
        ? canManage
        : agent.is_default === true || canRead
    );

  return {
    set_project_default: buildActionAffordance('set_project_default', {
      visible: systemManagedRunner,
      allowed: false,
      reason_code: systemManagedRunner ? actionUnavailableReason : 'developer_runner_not_default_eligible',
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'none',
    }),
    bind_to_task: buildActionAffordance('bind_to_task', {
      visible: true,
      allowed: selectAllowed,
      reason_code: selectAllowed ? undefined : (
        ready
          && developerRunner
          && !developerTaskHomeBindingAvailable
          && canUseTasks
          && canManage
          ? DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE
          : ready ? 'permission_denied' : 'agent_runner_unavailable'
      ),
      required_permissions: selectRequiredPermissions,
      danger_level: 'none',
    }),
    run_test_task: buildActionAffordance('run_test_task', {
      visible: developerRunner,
      allowed: developerRunner
        && canManage
        && canUseTasks
        && ready
        && connectionOnline
        && taskExecutionCapable
        && testTaskDispatchSupported,
      reason_code: developerRunner
        ? resolveDeveloperActionUnavailableReason({
            canUseAction: canManage && canUseTasks,
            connectionOnline,
            ready,
            taskExecutionCapable,
            dispatchSupported: testTaskDispatchSupported,
          })
        : systemReadOnlyReason,
      required_permissions: [AGENT_TASK_USE_PERMISSION, AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'none',
    }),
    edit: buildActionAffordance('edit', {
      visible: developerRunner,
      allowed: !readOnly && canManage,
      reason_code: readOnly ? systemReadOnlyReason : permissionDeniedReason(canManage),
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'none',
    }),
    disable: buildActionAffordance('disable', {
      visible: developerRunner,
      allowed: false,
      reason_code: developerRunner ? actionUnavailableReason : systemReadOnlyReason,
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'medium',
    }),
    delete: buildActionAffordance('delete', {
      visible: developerRunner,
      allowed: !readOnly && canManage,
      reason_code: readOnly ? systemReadOnlyReason : permissionDeniedReason(canManage),
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'high',
    }),
    issue_connection_key: buildActionAffordance('issue_connection_key', {
      visible: developerRunner,
      allowed: !readOnly && canManage,
      reason_code: readOnly ? systemReadOnlyReason : permissionDeniedReason(canManage),
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'none',
    }),
    revoke_connection_key: buildActionAffordance('revoke_connection_key', {
      visible: developerRunner,
      allowed: !readOnly && canManage,
      reason_code: readOnly ? systemReadOnlyReason : permissionDeniedReason(canManage),
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'medium',
    }),
    test_connection: buildActionAffordance('test_connection', {
      visible: developerRunner,
      allowed: developerRunner && canManage,
      reason_code: developerRunner
        ? permissionDeniedReason(canManage)
        : systemReadOnlyReason,
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'none',
    }),
    view_diagnostics: buildActionAffordance('view_diagnostics', {
      visible: true,
      allowed: canRead,
      reason_code: permissionDeniedReason(canRead),
      required_permissions: [AGENT_RUNNER_READ_PERMISSION],
      danger_level: 'none',
    }),
  };
}

function buildAgentRunnerCollectionActionAffordances(
  actorPermissions: Set<string>,
): Record<AgentRunnerCollectionActionOperation, AgentRunnerActionAffordance> {
  const canManage = canManageAgentRunners(actorPermissions);

  return {
    create_developer_runner: buildActionAffordance('create_developer_runner', {
      visible: true,
      allowed: canManage,
      reason_code: permissionDeniedReason(canManage),
      required_permissions: [AGENT_RUNNER_MANAGE_PERMISSION],
      danger_level: 'none',
    }),
  };
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

function toPublicAgentRunner<T extends AgentRecord>(
  deps: NodeApiDeps,
  agent: T,
  actorPermissions: Set<string>,
) {
  const status = resolveAgentRunnerStatusForApi(agent);
  const diagnostics = agent.diagnostics ?? {};
  const socketOnline = deps.agentExecutionService.getAgentOnlineState(agent.id);
  const presence = resolveAgentPresenceForApi({
    managed: isManagedAgentRunner(agent),
    storedPresence: agent.presence,
    socketOnline,
  });
  return {
    id: agent.id,
    project_id: agent.project_id,
    name: agent.name,
    ...(agent.description ? { description: agent.description } : {}),
    kind: resolveAgentRunnerKind(agent),
    source: resolveAgentRunnerSource(agent),
    read_only: isManagedAgentRunner(agent),
    is_default: agent.is_default === true,
    status,
    ...(readDefaultEndpointId(agent) ? { default_endpoint_id: readDefaultEndpointId(agent) } : {}),
    capabilities: agent.capabilities ?? {},
    diagnostics: {
      ...diagnostics,
      presence,
    },
    actions: buildAgentRunnerActionAffordances(agent, actorPermissions, {
      connectionOnline: presence === 'online',
      testTaskDispatchSupported: RUNNER_TEST_TASK_DISPATCH_SUPPORTED,
    }),
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

function readBodyObject(input: unknown): Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

type TimeoutReadResult =
  | { ok: true; timeoutMs: number }
  | { ok: false; message: 'agent_test_timeout_invalid' };

function readAgentTestTimeoutMs(raw: Record<string, unknown>): TimeoutReadResult {
  if (!Object.prototype.hasOwnProperty.call(raw, 'timeout_ms')) {
    return { ok: true, timeoutMs: AGENT_TEST_CONNECTION_DEFAULT_TIMEOUT_MS };
  }
  const value = raw.timeout_ms;
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < AGENT_TEST_CONNECTION_MIN_TIMEOUT_MS
    || value > AGENT_TEST_CONNECTION_MAX_TIMEOUT_MS
  ) {
    return { ok: false, message: 'agent_test_timeout_invalid' };
  }
  return { ok: true, timeoutMs: value };
}

function buildRunnerTestTaskUnavailableBody(input: {
  runnerId: string;
  errorCode: string;
  message?: string;
}) {
  return {
    error_code: input.errorCode,
    message: input.message ?? input.errorCode,
    runner_test: true,
    status: 'not_started',
    resolved_runner_id: input.runnerId,
  };
}

function readRequestId(req: http.IncomingMessage): string | null {
  return typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null;
}

function buildTestConnectionAuditMetadata(result: {
  timeout_ms: number;
  status: string;
  freshness: {
    state: string;
    active_connection_count: number;
  };
  errors: Array<{ code: string }>;
}): Record<string, unknown> {
  return {
    timeout_ms: result.timeout_ms,
    status: result.status,
    freshness_state: result.freshness.state,
    active_connection_count: result.freshness.active_connection_count,
    error_codes: result.errors.map((error) => error.code),
  };
}

function readAgentTestConnectionUnsupportedFields(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((field) => !AGENT_TEST_CONNECTION_ALLOWED_FIELDS.has(field));
}

function readAgentRunnerTestTaskUnsupportedFields(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((field) => !AGENT_RUNNER_TEST_TASK_ALLOWED_FIELDS.has(field));
}

function readOptionalRunnerTestIntent(raw: Record<string, unknown>): string | undefined {
  return typeof raw.intent === 'string' ? raw.intent : undefined;
}

async function writeRunnerTestTaskAudit(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  action: 'agent_runner.test_task.requested' | 'agent_runner.test_task.accepted' | 'agent_runner.test_task.failed';
  runnerId: string;
  requestId?: string | null;
  result?: 'ok' | 'error';
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await writeProjectAuditEvent(input.deps, {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    actor: { type: 'user', id: input.actorUserId },
    action: input.action,
    result: input.result,
    requestId: input.requestId,
    resourceType: 'agent_runner',
    resourceId: input.runnerId,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    metadata: {
      runner_test: true,
      resolved_runner_id: input.runnerId,
      ...(input.metadata ?? {}),
    },
  });
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
      items: items.map((item) => toPublicAgentRunner(deps, item, actorPermissions)),
      total: items.length,
      page: 1,
      page_size: items.length,
      has_more: false,
      actions: buildAgentRunnerCollectionActionAffordances(actorPermissions),
    });
    return true;
  }

  if (route.kind === 'agents' && method === 'POST') {
    const raw = (await readBody(req)) as Record<string, unknown>;
    const unsupportedFields = readUnsupportedAgentRunnerFields(raw, CREATE_AGENT_RUNNER_ALLOWED_FIELDS);
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
    const created = await deps.agentResourceService.createAgent(route.workspaceId, route.projectId, {
      name,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      runner_provider: 'developer',
      status: 'enabled',
      presence: 'offline',
      runner_status: 'draft',
      is_default: false,
      owner_id: user.id,
      admin_id: user.id,
      visibility: 'private',
    });
    const actorPermissions = new Set<string>([
      AGENT_RUNNER_READ_PERMISSION,
      AGENT_RUNNER_MANAGE_PERMISSION,
    ]);
    json(res, 201, toPublicAgentRunner(deps, created, actorPermissions));
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
    json(res, 200, toPublicAgentRunner(deps, item, actorPermissions));
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
    if (isManagedAgentRunner(existing)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
      return true;
    }
    const unsupportedFields = readUnsupportedAgentRunnerFields(raw, UPDATE_AGENT_RUNNER_ALLOWED_FIELDS);
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
    });
    if (!updated) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    json(res, 200, toPublicAgentRunner(deps, updated, actorPermissions));
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
    if (isManagedAgentRunner(existing)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
      return true;
    }
    const deleted = await deps.agentResourceService.deleteAgent(route.workspaceId, route.projectId, route.agentId);
    if (!deleted) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    res.statusCode = 204;
    res.end();
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
    if (isManagedAgentRunner(item)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
      return true;
    }
    json(res, 200, deps.agentResourceService.buildConnectionInfo(item));
    return true;
  }

  if (route.kind === 'agentTestConnection' && method === 'POST') {
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
    if (isManagedAgentRunner(item)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
      return true;
    }
    const raw = readBodyObject(await readBody(req));
    const unsupportedFields = readAgentTestConnectionUnsupportedFields(raw);
    if (unsupportedFields.length > 0) {
      json(res, 400, {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      });
      return true;
    }
    const timeout = readAgentTestTimeoutMs(raw);
    if (!timeout.ok) {
      json(res, 422, {
        error_code: 'VALIDATION_ERROR',
        message: timeout.message,
        field: 'timeout_ms',
      });
      return true;
    }
    const result = await deps.agentResourceService.testAgentConnection(
      route.workspaceId,
      route.projectId,
      route.agentId,
      { timeoutMs: timeout.timeoutMs },
    );
    if (!result) {
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (result.status === 'stale' && deps.agentExecutionService.getAgentOnlineState(route.agentId)) {
      deps.agentExecutionService.disconnectAgentRunner(route.agentId, 'agent_key_expired');
    }
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'agent_runner.test_connection.checked',
      resourceType: 'agent_runner',
      resourceId: route.agentId,
      requestId: readRequestId(req),
      metadata: buildTestConnectionAuditMetadata(result),
    });
    json(res, 200, result);
    return true;
  }

  if (route.kind === 'agentTestTaskRuns' && method === 'POST') {
    const raw = readBodyObject(await readBody(req));
    const unsupportedFields = readAgentRunnerTestTaskUnsupportedFields(raw);
    const requestId = readRequestId(req);
    const actorPermissions = await resolveActorPermissions(deps, route.workspaceId, route.projectId, user.id);
    const missingPermissions = [
      AGENT_TASK_USE_PERMISSION,
      AGENT_RUNNER_MANAGE_PERMISSION,
    ].filter((permission) => !actorPermissions.has(permission));
    if (missingPermissions.length > 0) {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: route.agentId,
        requestId,
        result: 'error',
        errorCode: 'FORBIDDEN',
        errorMessage: 'agent_test_task_forbidden',
        metadata: {
          failure_code: 'permission_denied',
          missing_permissions: missingPermissions,
        },
      });
      json(res, 403, {
        error_code: 'FORBIDDEN',
        message: 'agent_test_task_forbidden',
        missing_permissions: missingPermissions,
      });
      return true;
    }
    await writeRunnerTestTaskAudit({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorUserId: user.id,
      action: 'agent_runner.test_task.requested',
      runnerId: route.agentId,
      requestId,
      metadata: {
        intent_present: typeof raw.intent === 'string' && raw.intent.trim().length > 0,
        ...(unsupportedFields.length > 0 ? { unsupported_fields: unsupportedFields } : {}),
      },
    });
    if (unsupportedFields.length > 0) {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: route.agentId,
        requestId,
        result: 'error',
        errorCode: 'unsupported_field',
        errorMessage: 'unsupported_field',
        metadata: {
          failure_code: 'unsupported_field',
          fields: unsupportedFields,
          intent_present: Object.prototype.hasOwnProperty.call(raw, 'intent'),
        },
      });
      json(res, 400, {
        error_code: 'unsupported_field',
        message: 'unsupported_field',
        fields: unsupportedFields,
      });
      return true;
    }
    const item = await deps.agentResourceService.getAgent(route.workspaceId, route.projectId, route.agentId);
    if (!item) {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: route.agentId,
        requestId,
        result: 'error',
        errorCode: 'RESOURCE_NOT_FOUND',
        errorMessage: 'agent_not_found',
        metadata: { failure_code: 'agent_not_found' },
      });
      json(res, 404, { error_code: 'RESOURCE_NOT_FOUND', message: 'agent_not_found' });
      return true;
    }
    if (isManagedAgentRunner(item)) {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: item.id,
        requestId,
        result: 'error',
        errorCode: 'FORBIDDEN',
        errorMessage: 'agent_runner_read_only',
        metadata: { failure_code: 'system_managed_read_only' },
      });
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
      return true;
    }
    if (!RUNNER_TEST_TASK_DISPATCH_SUPPORTED) {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: item.id,
        requestId,
        result: 'error',
        errorCode: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
        errorMessage: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
        metadata: { failure_code: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE },
      });
      json(res, 409, buildRunnerTestTaskUnavailableBody({
        runnerId: item.id,
        errorCode: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_CODE,
        message: DEVELOPER_RUNNER_TASK_HOME_BINDING_UNAVAILABLE_MESSAGE,
      }));
      return true;
    }
    if (item.capabilities?.task_execution === false) {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: item.id,
        requestId,
        result: 'error',
        errorCode: 'agent_runner_capability_mismatch',
        errorMessage: 'agent_runner_capability_mismatch',
        metadata: { failure_code: 'agent_runner_capability_mismatch' },
      });
      json(res, 409, buildRunnerTestTaskUnavailableBody({
        runnerId: item.id,
        errorCode: 'agent_runner_capability_mismatch',
      }));
      return true;
    }
    if (resolveAgentRunnerStatusForApi(item) !== 'ready') {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: item.id,
        requestId,
        result: 'error',
        errorCode: 'agent_runner_test_task_unavailable',
        errorMessage: 'agent_runner_unavailable',
        metadata: { failure_code: 'agent_runner_unavailable' },
      });
      json(res, 409, buildRunnerTestTaskUnavailableBody({
        runnerId: item.id,
        errorCode: 'agent_runner_test_task_unavailable',
        message: 'agent_runner_unavailable',
      }));
      return true;
    }
    const connection = await deps.agentResourceService.testAgentConnection(
      route.workspaceId,
      route.projectId,
      route.agentId,
      { timeoutMs: AGENT_TEST_CONNECTION_DEFAULT_TIMEOUT_MS },
    );
    const connectionError = connection?.errors[0]?.code;
    if (!connection || connection.status !== 'connected') {
      const errorCode = connectionError === 'agent_runner_stale' ? 'agent_runner_stale' : 'agent_runner_disconnected';
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: item.id,
        requestId,
        result: 'error',
        errorCode,
        errorMessage: errorCode,
        metadata: { failure_code: errorCode },
      });
      json(res, 409, buildRunnerTestTaskUnavailableBody({
        runnerId: item.id,
        errorCode,
      }));
      return true;
    }
    const dispatchResult = await dispatchDeveloperRunnerTestTaskRun({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      user,
      runner: item,
      intent: readOptionalRunnerTestIntent(raw),
      requestId,
    });
    if (!dispatchResult.ok) {
      await writeRunnerTestTaskAudit({
        deps,
        workspaceId: route.workspaceId,
        projectId: route.projectId,
        actorUserId: user.id,
        action: 'agent_runner.test_task.failed',
        runnerId: item.id,
        requestId,
        result: 'error',
        errorCode: dispatchResult.errorCode,
        errorMessage: dispatchResult.message,
        metadata: { failure_code: dispatchResult.message },
      });
      json(res, 409, buildRunnerTestTaskUnavailableBody({
        runnerId: item.id,
        errorCode: dispatchResult.errorCode,
        message: dispatchResult.message,
      }));
      return true;
    }
    await writeRunnerTestTaskAudit({
      deps,
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actorUserId: user.id,
      action: 'agent_runner.test_task.accepted',
      runnerId: item.id,
      requestId,
      metadata: {
        task_id: dispatchResult.accepted.taskId,
        run_id: dispatchResult.accepted.runId,
        intent_present: typeof raw.intent === 'string' && raw.intent.trim().length > 0,
        bound_runner_id: item.id,
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
      },
    });
    json(res, 202, {
      runner_test: true,
      status: 'accepted',
      task_id: dispatchResult.accepted.taskId,
      run_id: dispatchResult.accepted.runId,
      resolved_runner_id: dispatchResult.accepted.resolvedRunnerId,
    });
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
    if (isManagedAgentRunner(item)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
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
    if (isManagedAgentRunner(item)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
      return true;
    }
    const created = await deps.agentResourceService.createAgentKey(route.workspaceId, route.projectId, route.agentId);
    if (created.revokedKeyIds.length > 0) {
      deps.agentExecutionService.disconnectAgentRunner(route.agentId, 'agent_key_rotated');
    }
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'agent_runner.key.issue',
      resourceType: 'agent_runner',
      resourceId: route.agentId,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
      metadata: {
        key_id: created.record.id,
        key_prefix: created.record.key_prefix,
        status: created.record.status,
        expires_at: created.record.expires_at,
      },
    });
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
    if (isManagedAgentRunner(item)) {
      json(res, 403, { error_code: 'FORBIDDEN', message: 'agent_runner_read_only' });
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
    deps.agentExecutionService.disconnectAgentRunner(route.agentId, 'agent_key_revoked');
    await writeProjectAuditEvent(deps, {
      workspaceId: route.workspaceId,
      projectId: route.projectId,
      actor: { type: 'user', id: user.id },
      action: 'agent_runner.key.revoke',
      resourceType: 'agent_runner',
      resourceId: route.agentId,
      requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'] : null,
      metadata: {
        key_id: route.keyId,
      },
    });
    res.statusCode = 204;
    res.end();
    return true;
  }

  return false;
}
