import { http, HttpResponse } from 'msw';
import { userProfileFixture } from '../fixtures/me';
import {
  getMockUnreadCount,
  listMockNotifications,
  markAllMockNotificationsRead,
  markMockNotificationRead,
} from '../state/me-notifications';

export const meHandlers = [
  http.get('/api/v1/me/profile', () => HttpResponse.json(userProfileFixture)),
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
