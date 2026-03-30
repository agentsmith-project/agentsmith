import { describe, expect, it } from 'vitest';
import { buildUpstreamUrl } from './request-handler/build-upstream-url.js';

describe('buildUpstreamUrl', () => {
  it('joins base and proxy path in normal case', () => {
    expect(buildUpstreamUrl('https://openai-compatible.provider.example', 'chat/completions')).toBe(
      'https://openai-compatible.provider.example/chat/completions',
    );
  });

  it('accepts canonical openai proxy paths', () => {
    expect(buildUpstreamUrl('https://openai-compatible.provider.example', 'openai/responses')).toBe(
      'https://openai-compatible.provider.example/responses',
    );
  });

  it('does not duplicate proxy path when base already ends with it', () => {
    expect(buildUpstreamUrl('https://openai-compatible.provider.example/chat/completions', 'chat/completions')).toBe(
      'https://openai-compatible.provider.example/chat/completions',
    );
  });

  it('handles redundant slashes', () => {
    expect(buildUpstreamUrl('https://openai-compatible.provider.example///', '/chat/completions')).toBe(
      'https://openai-compatible.provider.example/chat/completions',
    );
  });

  it('normalizes anthropic messages path to include v1 when missing', () => {
    expect(buildUpstreamUrl('https://anthropic-compatible.provider.example', 'messages')).toBe(
      'https://anthropic-compatible.provider.example/v1/messages',
    );
  });

  it('keeps anthropic messages path stable when base already has v1', () => {
    expect(buildUpstreamUrl('https://api.anthropic.com/v1', 'messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  it('keeps anthropic messages path stable when base already ends with messages', () => {
    expect(buildUpstreamUrl('https://api.anthropic.com/v1/messages', 'messages')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });

  it('supports anthropic messages/count_tokens with v1 injection', () => {
    expect(buildUpstreamUrl('https://anthropic-compatible.provider.example', 'messages/count_tokens')).toBe(
      'https://anthropic-compatible.provider.example/v1/messages/count_tokens',
    );
  });

  it('supports canonical anthropic messages/count_tokens paths', () => {
    expect(buildUpstreamUrl('https://anthropic-compatible.provider.example', 'anthropic/messages/count_tokens')).toBe(
      'https://anthropic-compatible.provider.example/v1/messages/count_tokens',
    );
  });

  it('normalizes openai chat suffix before switching to anthropic messages path', () => {
    expect(buildUpstreamUrl('https://anthropic-compatible.provider.example/chat/completions', 'messages')).toBe(
      'https://anthropic-compatible.provider.example/v1/messages',
    );
  });

  it('normalizes responses suffix before switching to anthropic messages path', () => {
    expect(buildUpstreamUrl('https://anthropic-compatible.provider.example/responses', 'messages')).toBe(
      'https://anthropic-compatible.provider.example/v1/messages',
    );
  });
});
