import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  upsertPersistedSystemWorkspace,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';
import { AgentResourceService } from './agent-resource-service.js';

describe('AgentResourceService', () => {
  beforeEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
    delete process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.AGENT_EXECUTION_WS_BASE_URL;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
  });

  it('creates external agent with expected defaults', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: '  External Echo  ',
      mode: 'external',
    });

    expect(created.name).toBe('External Echo');
    expect(created.mode).toBe('external');
    expect(created.presence).toBe('offline');
    expect(created.capabilities).toBeDefined();
    expect(created.capabilities?.streaming_completion).toBe(true);
    expect(created.capabilities?.multimodal_completion).toBe(false);
    expect(created.capabilities?.accepted_mime_types).toContain('image/png');
  });

  it('creates, verifies and revokes service key', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'key-test',
      mode: 'external',
    });

    const { record, key } = await service.createAgentKey('ws_default', 'proj_1', agent.id);
    const verified = await service.verifyAgentKey(agent.id, key);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(record.id);
    expect(verified?.last_used_at).toBeTruthy();

    const revoked = await service.revokeAgentKey('ws_default', 'proj_1', agent.id, record.id);
    expect(revoked).toBe(true);

    const verifyAfterRevoke = await service.verifyAgentKey(agent.id, key);
    expect(verifyAfterRevoke).toBeNull();
  });

  it('deletes related keys and clears connection state on deleteAgent', async () => {
    const cache = new InMemoryCache();
    const service = new AgentResourceService(new InMemoryJsonDocStore(), cache);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'delete-test',
      mode: 'external',
    });
    await service.createAgentKey('ws_default', 'proj_1', agent.id);
    await service.markAgentConnected(agent.id, { protocol_version: '1.0', remote_ip: '127.0.0.1' });

    const deleted = await service.deleteAgent('ws_default', 'proj_1', agent.id);
    expect(deleted).toBe(true);
    expect(await service.getAgent('ws_default', 'proj_1', agent.id)).toBeNull();
    expect(await service.listAgentKeys('ws_default', 'proj_1', agent.id)).toEqual([]);
    await expect(service.getConnectionInfo(agent.id)).resolves.toBeNull();
  });

  it('uses tenant-prefixed collections for agents and service keys', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
        substrate_label: 'primary',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
    });

    const docStore = new InMemoryJsonDocStore();
    const service = new AgentResourceService(docStore);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'tenant-agent',
      mode: 'external',
    });
    const { record } = await service.createAgentKey('ws_default', 'proj_1', agent.id);

    expect(await docStore.list('agents', {})).toHaveLength(0);
    expect(await docStore.list('agent_service_keys', {})).toHaveLength(0);
    expect(await docStore.list('ws_default_agents', {})).toHaveLength(1);
    expect(await docStore.list('ws_default_agent_service_keys', {})).toHaveLength(1);
    expect((await service.listAgents('ws_default', 'proj_1')).map((item) => item.id)).toContain(agent.id);
    expect((await service.listAgentKeys('ws_default', 'proj_1', agent.id)).map((item) => item.id)).toContain(record.id);
  });

  it('verifies agent keys from persisted workspace records', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
        substrate_label: 'primary',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
    });
    const docStore = new InMemoryJsonDocStore();
    const service = new AgentResourceService(docStore);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'tenant-agent-default-path',
      mode: 'external',
    });
    const { record, key } = await service.createAgentKey('ws_default', 'proj_1', agent.id);

    const verified = await service.verifyAgentKey(agent.id, key);
    expect(verified?.id).toBe(record.id);
    expect(verified?.workspace_id).toBe('ws_default');
  });

  it('uses persisted workspace records instead of filesystem registry mirrors when verifying agent keys', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_integration_mainline',
      name: 'Integration Mainline Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_integration_mainline',
        workspace_name: 'Integration Mainline Workspace',
        database_name: 'agentsmith_ws_integration_mainline',
        collection_prefix: 'ws_integration_mainline_',
        key_prefix: 'ws_integration_mainline:',
        substrate_label: 'primary',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
    });

    const docStore = new InMemoryJsonDocStore();
    const service = new AgentResourceService(docStore);
    const agent = await service.createAgent('ws_integration_mainline', 'proj_1', {
      name: 'repo-registry-agent',
      mode: 'external',
    });
    const { record, key } = await service.createAgentKey('ws_integration_mainline', 'proj_1', agent.id);

    const verified = await service.verifyAgentKey(agent.id, key);
    expect(verified?.id).toBe(record.id);
    expect(verified?.workspace_id).toBe('ws_integration_mainline');
  });

  it('hydrates external agent presence from shared cache', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const writer = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const agent = await writer.createAgent('ws_default', 'proj_1', {
      name: 'shared-presence-agent',
      mode: 'external',
    });

    await writer.markAgentConnected(agent.id, {
      protocol_version: '1.0',
      last_pong_at: '2026-03-18T00:00:00.000Z',
    });

    const loaded = await reader.getAgent('ws_default', 'proj_1', agent.id);
    expect(loaded).toEqual(
      expect.objectContaining({
        id: agent.id,
        presence: 'online',
        last_seen_at: '2026-03-18T00:00:00.000Z',
      }),
    );
  });

  it('builds external agent connection info from external execution base', () => {
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://10.88.0.1:20000';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_external_1',
      mode: 'external',
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://host.docker.internal:20000/api/v1/agent-execution/ws?agent_id=ag_external_1',
    );
  });

  it('builds internal agent connection info from internal execution base', () => {
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://10.88.0.1:20000';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_internal_1',
      mode: 'internal',
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://10.88.0.1:20000/api/v1/agent-execution/ws?agent_id=ag_internal_1',
    );
  });
});
