import { describe, expect, it } from 'vitest';
import { parseModelRequestRef, parseProjectPricingPayload } from './model-config-validation.js';

describe('model-config-validation', () => {
  it('parses provider/model request references', () => {
    expect(parseModelRequestRef({ model: 'openai/gpt-4o' })).toEqual({
      ok: true,
      value: { provider: 'openai', model: 'gpt-4o' },
    });
  });

  it('rejects missing or malformed request references', () => {
    expect(parseModelRequestRef({})).toEqual({
      ok: false,
      message: 'model_request_model_required',
    });

    expect(parseModelRequestRef({ model: 'gpt-4o' })).toEqual({
      ok: false,
      message: 'model_request_model_format_invalid',
    });
  });

  it('accepts valid project pricing maps', () => {
    expect(parseProjectPricingPayload({
      openai: {
        'gpt-4o': { input: 2.5, output: 10 },
      },
    })).toEqual({
      ok: true,
      value: {
        openai: {
          'gpt-4o': { input: 2.5, output: 10 },
        },
      },
    });
  });

  it('rejects invalid project pricing payloads', () => {
    expect(parseProjectPricingPayload({
      openai: {
        'gpt-4o': { input: '2.5' },
      },
    })).toEqual({
      ok: false,
      message: 'project_pricing_payload_invalid',
    });
  });
});
