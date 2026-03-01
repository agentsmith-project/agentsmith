import { randomUUID } from 'node:crypto';

export interface UserNotificationRecord {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link_url?: string | null;
  read_at?: string | null;
  created_at: string;
}

const notificationsByUser = new Map<string, UserNotificationRecord[]>();

export function getUserNotifications(userId: string): UserNotificationRecord[] {
  let notifications = notificationsByUser.get(userId);
  if (!notifications) {
    notifications = [];
    notificationsByUser.set(userId, notifications);
  }
  return notifications;
}

export function unreadNotificationsCount(items: UserNotificationRecord[]): number {
  return items.filter((n) => !n.read_at).length;
}

export function appendUserNotification(userId: string, payload: Omit<UserNotificationRecord, 'id' | 'created_at' | 'read_at'> & { created_at?: string; read_at?: string | null }): UserNotificationRecord {
  const notification: UserNotificationRecord = {
    id: `notif_${randomUUID().replace(/-/g, '')}`,
    created_at: payload.created_at ?? new Date().toISOString(),
    read_at: payload.read_at ?? null,
    ...payload,
  };
  const notifications = getUserNotifications(userId);
  notifications.unshift(notification);
  return notification;
}

export function syncUserNotification(
  userId: string,
  payload: UserNotificationRecord,
): UserNotificationRecord {
  const notifications = getUserNotifications(userId);
  const existing = notifications.find((item) => item.id === payload.id);
  if (existing) {
    existing.type = payload.type;
    existing.title = payload.title;
    existing.body = payload.body;
    existing.link_url = payload.link_url;
    existing.created_at = payload.created_at;
    if (payload.read_at !== undefined) {
      existing.read_at = payload.read_at;
    }
    return existing;
  }
  notifications.unshift({ ...payload });
  return payload;
}

export function markNotificationRead(userId: string, notificationId: string): UserNotificationRecord | null {
  const notifications = getUserNotifications(userId);
  const found = notifications.find((n) => n.id === notificationId);
  if (!found) return null;
  found.read_at = new Date().toISOString();
  return found;
}

export function markAllNotificationsRead(userId: string): number {
  const notifications = getUserNotifications(userId);
  const now = new Date().toISOString();
  let marked = 0;
  for (const n of notifications) {
    if (!n.read_at) {
      n.read_at = now;
      marked += 1;
    }
  }
  return marked;
}
