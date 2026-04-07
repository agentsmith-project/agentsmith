import { describe, expect, it } from 'vitest';
import { resolveEffectiveEndpointProxyPath } from './endpoint-route-handler.js';

describe('resolveEffectiveEndpointProxyPath', () => {
  it('preserves explicit canonical responses path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'openai/responses', 'chat/completions')).toBe('openai/responses');
  });

  it('preserves explicit canonical anthropic messages path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'anthropic/messages', 'chat/completions')).toBe('anthropic/messages');
  });

  it('falls back to resolved proxy path for legacy or alias chat paths', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'anthropic/v1/messages', 'messages')).toBe('messages');
    expect(resolveEffectiveEndpointProxyPath('chat', 'messages/count_tokens', 'messages')).toBe('messages');
  });

  it('falls back to resolved proxy path for non-chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('rerank', 'rerank', 'rerank')).toBe('rerank');
  });
});
