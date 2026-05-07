import { randomUUID } from 'node:crypto';
import type { NodeApiDeps } from './node-api-deps.js';
import type { EndpointCapabilityType, EndpointRecord, EndpointUpstreamProtocol } from './resource-models.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';
import { isProjectResourceAccessAllowedForUser } from './project-resource-policy-store.js';
import { enforceEndpointGovernancePreflight } from './governance-endpoint-preflight.js';

const AGENT_TASK_MODEL_SETTINGS_COLLECTION = 'agent_task_model_settings';
const AGENT_TASK_MODEL_SUPPORTED_PROTOCOLS = new Set<EndpointUpstreamProtocol>([
  'openai_chat_completions',
  'openai_responses',
  'anthropic_messages',
]);
const AGENT_TASK_MODEL_CAPABILITIES = new Set<EndpointCapabilityType>([
  'chat_completion',
  'multimodal_completion',
]);

export type AgentTaskModelSettingRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  endpoint_id: string;
  default_model_id?: string;
  setting_revision: string;
  updated_at: string;
  updated_by_user_id: string;
  audit?: {
    previous_endpoint_id?: string | null;
    previous_setting_revision?: string | null;
  };
};

export type AgentTaskModelSnapshot = {
  endpoint_id: string;
  endpoint_display_name?: string;
  resolved_model: string;
  upstream_protocol?: EndpointUpstreamProtocol;
  setting_revision: string;
  policy_decision_id?: string;
  resolved_at: string;
};

export type AgentTaskModelResolvedTarget = {
  endpoint: EndpointRecord;
  resolvedModel: string;
  upstreamProtocol: EndpointUpstreamProtocol;
  setting: AgentTaskModelSettingRecord;
  snapshot: AgentTaskModelSnapshot;
};

export type AgentTaskModelReadinessState = 'ready' | 'not_configured' | 'blocked';

export type AgentTaskModelReadiness = {
  state: AgentTaskModelReadinessState;
  display_summary: string;
  reason_code?: AgentTaskModelResolutionErrorCode;
};

export type AgentTaskModelResolutionErrorCode =
  | 'agent_task_model_setting_missing'
  | 'agent_task_model_endpoint_not_found'
  | 'agent_task_model_endpoint_disabled'
  | 'agent_task_model_default_missing'
  | 'agent_task_model_capability_mismatch'
  | 'agent_task_model_protocol_unsupported'
  | 'agent_task_model_credential_missing'
  | 'agent_task_model_credential_unavailable'
  | 'agent_task_model_policy_denied'
  | 'agent_task_model_rate_limited'
  | 'agent_task_model_spending_limited';

export type AgentTaskModelUseAction = {
  operation: 'use_for_agent_tasks';
  visible: boolean;
  allowed: boolean;
  reason_code?: AgentTaskModelResolutionErrorCode;
  required_permissions: ['project:governance:update'];
  danger_level: 'none';
};

export class AgentTaskModelSettingConflictError extends Error {
  readonly code = 'agent_task_model_setting_conflict';

  constructor() {
    super('agent_task_model_setting_conflict');
  }
}

export class AgentTaskModelResolutionError extends Error {
  constructor(
    readonly code: AgentTaskModelResolutionErrorCode,
    readonly statusCode: 403 | 409 | 429 = 409,
  ) {
    super(code);
  }
}

function settingCollection(workspaceId: string): string {
  return resolveWorkspaceScopedCollection(AGENT_TASK_MODEL_SETTINGS_COLLECTION, workspaceId);
}

function settingId(projectId: string): string {
  return `project:${projectId}`;
}

function buildSettingRevision(): string {
  return `set_${randomUUID().replace(/-/g, '')}`;
}

function hasEnabledCapability(endpoint: EndpointRecord, capabilityType: EndpointCapabilityType): boolean {
  const capability = endpoint.capabilities?.find((item) => item.type === capabilityType);
  return capability?.enabled === true;
}

export function resolveEndpointDefaultAgentTaskModel(endpoint: EndpointRecord): string {
  const capabilityDefault = endpoint.capabilities
    ?.filter((item) => AGENT_TASK_MODEL_CAPABILITIES.has(item.type) && item.enabled === true)
    .map((item) => item.default_model_id?.trim() ?? '')
    .find((value) => value.length > 0);
  return (
    endpoint.defaults?.chat_model_id?.trim()
    || endpoint.defaults?.multimodal_model_id?.trim()
    || capabilityDefault
    || endpoint.models?.find((item) => item.capability === 'chat_completion')?.model_id?.trim()
    || endpoint.models?.find((item) => item.capability === 'multimodal_completion')?.model_id?.trim()
    || endpoint.model?.trim()
    || ''
  );
}

