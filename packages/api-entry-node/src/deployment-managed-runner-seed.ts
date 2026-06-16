import { fileURLToPath } from 'node:url';
import type { NodeApiDeps } from './node-api-deps.js';
import { createNodeApiDepsFromEnv } from './node-api-deps-factory.js';
import { AgentTaskModelSettingService } from './agent-task-model-setting-service.js';
import type { EndpointRecord, EndpointUpstreamProtocol } from './resource-models.js';

export interface DeploymentManagedRunnerSeedEndpointInput {
  name: string;
  baseUrl: string;
  upstreamProtocol?: EndpointUpstreamProtocol;
  model: string;
  credentialName: string;
  credentialValue?: string;
}

export interface DeploymentManagedRunnerSeedInput {
  deps: Pick<NodeApiDeps, 'docStore' | 'cache' | 'endpointResourceService' | 'agentResourceService'>;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  endpoint: DeploymentManagedRunnerSeedEndpointInput;
  runnerName?: string;
}

export type DeploymentManagedRunnerSeedResult =
  | {
    status: 'seeded';
    workspaceId: string;
    projectId: string;
    credentialId: string;
    endpointId: string;
    agentRunnerId: string;
    modelSettingRevision: string;
  }
  | {
    status: 'skipped';
    reason: 'operator_endpoint_config_missing' | 'operator_credential_missing';
    workspaceId: string;
    projectId: string;
  };

type SeedEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;
type ResolvedDeploymentManagedRunnerSeedEndpointInput = DeploymentManagedRunnerSeedEndpointInput & {
  upstreamProtocol: EndpointUpstreamProtocol;
};

const DEPLOYMENT_MANAGED_RUNNER_ENDPOINT_PROTOCOLS = new Set<EndpointUpstreamProtocol>([
  'openai_chat_completions',
  'openai_responses',
  'anthropic_messages',
]);

function trimmed(value: string | undefined): string {
  return value?.trim() ?? '';
}

function parseEndpointUpstreamProtocol(value: string): EndpointUpstreamProtocol | undefined {
  return DEPLOYMENT_MANAGED_RUNNER_ENDPOINT_PROTOCOLS.has(value as EndpointUpstreamProtocol)
    ? value as EndpointUpstreamProtocol
    : undefined;
}

function normalizeEndpointName(value: string): string {
  return value.trim() || 'deployment-agent-task';
}

function normalizeCredentialName(value: string): string {
  return value.trim() || 'deployment-agent-task-key';
}

function endpointPayload(input: {
  endpoint: ResolvedDeploymentManagedRunnerSeedEndpointInput;
  credentialId: string;
}): Partial<EndpointRecord> {
  const model = input.endpoint.model.trim();
  return {
    name: normalizeEndpointName(input.endpoint.name),
    model,
    type: 'custom',
    base_url: input.endpoint.baseUrl.trim(),
    credential_ref: input.credentialId,
    status: 'active',
    upstream_protocol: input.endpoint.upstreamProtocol,
    capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: model }],
    models: [{ capability: 'chat_completion', model_id: model, display_name: model }],
    defaults: { chat_model_id: model },
  };
}

async function upsertOperatorCredential(input: {
  deps: Pick<NodeApiDeps, 'endpointResourceService'>;
  workspaceId: string;
  projectId: string;
  name: string;
  value: string;
}): Promise<string> {
  const credentialName = normalizeCredentialName(input.name);
  const existing = (await input.deps.endpointResourceService.listCredentials(input.workspaceId, input.projectId))
    .find((credential) => credential.name === credentialName);

  if (existing) {
    await input.deps.endpointResourceService.rotateCredential(
      input.workspaceId,
      input.projectId,
      existing.id,
      input.value,
    );
    return existing.id;
  }

  const created = await input.deps.endpointResourceService.createCredential(input.workspaceId, input.projectId, {
    name: credentialName,
    value: input.value,
  });
  return created.id;
}

async function upsertOperatorEndpoint(input: {
  deps: Pick<NodeApiDeps, 'endpointResourceService'>;
  workspaceId: string;
  projectId: string;
  endpoint: ResolvedDeploymentManagedRunnerSeedEndpointInput;
  credentialId: string;
}): Promise<EndpointRecord> {
  const endpointName = normalizeEndpointName(input.endpoint.name);
  const existing = (await input.deps.endpointResourceService.listEndpoints(input.workspaceId, input.projectId))
    .find((endpoint) => endpoint.name === endpointName);
  const payload = endpointPayload({
    endpoint: {
      ...input.endpoint,
      name: endpointName,
    },
    credentialId: input.credentialId,
  });

  if (existing) {
    const updated = await input.deps.endpointResourceService.updateEndpoint(
      input.workspaceId,
      input.projectId,
      existing.id,
      payload,
    );
    if (!updated) {
      throw new Error('deployment_managed_runner_seed_endpoint_update_lost');
    }
    return updated;
  }

  return input.deps.endpointResourceService.createEndpoint(input.workspaceId, input.projectId, payload);
}

