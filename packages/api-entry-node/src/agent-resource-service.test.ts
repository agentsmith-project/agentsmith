import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { AgentResourceService } from './agent-resource-service.js';

describe('AgentResourceService', () => {
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
});