export function endpointSupportsAgentTaskModel(endpoint: EndpointRecord): boolean {
  if (!endpoint.capabilities || endpoint.capabilities.length === 0) {
    return Boolean(endpoint.model?.trim());
  }
  return hasEnabledCapability(endpoint, 'chat_completion') || hasEnabledCapability(endpoint, 'multimodal_completion');
}

function mapPreflightDenyReason(errorCode: string): AgentTaskModelResolutionErrorCode {
  if (errorCode === 'RESOURCE_POLICY_RATE_LIMITED') return 'agent_task_model_rate_limited';
  if (errorCode === 'RESOURCE_POLICY_SPENDING_LIMITED') return 'agent_task_model_spending_limited';
  return 'agent_task_model_policy_denied';
}

export class AgentTaskModelSettingService {
  constructor(private readonly deps: Pick<NodeApiDeps, 'docStore' | 'cache' | 'endpointResourceService'>) {}

  async getSetting(workspaceId: string, projectId: string): Promise<AgentTaskModelSettingRecord | null> {
    const record = await this.deps.docStore.get<AgentTaskModelSettingRecord>(
      settingCollection(workspaceId),
      settingId(projectId),
    );
    if (!record) return null;
    if (record.workspace_id !== workspaceId || record.project_id !== projectId) return null;
    return record;
  }

  async patchSetting(input: {
    workspaceId: string;
    projectId: string;
    endpointId: string;
    expectedSettingRevision: string | null;
    actorUserId: string;
  }): Promise<AgentTaskModelSettingRecord> {
    const current = await this.getSetting(input.workspaceId, input.projectId);
    const currentRevision = current?.setting_revision ?? null;
    if (currentRevision !== input.expectedSettingRevision) {
      throw new AgentTaskModelSettingConflictError();
    }
    const endpoint = await this.deps.endpointResourceService.getEndpoint(
      input.workspaceId,
      input.projectId,
      input.endpointId,
    );
    if (!endpoint) {
      throw new AgentTaskModelResolutionError('agent_task_model_endpoint_not_found');
    }
    const action = await this.computeUseForAgentTasksAction({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      endpoint,
      actorUserId: input.actorUserId,
      visible: true,
    });
    if (!action.allowed) {
      throw new AgentTaskModelResolutionError(action.reason_code ?? 'agent_task_model_default_missing');
    }
    const now = new Date().toISOString();
    const next: AgentTaskModelSettingRecord = {
      id: settingId(input.projectId),
      workspace_id: input.workspaceId,
      project_id: input.projectId,
      endpoint_id: endpoint.id,
      default_model_id: resolveEndpointDefaultAgentTaskModel(endpoint),
      setting_revision: buildSettingRevision(),
      updated_at: now,
      updated_by_user_id: input.actorUserId,
      audit: {
        previous_endpoint_id: current?.endpoint_id ?? null,
        previous_setting_revision: currentRevision,
      },
    };
    await this.deps.docStore.upsert(settingCollection(input.workspaceId), next.id, next);
    return next;
  }

  async computeUseForAgentTasksAction(input: {
    workspaceId: string;
    projectId: string;
    endpoint: EndpointRecord;
    actorUserId: string;
    visible: boolean;
  }): Promise<AgentTaskModelUseAction> {
    const denied = (reason: AgentTaskModelResolutionErrorCode): AgentTaskModelUseAction => ({
      operation: 'use_for_agent_tasks',
      visible: input.visible,
      allowed: false,
      reason_code: reason,
      required_permissions: ['project:governance:update'],
      danger_level: 'none',
    });

    if (input.endpoint.workspace_id !== input.workspaceId || input.endpoint.project_id !== input.projectId) {
      return denied('agent_task_model_endpoint_not_found');
    }
    if (input.endpoint.status !== 'active') {
      return denied('agent_task_model_endpoint_disabled');
    }
    if (!resolveEndpointDefaultAgentTaskModel(input.endpoint)) {
      return denied('agent_task_model_default_missing');
    }
    if (!endpointSupportsAgentTaskModel(input.endpoint)) {
      return denied('agent_task_model_capability_mismatch');
    }
    if (!AGENT_TASK_MODEL_SUPPORTED_PROTOCOLS.has(input.endpoint.upstream_protocol)) {
      return denied('agent_task_model_protocol_unsupported');
    }
    if (!input.endpoint.base_url?.trim() || !input.endpoint.credential_ref?.trim()) {
      return denied('agent_task_model_credential_missing');
    }
    const credentialSecretReader = this.deps.endpointResourceService.getCredentialSecret;
    if (typeof credentialSecretReader === 'function') {
      const credential = await credentialSecretReader.call(
        this.deps.endpointResourceService,
        input.workspaceId,
        input.projectId,
        input.endpoint.credential_ref,
      );
      if (!credential) {
        return denied('agent_task_model_credential_unavailable');
      }
    }
    const policy = await isProjectResourceAccessAllowedForUser({
      docStore: this.deps.docStore,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      resourceType: 'endpoint',
      resourceId: input.endpoint.id,
      userId: input.actorUserId,
    });
    if (!policy.allowed) {
      return denied('agent_task_model_policy_denied');
    }
    return {
      operation: 'use_for_agent_tasks',
      visible: input.visible,
      allowed: true,
      required_permissions: ['project:governance:update'],
      danger_level: 'none',
    };
  }