export async function seedDeploymentDefaultManagedRunner(
  input: DeploymentManagedRunnerSeedInput,
): Promise<DeploymentManagedRunnerSeedResult> {
  const workspaceId = input.workspaceId.trim();
  const projectId = input.projectId.trim();
  const actorUserId = input.actorUserId.trim() || 'system:deployment-bootstrap';
  const model = input.endpoint.model.trim();
  const baseUrl = input.endpoint.baseUrl.trim();
  const upstreamProtocol = input.endpoint.upstreamProtocol;
  const credentialValue = input.endpoint.credentialValue?.trim() ?? '';

  if (!workspaceId || !projectId || !model || !baseUrl || !upstreamProtocol) {
    return {
      status: 'skipped',
      reason: 'operator_endpoint_config_missing',
      workspaceId,
      projectId,
    };
  }
  if (!credentialValue) {
    return {
      status: 'skipped',
      reason: 'operator_credential_missing',
      workspaceId,
      projectId,
    };
  }

  const credentialId = await upsertOperatorCredential({
    deps: input.deps,
    workspaceId,
    projectId,
    name: input.endpoint.credentialName,
    value: credentialValue,
  });
  const endpoint = await upsertOperatorEndpoint({
    deps: input.deps,
    workspaceId,
    projectId,
    endpoint: {
      ...input.endpoint,
      upstreamProtocol,
    },
    credentialId,
  });
  const modelSettingService = new AgentTaskModelSettingService(input.deps);
  const currentSetting = await modelSettingService.getSetting(workspaceId, projectId);
  const modelSetting = await modelSettingService.patchSetting({
    workspaceId,
    projectId,
    endpointId: endpoint.id,
    expectedSettingRevision: currentSetting?.setting_revision ?? null,
    actorUserId,
  });
  const runner = await input.deps.agentResourceService.upsertDeploymentDefaultManagedAgentRunner(workspaceId, projectId, {
    name: input.runnerName?.trim() || 'Deployment default managed runner',
    endpointId: endpoint.id,
    default_endpoint_id: endpoint.id,
    is_default: true,
    status: 'enabled',
    runner_status: 'ready',
    owner_id: actorUserId,
    admin_id: actorUserId,
    diagnostics: {
      deployment_bootstrap_seed: true,
    },
    capabilities: {
      streaming_completion: true,
      multimodal_completion: false,
      terminal: true,
      artifacts: true,
      file_inputs: true,
      url_inputs: true,
      task_execution: true,
    },
  });

  return {
    status: 'seeded',
    workspaceId,
    projectId,
    credentialId,
    endpointId: endpoint.id,
    agentRunnerId: runner.id,
    modelSettingRevision: modelSetting.setting_revision,
  };
}

export function deploymentManagedRunnerSeedInputFromEnv(
  deps: DeploymentManagedRunnerSeedInput['deps'],
  env: SeedEnv = process.env,
): DeploymentManagedRunnerSeedInput {
  return {
    deps,
    workspaceId: trimmed(env.DEPLOYMENT_DEFAULT_WORKSPACE_ID) || trimmed(env.WORKSPACE_ID),
    projectId: trimmed(env.DEPLOYMENT_DEFAULT_PROJECT_ID) || trimmed(env.PROJECT_ID),
    actorUserId: trimmed(env.DEPLOYMENT_DEFAULT_ACTOR_USER_ID)
      || trimmed(env.PRESET_OWNER_USER_ID)
      || 'system:deployment-bootstrap',
    runnerName: trimmed(env.DEPLOYMENT_DEFAULT_RUNNER_NAME)
      || trimmed(env.PRESET_AGENT_RUNNER_NAME)
      || 'Deployment default managed runner',
    endpoint: {
      name: trimmed(env.DEPLOYMENT_DEFAULT_ENDPOINT_NAME)
        || trimmed(env.PRESET_ANTHROPIC_ENDPOINT_NAME)
        || 'deployment-agent-task',
      baseUrl: trimmed(env.DEPLOYMENT_DEFAULT_ENDPOINT_BASE_URL)
        || trimmed(env.PRESET_ANTHROPIC_ENDPOINT_BASE_URL),
      upstreamProtocol: parseEndpointUpstreamProtocol(
        trimmed(env.DEPLOYMENT_DEFAULT_ENDPOINT_PROTOCOL)
        || trimmed(env.PRESET_ANTHROPIC_ENDPOINT_PROTOCOL),
      ),
      model: trimmed(env.DEPLOYMENT_DEFAULT_ENDPOINT_MODEL)
        || trimmed(env.PRESET_ENDPOINT_MODEL),
      credentialName: trimmed(env.DEPLOYMENT_DEFAULT_CREDENTIAL_NAME)
        || trimmed(env.PRESET_CREDENTIAL_NAME)
        || 'deployment-agent-task-key',
      credentialValue: trimmed(env.DEPLOYMENT_DEFAULT_ENDPOINT_API_KEY)
        || trimmed(env.PRESET_ENDPOINT_API_KEY),
    },
  };
}

export async function runDeploymentManagedRunnerSeedCli(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { deps, lifecycle } = createNodeApiDepsFromEnv(env);
  try {
    const result = await seedDeploymentDefaultManagedRunner(
      deploymentManagedRunnerSeedInputFromEnv(deps, env),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[deployment-managed-runner-seed] failed: ${message}\n`);
    return 1;
  } finally {
    await lifecycle.shutdown();
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  void runDeploymentManagedRunnerSeedCli().then((code) => {
    process.exitCode = code;
  });
}
