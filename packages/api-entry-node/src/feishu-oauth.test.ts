import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import { completeFeishuOAuth, startFeishuOAuth } from './feishu-oauth.js';

describe('feishu oauth shared state', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FEISHU_APP_ID: 'app_123',
      FEISHU_APP_SECRET: 'secret_123',
      FEISHU_OAUTH_REDIRECT_URI: 'http://localhost:18181/callback',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'token_123',
          refresh_token: 'refresh_123',
          expires_in: 3600,
          scope: 'offline_access',
          token_type: 'Bearer',
          union_id: 'union_123',
          name: 'Feishu User',
          email: 'feishu.user@example.com',
        }),
      })),
    );
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('completes oauth from cache-backed state after start', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();

    const started = await startFeishuOAuth(cache, 'user_123');
    const completed = await completeFeishuOAuth({
      cache,
      docStore,
      userId: 'user_123',
      code: 'code_123',
      state: started.state,
    });

    expect(completed.user_id).toBe('user_123');
    expect(completed.provider).toBe('feishu');
    expect(completed.account_identity?.external_email).toBe('feishu.user@example.com');
  });
});
