import { afterEach, describe, expect, it, vi } from 'vitest';

const storeClose = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
const upsertManagedRunner = vi.hoisted(() => vi.fn());
const getAgent = vi.hoisted(() => vi.fn());
const buildConnectionInfo = vi.hoisted(() => vi.fn());
const getEndpoint = vi.hoisted(() => vi.fn());
const getSetting = vi.hoisted(() => vi.fn());
const patchSetting = vi.hoisted(() => vi.fn());
const resolveEndpointDefaultAgentTaskModel = vi.hoisted(() => vi.fn());

vi.mock('../packages/adapters-private/src/json-doc-store', () => ({
  DEFAULT_MONGO_JSON_DOC_STORE_POOL_OPTIONS: {},
  MongoJsonDocStore: vi.fn().mockImplementation(function MongoJsonDocStoreMock() {
    return {
      close: storeClose,
    };
  }),
}));

vi.mock('../packages/api-entry-node/src/agent-resource-service', () => ({
  AgentResourceService: vi.fn().mockImplementation(function AgentResourceServiceMock() {
    return {
      upsertDeploymentDefaultManagedAgentRunner: upsertManagedRunner,
      getAgent,
      buildConnectionInfo,
    };
  }),
}));

vi.mock('../packages/api-entry-node/src/endpoint-resource-service', () => ({
  EndpointResourceService: vi.fn().mockImplementation(function EndpointResourceServiceMock() {
    return {
      getEndpoint,
    };
  }),
}));

vi.mock('../packages/api-entry-node/src/agent-task-model-setting-service', () => ({
  AgentTaskModelSettingService: vi.fn().mockImplementation(function AgentTaskModelSettingServiceMock() {
    return {
      getSetting,
      patchSetting,
    };
  }),
  resolveEndpointDefaultAgentTaskModel,
}));

import { upsertDeploymentDefaultManagedRunner } from './agent-runner-seed-managed-runner-core';

describe('managed runner seed core', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('configures the project Agent task model setting without requiring runner default_endpoint_id projection', async () => {
    upsertManagedRunner.mockResolvedValue({ id: 'ag_managed_default_1' });
    getAgent.mockResolvedValue({
      id: 'ag_managed_default_1',
      name: 'Managed Runner',
      runner_status: 'ready',
      is_default: true,
      capabilities: {},
      diagnostics: {},
    });
    getEndpoint.mockResolvedValue({
      id: 'ep_required',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      model: 'seed-model',
    });
    resolveEndpointDefaultAgentTaskModel.mockReturnValue('seed-model');
    getSetting.mockResolvedValue(null);
    patchSetting.mockResolvedValue({
      endpoint_id: 'ep_required',
      default_model_id: 'seed-model',
      setting_revision: 'set_seed_1',
    });
    buildConnectionInfo.mockReturnValue({
      ws_url: 'ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_managed_default_1',
    });

    await expect(upsertDeploymentDefaultManagedRunner({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_required',
      runnerName: 'Managed Runner',
      mongoUrl: 'mongodb://localhost:17017/admin',
      mongoDbName: 'mbos',
    })).resolves.toMatchObject({
      runnerId: 'ag_managed_default_1',
      defaultEndpointId: null,
      agentTaskModelSetting: {
        endpointId: 'ep_required',
        defaultModelId: 'seed-model',
        settingRevision: 'set_seed_1',
        updated: true,
      },
    });

    expect(upsertManagedRunner).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      expect.objectContaining({
        endpointId: 'ep_required',
      }),
    );
    expect(patchSetting).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_required',
      expectedSettingRevision: null,
      actorUserId: 'system:agent-runner-seed',
    });
    expect(storeClose).toHaveBeenCalledTimes(1);
  });

  it('keeps an existing matching Agent task model setting idempotent', async () => {
    upsertManagedRunner.mockResolvedValue({ id: 'ag_managed_default_1' });
    getAgent.mockResolvedValue({
      id: 'ag_managed_default_1',
      name: 'Managed Runner',
      runner_status: 'ready',
      is_default: true,
      default_endpoint_id: 'ep_required',
      capabilities: {},
      diagnostics: {},
    });
    getEndpoint.mockResolvedValue({
      id: 'ep_required',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      model: 'seed-model',
    });
    resolveEndpointDefaultAgentTaskModel.mockReturnValue('seed-model');
    getSetting.mockResolvedValue({
      endpoint_id: 'ep_required',
      default_model_id: 'seed-model',
      setting_revision: 'set_existing',
    });
    buildConnectionInfo.mockReturnValue({
      ws_url: 'ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_managed_default_1',
    });

    await expect(upsertDeploymentDefaultManagedRunner({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_required',
      runnerName: 'Managed Runner',
      mongoUrl: 'mongodb://localhost:17017/admin',
      mongoDbName: 'mbos',
    })).resolves.toMatchObject({
      defaultEndpointId: 'ep_required',
      agentTaskModelSetting: {
        endpointId: 'ep_required',
        defaultModelId: 'seed-model',
        settingRevision: 'set_existing',
        updated: false,
      },
    });

    expect(patchSetting).not.toHaveBeenCalled();
    expect(storeClose).toHaveBeenCalledTimes(1);
  });

  it('passes internal sandbox lifecycle config into the managed runner seed', async () => {
    upsertManagedRunner.mockResolvedValue({ id: 'ag_managed_default_1' });
    getAgent.mockResolvedValue({
      id: 'ag_managed_default_1',
      name: 'Managed Runner',
      runner_status: 'ready',
      is_default: true,
      default_endpoint_id: 'ep_required',
      capabilities: {},
      diagnostics: {},
    });
    getEndpoint.mockResolvedValue({
      id: 'ep_required',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      model: 'seed-model',
    });
    resolveEndpointDefaultAgentTaskModel.mockReturnValue('seed-model');
    getSetting.mockResolvedValue({
      endpoint_id: 'ep_required',
      default_model_id: 'seed-model',
      setting_revision: 'set_existing',
    });
    buildConnectionInfo.mockReturnValue({
      ws_url: 'ws://127.0.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_managed_default_1',
    });

    await upsertDeploymentDefaultManagedRunner({
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      endpointId: 'ep_required',
      runnerName: 'Managed Runner',
      mongoUrl: 'mongodb://localhost:17017/admin',
      mongoDbName: 'mbos',
      image: 'internal-runner:test',
      idleTimeoutSec: 180,
      maxLifetimeSec: 3600,
    });

    expect(upsertManagedRunner).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      expect.objectContaining({
        config: {
          image: 'internal-runner:test',
          idle_timeout_sec: 180,
          max_lifetime_sec: 3600,
        },
      }),
    );
  });
});
