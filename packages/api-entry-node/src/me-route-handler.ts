import type http from 'node:http';
import type { AuthenticatedUser } from './auth.js';
import { json, readBody } from './http-utils.js';

interface UserProfileRecord {
  display_name?: string | null;
  timezone?: string | null;
  locale?: string | null;
  bio?: string | null;
  job_title?: string | null;
  company?: string | null;
  interests?: string[] | null;
  greeting_preference?: string | null;
  preferences_json?: Record<string, unknown> | null;
}

interface UserNotificationRecord {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link_url?: string | null;
  read_at?: string | null;
  created_at: string;
}

const profilesByUser = new Map<string, UserProfileRecord>();
const notificationsByUser = new Map<string, UserNotificationRecord[]>();

function getUserProfile(user: AuthenticatedUser): UserProfileRecord {
  return profilesByUser.get(user.id) ?? {
    display_name: user.name,
    locale: null,
    timezone: null,
    bio: null,
    job_title: null,
    company: null,
    interests: null,
    greeting_preference: null,
    preferences_json: null,
  };
}

function setUserProfile(userId: string, profile: UserProfileRecord): void {
  profilesByUser.set(userId, profile);
}

function getUserNotifications(userId: string): UserNotificationRecord[] {
  let notifications = notificationsByUser.get(userId);
  if (!notifications) {
    notifications = [];
    notificationsByUser.set(userId, notifications);
  }
  return notifications;
}

function unreadCount(items: UserNotificationRecord[]): number {
  return items.filter((n) => !n.read_at).length;
}

export async function handleMeRoute(args: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  method: string;
  requestUrl: URL;
  user: AuthenticatedUser;
}): Promise<boolean> {
  const { req, res, method, requestUrl, user } = args;
  const pathname = requestUrl.pathname;
  if (!pathname.startsWith('/api/v1/me/')) {
    return false;
  }

  if (pathname === '/api/v1/me/profile') {
    if (method === 'GET') {
      json(res, 200, getUserProfile(user));
      return true;
    }
    if (method === 'PATCH') {
      const body = (await readBody(req)) as Record<string, unknown> | null;
      const current = getUserProfile(user);
      const next: UserProfileRecord = {
        ...current,
        ...(body ?? {}),
      };
      setUserProfile(user.id, next);
      json(res, 200, next);
      return true;
    }
    json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
    return true;
  }

  if (pathname === '/api/v1/me/notifications') {
    if (method !== 'GET') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const all = [...getUserNotifications(user.id)].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const unreadOnly = requestUrl.searchParams.get('unread_only') === 'true';
    const limit = Math.max(0, Math.min(200, Number.parseInt(requestUrl.searchParams.get('limit') ?? '20', 10) || 20));
    const offset = Math.max(0, Number.parseInt(requestUrl.searchParams.get('offset') ?? '0', 10) || 0);
    const filtered = unreadOnly ? all.filter((n) => !n.read_at) : all;
    json(res, 200, {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      unread_count: unreadCount(all),
    });
    return true;
  }

  if (pathname === '/api/v1/me/notifications/unread-count') {
    if (method !== 'GET') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    json(res, 200, { unread_count: unreadCount(getUserNotifications(user.id)) });
    return true;
  }

  if (pathname === '/api/v1/me/notifications/read-all') {
    if (method !== 'POST') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const notifications = getUserNotifications(user.id);
    const now = new Date().toISOString();
    let markedCount = 0;
    for (const n of notifications) {
      if (!n.read_at) {
        n.read_at = now;
        markedCount += 1;
      }
    }
    json(res, 200, { marked_count: markedCount });
    return true;
  }

  const markReadMatch = pathname.match(/^\/api\/v1\/me\/notifications\/([^/]+)\/read$/);
  if (markReadMatch) {
    if (method !== 'POST') {
      json(res, 405, { error_code: 'METHOD_NOT_ALLOWED', message: 'method_not_allowed' });
      return true;
    }
    const id = decodeURIComponent(markReadMatch[1] ?? '');
    const notifications = getUserNotifications(user.id);
    const found = notifications.find((n) => n.id === id);
    if (!found) {
      json(res, 404, { error_code: 'NOT_FOUND', message: 'notification_not_found' });
      return true;
    }
    found.read_at = new Date().toISOString();
    json(res, 200, found);
    return true;
  }

  json(res, 404, { error_code: 'NOT_FOUND', message: 'Route not found' });
  return true;
}
