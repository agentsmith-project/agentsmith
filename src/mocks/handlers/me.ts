import { http, HttpResponse } from 'msw';
import { userProfileFixture } from '../fixtures/me';
import {
  appendMockNotification,
  getMockUnreadCount,
  listMockNotifications,
  markAllMockNotificationsRead,
  markMockNotificationRead,
} from '../state/me-notifications';

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

function getRequestUserId(request: Request): string {
  const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authHeader) return 'user_001';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token.startsWith('mock_token_')) return 'user_001';
  const rest = token.slice('mock_token_'.length);
  const separator = rest.lastIndexOf('_');
  if (separator <= 0) return 'user_001';
  return rest.slice(0, separator);
}

export const meHandlers = [
  http.get('/api/v1/me/profile', () => HttpResponse.json(userProfileFixture)),
  http.get('/api/v1/me/external-connections', ({ request }) => {
    const provider = readMockValue(request, 'x-mock-connection-provider', 'ags_mock_connection_provider');
    const workspaceId = readMockValue(request, 'x-mock-connection-workspace', 'ags_mock_connection_workspace') ?? 'ws_default';
    const connectedEmail = readMockValue(request, 'x-mock-connection-email', 'ags_mock_connection_email');

    if (provider === 'feishu' && connectedEmail) {
      return HttpResponse.json({
        items: [{
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
        }],
        total: 1,
      });
    }

    return HttpResponse.json({ items: [], total: 0 });
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
