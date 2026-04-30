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

  it('persists upstream protocol and updates it explicitly', async () => {
    const service = new EndpointResourceService(new InMemoryJsonDocStore());

    const credential = await service.createCredential('ws_1', 'proj_1', {
      name: 'anthropic-key',
      value: 'sk-ant-test',
    });

    const endpoint = await service.createEndpoint('ws_1', 'proj_1', {
      name: 'anthropic-endpoint',
      model: 'claude-sonnet-4-5',
      type: 'catalog',
      base_url: 'https://api.anthropic.com/v1/messages',
      credential_ref: credential.id,
      upstream_protocol: 'anthropic_messages',
      provider_family: 'anthropic',
    });

    expect(endpoint.upstream_protocol).toBe('anthropic_messages');

    const updated = await service.updateEndpoint('ws_1', 'proj_1', endpoint.id, {
      upstream_protocol: 'openai_chat_completions',
      base_url: 'https://api.openai.com/v1/chat/completions',
    });

    expect(updated?.upstream_protocol).toBe('openai_chat_completions');
  });

  it('infers upstream protocol from base url for custom endpoints', async () => {
    const service = new EndpointResourceService(new InMemoryJsonDocStore());

    const credential = await service.createCredential('ws_1', 'proj_1', {
      name: 'glm-anthropic-key',
      value: 'sk-placeholder-test',
    });

    const endpoint = await service.createEndpoint('ws_1', 'proj_1', {
      name: 'glm-anthropic',
      model: 'placeholder-model',
      type: 'custom',
      base_url: 'https://anthropic-compatible.provider.example/messages',
      credential_ref: credential.id,
      provider_family: 'custom',
    });

    expect(endpoint.upstream_protocol).toBe('anthropic_messages');
    expect(endpoint.model_profile?.max_context_tokens).toBeGreaterThan(0);
    expect(endpoint.model_profile?.price_input_per_1m).toBe(0);
  });

  it('uses tenant-prefixed collections for credentials, secrets, and endpoints', async () => {
    await upsertPersistedSystemWorkspace({
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      project_creators: [],
      login_idp: { kind: 'keycloak', url: 'http://localhost:18080', realm: 'mbos', client_id: 'agentsmith' },
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
      type: 'catalog',
      base_url: 'https://api.openai.com/v1/chat/completions',
      credential_ref: credential.id,
      upstream_protocol: 'openai_chat_completions',
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
