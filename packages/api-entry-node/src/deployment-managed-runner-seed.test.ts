import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { AgentResourceService } from './agent-resource-service.js';
import { AgentTaskModelSettingService } from './agent-task-model-setting-service.js';
import {
  DeploymentManagedRunnerSeedConfigError,
  deploymentManagedRunnerSeedInputFromEnv,
  seedDeploymentDefaultManagedRunner,
} from './deployment-managed-runner-seed.js';
import { EndpointResourceService } from './endpoint-resource-service.js';

const RUNNER_IMAGE = `kind-registry:5000/mbos/agentsmith-managed-runner@sha256:${'a'.repeat(64)}`;
const VALID_SEED_ENV = {
  DEPLOYMENT_DEFAULT_WORKSPACE_ID: 'ws_default',
  DEPLOYMENT_DEFAULT_PROJECT_ID: 'proj_1',
  DEPLOYMENT_DEFAULT_ENDPOINT_NAME: 'deployment-agent-task',
  DEPLOYMENT_DEFAULT_ENDPOINT_BASE_URL: 'https://provider.example/v1',
  DEPLOYMENT_DEFAULT_ENDPOINT_PROTOCOL: 'openai_chat_completions',
  DEPLOYMENT_DEFAULT_ENDPOINT_MODEL: 'gpt-5.5',
  DEPLOYMENT_DEFAULT_CREDENTIAL_NAME: 'deployment-agent-task-key',
  DEPLOYMENT_DEFAULT_ENDPOINT_API_KEY: 'sk-operator-provided',
};

function buildDeps(docStore = new InMemoryJsonDocStore()): NodeApiDeps {
  const endpointResourceService = new EndpointResourceService(docStore);
  return {
    cache: new InMemoryCache(),
    docStore,
    endpointResourceService,
    agentResourceService: new AgentResourceService(docStore),
  } as unknown as NodeApiDeps;
}

