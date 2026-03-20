import { randomUUID } from 'node:crypto';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import {
  getUserExternalConnection,
  type UserExternalConnectionRecord,
  upsertUserExternalConnectionByProvider,
} from './user-external-connections-store.js';
import {
  getWorkspaceFeishuIntegration,
  type WorkspaceFeishuIntegrationRecord,
  upsertWorkspaceFeishuIntegration,
} from './workspace-feishu-settings-store.js';

type WorkspaceFeishuOAuthIntent = 'admin_verify' | 'user_connect';

type WorkspaceFeishuAuthSession = {
  userId: string;
  userEmail: string;
  workspaceId: string;
  state: string;
  redirectUri: string;
  intent: WorkspaceFeishuOAuthIntent;
  postRedirectPath: string;
  expiresAt: number;
};

type WorkspaceFeishuAuthResult = {
  userId: string;
  workspaceId: string;
  intent: WorkspaceFeishuOAuthIntent;
  redirectPath: string;
  connectionId?: string | null;
  expiresAt: number;
};

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

const FEISHU_AUTH_STATE_PREFIX = 'workspace:feishu:oauth:state:';
const FEISHU_AUTH_RESULT_PREFIX = 'workspace:feishu:oauth:result:';

function oauthStateKey(state: string): string {
  return `${FEISHU_AUTH_STATE_PREFIX}${state}`;
}

function oauthResultKey(state: string): string {
  return `${FEISHU_AUTH_RESULT_PREFIX}${state}`;
}

