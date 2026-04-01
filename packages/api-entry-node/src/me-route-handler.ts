import type http from 'node:http';
import type { CachePort, JsonDocStorePort } from '@mbos/ports';
import type { AuthenticatedUser } from './auth.js';
import { json, readBody } from './http-utils.js';
import {
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  syncUserNotification,
  unreadNotificationsCount,
} from './me-notifications-store.js';
import { listGovernanceIncidents } from './governance-incident-store.js';
import {
  getFeishuOAuthConfig,
  refreshFeishuOAuth,
} from './feishu-oauth.js';
import {
  createUserExternalConnection,
  deleteUserExternalConnection,
  getUserExternalConnection,
  isUserExternalConnectionKind,
  type UserExternalConnectionAccountIdentity,
  isUserExternalConnectionProvider,
  isUserExternalConnectionStatus,
  listUserExternalConnections,
  mergeExternalConnectionFields,
  normalizeExternalConnectionFields,
  normalizeStringArray,
  presentUserExternalConnection,
  updateUserExternalConnection,
} from './user-external-connections-store.js';
import { JsonDocProjectFileLibraryCatalogRepo } from './file-library-persistence.js';

interface UserProfileRecord {
  display_name?: string | null;
  timezone?: string | null;
  locale?: string | null;
  bio?: string | null;
  job_title?: string | null;
  company?: string | null;
  interests?: string[] | null;
  greeting_preference?: string | null;
  preferences_json?: Record<string, unknown> | null;
}

const USER_PROFILE_COLLECTION = 'user_profiles';
function getProviderConfig(provider: 'feishu' | 'jira' | 'github' | 'gitee' | 'custom') {
  if (provider === 'feishu') {
    const feishu = getFeishuOAuthConfig();
    return {
      provider,
      interactive_login_required: true,
      refresh_supported: true,
      callback_uri: feishu.redirectUri,
      auth_url: feishu.authorizeUrl,
      auth_configured: feishu.configured,
    };
  }
  return {
    provider,
    interactive_login_required: false,
    refresh_supported: false,
    callback_uri: null,
    auth_url: null,
    auth_configured: false,
  };
}

async function getUserProfile(docStore: JsonDocStorePort, user: AuthenticatedUser): Promise<UserProfileRecord> {
  const stored = await docStore.get<UserProfileRecord>(USER_PROFILE_COLLECTION, user.id);
  return stored ?? {
    display_name: user.name,
    locale: null,
    timezone: null,
    bio: null,
    job_title: null,
    company: null,
    interests: null,
    greeting_preference: null,
    preferences_json: null,
  };
}

async function setUserProfile(docStore: JsonDocStorePort, userId: string, profile: UserProfileRecord): Promise<void> {
  await docStore.upsert(USER_PROFILE_COLLECTION, userId, profile);
}