function expectInvalidProtocolEnv(
  env: Record<string, string | undefined>,
  expected: { envName: string; value: string },
): void {
  const deps = buildDeps();
  let thrown: unknown;
  try {
    deploymentManagedRunnerSeedInputFromEnv(deps, env);
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(DeploymentManagedRunnerSeedConfigError);
  expect(thrown).toMatchObject({
    code: 'operator_endpoint_protocol_invalid',
    ...expected,
  });
}

describe('seedDeploymentDefaultManagedRunner', () => {
  afterEach(() => {
    delete process.env.INTERNAL_AGENT_IMAGE;
    delete process.env.INTEGRATION_INTERNAL_AGENT_IMAGE;
    delete process.env.MANAGED_RUNNER_IMAGE;
  });

  it('upserts endpoint, model setting, and deployment default managed runner projection from operator input', async () => {
    process.env.INTERNAL_AGENT_IMAGE = RUNNER_IMAGE;
    const deps = buildDeps();

    const result = await seedDeploymentDefaultManagedRunner({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'admin_1',
      runnerName: 'Deployment default managed runner',
      endpoint: {
        name: 'deployment-agent-task',
        baseUrl: 'https://provider.example/v1/chat/completions',
        upstreamProtocol: 'openai_chat_completions',
        model: 'gpt-5.5',
        credentialName: 'deployment-agent-task-key',
        credentialValue: 'sk-operator-provided',
      },
    });

    expect(result).toMatchObject({
      status: 'seeded',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    expect(result.credentialId).toMatch(/^cred_/);
    expect(result.endpointId).toMatch(/^ep_/);
    expect(result.agentRunnerId).toMatch(/^ag_managed_default_/);
    expect(result.modelSettingRevision).toMatch(/^set_/);

    await expect(
      deps.endpointResourceService.getCredentialSecret('ws_default', 'proj_1', result.credentialId ?? ''),
    ).resolves.toBe('sk-operator-provided');

    const endpoint = await deps.endpointResourceService.getEndpoint('ws_default', 'proj_1', result.endpointId ?? '');
    expect(endpoint).toMatchObject({
      name: 'deployment-agent-task',
      model: 'gpt-5.5',
      base_url: 'https://provider.example/v1',
      status: 'active',
      credential_ref: result.credentialId,
      upstream_protocol: 'openai_chat_completions',
      capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'gpt-5.5' }],
      defaults: { chat_model_id: 'gpt-5.5' },
    });

    const modelSettingService = new AgentTaskModelSettingService(deps);
    await expect(modelSettingService.getReadiness({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'admin_1',
    })).resolves.toMatchObject({ state: 'ready' });
    await expect(modelSettingService.getSetting('ws_default', 'proj_1')).resolves.toMatchObject({
      endpoint_id: result.endpointId,
    });

    const runner = await deps.agentResourceService.getDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1');
    expect(runner).toMatchObject({
      id: result.agentRunnerId,
      name: 'Deployment default managed runner',
      runner_provider: 'managed',
      is_default: true,
      default_endpoint_id: result.endpointId,
      runner_status: 'ready',
      config: {
        image: RUNNER_IMAGE,
      },
      diagnostics: {
        managed_runner_projection: 'deployment_default',
        deployment_bootstrap_seed: true,
      },
    });
  });

  it('skips without persisting a projection when the operator credential is absent', async () => {
    process.env.INTERNAL_AGENT_IMAGE = RUNNER_IMAGE;
    const deps = buildDeps();

    const result = await seedDeploymentDefaultManagedRunner({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'admin_1',
      endpoint: {
        name: 'deployment-agent-task',
        baseUrl: 'https://provider.example/v1',
        upstreamProtocol: 'openai_chat_completions',
        model: 'gpt-5.5',
        credentialName: 'deployment-agent-task-key',
        credentialValue: '',
      },
    });

    expect(result).toEqual({
      status: 'skipped',
      reason: 'operator_credential_missing',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    await expect(
      deps.agentResourceService.getDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1'),
    ).resolves.toBeNull();
    await expect(
      new AgentTaskModelSettingService(deps).getSetting('ws_default', 'proj_1'),
    ).resolves.toBeNull();
  });

  it('skips env seeding without silently defaulting a missing upstream protocol', async () => {
    process.env.INTERNAL_AGENT_IMAGE = RUNNER_IMAGE;
    const deps = buildDeps();

    const result = await seedDeploymentDefaultManagedRunner(deploymentManagedRunnerSeedInputFromEnv(deps, {
      ...VALID_SEED_ENV,
      DEPLOYMENT_DEFAULT_ENDPOINT_PROTOCOL: undefined,
    }));

    expect(result).toEqual({
      status: 'skipped',
      reason: 'operator_endpoint_config_missing',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    await expect(deps.endpointResourceService.listEndpoints('ws_default', 'proj_1')).resolves.toEqual([]);
    await expect(
      deps.agentResourceService.getDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1'),
    ).resolves.toBeNull();
  });

  it('seeds env input when the upstream protocol is explicitly valid', async () => {
    process.env.INTERNAL_AGENT_IMAGE = RUNNER_IMAGE;
    const deps = buildDeps();

    const result = await seedDeploymentDefaultManagedRunner(deploymentManagedRunnerSeedInputFromEnv(deps, {
      ...VALID_SEED_ENV,
    }));

    expect(result).toMatchObject({
      status: 'seeded',
      workspaceId: 'ws_default',
      projectId: 'proj_1',
    });
    const endpoint = await deps.endpointResourceService.getEndpoint('ws_default', 'proj_1', result.endpointId ?? '');
    expect(endpoint?.upstream_protocol).toBe('openai_chat_completions');
  });

  it('throws a typed failure for an invalid deployment default endpoint protocol', () => {
    expectInvalidProtocolEnv({
      ...VALID_SEED_ENV,
      DEPLOYMENT_DEFAULT_ENDPOINT_PROTOCOL: 'openai_chat',
    }, {
      envName: 'DEPLOYMENT_DEFAULT_ENDPOINT_PROTOCOL',
      value: 'openai_chat',
    });
  });

  it('throws a typed failure for an invalid preset anthropic endpoint protocol', () => {
    expectInvalidProtocolEnv({
      ...VALID_SEED_ENV,
      DEPLOYMENT_DEFAULT_ENDPOINT_PROTOCOL: undefined,
      PRESET_ANTHROPIC_ENDPOINT_PROTOCOL: 'anthropic',
    }, {
      envName: 'PRESET_ANTHROPIC_ENDPOINT_PROTOCOL',
      value: 'anthropic',
    });
  });
});