function getFeishuEndpoints() {
  return {
    authorizeUrl:
      process.env.FEISHU_OAUTH_AUTHORIZE_URL?.trim()
      || 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    tokenUrl:
      process.env.FEISHU_OAUTH_TOKEN_URL?.trim()
      || 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
    scopes:
      (process.env.FEISHU_OAUTH_SCOPES?.trim() || 'offline_access')
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
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

async function exchangeFeishuToken(args: {
  tokenUrl: string;
  appId: string;
  appSecret: string;
  body: Record<string, unknown>;
}): Promise<FeishuTokenPayload> {
  const response = await fetch(args.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: args.appId,
      client_secret: args.appSecret,
      ...args.body,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error('feishu_token_exchange_failed');
  }
  return parseFeishuTokenResponse(payload);
}

async function writeWorkspaceFeishuOAuthSession(
  cache: CachePort,
  session: WorkspaceFeishuAuthSession,
): Promise<void> {
  const ttlSeconds = Math.max(1, Math.ceil((session.expiresAt - Date.now()) / 1000));
  await cache.set(oauthStateKey(session.state), JSON.stringify(session), ttlSeconds);
}

async function readWorkspaceFeishuOAuthSession(
  cache: CachePort,
  state: string,
): Promise<WorkspaceFeishuAuthSession | null> {
  const raw = await cache.get(oauthStateKey(state));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceFeishuAuthSession;
    if (
      typeof parsed?.userId !== 'string'
      || typeof parsed?.userEmail !== 'string'
      || typeof parsed?.workspaceId !== 'string'
      || typeof parsed?.state !== 'string'
      || typeof parsed?.redirectUri !== 'string'
      || typeof parsed?.intent !== 'string'
      || typeof parsed?.postRedirectPath !== 'string'
      || typeof parsed?.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function deleteWorkspaceFeishuOAuthSession(cache: CachePort, state: string): Promise<void> {
  await cache.del(oauthStateKey(state));
}

async function writeWorkspaceFeishuOAuthResult(
  cache: CachePort,
  state: string,
  result: WorkspaceFeishuAuthResult,
): Promise<void> {
  const ttlSeconds = Math.max(60, Math.ceil((result.expiresAt - Date.now()) / 1000));
  await cache.set(oauthResultKey(state), JSON.stringify(result), ttlSeconds);
}

async function readWorkspaceFeishuOAuthResult(
  cache: CachePort,
  state: string,
): Promise<WorkspaceFeishuAuthResult | null> {
  const raw = await cache.get(oauthResultKey(state));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WorkspaceFeishuAuthResult;
    if (
      typeof parsed?.userId !== 'string'
      || typeof parsed?.workspaceId !== 'string'
      || typeof parsed?.intent !== 'string'
      || typeof parsed?.redirectPath !== 'string'
      || typeof parsed?.expiresAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function assertFeishuConfigured(
  record: WorkspaceFeishuIntegrationRecord | null,
): WorkspaceFeishuIntegrationRecord {
  if (!record || !record.app_id.trim() || !record.app_secret?.trim() || !record.redirect_uri.trim()) {
    throw new Error('workspace_feishu_not_configured');
  }
  return record;
}

export async function startWorkspaceFeishuOAuth(args: {
  cache: CachePort;
  docStore: JsonDocStorePort;
  workspaceId: string;
  userId: string;
  userEmail: string;
  intent: WorkspaceFeishuOAuthIntent;
  postRedirectPath: string;
  requireEnabled?: boolean;
}): Promise<{
  authorization_url: string;
  state: string;
  redirect_uri: string;
  expires_at: string;
  scopes: string[];
}> {
  const record = assertFeishuConfigured(await getWorkspaceFeishuIntegration(args.docStore, args.workspaceId));
  if (args.requireEnabled && record.status !== 'enabled') {
    throw new Error('workspace_feishu_not_enabled');
  }
  const endpoints = getFeishuEndpoints();
  const state = `workspace_feishu_${randomUUID().replace(/-/g, '')}`;
  const session: WorkspaceFeishuAuthSession = {
    userId: args.userId,
    userEmail: args.userEmail,
    workspaceId: args.workspaceId,
    state,
    redirectUri: record.redirect_uri,
    intent: args.intent,
    postRedirectPath: args.postRedirectPath,
    expiresAt: Date.now() + 10 * 60 * 1000,
  };
  await writeWorkspaceFeishuOAuthSession(args.cache, session);
  const authUrl = new URL(endpoints.authorizeUrl);
  authUrl.searchParams.set('client_id', record.app_id);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', record.redirect_uri);
  authUrl.searchParams.set('scope', endpoints.scopes.join(' '));
  authUrl.searchParams.set('state', state);
  return {
    authorization_url: authUrl.toString(),
    state,
    redirect_uri: record.redirect_uri,
    expires_at: new Date(session.expiresAt).toISOString(),
    scopes: endpoints.scopes,
  };
}

export async function completeWorkspaceFeishuOAuth(args: {
  cache: CachePort;
  docStore: JsonDocStorePort;
  workspaceId: string;
  userId: string;
  userEmail: string;
  code?: string;
  state?: string;
}): Promise<{
  intent: WorkspaceFeishuOAuthIntent;
  redirect_path: string;
  connection?: UserExternalConnectionRecord;
}> {
  return completeWorkspaceFeishuOAuthInternal({
    cache: args.cache,
    docStore: args.docStore,
    workspaceId: args.workspaceId,
    code: args.code,
    state: args.state,
    expectedUserId: args.userId,
    fallbackUserEmail: args.userEmail,
  });
}

export async function completeWorkspaceFeishuOAuthFromState(args: {
  cache: CachePort;
  docStore: JsonDocStorePort;
  workspaceId: string;
  code?: string;
  state?: string;
}): Promise<{
  intent: WorkspaceFeishuOAuthIntent;
  redirect_path: string;
  connection?: UserExternalConnectionRecord;
}> {
  return completeWorkspaceFeishuOAuthInternal({
    cache: args.cache,
    docStore: args.docStore,
    workspaceId: args.workspaceId,
    code: args.code,
    state: args.state,
  });
}

async function completeWorkspaceFeishuOAuthInternal(args: {
  cache: CachePort;
  docStore: JsonDocStorePort;
  workspaceId: string;
  code?: string;
  state?: string;
  expectedUserId?: string;
  fallbackUserEmail?: string;
}): Promise<{
  intent: WorkspaceFeishuOAuthIntent;
  redirect_path: string;
  connection?: UserExternalConnectionRecord;
}> {
  if (!args.code?.trim() || !args.state?.trim()) {
    throw new Error('feishu_callback_missing_code_or_state');
  }
  const state = args.state.trim();
  const session = await readWorkspaceFeishuOAuthSession(args.cache, state);
  if (!session || session.expiresAt < Date.now()) {
    const completed = await readWorkspaceFeishuOAuthResult(args.cache, state);
    if (
      completed
      && completed.expiresAt >= Date.now()
      && completed.workspaceId === args.workspaceId
      && (!args.expectedUserId || completed.userId === args.expectedUserId)
    ) {
      const connection = completed.connectionId
        ? await getUserExternalConnection(args.docStore, completed.userId, completed.connectionId)
        : null;
      return {
        intent: completed.intent,
        redirect_path: completed.redirectPath,
        ...(connection ? { connection } : {}),
      };
    }
    throw new Error('feishu_callback_state_invalid');
  }
  if (
    session.workspaceId !== args.workspaceId
    || (args.expectedUserId && session.userId !== args.expectedUserId)
  ) {
    throw new Error('feishu_callback_state_invalid');
  }
  const record = assertFeishuConfigured(await getWorkspaceFeishuIntegration(args.docStore, args.workspaceId));
  const endpoints = getFeishuEndpoints();
  const token = await exchangeFeishuToken({
    tokenUrl: endpoints.tokenUrl,
    appId: record.app_id,
    appSecret: record.app_secret ?? '',
    body: {
      grant_type: 'authorization_code',
      code: args.code.trim(),
      redirect_uri: session.redirectUri,
    },
  });

  if (session.intent === 'admin_verify') {
    await upsertWorkspaceFeishuIntegration(args.docStore, {
      ...record,
      status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by_user_id: session.userId,
      verified_by_email: session.userEmail || args.fallbackUserEmail || null,
      last_error: null,
      updated_at: new Date().toISOString(),
    });
    await writeWorkspaceFeishuOAuthResult(args.cache, state, {
      userId: session.userId,
      workspaceId: args.workspaceId,
      intent: session.intent,
      redirectPath: session.postRedirectPath,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
    await deleteWorkspaceFeishuOAuthSession(args.cache, state);
    return {
      intent: session.intent,
      redirect_path: session.postRedirectPath,
    };
  }

  const expiresAt = token.expires_in && token.expires_in > 0
    ? new Date(Date.now() + token.expires_in * 1000).toISOString()
    : null;
  const scopes = token.scope
    ? token.scope.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean)
    : endpoints.scopes;
  const connection = await upsertUserExternalConnectionByProvider(args.docStore, {
    user_id: session.userId,
    workspace_id: args.workspaceId,
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
  await writeWorkspaceFeishuOAuthResult(args.cache, state, {
    userId: session.userId,
    workspaceId: args.workspaceId,
    intent: session.intent,
    redirectPath: session.postRedirectPath,
    connectionId: connection.id,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  await deleteWorkspaceFeishuOAuthSession(args.cache, state);
  return {
    intent: session.intent,
    redirect_path: session.postRedirectPath,
    connection,
  };
}

export async function enableWorkspaceFeishuIntegration(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
}): Promise<WorkspaceFeishuIntegrationRecord> {
  const record = assertFeishuConfigured(await getWorkspaceFeishuIntegration(args.docStore, args.workspaceId));
  if (record.status !== 'verified' && record.status !== 'enabled') {
    throw new Error('workspace_feishu_verification_required');
  }
  return upsertWorkspaceFeishuIntegration(args.docStore, {
    ...record,
    status: 'enabled',
    last_error: null,
    updated_at: new Date().toISOString(),
  });
}

export async function refreshWorkspaceFeishuOAuth(args: {
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
  if (connection.workspace_id) {
    const record = assertFeishuConfigured(await getWorkspaceFeishuIntegration(args.docStore, connection.workspace_id));
    const endpoints = getFeishuEndpoints();
    const token = await exchangeFeishuToken({
      tokenUrl: endpoints.tokenUrl,
      appId: record.app_id,
      appSecret: record.app_secret ?? '',
      body: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
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
  throw new Error('feishu_workspace_context_required');
}