  async getReadiness(input: {
    workspaceId: string;
    projectId: string;
    actorUserId: string;
  }): Promise<AgentTaskModelReadiness> {
    const setting = await this.getSetting(input.workspaceId, input.projectId);
    if (!setting) {
      return {
        state: 'not_configured',
        display_summary: 'Agent task model is not configured.',
        reason_code: 'agent_task_model_setting_missing',
      };
    }
    const endpoint = await this.deps.endpointResourceService.getEndpoint(
      input.workspaceId,
      input.projectId,
      setting.endpoint_id,
    );
    if (!endpoint) {
      return {
        state: 'blocked',
        display_summary: 'Agent tasks are blocked by model setup.',
        reason_code: 'agent_task_model_endpoint_not_found',
      };
    }
    const action = await this.computeUseForAgentTasksAction({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      endpoint,
      actorUserId: input.actorUserId,
      visible: false,
    });
    if (!action.allowed) {
      return {
        state: 'blocked',
        display_summary: 'Agent tasks are blocked by model setup.',
        reason_code: action.reason_code,
      };
    }
    return {
      state: 'ready',
      display_summary: 'Agent tasks are ready to run.',
    };
  }
}

export async function resolveAgentTaskModelTarget(input: {
  deps: NodeApiDeps;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  requestId?: string | null;
  source: string;
  contextMetadata?: Record<string, unknown>;
}): Promise<AgentTaskModelResolvedTarget> {
  const service = new AgentTaskModelSettingService(input.deps);
  const setting = await service.getSetting(input.workspaceId, input.projectId);
  if (!setting) {
    throw new AgentTaskModelResolutionError('agent_task_model_setting_missing');
  }
  const endpoint = await input.deps.endpointResourceService.getEndpoint(
    input.workspaceId,
    input.projectId,
    setting.endpoint_id,
  );
  if (!endpoint) {
    throw new AgentTaskModelResolutionError('agent_task_model_endpoint_not_found');
  }
  const action = await service.computeUseForAgentTasksAction({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    endpoint,
    actorUserId: input.actorUserId,
    visible: false,
  });
  if (!action.allowed) {
    throw new AgentTaskModelResolutionError(action.reason_code ?? 'agent_task_model_default_missing');
  }
  const preflight = await enforceEndpointGovernancePreflight({
    deps: input.deps,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    endpoint,
    userId: input.actorUserId,
    requestId: input.requestId,
    source: input.source,
    contextMetadata: input.contextMetadata,
  });
  if (!preflight.allowed) {
    throw new AgentTaskModelResolutionError(
      mapPreflightDenyReason(preflight.responseBody.error_code),
      preflight.statusCode,
    );
  }
  const resolvedModel = resolveEndpointDefaultAgentTaskModel(endpoint);
  const snapshot: AgentTaskModelSnapshot = {
    endpoint_id: endpoint.id,
    ...(endpoint.name ? { endpoint_display_name: endpoint.name } : {}),
    resolved_model: resolvedModel,
    upstream_protocol: endpoint.upstream_protocol,
    setting_revision: setting.setting_revision,
    policy_decision_id: preflight.decisionId,
    resolved_at: new Date().toISOString(),
  };
  return {
    endpoint,
    resolvedModel,
    upstreamProtocol: endpoint.upstream_protocol,
    setting,
    snapshot,
  };
}
