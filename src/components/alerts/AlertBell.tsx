/**
 * Alert Bell Component
 *
 * Bell icon in the header showing alert count with dropdown.
 *
 * @module alerts/AlertBell
 */

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface AlertNotification {
  id: string;
  rule_id: string;
  rule_name: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  triggered_at: string;
  read: boolean;
}

export interface AlertBellProps {
  notifications: AlertNotification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onDismiss?: (id: string) => void;
}

/**
 * Alert bell component
 *
 * Displays unread alert count and shows notification dropdown.
 *
 * @param props - Component props
 * @returns Alert bell component
 */
export function AlertBell(props: AlertBellProps) {
  const { notifications, unreadCount, onMarkRead, onMarkAllRead, onDismiss } = props;
  const [open, setOpen] = useState(false);
  const t = useTranslations('alerts');

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="alert-bell">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs"
              data-testid="alert-bell-badge"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80" data-testid="alert-bell-dropdown">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="font-medium text-primary">{t('notifications')}</span>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkAllRead}
              className="h-auto p-0 text-xs text-accent"
              data-testid="mark-all-read"
            >
              {t('mark_all_read')}
            </Button>
          )}
        </div>

        <DropdownMenuSeparator />

        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-tertiary">
              <Bell className="mb-2 h-8 w-8 opacity-50" />
              <p className="text-sm">{t('no_notifications')}</p>
            </div>
          ) : (
            <div className="p-2">
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onRead={() => onMarkRead(notification.id)}
                  onDismiss={onDismiss}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {notifications.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="p-2">
              <DropdownMenuItem
                onClick={() => {
                  /* Navigate to alert center */
                }}
                className="w-full justify-center"
                data-testid="view-all-alerts"
              >
                {t('view_all_alerts')}
              </DropdownMenuItem>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface NotificationItemProps {
  notification: AlertNotification;
  onRead: () => void;
  onDismiss?: (id: string) => void;
}

function NotificationItem({ notification, onRead: _onRead, onDismiss }: NotificationItemProps) {
  const _t = useTranslations('alerts');

  const severityColors = {
    info: 'bg-blue-500',
    warning: 'bg-yellow-500',
    error: 'bg-red-500',
  };

  return (
    <div
      className={`flex gap-3 rounded-lg p-3 transition-colors hover:bg-surface ${
        notification.read ? 'opacity-60' : ''
      }`}
      data-testid={`notification-${notification.id}`}
    >
      {/* Severity indicator */}
      <div
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${severityColors[notification.severity]}`}
        data-testid={`notification-severity-${notification.severity}`}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-medium text-primary">
            {notification.rule_name}
          </p>
          {!notification.read && (
            <span className="h-2 w-2 rounded-full bg-accent" data-testid="unread-indicator" />
          )}
        </div>
        <p className="mt-1 truncate text-xs text-tertiary">{notification.message}</p>
        <p className="mt-1 text-xs text-tertiary">
          {new Date(notification.triggered_at).toLocaleString()}
        </p>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 flex-col gap-1">
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDismiss(notification.id)}
            className="h-6 w-6 p-0"
            data-testid={`dismiss-${notification.id}`}
          >
            ✕
          </Button>
        )}
      </div>
    </div>
  );
}
