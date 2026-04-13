import { http, HttpResponse } from 'msw';
import { userProfileFixture } from '../fixtures/me';
import {
  appendMockNotification,
  getMockUnreadCount,
  listMockNotifications,
  markAllMockNotificationsRead,
  markMockNotificationRead,
} from '../state/me-notifications';
import {
  buildMockExternalConnectionId,
  clearMockExternalConnections,
  createMockExternalConnection,
  deleteMockExternalConnection,
  listMockExternalConnections,
  seedMockExternalConnections,
  toStoredExternalConnectionField,
  updateMockExternalConnection,
} from '../state/me-external-connections';
import { readMockAuthActorFromRequest } from '../utils/mock-auth-token';

type MockExternalConnectionSeed = Parameters<typeof seedMockExternalConnections>[1][number];

function readCookieValue(request: Request, key: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  const value = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));
  if (!value) return null;
  return decodeURIComponent(value.slice(key.length + 1));
}

function readMockValue(request: Request, header: string, cookie: string): string | null {
  return request.headers.get(header) ?? readCookieValue(request, cookie);
}

function readMockJsonArray(request: Request, header: string): Array<Record<string, unknown>> | null {
  const raw = readMockValue(request, header, header);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : null;
  } catch {
    return null;
  }
}

function getRequestUserId(request: Request): string {
  return readMockAuthActorFromRequest(request).userId;
}

