import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { EndpointResourceService } from './endpoint-resource-service.js';

describe('endpoint-resource-service', () => {
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
});
