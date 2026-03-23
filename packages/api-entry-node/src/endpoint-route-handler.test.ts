import { describe, expect, it } from 'vitest';
import { resolveEffectiveEndpointProxyPath } from './endpoint-route-handler.js';

describe('resolveEffectiveEndpointProxyPath', () => {
  it('preserves explicit responses path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'responses', 'chat/completions')).toBe('responses');
  });

  it('preserves explicit anthropic messages path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'messages', 'chat/completions')).toBe('messages');
  });

  it('preserves explicit anthropic count tokens path for chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('chat', 'messages/count_tokens', 'messages')).toBe('messages/count_tokens');
  });

  it('falls back to resolved proxy path for non-chat actions', () => {
    expect(resolveEffectiveEndpointProxyPath('rerank', 'rerank', 'rerank')).toBe('rerank');
  });
});
