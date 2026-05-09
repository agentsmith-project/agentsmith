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

const DEFAULT_MONGO_DB_NAME = 'mbos';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }
  return value;
}

async function ensureProjectAgentTaskModelSetting(input: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  endpointId: string;
}): Promise<{
  endpointId: string;
  defaultModelId: string;
  settingRevision: string;
  updated: boolean;
}> {
  const endpointResourceService = new EndpointResourceService(input.docStore);
  const endpoint = await endpointResourceService.getEndpoint(
    input.workspaceId,
    input.projectId,
    input.endpointId,
  );
  if (!endpoint) {
    throw new Error('developer_runner_endpoint_not_found');
  }
  if (endpoint.workspace_id !== input.workspaceId || endpoint.project_id !== input.projectId) {
    throw new Error('developer_runner_endpoint_project_mismatch');
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
    actorUserId: 'system:agent-runner-seed',
  });
  return {
    endpointId: updated.endpoint_id,
    defaultModelId: updated.default_model_id ?? defaultModelId,
    settingRevision: updated.setting_revision,
    updated: true,
  };
}

async function main(): Promise<void> {
  const workspaceId = process.env.WORKSPACE_ID?.trim() || 'ws_default';
  const projectId = required('PROJECT_ID');
  const endpointId = required('ENDPOINT_ID');
  const runnerName = process.env.AGENT_RUNNER_NAME?.trim() || `codex-agent-task-runner-${Date.now()}`;
  const mongoUrl = required('MONGO_URL');
  const mongoDbName = process.env.MONGO_DB_NAME?.trim() || DEFAULT_MONGO_DB_NAME;

  const store = new MongoJsonDocStore({
    url: mongoUrl,
    dbName: mongoDbName,
    mongoClientOptions: DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
  });

  try {
    const service = new AgentResourceService(store);
    const existing = (await service.listAgents(workspaceId, projectId))
      .find((item) => item.runner_provider === 'developer' && item.name === runnerName);
    const runnerPatch = {
      name: runnerName,
      runner_provider: 'developer' as const,
      status: 'enabled' as const,
      presence: 'offline' as const,
      runner_status: 'ready' as const,
      is_default: false,
      default_endpoint_id: endpointId,
      owner_id: 'system:agent-runner-seed',
      admin_id: 'system:agent-runner-seed',
      visibility: 'public' as const,
      capabilities: {
        streaming_completion: true,
        multimodal_completion: false,
        terminal: true,
        artifacts: true,
        task_execution: true,
        file_inputs: true,
        url_inputs: true,
      },
      diagnostics: {
        local_manual_seed_mode: 'developer_runner',
      },
    };
    const runner = existing
      ? await service.updateAgent(workspaceId, projectId, existing.id, runnerPatch)
      : await service.createAgent(workspaceId, projectId, runnerPatch);
    if (!runner) {
      throw new Error('developer_runner_seed_failed');
    }
    const createdKey = await service.createAgentKey(workspaceId, projectId, runner.id);
    const connectionInfo = service.buildConnectionInfo(runner);
    const agentTaskModelSetting = await ensureProjectAgentTaskModelSetting({
      docStore: store,
      workspaceId,
      projectId,
      endpointId,
    });

    process.stdout.write(`${JSON.stringify({
      project_id: projectId,
      agent_runner_id: runner.id,
      runner_provider: 'developer',
      default_endpoint_id: endpointId,
      agent_key: createdKey.key,
      agent_task_model_setting: {
        endpoint_id: agentTaskModelSetting.endpointId,
        default_model_id: agentTaskModelSetting.defaultModelId,
        setting_revision: agentTaskModelSetting.settingRevision,
        updated: agentTaskModelSetting.updated,
      },
      ws_url: connectionInfo.ws_url,
    }, null, 2)}\n`);
  } finally {
    await store.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[seed-developer-runner] ${message}\n`);
  process.exit(1);
});
