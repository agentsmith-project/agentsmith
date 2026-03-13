import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentResourceService } from './agent-resource-service.js';

describe('AgentResourceService', () => {
  const originalCwd = process.cwd();

  afterEach(() => {
    delete process.env.SYSTEM_WORKSPACE_REGISTRY_PATH;
    process.chdir(originalCwd);
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
    const service = new AgentResourceService(new InMemoryJsonDocStore());
    const agent = await service.createAgent('ws_default', 'proj_1', {
      name: 'delete-test',
      mode: 'external',
    });
    await service.createAgentKey('ws_default', 'proj_1', agent.id);
    service.markAgentConnected(agent.id, { protocol_version: '1.0', remote_ip: '127.0.0.1' });

    const deleted = await service.deleteAgent('ws_default', 'proj_1', agent.id);
    expect(deleted).toBe(true);
    expect(await service.getAgent('ws_default', 'proj_1', agent.id)).toBeNull();
    expect(await service.listAgentKeys('ws_default', 'proj_1', agent.id)).toEqual([]);
    expect(service.getConnectionInfo(agent.id)).toBeNull();
  });

  it('uses tenant-prefixed collections for agents and service keys', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-agent-tenant-registry-'));
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          workspace_admin: 'owner@example.com',
          tenant: {
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
            key_prefix: 'ws_default:',
          },
        },
      ]),
      'utf-8',
    );

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

    rmSync(dir, { recursive: true, force: true });
  });

  it('verifies agent keys from the default registry path when SYSTEM_WORKSPACE_REGISTRY_PATH is unset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentsmith-agent-default-registry-'));
    const artifactsDir = join(dir, 'artifacts');
    const registryPath = join(artifactsDir, 'system-workspaces.json');
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          tenant: {
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
            key_prefix: 'ws_default:',
          },
        },
      ]),
      'utf-8',
    );
    process.chdir(dir);

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

    rmSync(dir, { recursive: true, force: true });
  });
});
