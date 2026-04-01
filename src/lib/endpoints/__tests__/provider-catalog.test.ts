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
    it('should contain three custom protocol options', () => {
      expect(CUSTOM_PROTOCOL_OPTIONS).toHaveLength(3);
    });

    it('should have openai_chat_completions as first option', () => {
      const openaiChat = CUSTOM_PROTOCOL_OPTIONS[0];
      expect(openaiChat.protocol).toBe('openai_chat_completions');
      expect(openaiChat.display_name).toBe('OpenAI Chat Completions');
      expect(openaiChat.default_base_url).toBe('https://api.openai.com/v1');
      expect(openaiChat.description).toBeDefined();
    });

    it('should have openai_responses as second option', () => {
      const responses = CUSTOM_PROTOCOL_OPTIONS[1];
      expect(responses.protocol).toBe('openai_responses');
      expect(responses.display_name).toBe('OpenAI Responses');
      expect(responses.default_base_url).toBe('https://api.openai.com/v1');
      expect(responses.description).toBeDefined();
    });

    it('should have anthropic_messages as third option', () => {
      const anthropicMessages = CUSTOM_PROTOCOL_OPTIONS[2];
      expect(anthropicMessages.protocol).toBe('anthropic_messages');
      expect(anthropicMessages.display_name).toBe('Anthropic Messages');
      expect(anthropicMessages.default_base_url).toBe('https://api.anthropic.com');
      expect(anthropicMessages.description).toBeDefined();
    });
  });

  describe('getCustomProtocolConfig', () => {
    it('should return openai_chat_completions config', () => {
      const config = getCustomProtocolConfig('openai_chat_completions');
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('openai_chat_completions');
      expect(config?.display_name).toBe('OpenAI Chat Completions');
    });

    it('should return openai_responses config', () => {
      const config = getCustomProtocolConfig('openai_responses');
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('openai_responses');
      expect(config?.display_name).toBe('OpenAI Responses');
    });

    it('should return anthropic_messages config', () => {
      const config = getCustomProtocolConfig('anthropic_messages');
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('anthropic_messages');
      expect(config?.display_name).toBe('Anthropic Messages');
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
      expect(config?.protocol).toBe('openai_chat_completions');
    });

    it('should return second protocol at index 1', () => {
      const config = getCustomProtocolByIndex(1);
      expect(config).toBeDefined();
      expect(config?.protocol).toBe('openai_responses');
    });

    it('should return undefined for out of range index', () => {
      const config = getCustomProtocolByIndex(99);
      expect(config).toBeUndefined();
    });
  });
});
