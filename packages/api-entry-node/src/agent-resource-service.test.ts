import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  upsertPersistedSystemWorkspace,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';
import { AgentResourceService } from './agent-resource-service.js';
import { listAuditEvents } from './audit-usage-store.js';
import { resolveWorkspaceScopedCollection } from './workspace-tenant-collections.js';

describe('AgentResourceService', () => {
  beforeEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
    delete process.env.PUBLIC_API_BASE_URL;
    delete process.env.INTERNAL_API_BASE_URL;
    delete process.env.AGENT_EXECUTION_WS_BASE_URL;
    delete process.env.AGENT_EXECUTION_HTTP_BASE_URL;
    delete process.env.INTERNAL_AGENT_IMAGE;
    delete process.env.INTEGRATION_INTERNAL_AGENT_IMAGE;
  });

  it('creates developer agent runner with expected defaults', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: '  Developer Echo  ',
      runner_provider: 'developer',
    });

    expect(created.name).toBe('Developer Echo');
    expect(created.runner_provider).toBe('developer');
    expect(created).not.toHaveProperty('interaction_kind');
    expect(created.presence).toBe('offline');
    expect(created.capabilities).toBeDefined();
    expect(created.capabilities?.streaming_completion).toBe(true);
    expect(created.capabilities?.multimodal_completion).toBe(false);
    expect(created.capabilities?.accepted_mime_types).toContain('image/png');
  });

  it('does not allow Developer runners to become Project default through service create or update', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: 'Developer default attempt',
      runner_provider: 'developer',
      is_default: true,
    });

    expect(created.runner_provider).toBe('developer');
    expect(created.is_default).toBe(false);

    const updated = await service.updateAgent('ws_default', 'proj_1', created.id, {
      is_default: true,
    });

    expect(updated?.runner_provider).toBe('developer');
    expect(updated?.is_default).toBe(false);
    await expect(service.getAgent('ws_default', 'proj_1', created.id)).resolves.toEqual(
      expect.objectContaining({
        runner_provider: 'developer',
        is_default: false,
      }),
    );
  });

  it('keeps System managed runners eligible for Project default through service create', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: 'System managed default',
      runner_provider: 'managed',
      is_default: true,
    });

    expect(created.runner_provider).toBe('managed');
    expect(created.is_default).toBe(true);
  });

  it('projects deployment default managed runner endpointId into the API-visible default endpoint field', async () => {
    const docStore = new InMemoryJsonDocStore();
    const service = new AgentResourceService(docStore);

    const created = await service.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      name: 'Default managed runner',
      endpointId: ' ep_managed_default ',
      is_default: true,
    });

    expect(created.default_endpoint_id).toBe('ep_managed_default');
    expect(created.execution_preferences_json).toMatchObject({
      agent_task: { endpoint_id: 'ep_managed_default' },
      task: { endpoint_id: 'ep_managed_default' },
      notebook: { endpoint_id: 'ep_managed_default' },
    });

    const listed = await service.listAgents('ws_default', 'proj_1');
    expect(listed).toEqual([
      expect.objectContaining({
        id: created.id,
        runner_provider: 'managed',
        is_default: true,
        default_endpoint_id: 'ep_managed_default',
      }),
    ]);

    const stored = await docStore.get<Record<string, unknown>>(
      resolveWorkspaceScopedCollection('agents', 'ws_default'),
      created.id,
    );
    expect(stored).toMatchObject({
      id: created.id,
      default_endpoint_id: 'ep_managed_default',
    });
  });

  it('merges deployment default managed runner private config updates without rotating runtime key material', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());

    const created = await service.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      name: 'Default managed runner',
      endpointId: 'ep_managed_default',
      is_default: true,
    });
    const createdConfig = created.config;
    expect(createdConfig?._internal_key_id).toMatch(/^agk_/);
    expect(createdConfig?._internal_raw_key).toMatch(/^ask_/);
    expect(createdConfig?.image).toBeTruthy();

    const updated = await service.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      endpointId: 'ep_managed_default',
      config: {
        idle_timeout_sec: 180,
        max_lifetime_sec: 3600,
      },
    });

    expect(updated.config).toEqual(expect.objectContaining({
      image: createdConfig?.image,
      _internal_key_id: createdConfig?._internal_key_id,
      _internal_raw_key: createdConfig?._internal_raw_key,
      idle_timeout_sec: 180,
      max_lifetime_sec: 3600,
    }));
  });

  it('refreshes deployment default managed runner image from deploy truth without rotating runtime key material', async () => {
    process.env.INTERNAL_AGENT_IMAGE = 'kind-registry:5000/mbos/agentsmith-managed-runner@sha256:1111';
    const service = new AgentResourceService(new InMemoryJsonDocStore());

    const created = await service.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      name: 'Default managed runner',
      endpointId: 'ep_managed_default',
      is_default: true,
    });
    const createdConfig = created.config;
    expect(createdConfig?.image).toBe('kind-registry:5000/mbos/agentsmith-managed-runner@sha256:1111');

    process.env.INTERNAL_AGENT_IMAGE = 'kind-registry:5000/mbos/agentsmith-managed-runner@sha256:2222';
    const updated = await service.upsertDeploymentDefaultManagedAgentRunner('ws_default', 'proj_1', {
      endpointId: 'ep_managed_default',
      config: {
        idle_timeout_sec: 180,
      },
    });

    expect(updated.config).toEqual(expect.objectContaining({
      image: 'kind-registry:5000/mbos/agentsmith-managed-runner@sha256:2222',
      _internal_key_id: createdConfig?._internal_key_id,
      _internal_raw_key: createdConfig?._internal_raw_key,
      idle_timeout_sec: 180,
    }));
  });

  it('keeps distinct runners when wall-clock and Math.random buckets collide', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1234);
    try {
      vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
      const service = new AgentResourceService(new InMemoryJsonDocStore());

      const defaultRunner = await service.createAgent('ws_default', 'proj_1', {
        name: 'Default runner',
        runner_provider: 'managed',
        is_default: true,
      });
      const hiddenRunner = await service.createAgent('ws_default', 'proj_1', {
        name: 'Hidden runner',
        runner_provider: 'managed',
        is_default: false,
      });

      expect(hiddenRunner.id).not.toBe(defaultRunner.id);
      await expect(service.listAgents('ws_default', 'proj_1')).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: defaultRunner.id, is_default: true }),
          expect.objectContaining({ id: hiddenRunner.id, is_default: false }),
        ]),
      );
    } finally {
      randomSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not invent an interaction kind when callers omit it', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: 'No Default Interaction Kind',
      runner_provider: 'developer',
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

  it('builds developer connection info with canonical runner query params', async () => {
    process.env.INTERNAL_API_BASE_URL = 'http://api:20000';
    process.env.PUBLIC_API_BASE_URL = 'http://host.docker.internal:20000/api/v1';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_developer_1',
      runner_provider: 'developer',
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://host.docker.internal:20000/api/v1/agent-execution/ws?agent_runner_id=ag_developer_1',
    );
    expect(connectionInfo.agent_runner_id).toBe('ag_developer_1');
    expect(connectionInfo).not.toHaveProperty('agent_id');
  });

  it('preserves existing agent fields when partial updates omit them', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const created = await service.createAgent('ws_default', 'proj_1', {
      name: 'compose external',
      runner_provider: 'developer',
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
        runner_provider: 'developer',
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
      runner_provider: 'developer',
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

  it('rotates Developer runner service keys with one active key and metadata-only storage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    try {
      const docStore = new InMemoryJsonDocStore();
      const service = new AgentResourceService(docStore);
      const agent = await service.createAgent('ws_default', 'proj_1', {
        name: 'key-rotation-test',
        runner_provider: 'developer',
      });

      const first = await service.createAgentKey('ws_default', 'proj_1', agent.id);
      vi.setSystemTime(new Date('2026-05-05T00:00:01.000Z'));
      const second = await service.createAgentKey('ws_default', 'proj_1', agent.id);

      const keys = await service.listAgentKeys('ws_default', 'proj_1', agent.id);
      expect(keys.filter((item) => item.status === 'active')).toHaveLength(1);
      expect(keys.find((item) => item.id === first.record.id)).toMatchObject({
        id: first.record.id,
        status: 'revoked',
      });
      expect(keys.find((item) => item.id === second.record.id)).toMatchObject({
        id: second.record.id,
        status: 'active',
        expires_at: '2026-05-12T00:00:01.000Z',
      });
      expect(JSON.stringify(keys)).not.toContain(first.key);
      expect(JSON.stringify(keys)).not.toContain(second.key);

      const storedSecond = await docStore.get<Record<string, unknown>>(
        resolveWorkspaceScopedCollection('agent_service_keys', 'ws_default'),
        second.record.id,
      );
      expect(storedSecond).toMatchObject({
        key_prefix: second.key.slice(0, 12),
        status: 'active',
      });
      expect(storedSecond).not.toHaveProperty('key');
      expect(storedSecond?.key_hash).not.toBe(second.key);
      await expect(service.verifyAgentKey(agent.id, first.key)).resolves.toBeNull();
      await expect(service.verifyAgentKey(agent.id, second.key)).resolves.toEqual(
        expect.objectContaining({ id: second.record.id }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('expires Developer runner service keys after seven days', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    try {
      const service = new AgentResourceService(new InMemoryJsonDocStore());
      const agent = await service.createAgent('ws_default', 'proj_1', {
        name: 'key-expiry-test',
        runner_provider: 'developer',
      });
      const created = await service.createAgentKey('ws_default', 'proj_1', agent.id);

      vi.setSystemTime(new Date('2026-05-12T00:00:01.000Z'));

      await expect(service.verifyAgentKey(agent.id, created.key)).resolves.toBeNull();
      await expect(service.listAgentKeys('ws_default', 'proj_1', agent.id)).resolves.toContainEqual(
        expect.objectContaining({
          id: created.record.id,
          status: 'expired',
          expires_at: '2026-05-12T00:00:00.000Z',
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stores authenticated key metadata on registered presence connections', async () => {
    const service = new AgentResourceService(new InMemoryJsonDocStore(), new InMemoryCache());
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'key-auth-presence-agent',
      runner_provider: 'developer',
    });
    const keyPair = await service.createAgentKey('ws_default', 'proj_1', agent.id);

    await service.registerAgentConnection({
      agentId: agent.id,
      workspaceId: 'ws_default',
      projectId: 'proj_1',
      connectionId: 'conn_key_auth',
      socketKey: agent.id,
      apiInstanceId: 'api_a',
      protocolVersion: '1.0',
      lastPongAt: '2026-05-05T00:00:00.000Z',
      authenticatedKey: {
        kind: 'service_key',
        keyId: keyPair.record.id,
        expiresAt: keyPair.record.expires_at,
      },
    });

    await expect(service.getConnectionInfo(agent.id)).resolves.toEqual(expect.objectContaining({
      connection_id: 'conn_key_auth',
      auth_kind: 'service_key',
      auth_key_id: keyPair.record.id,
      auth_key_expires_at: keyPair.record.expires_at,
    }));
    await expect(service.isAgentConnectionCurrent(agent.id, 'conn_key_auth')).resolves.toBe(true);
  });

  it('invalidates test-connection presence when the authenticated service key has expired', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    try {
      const docStore = new InMemoryJsonDocStore();
      const service = new AgentResourceService(docStore, new InMemoryCache());
      const agent = await service.createAgent('ws_default', 'proj_1', {
        name: 'key-expired-presence-agent',
        runner_provider: 'developer',
      });
      const keyPair = await service.createAgentKey('ws_default', 'proj_1', agent.id);
      const expiredKeyRecord = {
        ...keyPair.record,
        expires_at: '2026-05-05T00:00:00.000Z',
      };
      await docStore.upsert(
        resolveWorkspaceScopedCollection('agent_service_keys', 'ws_default'),
        keyPair.record.id,
        expiredKeyRecord,
      );
      await service.registerAgentConnection({
        agentId: agent.id,
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        connectionId: 'conn_key_expires',
        socketKey: agent.id,
        apiInstanceId: 'api_a',
        protocolVersion: '1.0',
        lastPongAt: '2026-05-05T00:00:00.000Z',
        authenticatedKey: {
          kind: 'service_key',
          keyId: keyPair.record.id,
          expiresAt: expiredKeyRecord.expires_at,
        },
      });

      vi.setSystemTime(new Date('2026-05-05T00:00:01.000Z'));

      const result = await service.testAgentConnection('ws_default', 'proj_1', agent.id, { timeoutMs: 750 });

      expect(result).toEqual(expect.objectContaining({
        agent_runner_id: agent.id,
        status: 'stale',
        freshness: expect.objectContaining({
          state: 'stale',
          active_connection_count: 0,
        }),
        cleanup: {
          key_expiry: {
            workspace_id: 'ws_default',
            project_id: 'proj_1',
            agent_runner_id: agent.id,
            key_id: keyPair.record.id,
            key_prefix: keyPair.record.key_prefix,
            expires_at: '2026-05-05T00:00:00.000Z',
            cleanup_result: 'marked_expired',
            disconnected: true,
          },
        },
      }));
      await expect(service.getConnectionInfo(agent.id)).resolves.toBeNull();
      await expect(service.isAgentConnectionCurrent(agent.id, 'conn_key_expires')).resolves.toBe(false);
      await expect(service.listAgentKeys('ws_default', 'proj_1', agent.id)).resolves.toContainEqual(
        expect.objectContaining({
          id: keyPair.record.id,
          status: 'expired',
        }),
      );
      const auditEvents = await listAuditEvents(docStore, {
        workspaceId: 'ws_default',
        projectId: 'proj_1',
        action: 'agent_runner.connection_key.expired',
        startTime: '1970-01-01T00:00:00.000Z',
        endTime: '2999-12-31T23:59:59.999Z',
        page: 1,
        pageSize: 10,
        sortOrder: 'asc',
      });
      expect(auditEvents.items).toHaveLength(1);
      expect(auditEvents.items[0]).toMatchObject({
        actor_type: 'agent',
        actor_id: agent.id,
        action: 'agent_runner.connection_key.expired',
        resource_type: 'agent_runner',
        resource_id: agent.id,
        result: 'ok',
        metadata_json: {
          workspace_id: 'ws_default',
          project_id: 'proj_1',
          agent_runner_id: agent.id,
          key_id: keyPair.record.id,
          key_prefix: keyPair.record.key_prefix,
          expires_at: '2026-05-05T00:00:00.000Z',
          cleanup_result: 'marked_expired',
          disconnected: true,
        },
      });
      const auditPayload = JSON.stringify(auditEvents.items);
      expect(auditPayload).not.toContain(keyPair.key);
      expect(auditPayload).not.toContain('key_hash');
    } finally {
      vi.useRealTimers();
    }
  });

  it('deletes related keys and clears connection state on deleteAgent', async () => {
    const cache = new InMemoryCache();
    const service = new AgentResourceService(new InMemoryJsonDocStore(), cache);
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'delete-test',
      runner_provider: 'developer',
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
      login_idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
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
      runner_provider: 'developer',
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
      login_idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
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
      runner_provider: 'developer',
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
      login_idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
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
      runner_provider: 'developer',
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
      runner_provider: 'developer',
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
      runner_provider: 'developer',
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
      runner_provider: 'developer',
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
      runner_provider: 'developer',
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
      runner_provider: 'developer',
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
      runner_provider: 'developer',
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
      runner_provider: 'developer',
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

  it('builds developer agent runner connection info from public execution base', () => {
    process.env.PUBLIC_API_BASE_URL = 'http://host.docker.internal:20000/api/v1';
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://10.88.0.1:20000';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_developer_1',
      runner_provider: 'developer',
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://host.docker.internal:20000/api/v1/agent-execution/ws?agent_runner_id=ag_developer_1',
    );
  });

  it('builds managed agent runner connection info from internal execution base', () => {
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://10.88.0.1:20000';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_managed_1',
      runner_provider: 'managed',
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://10.88.0.1:20000/api/v1/agent-execution/ws?agent_runner_id=ag_managed_1',
    );
  });

  it('normalizes internal agent websocket base before appending the agent execution endpoint path', () => {
    process.env.AGENT_EXECUTION_WS_BASE_URL = 'ws://10.88.0.1:41000/api/v1';

    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const connectionInfo = service.buildConnectionInfo({
      id: 'ag_managed_1',
      runner_provider: 'managed',
    });

    expect(connectionInfo.ws_url).toBe(
      'ws://10.88.0.1:41000/api/v1/agent-execution/ws?agent_runner_id=ag_managed_1',
    );
  });
});
