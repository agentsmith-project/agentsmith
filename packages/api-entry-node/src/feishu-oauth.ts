import { randomUUID } from 'node:crypto';
import type { JsonDocStorePort } from '@mbos/ports';
import {
  upsertUserExternalConnectionByProvider,
  getUserExternalConnection,
  type UserExternalConnectionRecord,
} from './user-external-connections-store.js';

type FeishuAuthSession = {
  userId: string;
  state: string;
  redirectUri: string;
  expiresAt: number;
};

const FEISHU_AUTH_SESSIONS = new Map<string, FeishuAuthSession>();

type FeishuTokenPayload = {
  access_token: string;
  refresh_token?: string | null;
  expires_in?: number | null;
  refresh_expires_in?: number | null;
  scope?: string | null;
  token_type?: string | null;
  open_id?: string | null;
  union_id?: string | null;
  name?: string | null;
  email?: string | null;
};

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name.toLowerCase()}_not_configured`);
  }
  return value;
}

export function getFeishuOAuthConfig() {
  const clientId = process.env.FEISHU_APP_ID?.trim() ?? '';
  const clientSecret = process.env.FEISHU_APP_SECRET?.trim() ?? '';
  const redirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI?.trim()
    || process.env.FEISHU_REDIRECT_URI?.trim()
    || 'http://127.0.0.1:18181/callback';
  const authorizeUrl = process.env.FEISHU_OAUTH_AUTHORIZE_URL?.trim() || 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
  const tokenUrl = process.env.FEISHU_OAUTH_TOKEN_URL?.trim() || 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
  const scopesRaw = process.env.FEISHU_OAUTH_SCOPES?.trim()
    || 'offline_access';
  const scopes = scopesRaw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri,
    authorizeUrl,
    tokenUrl,
    scopes,
  };
}

export function getFeishuOAuthFrontendConfig() {
  const webBaseUrl = process.env.MBOS_WEB_BASE_URL?.trim() || 'http://localhost:3001';
  const locale = process.env.MBOS_DEFAULT_LOCALE?.trim() || 'zh-CN';
  return {
    webBaseUrl: webBaseUrl.replace(/\/+$/, ''),
    locale,
  };
}

function parseFeishuTokenResponse(payload: unknown): FeishuTokenPayload {
  const raw = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const nested = raw.data && typeof raw.data === 'object'
    ? raw.data as Record<string, unknown>
    : raw;
  const accessToken = typeof nested.access_token === 'string' ? nested.access_token : '';
  if (!accessToken) {
    throw new Error('feishu_token_exchange_failed');
  }
  return {
    access_token: accessToken,
    refresh_token: typeof nested.refresh_token === 'string' ? nested.refresh_token : null,
    expires_in: typeof nested.expires_in === 'number' ? nested.expires_in : null,
    refresh_expires_in: typeof nested.refresh_expires_in === 'number' ? nested.refresh_expires_in : null,
    scope: typeof nested.scope === 'string' ? nested.scope : null,
    token_type: typeof nested.token_type === 'string' ? nested.token_type : null,
    open_id: typeof nested.open_id === 'string' ? nested.open_id : null,
    union_id: typeof nested.union_id === 'string' ? nested.union_id : null,
    name: typeof nested.name === 'string' ? nested.name : null,
    email: typeof nested.email === 'string' ? nested.email : null,
  };
}

async function exchangeFeishuToken(body: Record<string, unknown>): Promise<FeishuTokenPayload> {
  const config = getFeishuOAuthConfig();
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('feishu_token_exchange_failed');
  }
  return parseFeishuTokenResponse(payload);
}

export function startFeishuOAuth(userId: string) {
  const config = getFeishuOAuthConfig();
  if (!config.configured) {
    throw new Error('feishu_oauth_not_configured');
  }
  const state = `feishu_${randomUUID().replace(/-/g, '')}`;
  const session: FeishuAuthSession = {
    userId,
    state,
    redirectUri: config.redirectUri,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  FEISHU_AUTH_SESSIONS.set(state, session);
  const authUrl = new URL(config.authorizeUrl);
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', config.redirectUri);
  authUrl.searchParams.set('scope', config.scopes.join(' '));
  authUrl.searchParams.set('state', state);
  return {
    authorization_url: authUrl.toString(),
    state,
    redirect_uri: config.redirectUri,
    expires_at: new Date(session.expiresAt).toISOString(),
    scopes: config.scopes,
  };
}

function parseCallbackInput(callbackUrl?: string, code?: string, state?: string) {
  if (callbackUrl?.trim()) {
    const parsed = new URL(callbackUrl.trim());
    return {
      code: parsed.searchParams.get('code') ?? '',
      state: parsed.searchParams.get('state') ?? '',
    };
  }
  return {
    code: code?.trim() ?? '',
    state: state?.trim() ?? '',
  };
}

async function completeFeishuOAuthInternal(args: {
  docStore: JsonDocStorePort;
  userId?: string;
  callbackUrl?: string;
  code?: string;
  state?: string;
}): Promise<UserExternalConnectionRecord> {
  const parsed = parseCallbackInput(args.callbackUrl, args.code, args.state);
  if (!parsed.code || !parsed.state) {
    throw new Error('feishu_callback_missing_code_or_state');
  }
  const session = FEISHU_AUTH_SESSIONS.get(parsed.state);
  if (!session || session.expiresAt < Date.now()) {
    throw new Error('feishu_callback_state_invalid');
  }
  if (args.userId && session.userId !== args.userId) {
    throw new Error('feishu_callback_state_invalid');
  }
  const config = getFeishuOAuthConfig();
  const token = await exchangeFeishuToken({
    grant_type: 'authorization_code',
    client_id: getRequiredEnv('FEISHU_APP_ID'),
    client_secret: getRequiredEnv('FEISHU_APP_SECRET'),
    code: parsed.code,
    redirect_uri: session.redirectUri || config.redirectUri,
  });
  FEISHU_AUTH_SESSIONS.delete(parsed.state);
  const expiresAt = token.expires_in && token.expires_in > 0
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;
  const scopes = token.scope
    ? token.scope.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
    : config.scopes;
  return upsertUserExternalConnectionByProvider(args.docStore, {
    user_id: session.userId,
    provider: 'feishu',
    kind: 'oauth_account',
    custom_domain: null,
    display_name: 'Feishu',
    note: null,
    status: 'active',
    fields: [
      {
        key: 'access_token',
        value: token.access_token,
        description: 'Feishu user access token',
        secret: true,
      },
      ...(token.refresh_token ? [{
        key: 'refresh_token',
        value: token.refresh_token,
        description: 'Feishu refresh token',
        secret: true,
      }] : []),
    ],
    account_identity: {
      external_user_id: token.union_id ?? token.open_id ?? null,
      external_name: token.name ?? null,
      external_email: token.email ?? null,
      tenant_id: null,
    },
    scopes,
    expires_at: expiresAt,
    last_refreshed_at: new Date().toISOString(),
    last_used_at: null,
    last_error: null,
  });
}

export async function completeFeishuOAuth(args: {
  docStore: JsonDocStorePort;
  userId: string;
  callbackUrl?: string;
  code?: string;
  state?: string;
}): Promise<UserExternalConnectionRecord> {
  return completeFeishuOAuthInternal(args);
}

export async function completeFeishuOAuthFromCallback(args: {
  docStore: JsonDocStorePort;
  callbackUrl?: string;
  code?: string;
  state?: string;
}): Promise<UserExternalConnectionRecord> {
  return completeFeishuOAuthInternal(args);
}

export async function refreshFeishuOAuth(args: {
  docStore: JsonDocStorePort;
  userId: string;
  connectionId: string;
}): Promise<UserExternalConnectionRecord> {
  const connection = await getUserExternalConnection(args.docStore, args.userId, args.connectionId);
  if (!connection || connection.provider !== 'feishu') {
    throw new Error('feishu_connection_not_found');
  }
  const refreshToken = connection.fields.find((field) => field.key === 'refresh_token')?.value ?? '';
  if (!refreshToken) {
    throw new Error('feishu_refresh_token_missing');
  }
  const token = await exchangeFeishuToken({
    grant_type: 'refresh_token',
    client_id: getRequiredEnv('FEISHU_APP_ID'),
    client_secret: getRequiredEnv('FEISHU_APP_SECRET'),
    refresh_token: refreshToken,
  });
  const expiresAt = token.expires_in && token.expires_in > 0
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : connection.expires_at ?? null;
  return upsertUserExternalConnectionByProvider(args.docStore, {
    ...connection,
    fields: [
      {
        key: 'access_token',
        value: token.access_token,
        description: 'Feishu user access token',
        secret: true,
      },
      ...(token.refresh_token ? [{
        key: 'refresh_token',
        value: token.refresh_token,
        description: 'Feishu refresh token',
        secret: true,
      }] : [{
        key: 'refresh_token',
        value: refreshToken,
        description: 'Feishu refresh token',
        secret: true,
      }]),
    ],
    status: 'active',
    expires_at: expiresAt,
    last_refreshed_at: new Date().toISOString(),
    last_error: null,
  });
}

export async function refreshExpiringFeishuConnections(docStore: JsonDocStorePort): Promise<void> {
  const config = getFeishuOAuthConfig();
  if (!config.configured) return;
  const items = await docStore.list<UserExternalConnectionRecord>('user_external_connections');
  for (const item of items) {
    if (item.provider !== 'feishu' || item.kind !== 'oauth_account') continue;
    if (!item.expires_at) continue;
    const expiresAtMs = Date.parse(item.expires_at);
    if (Number.isNaN(expiresAtMs)) continue;
    if (expiresAtMs - Date.now() > 5 * 60 * 1000) continue;
    try {
      await refreshFeishuOAuth({
        docStore,
        userId: item.user_id,
        connectionId: item.id,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'feishu_refresh_failed';
      await upsertUserExternalConnectionByProvider(docStore, {
        ...item,
        status: 'reauth_required',
        last_error: message,
      });
    }
  }
}
