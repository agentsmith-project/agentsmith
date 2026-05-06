import {
  DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS,
  MongoJsonDocStore,
} from '../packages/adapters-private/src/json-doc-store';
import { AgentResourceService } from '../packages/api-entry-node/src/agent-resource-service';

export type DefaultManagedRunnerSeedResult = {
  runnerId: string;
  runnerName: string;
  status: string;
  isDefault: boolean;
  defaultEndpointId: string | null;
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
};

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
    if (projectedDefaultEndpointId !== endpointId) {
      throw new Error('managed_runner_default_endpoint_projection_missing');
    }

    const connectionInfo = service.buildConnectionInfo(refreshed);
    return {
      runnerId: refreshed.id,
      runnerName: refreshed.name,
      status: refreshed.runner_status?.trim() || 'ready',
      isDefault: refreshed.is_default === true,
      defaultEndpointId: projectedDefaultEndpointId,
      capabilities: refreshed.capabilities ?? {},
      diagnostics: refreshed.diagnostics ?? {},
      wsUrl: connectionInfo.ws_url,
    };
  } finally {
    await store.close();
  }
}
