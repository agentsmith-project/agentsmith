import { describe, expect, it } from 'vitest';
import { classifyUpstreamStatus, resolveRoutingPlan, shouldFallbackByPolicy } from './runtime-routing.js';

describe('runtime-routing', () => {
  it('resolves direct model routing', () => {
    const plan = resolveRoutingPlan({
      modelRaw: 'openai/gpt-4o',
      aliases: [],
      combos: [],
    });
    if ('errorCode' in plan) throw new Error('unexpected_validation_error');
    expect(plan.routedBy).toBe('direct');
    expect(plan.attempts).toEqual([{ provider: 'openai', model: 'gpt-4o' }]);
  });

  it('resolves alias routing', () => {
    const plan = resolveRoutingPlan({
      modelRaw: 'assistant-main',
      aliases: [{ alias: 'assistant-main', target_provider: 'openai', target_model: 'gpt-4o' }],
      combos: [],
    });
    if ('errorCode' in plan) throw new Error('unexpected_validation_error');
    expect(plan.routedBy).toBe('alias');
    expect(plan.attempts).toEqual([{ provider: 'openai', model: 'gpt-4o' }]);
  });

  it('resolves combo routing and fallback policy', () => {
    const plan = resolveRoutingPlan({
      modelRaw: 'combo:prod-chat',
      aliases: [],
      combos: [{
        name: 'prod-chat',
        targets: [{ provider: 'openai', model: 'gpt-4o' }, { provider: 'anthropic', model: 'sonnet' }],
        fallback_policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
      }],
    });
    if ('errorCode' in plan) throw new Error('unexpected_validation_error');
    expect(plan.routedBy).toBe('combo');
    expect(plan.comboName).toBe('prod-chat');
    expect(plan.attempts).toHaveLength(2);
    expect(plan.fallbackPolicy?.max_hops).toBe(1);
  });

  it('returns validation errors for missing alias/combo', () => {
    const aliasPlan = resolveRoutingPlan({
      modelRaw: 'missing-alias',
      aliases: [],
      combos: [],
    });
    expect(aliasPlan).toEqual({ errorCode: 'VALIDATION_ERROR', message: 'runtime_alias_not_found' });

    const comboPlan = resolveRoutingPlan({
      modelRaw: 'combo:missing',
      aliases: [],
      combos: [],
    });
    expect(comboPlan).toEqual({ errorCode: 'VALIDATION_ERROR', message: 'runtime_combo_not_found' });
  });

  it('classifies upstream status by retryability', () => {
    expect(classifyUpstreamStatus(429)).toBe('provider_retryable');
    expect(classifyUpstreamStatus(503)).toBe('provider_retryable');
    expect(classifyUpstreamStatus(400)).toBe('provider_non_retryable');
    expect(classifyUpstreamStatus(200)).toBe('system_error');
  });

  it('applies fallback policy with max hops', () => {
    expect(shouldFallbackByPolicy({
      errorClass: 'provider_retryable',
      hopAfterFallback: 1,
      policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
    })).toBe(true);

    expect(shouldFallbackByPolicy({
      errorClass: 'provider_retryable',
      hopAfterFallback: 2,
      policy: { max_hops: 1, retryable_error_classes: ['provider_retryable'] },
    })).toBe(false);

    expect(shouldFallbackByPolicy({
      errorClass: 'provider_non_retryable',
      hopAfterFallback: 1,
      policy: { max_hops: 2, retryable_error_classes: ['provider_retryable'] },
    })).toBe(false);
  });
});
