import { describe, expect, it } from 'vitest';
import {
  ENDPOINT_PROVIDER_OPTIONS,
  getModelsByCapability,
  getProviderOption,
} from '@/lib/endpoints/provider-catalog';

describe('provider-catalog', () => {
  it('contains default provider set for endpoint creation', () => {
    const keys = ENDPOINT_PROVIDER_OPTIONS.map((item) => item.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'openai',
        'anthropic',
        'deepseek',
        'minimax',
        'kimi',
        'google',
        'glm',
        'alibaba',
      ]),
    );
  });

  it('supports multimodal capability filtering', () => {
    const openai = getProviderOption('openai');
    const models = getModelsByCapability(openai, 'multimodal_completion');
    expect(models.length).toBeGreaterThan(0);
  });
});
