import { http, HttpResponse } from 'msw';
import { userProfileFixture } from '../fixtures/me';
import {
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
    const unreadOnly = url.searchParams.get('unread_only') === 'true';
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);

    const notifications = listMockNotifications();
    const filtered = unreadOnly ? notifications.filter((n) => !n.read_at) : notifications;
    const items = filtered.slice(offset, offset + limit);

    return HttpResponse.json({
      items,
      total: filtered.length,
      unread_count: getMockUnreadCount(),
    });
  }),
  http.get('/api/v1/me/notifications/unread-count', () =>
    HttpResponse.json({ unread_count: getMockUnreadCount() }),
  ),
  http.post('/api/v1/me/notifications/:id/read', ({ params }) => {
    const id = params.id as string;
    const notification = markMockNotificationRead(id);
    if (!notification) {
      return HttpResponse.json({ error: 'notification_not_found' }, { status: 404 });
    }
    return HttpResponse.json(notification);
  }),
  http.post('/api/v1/me/notifications/read-all', () => {
    return HttpResponse.json({ marked_count: markAllMockNotificationsRead() });
  }),
];