export function resolveMockExternalConnectionsForRequest(args: {
  request: Request;
  storedConnections: ReturnType<typeof listMockExternalConnections>;
}) {
  if (args.storedConnections.length > 0) {
    return args.storedConnections;
  }

  const provider = readMockValue(args.request, 'x-mock-connection-provider', 'ags_mock_connection_provider');
  const workspaceId = readMockValue(args.request, 'x-mock-connection-workspace', 'ags_mock_connection_workspace') ?? 'ws_default';
  const connectedEmail = readMockValue(args.request, 'x-mock-connection-email', 'ags_mock_connection_email');
  const connectionDisplayName = readMockValue(args.request, 'x-mock-connection-display-name', 'ags_mock_connection_display_name');
  const connectionKind = readMockValue(args.request, 'x-mock-connection-kind', 'ags_mock_connection_kind');
  const connectionStatus = readMockValue(args.request, 'x-mock-connection-status', 'ags_mock_connection_status');
  const connectionNote = readMockValue(args.request, 'x-mock-connection-note', 'ags_mock_connection_note');
  const connectionCustomDomain = readMockValue(args.request, 'x-mock-connection-custom-domain', 'ags_mock_connection_custom_domain');
  const connectionFields = readMockJsonArray(args.request, 'x-mock-connection-fields');
  const connectionScopesRaw = readMockValue(args.request, 'x-mock-connection-scopes', 'ags_mock_connection_scopes');
  const connectionScopes = connectionScopesRaw ? (() => {
    try {
      const parsed = JSON.parse(connectionScopesRaw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : null;
    } catch {
      return null;
    }
  })() : null;

  if (provider === 'feishu' && connectedEmail) {
    return [{
      id: 'conn_feishu_visual',
      provider: 'feishu',
      kind: 'oauth_account',
      status: 'active',
      display_name: 'Visual Feishu Connection',
      note: null,
      custom_domain: null,
      fields: [],
      account_identity: {
        external_id: 'ou_visual_user',
        external_name: connectedEmail.split('@')[0],
        external_email: connectedEmail,
      },
      scopes: ['offline_access'],
      expires_at: null,
      last_refreshed_at: '2026-03-19T08:00:00.000Z',
      last_error: null,
      workspace_id: workspaceId,
      created_at: '2026-03-19T08:00:00.000Z',
      updated_at: '2026-03-19T08:00:00.000Z',
    }];
  }

  if (provider === 'custom' && connectionDisplayName && connectionFields) {
    const displayName = connectionDisplayName.trim();
    const customDomain = connectionCustomDomain?.trim() || null;
    return [{
      id: buildMockExternalConnectionId(displayName, 'custom'),
      provider: 'custom',
      kind: (connectionKind === 'ssh_keypair' || connectionKind === 'oauth_account' || connectionKind === 'secret_bundle')
        ? connectionKind
        : 'secret_bundle',
      status: connectionStatus === 'expired' || connectionStatus === 'reauth_required' || connectionStatus === 'error'
        ? connectionStatus
        : 'active',
      display_name: displayName,
      note: connectionNote?.trim() || null,
      custom_domain: customDomain,
      fields: connectionFields.map((field) =>
        toStoredExternalConnectionField({
          key: typeof field.key === 'string' ? field.key : '',
          value: typeof field.value === 'string' ? field.value : '',
          description: typeof field.description === 'string' ? field.description : null,
          secret: field.secret !== false,
        })
      ).filter((field) => field.key.length > 0),
      account_identity: null,
      scopes: connectionScopes,
      expires_at: null,
      last_refreshed_at: null,
      last_error: null,
      workspace_id: null,
      created_at: '2026-03-19T08:00:00.000Z',
      updated_at: '2026-03-19T08:00:00.000Z',
    }];
  }

  return [];
}

export function normalizeMockExternalConnectionSeed(
  userId: string,
  connection: MockExternalConnectionSeed,
): MockExternalConnectionSeed {
  return {
    ...connection,
    user_id: userId,
    custom_domain: connection.custom_domain ?? null,
    note: connection.note ?? null,
    status: connection.status ?? 'active',
    fields: (connection.fields ?? []).map((field) => toStoredExternalConnectionField(field)),
    account_identity: connection.account_identity ?? null,
    scopes: connection.scopes ?? null,
    expires_at: connection.expires_at ?? null,
    last_refreshed_at: connection.last_refreshed_at ?? null,
    last_used_at: connection.last_used_at ?? null,
    last_error: connection.last_error ?? null,
    reauth_reason: connection.reauth_reason ?? null,
    missing_scopes: connection.missing_scopes ?? null,
    workspace_id: connection.workspace_id ?? null,
  };
}

export const meHandlers = [
  http.get('/api/v1/me/profile', () => HttpResponse.json(userProfileFixture)),
  http.get('/api/v1/me/external-connections', ({ request }) => {
    const userId = getRequestUserId(request);
    const storedConnections = listMockExternalConnections(userId);
    const items = resolveMockExternalConnectionsForRequest({ request, storedConnections });
    return HttpResponse.json({ items, total: items.length });
  }),
  http.post('/api/v1/me/external-connections', async ({ request }) => {
    const userId = getRequestUserId(request);
    const body = (await request.json().catch(() => ({}))) as Parameters<typeof createMockExternalConnection>[1];
    return HttpResponse.json(createMockExternalConnection(userId, body), { status: 201 });
  }),
  http.post('/api/test/me/external-connections/seed', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      user_id?: string;
      connections?: Parameters<typeof seedMockExternalConnections>[1];
      connection?: Parameters<typeof seedMockExternalConnections>[1][number];
      replace_existing?: boolean;
    };
    const userId = typeof body.user_id === 'string' && body.user_id.trim().length > 0
      ? body.user_id.trim()
      : 'user_001';
    if (body.replace_existing === true) {
      clearMockExternalConnections(userId);
    }
    const connections = Array.isArray(body.connections)
      ? body.connections
      : body.connection
        ? [body.connection]
        : [];
    const seeded = seedMockExternalConnections(
      userId,
      connections.map((connection) => normalizeMockExternalConnectionSeed(userId, connection))
    );
    return HttpResponse.json({
      ok: true,
      count: seeded.length,
      items: seeded,
      id: seeded[0]?.id ?? null,
    });
  }),
  http.patch('/api/v1/me/external-connections/:id', async ({ params, request }) => {
    const userId = getRequestUserId(request);
    const body = (await request.json().catch(() => ({}))) as Parameters<typeof updateMockExternalConnection>[2];
    const updated = updateMockExternalConnection(userId, params.id as string, body);
    if (!updated) {
      return HttpResponse.json({ error: 'external_connection_not_found' }, { status: 404 });
    }
    return HttpResponse.json(updated);
  }),
  http.delete('/api/v1/me/external-connections/:id', ({ params, request }) => {
    const userId = getRequestUserId(request);
    const deleted = deleteMockExternalConnection(userId, params.id as string);
    if (!deleted) {
      return HttpResponse.json({ error: 'external_connection_not_found' }, { status: 404 });
    }
    return HttpResponse.json({ ok: true });
  }),
  http.patch('/api/v1/me/profile', async ({ request }) => {
    const body: any = await request.json().catch(() => ({}));
    Object.assign(userProfileFixture, body);
    return HttpResponse.json(userProfileFixture);
  }),
  http.get('/api/v1/me/notifications', ({ request }) => {
    const url = new URL(request.url);
    const userId = getRequestUserId(request);
    const unreadOnly = url.searchParams.get('unread_only') === 'true';
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);

    const notifications = listMockNotifications(userId);
    const filtered = unreadOnly ? notifications.filter((n) => !n.read_at) : notifications;
    const items = filtered.slice(offset, offset + limit);

    return HttpResponse.json({
      items,
      total: filtered.length,
      unread_count: getMockUnreadCount(userId),
    });
  }),
  http.get('/api/v1/me/notifications/unread-count', ({ request }) =>
    HttpResponse.json({ unread_count: getMockUnreadCount(getRequestUserId(request)) }),
  ),
  http.post('/api/v1/me/notifications/:id/read', ({ params, request }) => {
    const userId = getRequestUserId(request);
    const id = params.id as string;
    const notification = markMockNotificationRead(userId, id);
    if (!notification) {
      return HttpResponse.json({ error: 'notification_not_found' }, { status: 404 });
    }
    return HttpResponse.json(notification);
  }),
  http.post('/api/v1/me/notifications/read-all', ({ request }) => {
    return HttpResponse.json({ marked_count: markAllMockNotificationsRead(getRequestUserId(request)) });
  }),
  http.post('/api/test/me/notifications/seed', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      user_id?: string;
      notifications?: Array<{
        id?: string;
        type?: string;
        title?: string;
        body?: string | null;
        link_url?: string | null;
        read_at?: string | null;
        created_at?: string;
      }>;
    };
    const userId = typeof body.user_id === 'string' && body.user_id.trim().length > 0
      ? body.user_id.trim()
      : 'user_001';
    const notifications = Array.isArray(body.notifications) ? body.notifications : [];
    for (const notification of notifications) {
      appendMockNotification(userId, {
        id: notification.id ?? `notif_seed_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: notification.type ?? 'system_notice',
        title: notification.title ?? 'Seeded notification',
        body: notification.body ?? null,
        link_url: notification.link_url ?? null,
        read_at: notification.read_at ?? null,
        created_at: notification.created_at ?? new Date().toISOString(),
      });
    }
    return HttpResponse.json({ ok: true, count: notifications.length });
  }),
];

export { appendMockNotification };
