'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/lib/i18n/routing';
import { Bell, CheckCheck } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MeAPI, getApiClient } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils/formatters';
import type { UserNotification } from '@/lib/api/endpoints/me';

export function NotificationCenter() {
  const t = useTranslations('notifications');
  const [open, setOpen] = React.useState(false);
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new MeAPI(getApiClient()), []);

  const { data, isLoading } = useQuery({
    queryKey: ['me', 'notifications'],
    queryFn: () => api.getNotifications({ limit: 20 }),
    enabled: open,
  });

  const { data: unreadData } = useQuery({
    queryKey: ['me', 'notifications', 'unread-count'],
    queryFn: () => api.getUnreadCount(),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me', 'notifications'] });
    },
  });

  const unreadCount = unreadData?.unread_count ?? data?.unread_count ?? 0;
  const items = data?.items ?? [];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="topbar__notifications"
          className="relative p-2 hover:bg-hover rounded-md text-icon-default hover:text-foreground transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          aria-label={t('title')}
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-medium bg-error text-error-foreground rounded-full border-2 border-panel">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-subtle">
          <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-1 text-xs"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              <CheckCheck className="w-3.5 h-3.5 mr-1" />
              {t('mark_all_read')}
            </Button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-tertiary">
              Loading...
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-tertiary">
              {t('empty')}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {items.map((notif) => (
                <NotificationItem
                  key={notif.id}
                  notif={notif}
                  onRead={() => markReadMutation.mutate(notif.id)}
                  onLinkClick={() => setOpen(false)}
                />
              ))}
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationItem({
  notif,
  onRead,
  onLinkClick,
}: {
  notif: UserNotification;
  onRead: () => void;
  onLinkClick: () => void;
}) {
  const router = useRouter();
  const isUnread = !notif.read_at;

  const content = (
    <div
      className={`px-4 py-3 hover:bg-hover transition-colors cursor-pointer ${
        isUnread ? 'bg-accent/5' : ''
      }`}
      onClick={() => {
        if (isUnread) onRead();
        if (notif.link_url) {
          router.push(notif.link_url);
          onLinkClick();
        }
      }}
    >
      <div className="flex items-start gap-3">
        {isUnread && (
          <span className="mt-1.5 w-2 h-2 rounded-full bg-accent shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{notif.title}</p>
          {notif.body && (
            <p className="text-xs text-tertiary mt-0.5 line-clamp-2">
              {notif.body}
            </p>
          )}
          <p className="text-xs text-tertiary mt-1">
            {formatRelativeTime(notif.created_at)}
          </p>
        </div>
      </div>
    </div>
  );

  return content;
}
