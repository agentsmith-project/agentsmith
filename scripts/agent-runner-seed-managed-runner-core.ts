import {
  DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
  MongoJsonDocStore,
} from '../packages/adapters-private/src/json-doc-store';
import { InMemoryCache } from '../packages/adapters-private/src/cache';
import type { JsonDocStorePort } from '@mbos/ports';
import { AgentResourceService } from '../packages/api-entry-node/src/agent-resource-service';
import { EndpointResourceService } from '../packages/api-entry-node/src/endpoint-resource-service';
import {
  AgentTaskModelSettingService,
  resolveEndpointDefaultAgentTaskModel,
} from '../packages/api-entry-node/src/agent-task-model-setting-service';

export type DefaultManagedRunnerAgentTaskModelSettingSeedResult = {
  endpointId: string;
  defaultModelId: string;
  settingRevision: string;
  updated: boolean;
};

export type DefaultManagedRunnerSeedResult = {
  runnerId: string;
  runnerName: string;
  status: string;
  isDefault: boolean;
  defaultEndpointId: string | null;
  agentTaskModelSetting: DefaultManagedRunnerAgentTaskModelSettingSeedResult;
  capabilities: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  wsUrl: string;
};

export type DefaultManagedRunnerSeedInput = {
  workspaceId: string;
  projectId: string;
  endpointId: string;
  runnerName: string;
  mongoUrl: string;
  mongoDbName: string;
  isDefault?: boolean;
  status?: 'enabled' | 'disabled';
  presence?: 'managed' | 'online' | 'offline';
  runnerStatus?: 'draft' | 'connected' | 'ready' | 'degraded' | 'offline';
  description?: string;
  capabilities?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  actorUserId?: string;
};

async function ensureProjectAgentTaskModelSetting(input: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  endpointId: string;
  actorUserId?: string;
}): Promise<DefaultManagedRunnerAgentTaskModelSettingSeedResult> {
  const endpointResourceService = new EndpointResourceService(input.docStore);
  const endpoint = await endpointResourceService.getEndpoint(
    input.workspaceId,
    input.projectId,
    input.endpointId,
  );
  if (!endpoint) {
    throw new Error('agent_task_model_setting_endpoint_not_found');
  }
  if (endpoint.workspace_id !== input.workspaceId || endpoint.project_id !== input.projectId) {
    throw new Error('agent_task_model_setting_endpoint_project_mismatch');
  }

  const defaultModelId = resolveEndpointDefaultAgentTaskModel(endpoint);
  const service = new AgentTaskModelSettingService({
    docStore: input.docStore,
    cache: new InMemoryCache(),
    endpointResourceService,
  });
  const current = await service.getSetting(input.workspaceId, input.projectId);
  if (
    current?.endpoint_id === endpoint.id
    && (current.default_model_id?.trim() || '') === defaultModelId
  ) {
    return {
      endpointId: current.endpoint_id,
      defaultModelId,
      settingRevision: current.setting_revision,
      updated: false,
    };
  }

  const updated = await service.patchSetting({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    endpointId: endpoint.id,
    expectedSettingRevision: current?.setting_revision ?? null,
    actorUserId: input.actorUserId?.trim() || 'system:agent-runner-seed',
  });
  return {
    endpointId: updated.endpoint_id,
    defaultModelId: updated.default_model_id ?? defaultModelId,
    settingRevision: updated.setting_revision,
    updated: true,
  };
}

export async function upsertDeploymentDefaultManagedRunner(
  input: DefaultManagedRunnerSeedInput,
): Promise<DefaultManagedRunnerSeedResult> {
  const endpointId = input.endpointId?.trim();
  if (!endpointId) {
    throw new Error('managed_runner_missing_endpoint_id');
  }
  const runnerName = input.runnerName?.trim() || `codex-agent-task-runner-${Date.now()}`;

  const store = new MongoJsonDocStore({
    url: input.mongoUrl,
    dbName: input.mongoDbName || 'mbos',
    mongoClientOptions: DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
  });

  try {
    const status = input.status === 'disabled' ? 'disabled' : 'enabled';
    const presence = input.presence === 'online' || input.presence === 'offline'
      ? input.presence
      : 'managed';
    const runnerStatus = input.runnerStatus === 'draft'
      || input.runnerStatus === 'connected'
      || input.runnerStatus === 'ready'
      || input.runnerStatus === 'degraded'
      || input.runnerStatus === 'offline'
      ? input.runnerStatus
      : 'ready';

    const service = new AgentResourceService(store);
    const runner = await service.upsertDeploymentDefaultManagedAgentRunner(
      input.workspaceId,
      input.projectId,
      {
        name: runnerName,
        endpointId,
        status,
        presence,
        runner_status: runnerStatus,
        is_default: input.isDefault === true,
        description: input.description?.trim() || 'Managed Agent task runner baseline',
        diagnostics: {
          presence: 'managed',
          ...(input.diagnostics ?? {}),
        },
        capabilities: {
          streaming_completion: true,
          multimodal_completion: false,
          terminal: true,
          artifacts: true,
          task_execution: true,
          file_inputs: true,
          url_inputs: true,
          ...(input.capabilities ?? {}),
        },
        visibility: 'public',
      },
    );

    const refreshed = await service.getAgent(input.workspaceId, input.projectId, runner.id);
    if (!refreshed) {
      throw new Error('managed_runner_seed_failed_after_upsert');
    }

    const projectedDefaultEndpointId = refreshed.default_endpoint_id?.trim() || '';
    const agentTaskModelSetting = await ensureProjectAgentTaskModelSetting({
      docStore: store,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      endpointId,
      actorUserId: input.actorUserId,
    });

    const connectionInfo = service.buildConnectionInfo(refreshed);
    return {
      runnerId: refreshed.id,
      runnerName: refreshed.name,
      status: refreshed.runner_status?.trim() || 'ready',
      isDefault: refreshed.is_default === true,
      defaultEndpointId: projectedDefaultEndpointId || null,
      agentTaskModelSetting,
      capabilities: refreshed.capabilities ?? {},
      diagnostics: refreshed.diagnostics ?? {},
      wsUrl: connectionInfo.ws_url,
    };
  } finally {
    await store.close();
  }
}
