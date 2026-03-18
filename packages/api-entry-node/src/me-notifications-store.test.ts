import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  appendUserNotification,
  getUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotificationsCount,
} from './me-notifications-store.js';

describe('me-notifications-store', () => {
  it('persists notifications and unread state in docStore', async () => {
    const docStore = new InMemoryJsonDocStore();
    const userId = 'user_1';
    const created = await appendUserNotification(docStore, userId, {
      type: 'governance_override_requested',
      title: 'Governance override requested',
      body: 'incident-1',
      link_url: null,
    });

    const notifications = await getUserNotifications(docStore, userId);
    expect(notifications).toEqual([
      expect.objectContaining({
        id: created.id,
        title: 'Governance override requested',
        read_at: null,
      }),
    ]);
    expect(unreadNotificationsCount(notifications)).toBe(1);

    const marked = await markNotificationRead(docStore, userId, created.id);
    expect(marked?.read_at).toBeTruthy();
    expect(unreadNotificationsCount(await getUserNotifications(docStore, userId))).toBe(0);
  });

  it('marks all unread notifications as read', async () => {
    const docStore = new InMemoryJsonDocStore();
    const userId = 'user_2';
    await appendUserNotification(docStore, userId, {
      type: 'governance_incident_acknowledged',
      title: 'Incident acknowledged',
      body: null,
      link_url: null,
    });
    await appendUserNotification(docStore, userId, {
      type: 'governance_incident_resolved',
      title: 'Incident resolved',
      body: null,
      link_url: null,
    });

    const markedCount = await markAllNotificationsRead(docStore, userId);
    expect(markedCount).toBe(2);
    const notifications = await getUserNotifications(docStore, userId);
    expect(notifications.every((item) => Boolean(item.read_at))).toBe(true);
  });
});
