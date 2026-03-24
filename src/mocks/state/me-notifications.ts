import { userNotificationFixtures } from '../fixtures/me';

export type MockUserNotification = (typeof userNotificationFixtures)[number];

declare global {
  var __MBOS_MSW_NOTIFICATIONS__: Record<string, MockUserNotification[]> | undefined;
}

function defaultNotificationsForUser(userId: string): MockUserNotification[] {
  if (userId === 'user_001') {
    return userNotificationFixtures.map((item) => ({ ...item }));
  }
  return [];
}

function notificationStore(userId: string): MockUserNotification[] {
  if (!globalThis.__MBOS_MSW_NOTIFICATIONS__) {
    globalThis.__MBOS_MSW_NOTIFICATIONS__ = {};
  }
  if (!globalThis.__MBOS_MSW_NOTIFICATIONS__[userId]) {
    globalThis.__MBOS_MSW_NOTIFICATIONS__[userId] = defaultNotificationsForUser(userId);
  }
  return globalThis.__MBOS_MSW_NOTIFICATIONS__[userId];
}

export function listMockNotifications(userId: string): MockUserNotification[] {
  return notificationStore(userId);
}

export function appendMockNotification(userId: string, notification: MockUserNotification) {
  notificationStore(userId).unshift(notification);
}

export function getMockUnreadCount(userId: string): number {
  return notificationStore(userId).filter((item) => !item.read_at).length;
}

export function markMockNotificationRead(userId: string, id: string): MockUserNotification | null {
  const notification = notificationStore(userId).find((item) => item.id === id);
  if (!notification) return null;
  notification.read_at = new Date().toISOString();
  return notification;
}

export function markAllMockNotificationsRead(userId: string): number {
  const now = new Date().toISOString();
  let markedCount = 0;
  for (const notification of notificationStore(userId)) {
    if (!notification.read_at) {
      notification.read_at = now;
      markedCount += 1;
    }
  }
  return markedCount;
}
