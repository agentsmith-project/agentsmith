import { http, HttpResponse } from 'msw';
import { userProfileFixture, userNotificationFixtures } from '../fixtures/me';

const notifications = [...userNotificationFixtures];

function getUnreadCount() {
  return notifications.filter((n) => !n.read_at).length;
}

export const meHandlers = [
  http.get('/api/v1/me/profile', () => HttpResponse.json(userProfileFixture)),
  http.patch('/api/v1/me/profile', async ({ request }) => {
    const body = await request.json().catch(() => ({}));
    Object.assign(userProfileFixture, body);
    return HttpResponse.json(userProfileFixture);
  }),
  http.get('/api/v1/me/notifications', ({ request }) => {
    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get('unread_only') === 'true';
    const limit = Number(url.searchParams.get('limit') ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);

    const filtered = unreadOnly ? notifications.filter((n) => !n.read_at) : notifications;
    const items = filtered.slice(offset, offset + limit);

    return HttpResponse.json({
      items,
      total: filtered.length,
      unread_count: getUnreadCount(),
    });
  }),
  http.get('/api/v1/me/notifications/unread-count', () =>
    HttpResponse.json({ unread_count: getUnreadCount() }),
  ),
  http.post('/api/v1/me/notifications/:id/read', ({ params }) => {
    const id = params.id as string;
    const notification = notifications.find((n) => n.id === id);
    if (!notification) {
      return HttpResponse.json({ error: 'notification_not_found' }, { status: 404 });
    }
    notification.read_at = new Date().toISOString();
    return HttpResponse.json(notification);
  }),
  http.post('/api/v1/me/notifications/read-all', () => {
    const now = new Date().toISOString();
    let markedCount = 0;
    notifications.forEach((notification) => {
      if (!notification.read_at) {
        notification.read_at = now;
        markedCount += 1;
      }
    });
    return HttpResponse.json({ marked_count: markedCount });
  }),
];
