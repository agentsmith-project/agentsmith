import { describe, expect, it } from 'vitest';
import {
  buildModelCatalogProviderOptions,
  inferProviderFamily,
  sortModelCatalogProviders,
} from '../model-catalog-provider-options';
import type { ModelCatalogProvider } from '@/lib/api/endpoints/model-config';

function provider(
  provider_key: string,
  name: string,
  api = 'https://example.com/v1',
): ModelCatalogProvider {
  return {
    provider: provider_key,
    family: provider_key === 'anthropic' ? 'anthropic' : provider_key === 'openai' ? 'openai' : 'custom',
    label: name,
    name,
    provider_key,
    provider_id: provider_key,
    api,
    default_base_url: api,
    upstream_protocol: provider_key === 'anthropic' ? 'anthropic_messages' : 'openai_chat_completions',
  };
}

describe('model-catalog-provider-options', () => {
  it('prioritizes openai/anthropic then chinese providers', () => {
    const sorted = sortModelCatalogProviders([
      provider('openrouter', 'OpenRouter'),
      provider('moonshotai', 'Moonshot AI'),
      provider('anthropic', 'Anthropic'),
      provider('zhipuai', 'Zhipu AI'),
      provider('openai', 'OpenAI'),
    ]);

    expect(sorted.map((item: ModelCatalogProvider) => item.provider_key)).toEqual([
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

  it('builds options with upstream protocol', () => {
    const options = buildModelCatalogProviderOptions([
      provider('anthropic', 'Anthropic', 'https://api.anthropic.com'),
      provider('zhipuai', 'Zhipu AI', 'https://open.bigmodel.cn/api/coding/paas/v4'),
    ]);

    expect(options[0]).toMatchObject({
      key: 'anthropic',
      family: 'anthropic',
      upstream_protocol: 'anthropic_messages',
    });
    expect(options[1]).toMatchObject({
      key: 'zhipuai',
      family: 'glm',
      upstream_protocol: 'openai_chat_completions',
    });
  });

  it('falls back to known provider base url when api is missing', () => {
    const options = buildModelCatalogProviderOptions([
      provider('openai', 'OpenAI', ''),
    ]);

    expect(options[0]?.default_base_url).toBe('https://api.openai.com/v1');
  });

  it('falls back to the official DeepSeek OpenAI-compatible base URL without v1 suffix', () => {
    const options = buildModelCatalogProviderOptions([
      provider('deepseek', 'DeepSeek', ''),
    ]);

    expect(options[0]?.default_base_url).toBe('https://api.deepseek.com');
    expect(options[0]?.upstream_protocol).toBe('openai_chat_completions');
  });
});
