import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  upsertPersistedSystemWorkspace,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';
import { AgentResourceService } from './agent-resource-service.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

describe('AgentResourceService', () => {
  beforeEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
    delete process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL;
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.AGENT_EXECUTION_WS_BASE_URL;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
  });

  it('creates external agent with expected defaults', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: '  External Echo  ',
      mode: 'external',
      interaction_kind: 'chat',
    });

    expect(created.name).toBe('External Echo');
    expect(created.mode).toBe('external');
    expect(created.interaction_kind).toBe('chat');
    expect(created.presence).toBe('offline');
    expect(created.capabilities).toBeDefined();
    expect(created.capabilities?.streaming_completion).toBe(true);
    expect(created.capabilities?.multimodal_completion).toBe(false);
    expect(created.capabilities?.accepted_mime_types).toContain('image/png');
  });

  it('does not invent an interaction kind when callers omit it', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: 'No Default Interaction Kind',
      mode: 'external',
    });

    expect(created.interaction_kind).toBeUndefined();
  });

  it('strips legacy interaction_mode from API reads without inventing an interaction kind', async () => {
    const docStore = new InMemoryJsonDocStore();
    const service = new AgentResourceService(docStore);
    await docStore.upsert(resolveWorkspaceScopedCollection('agents', 'ws_default'), 'ag_legacy_chat', {
      id: 'ag_legacy_chat',
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      name: 'legacy-chat-agent',
      mode: 'external',
      interaction_mode: 'chat',
      execution_preferences_json: {
        chat: {
          endpoint_id: 'ep_legacy_chat',
        },
      },
      status: 'enabled',
      created_at: '2026-04-09T00:00:00.000Z',
      updated_at: '2026-04-09T00:00:00.000Z',
    });

    const loaded = await service.getAgent('ws_default', 'proj_1', 'ag_legacy_chat');
    expect(loaded?.interaction_kind).toBeUndefined();
    expect(loaded).not.toHaveProperty('interaction_mode');

    const stored = await docStore.get<Record<string, unknown>>(
      resolveWorkspaceScopedCollection('agents', 'ws_default'),
      'ag_legacy_chat',
    );
    expect(stored?.interaction_kind).toBeUndefined();
    expect(stored?.interaction_mode).toBe('chat');
  });

  it('builds compose-internal connection info for compose-managed external agents', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://api:20000';
    process.env.EXTERNAL_AGENT_EXECUTION_HTTP_BASE_URL = 'http://host.docker.internal:20000';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_external_compose',
      mode: 'external',
      config: {
        runner_runtime: 'compose_managed',
      },
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://api:20000/api/v1/agent-execution/ws?agent_id=ag_external_compose',
    );
  });

  it('preserves existing agent fields when partial updates omit them', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: 'compose external',
      mode: 'external',
      interaction_kind: 'notebook',
      status: 'enabled',
      visibility: 'private',
      config: {
        endpoint_id: 'ep_1',
      },
    });

    const updated = await service.updateAgent('ws_default', 'proj_1', created.id, {
      config: {
        ...created.config,
        runner_runtime: 'compose_managed',
      },
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: created.id,
        mode: 'external',
        interaction_kind: 'notebook',
        status: 'enabled',
        visibility: 'private',
        config: expect.objectContaining({
          endpoint_id: 'ep_1',
          runner_runtime: 'compose_managed',
        }),
      }),
    );
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

  it('keeps a newer connection online when an older connection releases late', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const writer = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const agent = await writer.createAgent('ws_default', 'proj_1', {
      name: 'lease-reconnect-agent',
      mode: 'external',
    });

    await writer.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_old',
      socketKey: agent.id,
      apiInstanceId: 'api_a',
      protocolVersion: '1.0',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });
    await writer.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_new',
      socketKey: agent.id,
      apiInstanceId: 'api_b',
      protocolVersion: '1.0',
      lastPongAt: '2026-03-18T00:00:10.000Z',
    });

    await expect(writer.releaseAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_old',
    })).resolves.toEqual(expect.objectContaining({
      released: false,
      stale: true,
      active_connection_count: 1,
      presence: 'online',
    }));

    await expect(reader.getConnectionInfo(agent.id)).resolves.toEqual(expect.objectContaining({
      connection_id: 'conn_new',
      socket_key: agent.id,
      active_connection_count: 1,
      last_pong_at: '2026-03-18T00:00:10.000Z',
    }));
    await expect(reader.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'online',
      last_seen_at: '2026-03-18T00:00:10.000Z',
    }));
  });

  it('keeps another session online until the last connection releases', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const service = new AgentResourceService(docStore, cache);
    const reader = new AgentResourceService(docStore, cache);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'lease-session-agent',
      mode: 'external',
    });

    await service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_a',
      socketKey: `${agent.id}::task_a`,
      sessionId: 'task_a',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });
    await service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_b',
      socketKey: `${agent.id}::task_b`,
      sessionId: 'task_b',
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });

    await expect(service.releaseAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_a',
    })).resolves.toEqual(expect.objectContaining({
      released: true,
      stale: false,
      active_connection_count: 1,
      presence: 'online',
    }));
    await expect(reader.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'online',
      last_seen_at: '2026-03-18T00:00:05.000Z',
    }));

    await expect(service.releaseAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_task_b',
    })).resolves.toEqual(expect.objectContaining({
      released: true,
      stale: false,
      active_connection_count: 0,
      presence: 'offline',
    }));
    await expect(reader.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'offline',
    }));
  });

  it('treats old pong refreshes as stale after socket claim replacement', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const service = new AgentResourceService(docStore, cache);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'lease-stale-refresh-agent',
      mode: 'external',
    });

    await service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_old',
      socketKey: agent.id,
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });
    await service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_new',
      socketKey: agent.id,
      apiInstanceId: 'api_b',
      lastPongAt: '2026-03-18T00:00:05.000Z',
    });

    await expect(service.refreshAgentConnection({
      agentId: agent.id,
      connectionId: 'conn_old',
      lastPongAt: '2026-03-18T00:00:30.000Z',
    })).resolves.toEqual(expect.objectContaining({
      refreshed: false,
      stale: true,
      active_connection_count: 1,
    }));
    await expect(service.refreshAgentConnection({
      agentId: agent.id,
      connectionId: 'conn_new',
      lastPongAt: '2026-03-18T00:00:40.000Z',
    })).resolves.toEqual(expect.objectContaining({
      refreshed: true,
      stale: false,
      active_connection_count: 1,
    }));
    await expect(service.getConnectionInfo(agent.id)).resolves.toEqual(expect.objectContaining({
      connection_id: 'conn_new',
      last_pong_at: '2026-03-18T00:00:40.000Z',
    }));
  });

  it('supports strict session authority lookups without agent-level fallback', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const service = new AgentResourceService(docStore, cache);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'strict-session-authority-agent',
      mode: 'external',
    });

    await service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_agent_level',
      socketKey: agent.id,
      apiInstanceId: 'api_a',
      lastPongAt: '2026-03-18T00:00:00.000Z',
    });

    await expect(
      service.getSessionConnectionInfo(agent.id, 'task_strict', { allowAgentFallback: false }),
    ).resolves.toBeNull();
    await expect(
      service.getSessionConnectionInfo(agent.id, 'task_strict', { allowAgentFallback: true }),
    ).resolves.toEqual(expect.objectContaining({
      connection_id: 'conn_agent_level',
      socket_key: agent.id,
    }));
  });

  it('keeps the registered shared authority when docstore presence projection sync fails during registration', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const service = new AgentResourceService(docStore, cache);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'projection-register-agent',
      mode: 'external',
    });

    const originalUpsert = docStore.upsert.bind(docStore);
    let injectedFailure = false;
    vi.spyOn(docStore, 'upsert').mockImplementation(async (collection, id, value) => {
      if (
        !injectedFailure
        && collection === resolveWorkspaceScopedCollection('agents', 'ws_default')
        && id === agent.id
        && typeof value === 'object'
        && value !== null
        && 'presence' in value
        && value.presence === 'online'
      ) {
        injectedFailure = true;
        throw new Error('docstore_presence_projection_failed');
      }
      return originalUpsert(collection, id, value);
    });

    await expect(service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_projection',
      socketKey: agent.id,
      apiInstanceId: 'api_a',
      lastPongAt: '2026-04-16T00:00:00.000Z',
    })).resolves.toEqual(expect.objectContaining({
      connection_id: 'conn_projection',
      active_connection_count: 1,
    }));

    expect(injectedFailure).toBe(true);
    await expect(service.getConnectionInfo(agent.id)).resolves.toEqual(expect.objectContaining({
      connection_id: 'conn_projection',
      active_connection_count: 1,
    }));
    await expect(service.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'online',
      last_seen_at: '2026-04-16T00:00:00.000Z',
    }));
  });

  it('clears the shared authority even when docstore projection sync fails during release', async () => {
    const docStore = new InMemoryJsonDocStore();
    const cache = new InMemoryCache();
    const service = new AgentResourceService(docStore, cache);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'projection-release-agent',
      mode: 'external',
    });

    await service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_projection_release',
      socketKey: agent.id,
      apiInstanceId: 'api_a',
      lastPongAt: '2026-04-16T00:00:00.000Z',
    });

    const originalUpsert = docStore.upsert.bind(docStore);
    let injectedFailure = false;
    vi.spyOn(docStore, 'upsert').mockImplementation(async (collection, id, value) => {
      if (
        !injectedFailure
        && collection === resolveWorkspaceScopedCollection('agents', 'ws_default')
        && id === agent.id
        && typeof value === 'object'
        && value !== null
        && 'presence' in value
        && value.presence === 'offline'
      ) {
        injectedFailure = true;
        throw new Error('docstore_presence_projection_failed');
      }
      return originalUpsert(collection, id, value);
    });

    await expect(service.releaseAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_projection_release',
    })).resolves.toEqual(expect.objectContaining({
      released: true,
      stale: false,
      active_connection_count: 0,
      presence: 'offline',
    }));

    expect(injectedFailure).toBe(true);
    await expect(service.getConnectionInfo(agent.id)).resolves.toBeNull();
    await expect(service.getAgent('ws_default', 'proj_1', agent.id)).resolves.toEqual(expect.objectContaining({
      presence: 'offline',
    }));
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

  it('normalizes internal agent websocket base before appending the agent execution endpoint path', () => {
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://10.88.0.1:41000/api/v1';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_internal_1',
      mode: 'internal',
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://10.88.0.1:41000/api/v1/agent-execution/ws?agent_id=ag_internal_1',
    );
  });
});
