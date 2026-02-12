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
});

