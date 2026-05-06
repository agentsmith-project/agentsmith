import { afterEach, describe, expect, it, vi } from 'vitest';

const storeClose = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));
const upsertManagedRunner = vi.hoisted(() => vi.fn());
const getAgent = vi.hoisted(() => vi.fn());
const buildConnectionInfo = vi.hoisted(() => vi.fn());

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

import { upsertDeploymentDefaultManagedRunner } from './agent-runner-seed-managed-runner-core';

describe('managed runner seed core', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when service upsert does not project the endpoint into default_endpoint_id', async () => {
    upsertManagedRunner.mockResolvedValue({ id: 'ag_managed_default_1' });
    getAgent.mockResolvedValue({
      id: 'ag_managed_default_1',
      name: 'Managed Runner',
      runner_status: 'ready',
      is_default: true,
      capabilities: {},
      diagnostics: {},
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
    })).rejects.toThrow('managed_runner_default_endpoint_projection_missing');

    expect(upsertManagedRunner).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      expect.objectContaining({
        endpointId: 'ep_required',
      }),
    );
    expect(storeClose).toHaveBeenCalledTimes(1);
  });
});