export async function handleMeRoute(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  requestUrl: URL;
  user: AuthenticatedUser;
  cache: CachePort;
  docStore: JsonDocStorePort;
  governanceIncidentsDir?: string;
}): Promise<boolean> {
  const { req, res, method, requestUrl, user, docStore, governanceIncidentsDir } = args;
  const pathname = requestUrl.pathname;
  if (!pathname.startsWith('/api/v1/me/')) {
    return false;
  }

  if (pathname === '/api/v1/me/profile') {
    if (method === 'GET') {
      json(res, 200, await getUserProfile(docStore, user));
      return true;
    }
    if (method === 'PATCH') {
      const body = (await readBody(req)) as Record<string, unknown> | null;
      const current = await getUserProfile(docStore, user);
      const next: UserProfileRecord = {
        ...current,
        ...(body ?? {}),
      };
      await setUserProfile(docStore, user.id, next);
      json(res, 200, next);
      return true;
    }
    json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
    return true;
  }

  if (pathname === '/api/v1/me/desktop/file-libraries') {
    if (method !== 'GET') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const items = await new JsonDocProjectFileLibraryCatalogRepo(docStore).listByOwner(user.id);
    items.sort((left, right) => right.created_at.localeCompare(left.created_at));
    json(res, 200, { items });
    return true;
  }

  if (pathname === '/api/v1/me/notifications') {
    if (method !== 'GET') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    if (governanceIncidentsDir) {
      for (const event of listGovernanceIncidents(governanceIncidentsDir).slice(0, 20)) {
        await syncUserNotification(docStore, user.id, {
          id: `governance_incident_${event.id}`,
          type: 'governance_incident',
          title: event.title,
          body: event.body,
          link_url: null,
          created_at: event.created_at,
          read_at: null,
        });
      }
    }
    const all = [...await getUserNotifications(docStore, user.id)].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const unreadOnly = requestUrl.searchParams.get('unread_only') === 'true';
    const limit = Math.max(0, Math.min(200, Number.parseInt(requestUrl.searchParams.get('limit') ?? '20', 10) || 20));
    const offset = Math.max(0, Number.parseInt(requestUrl.searchParams.get('offset') ?? '0', 10) || 0);
    const filtered = unreadOnly ? all.filter((n) => !n.read_at) : all;
    json(res, 200, {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      unread_count: unreadNotificationsCount(all),
    });
    return true;
  }

  if (pathname === '/api/v1/me/notifications/unread-count') {
    if (method !== 'GET') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    json(res, 200, { unread_count: unreadNotificationsCount(await getUserNotifications(docStore, user.id)) });
    return true;
  }

  if (pathname === '/api/v1/me/external-connections') {
    if (method === 'GET') {
      const items = (await listUserExternalConnections(docStore, user.id)).map(presentUserExternalConnection);
      json(res, 200, { items, total: items.length });
      return true;
    }

    if (method === 'POST') {
      const body = (await readBody(req)) as Record<string, unknown> | null;
      if (!body || !isUserExternalConnectionProvider(body.provider) || !isUserExternalConnectionKind(body.kind)) {
        json(res, 400, { error_code: 'INVALID_REQUEST', message: 'external_connection_invalid_provider_or_kind' });
        return true;
      }
      const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
      if (!displayName) {
        json(res, 400, { error_code: 'INVALID_REQUEST', message: 'external_connection_display_name_required' });
        return true;
      }
      if (body.provider === 'custom') {
        const customDomain = typeof body.custom_domain === 'string' ? body.custom_domain.trim() : '';
        if (!customDomain) {
          json(res, 400, { error_code: 'INVALID_REQUEST', message: 'external_connection_custom_domain_required' });
          return true;
        }
      }
      const record = await createUserExternalConnection(docStore, {
        user_id: user.id,
        provider: body.provider,
        custom_domain: typeof body.custom_domain === 'string' ? body.custom_domain.trim() || null : null,
        kind: body.kind,
        display_name: displayName,
        note: typeof body.note === 'string' ? body.note.trim() || null : null,
        status: isUserExternalConnectionStatus(body.status) ? body.status : 'active',
        fields: normalizeExternalConnectionFields(body.fields) ?? [],
        account_identity: body.account_identity && typeof body.account_identity === 'object'
          ? body.account_identity as UserExternalConnectionAccountIdentity
          : null,
        scopes: normalizeStringArray(body.scopes) ?? null,
        expires_at: typeof body.expires_at === 'string' ? body.expires_at : null,
        last_refreshed_at: null,
        last_used_at: null,
        last_error: typeof body.last_error === 'string' ? body.last_error : null,
      });
      json(res, 201, presentUserExternalConnection(record));
      return true;
    }

    json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
    return true;
  }

  const providerMatch = pathname.match(/^\/api\/v1\/me\/external-connections\/providers\/([^/]+)$/);
  if (providerMatch) {
    if (method !== 'GET') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const provider = decodeURIComponent(providerMatch[1] ?? '');
    if (!isUserExternalConnectionProvider(provider)) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'provider_not_found' });
      return true;
    }
    json(res, 200, getProviderConfig(provider));
    return true;
  }

  const connectionMatch = pathname.match(/^\/api\/v1\/me\/external-connections\/([^/]+)$/);
  if (connectionMatch) {
    const connectionId = decodeURIComponent(connectionMatch[1] ?? '');
    const existing = await getUserExternalConnection(docStore, user.id, connectionId);
    if (!existing) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'external_connection_not_found' });
      return true;
    }

    if (method === 'PATCH') {
      const body = (await readBody(req)) as Record<string, unknown> | null;
      const nextRecord = await updateUserExternalConnection(docStore, user.id, connectionId, {
        custom_domain: body?.custom_domain === undefined
          ? existing.custom_domain
          : typeof body.custom_domain === 'string'
            ? body.custom_domain.trim() || null
            : null,
        display_name: typeof body?.display_name === 'string' && body.display_name.trim()
          ? body.display_name.trim()
          : existing.display_name,
        note: body?.note === undefined
          ? existing.note
          : typeof body.note === 'string'
            ? body.note.trim() || null
            : null,
        status: isUserExternalConnectionStatus(body?.status) ? body.status : existing.status,
        fields: mergeExternalConnectionFields(existing.fields, body?.fields) ?? existing.fields,
        account_identity: body?.account_identity === undefined
          ? existing.account_identity
          : body.account_identity && typeof body.account_identity === 'object'
            ? body.account_identity as UserExternalConnectionAccountIdentity
            : null,
        scopes: body?.scopes === undefined ? existing.scopes : normalizeStringArray(body.scopes) ?? null,
        expires_at: body?.expires_at === undefined
          ? existing.expires_at
          : typeof body.expires_at === 'string'
            ? body.expires_at
            : null,
        last_error: body?.last_error === undefined
          ? existing.last_error
          : typeof body.last_error === 'string'
            ? body.last_error
            : null,
      });
      json(res, 200, presentUserExternalConnection(nextRecord ?? existing));
      return true;
    }

    if (method === 'DELETE') {
      await deleteUserExternalConnection(docStore, user.id, connectionId);
      res.statusCode = 204;
      res.end();
      return true;
    }

    json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
    return true;
  }

  const refreshMatch = pathname.match(/^\/api\/v1\/me\/external-connections\/([^/]+)\/refresh$/);
  if (refreshMatch) {
    if (method !== 'POST') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const connectionId = decodeURIComponent(refreshMatch[1] ?? '');
    try {
      const updated = await refreshFeishuOAuth({
        docStore,
        userId: user.id,
        connectionId,
      });
      json(res, 200, presentUserExternalConnection(updated));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'external_connection_refresh_failed';
      json(res, 400, { error_code: 'INVALID_REQUEST', message });
    }
    return true;
  }

  if (pathname === '/api/v1/me/notifications/read-all') {
    if (method !== 'POST') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const markedCount = await markAllNotificationsRead(docStore, user.id);
    json(res, 200, { marked_count: markedCount });
    return true;
  }

  const markReadMatch = pathname.match(/^\/api\/v1\/me\/notifications\/([^/]+)\/read$/);
  if (markReadMatch) {
    if (method !== 'POST') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const id = decodeURIComponent(markReadMatch[1] ?? '');
    const found = await markNotificationRead(docStore, user.id, id);
    if (!found) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'notification_not_found' });
      return true;
    }
    json(res, 200, found);
    return true;
  }

  json(res, 404, { error_code: 'NOT_FOUND', message: 'Route not found' });
  return true;
}
