import { describe, expect, it } from 'vitest';
import {
  buildRuntimeProviderOptions,
  inferProviderFamily,
  sortRuntimeProviders,
} from '../runtime-provider-options';
import type { RuntimeCatalogProvider } from '@/lib/api/endpoints/runtime';

function provider(
  provider_key: string,
  name: string,
  api = 'https://example.com/v1',
): RuntimeCatalogProvider {
  return {
    id: `p_${provider_key}`,
    version_id: 'v1',
    provider_key,
    provider_id: provider_key,
    name,
    api,
    env: [],
    model_count: 0,
  };
}

describe('runtime-provider-options', () => {
  it('prioritizes openai/anthropic then chinese providers', () => {
    const sorted = sortRuntimeProviders([
      provider('openrouter', 'OpenRouter'),
      provider('moonshotai', 'Moonshot AI'),
      provider('anthropic', 'Anthropic'),
      provider('zhipuai', 'Zhipu AI'),
      provider('openai', 'OpenAI'),
    ]);

    expect(sorted.map((item) => item.provider_key)).toEqual([
      'openai',
      'anthropic',
      'zhipuai',
      'moonshotai',
      'openrouter',
    ]);
  });

  it('maps real provider keys to endpoint family', () => {
    expect(inferProviderFamily('zhipuai')).toBe('glm');
    expect(inferProviderFamily('moonshotai')).toBe('kimi');
    expect(inferProviderFamily('openai')).toBe('openai');
    expect(inferProviderFamily('unknown-provider')).toBe('custom');
  });

  it('builds options with protocol and compatibility interface', () => {
    const options = buildRuntimeProviderOptions([
      provider('anthropic', 'Anthropic', 'https://api.anthropic.com'),
      provider('zhipuai', 'Zhipu AI', 'https://open.bigmodel.cn/api/coding/paas/v4'),
    ]);

    expect(options[0]).toMatchObject({
      key: 'anthropic',
      family: 'anthropic',
      protocol: 'anthropic_compatible',
      compatibility_interface: 'anthropic_compatible',
    });
    expect(options[1]).toMatchObject({
      key: 'zhipuai',
      family: 'glm',
      protocol: 'openai_compatible',
      compatibility_interface: 'openai_compatible',
    });
  });
});
