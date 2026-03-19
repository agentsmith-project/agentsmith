import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  upsertPersistedSystemWorkspace,
} from '../../../src/lib/system-admin/workspace-registry/persistence.js';
import { EndpointResourceService } from './endpoint-resource-service.js';

describe('endpoint-resource-service', () => {
  afterEach(() => {
    resetSystemWorkspaceRegistryPersistenceForTest();
  });

  it('persists anthropic compatibility interface when protocol is anthropic compatible', async () => {
    const service = new EndpointResourceService(new InMemoryJsonDocStore());

    const credential = await service.createCredential('ws_1', 'proj_1', {
      name: 'anthropic-key',
      value: 'sk-ant-test',
    });

    const endpoint = await service.createEndpoint('ws_1', 'proj_1', {
      name: 'anthropic-endpoint',
      model: 'claude-sonnet-4-5',
      type: 'anthropic',
      base_url: 'https://api.anthropic.com/v1/messages',
      credential_ref: credential.id,
      protocol: 'anthropic_compatible',
      provider_family: 'anthropic',
    });

    expect(endpoint.protocol).toBe('anthropic_compatible');
    expect(endpoint.meta?.compatibility_interface).toBe('anthropic_compatible');

    const updated = await service.updateEndpoint('ws_1', 'proj_1', endpoint.id, {
      protocol: 'openai_compatible',
      base_url: 'https://api.openai.com/v1/chat/completions',
    });

    expect(updated?.protocol).toBe('openai_compatible');
    expect(updated?.meta?.compatibility_interface).toBe('openai_compatible');
  });

  it('infers anthropic protocol from base url and sets compatibility interface metadata', async () => {
    const service = new EndpointResourceService(new InMemoryJsonDocStore());

    const credential = await service.createCredential('ws_1', 'proj_1', {
      name: 'glm-anthropic-key',
      value: 'sk-glm-test',
    });

    const endpoint = await service.createEndpoint('ws_1', 'proj_1', {
      name: 'glm-anthropic',
      model: 'glm-4.7',
      type: 'custom',
      base_url: 'https://open.bigmodel.cn/api/anthropic/messages',
      credential_ref: credential.id,
      provider_family: 'custom',
    });

    expect(endpoint.protocol).toBe('anthropic_compatible');
    expect(endpoint.meta?.compatibility_interface).toBe('anthropic_compatible');
    expect(endpoint.model_profile?.max_context_tokens).toBeGreaterThan(0);
    expect(endpoint.model_profile?.price_input_per_1m).toBe(0);
  });

  it('uses tenant-prefixed collections for credentials, secrets, and endpoints', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        substrate_label: 'primary',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: '2026-03-18T00:00:00.000Z',
      updated_at: '2026-03-18T00:00:00.000Z',
    });

    const docStore = new InMemoryJsonDocStore();
    const service = new EndpointResourceService(docStore);

    const credential = await service.createCredential('ws_default', 'proj_1', {
      name: 'tenant-key',
      value: 'sk-tenant',
    });
    const endpoint = await service.createEndpoint('ws_default', 'proj_1', {
      name: 'tenant-endpoint',
      model: 'gpt-4o',
      type: 'openai',
      base_url: 'https://api.openai.com/v1/chat/completions',
      credential_ref: credential.id,
      protocol: 'openai_compatible',
      provider_family: 'custom',
    });

    expect(await docStore.list('credentials', {})).toHaveLength(0);
    expect(await docStore.list('credential_secrets', {})).toHaveLength(0);
    expect(await docStore.list('endpoints', {})).toHaveLength(0);
    expect(await docStore.list('ws_default_credentials', {})).toHaveLength(1);
    expect(await docStore.list('ws_default_credential_secrets', {})).toHaveLength(1);
    expect(await docStore.list('ws_default_endpoints', {})).toHaveLength(1);
    expect((await service.listCredentials('ws_default', 'proj_1')).map((item) => item.id)).toContain(credential.id);
    expect((await service.listEndpoints('ws_default', 'proj_1')).map((item) => item.id)).toContain(endpoint.id);
    expect(await service.getCredentialSecret('ws_default', 'proj_1', credential.id)).toBe('sk-tenant');
  });
});
