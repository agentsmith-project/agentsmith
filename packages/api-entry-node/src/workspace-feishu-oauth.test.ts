import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryCache, InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  completeWorkspaceFeishuOAuth,
  completeWorkspaceFeishuOAuthFromState,
  startWorkspaceFeishuOAuth,
} from './workspace-feishu-oauth.js';
import { getContextEntry } from './context-store.js';
import { upsertWorkspaceFeishuIntegration } from './workspace-feishu-settings-store.js';

describe('workspace Feishu oauth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FEISHU_OAUTH_AUTHORIZE_URL: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      FEISHU_OAUTH_TOKEN_URL: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      FEISHU_OAUTH_SCOPES: 'offline_access',
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

  it('returns the same redirect result when callback submit is repeated for user connect', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();

    await upsertWorkspaceFeishuIntegration(docStore, {
      id: 'workspace_feishu:ws_1',
      workspace_id: 'ws_1',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      app_secret: 'secret_123',
      redirect_uri: 'http://localhost:3001/workspaces/ws_1/feishu/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });

    const started = await startWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_1',
      userId: 'user_123',
      userEmail: 'user@example.com',
      intent: 'user_connect',
      postRedirectPath: '/en-US/workspaces/ws_1/connections?provider=feishu',
      requireEnabled: true,
    });

    const first = await completeWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_1',
      userId: 'user_123',
      userEmail: 'user@example.com',
      code: 'code_123',
      state: started.state,
    });
    const second = await completeWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_1',
      userId: 'user_123',
      userEmail: 'user@example.com',
      code: 'code_123',
      state: started.state,
    });

    expect(first.redirect_path).toBe('/en-US/workspaces/ws_1/connections?provider=feishu');
    expect(second.redirect_path).toBe(first.redirect_path);
    expect(second.connection?.id).toBe(first.connection?.id);
    expect(second.connection?.workspace_id).toBe('ws_1');
  });

  it('returns the same redirect result when callback submit is repeated for admin verify', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();

    await upsertWorkspaceFeishuIntegration(docStore, {
      id: 'workspace_feishu:ws_2',
      workspace_id: 'ws_2',
      provider: 'feishu',
      status: 'verification_required',
      app_id: 'app_123',
      app_secret: 'secret_123',
      redirect_uri: 'http://localhost:3001/workspaces/ws_2/feishu/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });

    const started = await startWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_2',
      userId: 'admin_123',
      userEmail: 'admin@example.com',
      intent: 'admin_verify',
      postRedirectPath: '/en-US/workspaces/ws_2/settings/feishu?step=enable',
    });

    const first = await completeWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_2',
      userId: 'admin_123',
      userEmail: 'admin@example.com',
      code: 'code_123',
      state: started.state,
    });
    const second = await completeWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_2',
      userId: 'admin_123',
      userEmail: 'admin@example.com',
      code: 'code_123',
      state: started.state,
    });

    expect(first.intent).toBe('admin_verify');
    expect(second.intent).toBe('admin_verify');
    expect(second.redirect_path).toBe('/en-US/workspaces/ws_2/settings/feishu?step=enable');
    expect(second.connection).toBeUndefined();
  });

  it('completes user connect from state without requiring an active bearer token context', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();

    await upsertWorkspaceFeishuIntegration(docStore, {
      id: 'workspace_feishu:ws_3',
      workspace_id: 'ws_3',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      app_secret: 'secret_123',
      redirect_uri: 'http://localhost:3001/workspaces/ws_3/feishu/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });

    const started = await startWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_3',
      userId: 'user_789',
      userEmail: 'user789@example.com',
      intent: 'user_connect',
      postRedirectPath: '/zh-CN/workspaces/ws_3/connections?provider=feishu',
      requireEnabled: true,
    });

    const completed = await completeWorkspaceFeishuOAuthFromState({
      cache,
      docStore,
      workspaceId: 'ws_3',
      code: 'code_789',
      state: started.state,
    });

    expect(completed.intent).toBe('user_connect');
    expect(completed.redirect_path).toBe('/zh-CN/workspaces/ws_3/connections?provider=feishu');
    expect(completed.connection?.user_id).toBe('user_789');
    expect(completed.connection?.workspace_id).toBe('ws_3');
  });

  it('syncs a member default binding after a successful user connect', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();

    await upsertWorkspaceFeishuIntegration(docStore, {
      id: 'workspace_feishu:ws_5',
      workspace_id: 'ws_5',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      app_secret: 'secret_123',
      redirect_uri: 'http://localhost:3001/workspaces/ws_5/feishu/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });

    const started = await startWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_5',
      userId: 'user_555',
      userEmail: 'user555@example.com',
      intent: 'user_connect',
      postRedirectPath: '/en-US/workspaces/ws_5/connections?provider=feishu',
      requireEnabled: true,
    });

    const completed = await completeWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_5',
      userId: 'user_555',
      userEmail: 'user555@example.com',
      code: 'code_555',
      state: started.state,
    });

    expect(completed.connection?.id).toBeTruthy();
    const binding = await getContextEntry(docStore, {
      scope: 'member',
      key: 'managed_credential_bindings.feishu',
      user_id: 'user_555',
      workspace_id: 'ws_5',
    });
    expect(binding).toMatchObject({
      scope: 'member',
      key: 'managed_credential_bindings.feishu',
      user_id: 'user_555',
      workspace_id: 'ws_5',
    });
    expect(JSON.parse(binding?.content ?? '{}')).toEqual({
      provider: 'feishu',
      connection_id: completed.connection?.id,
    });
  });

  it('requests the configured Feishu scopes and stores them on successful user connect', async () => {
    const cache = new InMemoryCache();
    const docStore = new InMemoryJsonDocStore();

    process.env.FEISHU_OAUTH_SCOPES = 'offline_access search:docs:read wiki:wiki wiki:wiki:readonly wiki:node:retrieve';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          access_token: 'token_456',
          refresh_token: 'refresh_456',
          expires_in: 3600,
          scope: 'offline_access search:docs:read wiki:wiki wiki:wiki:readonly wiki:node:retrieve',
          token_type: 'Bearer',
          union_id: 'union_456',
          name: 'Scoped Feishu User',
          email: 'scoped.feishu.user@example.com',
        }),
      })),
    );

    await upsertWorkspaceFeishuIntegration(docStore, {
      id: 'workspace_feishu:ws_4',
      workspace_id: 'ws_4',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      app_secret: 'secret_123',
      redirect_uri: 'http://localhost:3001/workspaces/ws_4/feishu/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
    });

    const started = await startWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_4',
      userId: 'user_456',
      userEmail: 'user456@example.com',
      intent: 'user_connect',
      postRedirectPath: '/en-US/workspaces/ws_4/connections?provider=feishu',
      requireEnabled: true,
    });

    const authUrl = new URL(started.authorization_url);
    expect(authUrl.searchParams.get('scope')).toBe(
      'offline_access search:docs:read wiki:wiki wiki:wiki:readonly wiki:node:retrieve',
    );

    const completed = await completeWorkspaceFeishuOAuth({
      cache,
      docStore,
      workspaceId: 'ws_4',
      userId: 'user_456',
      userEmail: 'user456@example.com',
      code: 'code_456',
      state: started.state,
    });

    expect(completed.connection?.status).toBe('active');
    expect(completed.connection?.last_error).toBeNull();
    expect(completed.connection?.reauth_reason).toBeNull();
    expect(completed.connection?.missing_scopes).toBeNull();
    expect(completed.connection?.scopes).toEqual([
      'offline_access',
      'search:docs:read',
      'wiki:wiki',
      'wiki:wiki:readonly',
      'wiki:node:retrieve',
    ]);
  });
});
