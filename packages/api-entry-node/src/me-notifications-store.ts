import type { JsonDocStorePort } from '@mbos/ports';
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

const USER_NOTIFICATIONS_COLLECTION = 'user_notifications';

type StoredUserNotificationRecord = UserNotificationRecord & {
  user_id: string;
};

function toStoredNotification(userId: string, notification: UserNotificationRecord): StoredUserNotificationRecord {
  return {
    user_id: userId,
    ...notification,
  };
}

function toPublicNotification(record: StoredUserNotificationRecord): UserNotificationRecord {
  const { user_id: _userId, ...notification } = record;
  return notification;
}

export async function getUserNotifications(
  docStore: JsonDocStorePort,
  userId: string,
): Promise<UserNotificationRecord[]> {
  const notifications = await docStore.list<StoredUserNotificationRecord>(USER_NOTIFICATIONS_COLLECTION, {
    user_id: userId,
  });
  return notifications.map(toPublicNotification);
}

export function unreadNotificationsCount(items: UserNotificationRecord[]): number {
  return items.filter((n) => !n.read_at).length;
}

export async function appendUserNotification(
  docStore: JsonDocStorePort,
  userId: string,
  payload: Omit<UserNotificationRecord, 'id' | 'created_at' | 'read_at'> & { created_at?: string; read_at?: string | null },
): Promise<UserNotificationRecord> {
  const notification: UserNotificationRecord = {
    id: `notif_${randomUUID().replace(/-/g, '')}`,
    created_at: payload.created_at ?? new Date().toISOString(),
    read_at: payload.read_at ?? null,
    ...payload,
  };
  await docStore.upsert(USER_NOTIFICATIONS_COLLECTION, notification.id, toStoredNotification(userId, notification));
  return notification;
}

export async function syncUserNotification(
  docStore: JsonDocStorePort,
  userId: string,
  payload: UserNotificationRecord,
): Promise<UserNotificationRecord> {
  const existing = await docStore.get<StoredUserNotificationRecord>(USER_NOTIFICATIONS_COLLECTION, payload.id);
  if (existing && existing.user_id === userId) {
    const next: UserNotificationRecord = {
      ...toPublicNotification(existing),
      type: payload.type,
      title: payload.title,
      body: payload.body,
      link_url: payload.link_url,
      created_at: payload.created_at,
      read_at:
        payload.read_at !== undefined && !(existing.read_at && payload.read_at === null)
          ? payload.read_at
          : existing.read_at,
    };
    await docStore.upsert(USER_NOTIFICATIONS_COLLECTION, payload.id, toStoredNotification(userId, next));
    return next;
  }
  await docStore.upsert(USER_NOTIFICATIONS_COLLECTION, payload.id, toStoredNotification(userId, { ...payload }));
  return payload;
}

export async function markNotificationRead(
  docStore: JsonDocStorePort,
  userId: string,
  notificationId: string,
): Promise<UserNotificationRecord | null> {
  const found = await docStore.get<StoredUserNotificationRecord>(USER_NOTIFICATIONS_COLLECTION, notificationId);
  if (!found || found.user_id !== userId) return null;
  const updated: UserNotificationRecord = {
    ...toPublicNotification(found),
    read_at: new Date().toISOString(),
  };
  await docStore.upsert(USER_NOTIFICATIONS_COLLECTION, notificationId, toStoredNotification(userId, updated));
  return updated;
}

export async function markAllNotificationsRead(
  docStore: JsonDocStorePort,
  userId: string,
): Promise<number> {
  const notifications = await getUserNotifications(docStore, userId);
  const now = new Date().toISOString();
  let marked = 0;
  for (const notification of notifications) {
    if (!notification.read_at) {
      marked += 1;
      await docStore.upsert(
        USER_NOTIFICATIONS_COLLECTION,
        notification.id,
        toStoredNotification(userId, {
          ...notification,
          read_at: now,
        }),
      );
    }
  }
  return marked;
}
