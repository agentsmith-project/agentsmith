import { userNotificationFixtures } from '../fixtures/me';

export type MockUserNotification = (typeof userNotificationFixtures)[number];

declare global {
  var __MBOS_MSW_NOTIFICATIONS__: MockUserNotification[] | undefined;
}

function notificationStore(): MockUserNotification[] {
  if (!globalThis.__MBOS_MSW_NOTIFICATIONS__) {
    globalThis.__MBOS_MSW_NOTIFICATIONS__ = userNotificationFixtures.map((item) => ({ ...item }));
  }
  return globalThis.__MBOS_MSW_NOTIFICATIONS__;
}

export function listMockNotifications(): MockUserNotification[] {
  return notificationStore();
}

export function appendMockNotification(notification: MockUserNotification) {
  notificationStore().unshift(notification);
}

export function getMockUnreadCount(): number {
  return notificationStore().filter((item) => !item.read_at).length;
}

export function markMockNotificationRead(id: string): MockUserNotification | null {
  const notification = notificationStore().find((item) => item.id === id);
  if (!notification) return null;
  notification.read_at = new Date().toISOString();
  return notification;
}

export function markAllMockNotificationsRead(): number {
  const now = new Date().toISOString();
  let markedCount = 0;
  for (const notification of notificationStore()) {
    if (!notification.read_at) {
      notification.read_at = now;
      markedCount += 1;
    }
  }
  return markedCount;
}
