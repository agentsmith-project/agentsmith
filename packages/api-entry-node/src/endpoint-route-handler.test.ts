import { describe, expect, it } from 'vitest';
import { resolveEffectiveEndpointProxyPath } from './endpoint-route-handler.js';

describe('resolveEffectiveEndpointProxyPath', () => {
  it('preserves explicit responses path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'openai/responses', 'chat/completions')).toBe('openai/responses');
  });

  it('preserves explicit anthropic messages path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'anthropic/messages', 'chat/completions')).toBe('anthropic/messages');
  });

  it('preserves explicit anthropic v1 messages path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'anthropic/v1/messages', 'chat/completions')).toBe('anthropic/v1/messages');
  });

  it('preserves explicit anthropic count tokens path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'messages/count_tokens', 'messages')).toBe('messages/count_tokens');
  });

  it('falls back to resolved proxy path for non-chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('rerank', 'rerank', 'rerank')).toBe('rerank');
  });
});
