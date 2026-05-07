import { describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import type { NodeApiDeps } from './node-api-deps.js';
import { EndpointResourceService } from './endpoint-resource-service.js';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import {
  AgentTaskModelSettingService,
  resolveAgentTaskModelTarget,
} from './agent-task-model-setting-service.js';

function buildDeps(docStore = new InMemoryJsonDocStore()): NodeApiDeps {
  const endpointResourceService = new EndpointResourceService(docStore);
  return {
    cache: new InMemoryCache(),
    docStore,
    endpointResourceService,
  } as unknown as NodeApiDeps;
}

async function createReadyEndpoint(deps: NodeApiDeps, projectId = 'proj_1') {
  const credential = await deps.endpointResourceService.createCredential('ws_default', projectId, {
    name: 'agent-task-key',
    value: 'sk-agent-task',
  });
  return deps.endpointResourceService.createEndpoint('ws_default', projectId, {
    name: 'Agent task endpoint',
    model: 'gpt-5.5',
    type: 'custom',
    base_url: 'https://provider.example/v1/chat/completions',
    credential_ref: credential.id,
    status: 'active',
    upstream_protocol: 'openai_chat_completions',
    capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'gpt-5.5' }],
    models: [{ capability: 'chat_completion', model_id: 'gpt-5.5', display_name: 'GPT 5.5' }],
    defaults: { chat_model_id: 'gpt-5.5' },
  });
}

describe('AgentTaskModelSettingService', () => {
  it('patches the project Agent task model setting with revision conflict protection', async () => {
    const deps = buildDeps();
    const endpoint = await createReadyEndpoint(deps);
    const service = new AgentTaskModelSettingService(deps);

    const created = await service.patchSetting({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: endpoint.id,
      expectedSettingRevision: null,
      actorUserId: 'admin_1',
    });

    expect(created.endpoint_id).toBe(endpoint.id);
    expect(created.setting_revision).toMatch(/^set_/);
    expect(created.updated_by_user_id).toBe('admin_1');

    await expect(service.patchSetting({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: endpoint.id,
      expectedSettingRevision: 'stale_revision',
      actorUserId: 'admin_1',
    })).rejects.toMatchObject({
      code: 'agent_task_model_setting_conflict',
    });
  });

  it('computes use_for_agent_tasks from endpoint readiness without adding an endpoint capability enum', async () => {
    const deps = buildDeps();
    const endpoint = await createReadyEndpoint(deps);
    const service = new AgentTaskModelSettingService(deps);

    await expect(service.computeUseForAgentTasksAction({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpoint,
      actorUserId: 'admin_1',
      visible: true,
    })).resolves.toMatchObject({
      operation: 'use_for_agent_tasks',
      visible: true,
      allowed: true,
      required_permissions: ['project:governance:update'],
    });

    await expect(service.computeUseForAgentTasksAction({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpoint: {
        ...endpoint,
        id: 'ep_embedding_only',
        capabilities: [{ type: 'embedding', enabled: true }],
        model: '',
        defaults: {},
        models: [],
      },
      actorUserId: 'admin_1',
      visible: true,
    })).resolves.toMatchObject({
      allowed: false,
      reason_code: 'agent_task_model_default_missing',
    });
  });
});

describe('resolveAgentTaskModelTarget', () => {
  it('resolves only from the project setting Endpoint default model and snapshots the resolved target', async () => {
    const deps = buildDeps();
    const endpoint = await createReadyEndpoint(deps);
    const service = new AgentTaskModelSettingService(deps);
    const setting = await service.patchSetting({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: endpoint.id,
      expectedSettingRevision: null,
      actorUserId: 'admin_1',
    });

    const target = await resolveAgentTaskModelTarget({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'user_1',
      source: 'agent_task_run',
      contextMetadata: { runner_default_endpoint_id: 'ep_must_not_win' },
    });

    expect(target.endpoint.id).toBe(endpoint.id);
    expect(target.snapshot).toMatchObject({
      endpoint_id: endpoint.id,
      endpoint_display_name: endpoint.name,
      resolved_model: 'gpt-5.5',
      upstream_protocol: 'openai_chat_completions',
      setting_revision: setting.setting_revision,
    });
    expect(target.snapshot.resolved_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('does not fall back to runner defaults, runner preferences, env defaults, or hard-coded models', async () => {
    const deps = buildDeps();
    await expect(resolveAgentTaskModelTarget({
      deps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'user_1',
      source: 'agent_task_run',
      contextMetadata: {
        runner_default_endpoint_id: 'ep_runner_default',
        execution_preferences_json: { notebook: { endpoint_id: 'ep_runner_pref', model: 'runner-model' } },
      },
    })).rejects.toMatchObject({
      code: 'agent_task_model_setting_missing',
    });
  });

  it('denies resolution when resource policy blocks the selected Endpoint', async () => {
    const deps = buildDeps();
    const endpoint = await createReadyEndpoint(deps);
    const service = new AgentTaskModelSettingService(deps);
    await service.patchSetting({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: endpoint.id,
      expectedSettingRevision: null,
      actorUserId: 'admin_1',
    });
    await upsertProjectResourcePolicy(deps.docStore, 'ws_default', 'proj_1', {
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      access_mode: 'allow_list',
      allowed_subjects: [],
    });
    const dispatch = vi.fn();
    await expect(resolveAgentTaskModelTarget({
      deps: {
        ...deps,
        agentExecutionService: { dispatchStreamingRequest: dispatch },
      } as unknown as NodeApiDeps,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      actorUserId: 'user_1',
      source: 'agent_task_run',
    })).rejects.toMatchObject({
      code: 'agent_task_model_policy_denied',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
