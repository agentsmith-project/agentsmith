/**
 * Me API - User profile and notifications
 */

import type { ApiClient } from '../client';

export interface UserProfile {
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

export interface UserNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link_url?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface NotificationsListResponse {
  items: UserNotification[];
  total: number;
  unread_count: number;
}

export class MeAPI {
  constructor(private client: ApiClient) {}

  async getProfile(): Promise<UserProfile> {
    return this.client.get<UserProfile>('/me/profile');
  }

  async updateProfile(data: Partial<UserProfile>): Promise<UserProfile> {
    return this.client.patch<UserProfile>('/me/profile', data);
  }

  async getNotifications(params?: {
    unread_only?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<NotificationsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.unread_only) searchParams.set('unread_only', 'true');
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));
    const query = searchParams.toString();
    return this.client.get<NotificationsListResponse>(
      `/me/notifications${query ? `?${query}` : ''}`
    );
  }

  async getUnreadCount(): Promise<{ unread_count: number }> {
    return this.client.get<{ unread_count: number }>('/me/notifications/unread-count');
  }

  async markNotificationRead(notificationId: string): Promise<UserNotification> {
    return this.client.post<UserNotification>(`/me/notifications/${notificationId}/read`);
  }

  async markAllNotificationsRead(): Promise<{ marked_count: number }> {
    return this.client.post<{ marked_count: number }>('/me/notifications/read-all');
  }
}
