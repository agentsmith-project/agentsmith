import { describe, expect, it } from 'vitest';
import {
  ENDPOINT_PROVIDER_OPTIONS,
  getModelsByCapability,
  getProviderOption,
  CUSTOM_PROVIDER_OPTION,
  CUSTOM_PROTOCOL_OPTIONS,
  getCustomProtocolConfig,
  getCustomProtocolByIndex,
} from '@/lib/endpoints/provider-catalog';
import type { CustomEndpointProtocol } from '@/lib/api/types';

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

  describe('custom provider option', () => {
    it('should return custom provider option', () => {
      const custom = getProviderOption('custom');
      expect(custom).toEqual(CUSTOM_PROVIDER_OPTION);
      expect(custom.key).toBe('custom');
      expect(custom.family).toBe('custom');
      expect(custom.display_name).toBe('Custom');
    });

    it('should have empty models array', () => {
      const custom = getProviderOption('custom');
      expect(custom.models).toEqual([]);
    });
  });

  describe('custom protocol options', () => {
    it('should contain two custom protocol options', () => {
      expect(CUSTOM_PROTOCOL_OPTIONS).toHaveLength(2);
    });

    it('should have openai_compatible as first option', () => {
      const openaiCompatible = CUSTOM_PROTOCOL_OPTIONS[0];
      expect(openaiCompatible.protocol).toBe('openai_compatible');
      expect(openaiCompatible.display_name).toBe('OpenAI Compatible');
      expect(openaiCompatible.default_base_url).toBe('https://api.openai.com/v1');
      expect(openaiCompatible.description).toBeDefined();
    });

    it('should have anthropic_compatible as second option', () => {
      const anthropicCompatible = CUSTOM_PROTOCOL_OPTIONS[1];
      expect(anthropicCompatible.protocol).toBe('anthropic_compatible');
      expect(anthropicCompatible.display_name).toBe('Anthropic Compatible');
      expect(anthropicCompatible.default_base_url).toBe('https://api.anthropic.com');
      expect(anthropicCompatible.description).toBeDefined();
    });
  });

  describe('getCustomProtocolConfig', () => {
    it('should return openai_compatible config', () => {
      const config = getCustomProtocolConfig('openai_compatible');
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('openai_compatible');
      expect(config?.display_name).toBe('OpenAI Compatible');
    });

    it('should return anthropic_compatible config', () => {
      const config = getCustomProtocolConfig('anthropic_compatible');
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('anthropic_compatible');
      expect(config?.display_name).toBe('Anthropic Compatible');
    });

    it('should return undefined for invalid protocol', () => {
      const config = getCustomProtocolConfig('invalid' as CustomEndpointProtocol);
      expect(config).toBeUndefined();
    });
  });

  describe('getCustomProtocolByIndex', () => {
    it('should return first protocol at index 0', () => {
      const config = getCustomProtocolByIndex(0);
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('openai_compatible');
    });

    it('should return second protocol at index 1', () => {
      const config = getCustomProtocolByIndex(1);
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('anthropic_compatible');
    });

    it('should return undefined for out of range index', () => {
      const config = getCustomProtocolByIndex(99);
      expect(config).toBeUndefined();
    });
  });
});
