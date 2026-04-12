/**
 * Alert Notifications Panel Component
 *
 * Panel displaying alert notifications with actions.
 *
 * @module alerts/AlertNotificationsPanel
 */

'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Bell, X, AlertCircle, AlertTriangle, AlertOctagon, Info } from 'lucide-react';
import type { Alert } from '@/lib/types/alerts';
import { Button } from '@/components/ui/button';

export interface AlertNotificationsPanelProps {
  alerts: Alert[];
  onMarkAsRead: (alertId: string) => void;
  onDismiss: (alertId: string) => void;
  onActionClick?: (alertId: string, label: string, urlOrHandler?: string) => void;
  showDismissed?: boolean;
  loading?: boolean;
}

const severityIcons = {
  critical: AlertOctagon,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const severityColors = {
  critical: 'text-error',
  error: 'text-error',
  warning: 'text-warning',
  info: 'text-info',
};

/**
 * Alert notifications panel component
 *
 * Features:
 * - List of notifications
 * - Severity indicators
 * - Mark as read on click
 * - Dismiss action
 * - Action buttons
 * - Filters out dismissed by default
 *
 * @param props - Component props
 * @returns Notifications panel component
 */
export function AlertNotificationsPanel({
  alerts,
  onMarkAsRead,
  onDismiss,
  onActionClick,
  showDismissed = false,
  loading = false,
}: AlertNotificationsPanelProps) {
  const t = useTranslations('alerts');
  const commonT = useTranslations('common');

  const resolveActionLabel = React.useCallback((label: string) => {
    if (label.startsWith('common.')) {
      return commonT(label.slice('common.'.length));
    }
    if (label.startsWith('alerts.')) {
      return t(label.slice('alerts.'.length));
    }
    return label;
  }, [commonT, t]);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3 py-3" data-testid="alert-notifications__loading">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 border-y border-subtle/60 animate-pulse"
            data-testid={`alert-notifications__skeleton-${i}`}
          />
        ))}
      </div>
    );
  }

  // Filter out dismissed alerts unless showDismissed is true
  const visibleAlerts = showDismissed
    ? alerts
    : alerts.filter((alert) => alert.status !== 'dismissed');

  // Empty state
  if (visibleAlerts.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center border-y border-subtle/60 py-10 px-4"
        data-testid="alert-notifications__empty"
      >
        <Bell className="h-10 w-10 text-tertiary mb-3" />
        <h3 className="text-base font-medium text-foreground mb-1">{t('no_alerts')}</h3>
        <p className="text-sm text-tertiary">{t('no_alerts_description')}</p>
      </div>
    );
  }

  // Sort by severity (critical first) and created_at (newest first)
  const sortedAlerts = [...visibleAlerts].sort((a, b) => {
    const severityOrder = { critical: 0, error: 1, warning: 2, info: 3 };
    const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
      <div className="divide-y divide-subtle/60 border-y border-subtle/60" data-testid="alert-notifications">
      {sortedAlerts.map((alert) => {
        const SeverityIcon = severityIcons[alert.severity];
        const severityClass = severityColors[alert.severity];
        const isUnread = alert.status === 'unread';

        return (
          <article
            key={alert.id}
            data-testid={`alert-notifications__item--${alert.id}`}
            className={`relative py-4 transition-colors ${
              isUnread ? 'border-l-2 border-l-accent/40 pl-4' : 'pl-4'
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`shrink-0 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] ${severityClass}`}
                data-testid={`severity-badge-${alert.severity}`}
              >
                <SeverityIcon className="h-3.5 w-3.5" />
                <span>{t(`severity.${alert.severity}`)}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <h4 className="text-sm font-medium text-foreground">{alert.title}</h4>
                    {alert.resource_name ? (
                      <p className="text-xs text-secondary">
                        {t('resource')}: {alert.resource_name}
                      </p>
                    ) : null}
                  </div>
                  <span className="text-xs text-tertiary shrink-0">
                    {new Date(alert.created_at).toLocaleString()}
                  </span>
                </div>

                <p className="mt-1 text-sm text-tertiary">{alert.message}</p>

                {alert.metadata?.status === 'resolved' && (
                  <p
                    className="mt-1 text-xs text-success"
                    data-testid={`alert-status-resolved-${alert.id}`}
                  >
                    {t('resolved')}
                  </p>
                )}

                {typeof alert.metadata?.webhook_sent === 'boolean' && (
                  <p className="mt-1 text-xs text-tertiary" data-testid={`alert-webhook-${alert.id}`}>
                    webhook: {alert.metadata.webhook_sent ? 'sent' : 'failed'}
                    {typeof alert.metadata.webhook_status === 'number' ? ` (${String(alert.metadata.webhook_status)})` : ''}
                    {typeof alert.metadata.webhook_error === 'string' ? ` ${alert.metadata.webhook_error}` : ''}
                  </p>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {alert.actions?.map((action, idx) => (
                    <Button
                      key={idx}
                      onClick={() => {
                        onMarkAsRead(alert.id);
                        if (action.url && onActionClick) {
                          onActionClick(alert.id, action.label, action.url);
                        } else if (action.handler === 'dismiss') {
                          onDismiss(alert.id);
                        }
                      }}
                      variant={action.primary ? 'outline' : 'ghost'}
                      size="sm"
                      className="h-7 px-2.5 text-[12px]"
                    >
                      {resolveActionLabel(action.label)}
                    </Button>
                  ))}

                  {!alert.actions?.find((a) => a.handler === 'dismiss') && (
                    <Button
                      onClick={() => onDismiss(alert.id)}
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-tertiary hover:text-error"
                      data-testid={`dismiss-button-${alert.id}`}
                      aria-label={t('dismiss')}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {isUnread && (
              <div className="absolute top-4 right-4 h-2 w-2 rounded-full bg-accent" />
            )}
          </article>
        );
      })}
    </div>
  );
}

// Re-export Alert type for convenience
export type { Alert } from '@/lib/types/alerts';
