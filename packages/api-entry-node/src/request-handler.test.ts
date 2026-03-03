import { describe, expect, it } from 'vitest';
import { buildUpstreamUrl } from './request-handler.js';

describe('buildUpstreamUrl', () => {
  it('joins base and proxy path in normal case', () => {
    expect(buildUpstreamUrl('https://open.bigmodel.cn/api/paas/v4', 'chat/completions')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  });

  it('does not duplicate proxy path when base already ends with it', () => {
    expect(buildUpstreamUrl('https://open.bigmodel.cn/api/paas/v4/chat/completions', 'chat/completions')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  });

  it('handles redundant slashes', () => {
    expect(buildUpstreamUrl('https://open.bigmodel.cn/api/paas/v4///', '/chat/completions')).toBe(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    );
  });

  it('normalizes anthropic messages path to include v1 when missing', () => {
    expect(buildUpstreamUrl('https://open.bigmodel.cn/api/anthropic', 'messages')).toBe(
      'https://open.bigmodel.cn/api/anthropic/v1/messages',
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
});
