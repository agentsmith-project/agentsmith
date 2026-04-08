import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { createUserExternalConnection, getUserExternalConnection } from './user-external-connections-store.js';
import { refreshFeishuOAuth } from './feishu-oauth.js';

describe('feishu-oauth', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      FEISHU_APP_ID: 'app_123',
      FEISHU_APP_SECRET: 'secret_123',
      FEISHU_OAUTH_TOKEN_URL: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
      FEISHU_OAUTH_SCOPES: 'offline_access search:docs:read wiki:wiki wiki:wiki:readonly wiki:node:retrieve',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('updates scopes from refresh response and keeps the connection active when required scopes are present', async () => {
    const docStore = new InMemoryJsonDocStore();
    const connection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      provider: 'feishu',
      workspace_id: null,
      custom_domain: null,
      kind: 'oauth_account',
      display_name: 'Feishu',
      note: null,
      status: 'active',
      fields: [
        { key: 'access_token', value: 'access_old', description: null, secret: true },
        { key: 'refresh_token', value: 'refresh_old', description: null, secret: true },
      ],
      account_identity: null,
      scopes: ['offline_access'],
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'access_new',
        refresh_token: 'refresh_new',
        expires_in: 3600,
        scope: 'offline_access search:docs:read wiki:wiki wiki:wiki:readonly wiki:node:retrieve',
      }),
    })));

    const refreshed = await refreshFeishuOAuth({
      docStore,
      userId: 'user_1',
      connectionId: connection.id,
    });

    expect(refreshed.status).toBe('active');
    expect(refreshed.last_error).toBeNull();
    expect(refreshed.reauth_reason).toBeNull();
    expect(refreshed.missing_scopes).toBeNull();
    expect(refreshed.scopes).toEqual([
      'offline_access',
      'search:docs:read',
      'wiki:wiki',
      'wiki:wiki:readonly',
      'wiki:node:retrieve',
    ]);
  });

  it('marks the connection as reauth_required when refresh response still misses required docs scopes', async () => {
    const docStore = new InMemoryJsonDocStore();
    const connection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      provider: 'feishu',
      workspace_id: null,
      custom_domain: null,
      kind: 'oauth_account',
      display_name: 'Feishu',
      note: null,
      status: 'active',
      fields: [
        { key: 'access_token', value: 'access_old', description: null, secret: true },
        { key: 'refresh_token', value: 'refresh_old', description: null, secret: true },
      ],
      account_identity: null,
      scopes: ['offline_access'],
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'access_new',
        refresh_token: 'refresh_new',
        expires_in: 3600,
        scope: 'offline_access auth:user.id:read',
      }),
    })));

    const refreshed = await refreshFeishuOAuth({
      docStore,
      userId: 'user_1',
      connectionId: connection.id,
    });

    expect(refreshed.status).toBe('reauth_required');
    expect(refreshed.reauth_reason).toBe('missing_scopes');
    expect(refreshed.missing_scopes).toEqual([
      'search:docs:read',
      'wiki:wiki',
      'wiki:wiki:readonly',
      'wiki:node:retrieve',
    ]);
    expect(refreshed.last_error).toBe(
      'feishu_missing_required_scopes:search:docs:read,wiki:wiki,wiki:wiki:readonly,wiki:node:retrieve',
    );

    const stored = await getUserExternalConnection(docStore, 'user_1', connection.id);
    expect(stored?.status).toBe('reauth_required');
    expect(stored?.scopes).toEqual(['offline_access', 'auth:user.id:read']);
  });

  it('marks the connection as refresh_failed when the token exchange fails', async () => {
    const docStore = new InMemoryJsonDocStore();
    const connection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      provider: 'feishu',
      workspace_id: null,
      custom_domain: null,
      kind: 'oauth_account',
      display_name: 'Feishu',
      note: null,
      status: 'active',
      fields: [
        { key: 'access_token', value: 'access_old', description: null, secret: true },
        { key: 'refresh_token', value: 'refresh_old', description: null, secret: true },
      ],
      account_identity: null,
      scopes: ['offline_access'],
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
      reauth_reason: null,
      missing_scopes: null,
    });

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({ code: 99991661 }),
    })));

    const refreshed = await refreshFeishuOAuth({
      docStore,
      userId: 'user_1',
      connectionId: connection.id,
    });

    expect(refreshed.status).toBe('reauth_required');
    expect(refreshed.reauth_reason).toBe('refresh_failed');
    expect(refreshed.missing_scopes).toBeNull();
    expect(refreshed.last_error).toBe('feishu_token_exchange_failed');
  });

  it('marks the connection as refresh_token_missing when no refresh token is stored', async () => {
    const docStore = new InMemoryJsonDocStore();
    const connection = await createUserExternalConnection(docStore, {
      user_id: 'user_1',
      provider: 'feishu',
      workspace_id: null,
      custom_domain: null,
      kind: 'oauth_account',
      display_name: 'Feishu',
      note: null,
      status: 'active',
      fields: [
        { key: 'access_token', value: 'access_old', description: null, secret: true },
      ],
      account_identity: null,
      scopes: ['offline_access'],
      expires_at: null,
      last_refreshed_at: null,
      last_used_at: null,
      last_error: null,
      reauth_reason: null,
      missing_scopes: null,
    });

    const refreshed = await refreshFeishuOAuth({
      docStore,
      userId: 'user_1',
      connectionId: connection.id,
    });

    expect(refreshed.status).toBe('reauth_required');
    expect(refreshed.reauth_reason).toBe('refresh_token_missing');
    expect(refreshed.last_error).toBe('feishu_refresh_token_missing');
    expect(refreshed.missing_scopes).toBeNull();
  });
});
