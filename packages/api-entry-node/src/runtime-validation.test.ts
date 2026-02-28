import { describe, expect, it } from 'vitest';
import {
  parseRuntimeAliasPayload,
  parseRuntimeComboPayload,
  parseRuntimeModelCreatePayload,
  parseRuntimeModelUpdatePayload,
  parseRuntimePricingPayload,
  parseRuntimeProviderCreatePayload,
} from './runtime-validation.js';

describe('runtime-validation', () => {
  it('parses provider create payload', () => {
    const parsed = parseRuntimeProviderCreatePayload({
      provider: 'openai',
      auth_mode: 'api_key',
      base_url: 'https://api.openai.com/v1',
      priority: 10,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.provider).toBe('openai');
    expect(parsed.value.auth_mode).toBe('api_key');
    expect(parsed.value.priority).toBe(10);
  });

  it('rejects invalid model create payload and empty update capabilities', () => {
    expect(parseRuntimeModelCreatePayload({ provider: 'openai' })).toEqual({
      ok: false,
      message: 'runtime_model_required_fields_missing',
    });
    expect(parseRuntimeModelUpdatePayload({ capabilities: [] }, ['chat'])).toEqual({
      ok: false,
      message: 'runtime_model_capabilities_required',
    });
  });

  it('parses alias and combo payloads', () => {
    const alias = parseRuntimeAliasPayload({
      alias: 'assistant-main',
      target_provider: 'openai',
      target_model: 'gpt-4o',
    });
    expect(alias.ok).toBe(true);

    const combo = parseRuntimeComboPayload({
      name: 'prod-chat',
      targets: [{ provider: 'openai', model: 'gpt-4o' }],
      fallback_policy: {
        max_hops: 1,
        retryable_error_classes: ['provider_retryable'],
      },
    });
    expect(combo.ok).toBe(true);
    if (!combo.ok) return;
    expect(combo.value.fallback_policy.max_hops).toBe(1);
  });

  it('validates pricing map shape', () => {
    expect(parseRuntimePricingPayload({
      openai: {
        'gpt-4o': {
          input: 2.5,
          output: 10,
        },
      },
    })).toEqual({
      ok: true,
      value: {
        openai: {
          'gpt-4o': {
            input: 2.5,
            output: 10,
          },
        },
      },
    });

    expect(parseRuntimePricingPayload({
      openai: {
        'gpt-4o': {
          input: 'bad',
        },
      },
    })).toEqual({
      ok: false,
      message: 'runtime_pricing_payload_invalid',
    });
  });
});
