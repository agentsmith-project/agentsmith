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
import { Bell, X, AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { Alert } from '@/lib/types/alerts';

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
  critical: 'text-error bg-error/10 border-error/20',
  error: 'text-error bg-error/10 border-error/20',
  warning: 'text-warning bg-warning/10 border-warning/20',
  info: 'text-info bg-info/10 border-info/20',
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

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3" data-testid="alert-notifications__loading">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 rounded-lg bg-surface border border-border animate-pulse"
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
        className="flex flex-col items-center justify-center py-12 px-4 bg-surface border border-border rounded-xl"
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
    <div className="space-y-3" data-testid="alert-notifications">
      {sortedAlerts.map((alert) => {
        const SeverityIcon = severityIcons[alert.severity];
        const severityClass = severityColors[alert.severity];
        const isUnread = alert.status === 'unread';

        return (
          <div
            key={alert.id}
            data-testid="alert-card"
            className={`relative rounded-lg border bg-surface p-4 transition-colors ${
              isUnread ? 'border-l-4 border-l-accent' : 'border-border'
            }`}
          >
            {/* Severity Badge */}
            <div className="flex items-start gap-3">
              <div
                className={`shrink-0 p-2 rounded-full border ${severityClass}`}
                data-testid={`severity-badge-${alert.severity}`}
              >
                <SeverityIcon className="h-4 w-4" />
              </div>

              <div className="flex-1 min-w-0">
                {/* Header: Title + Timestamp */}
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-medium text-foreground">{alert.title}</h4>
                  <span className="text-xs text-tertiary shrink-0">
                    {new Date(alert.created_at).toLocaleString()}
                  </span>
                </div>

                {/* Message */}
                <p className="mt-1 text-sm text-tertiary">{alert.message}</p>

                {/* Resource context */}
                {alert.resource_name && (
                  <p className="mt-1 text-xs text-tertiary">
                    {t('resource')}: {alert.resource_name}
                  </p>
                )}

                {/* Actions */}
                <div className="mt-3 flex items-center gap-2">
                  {alert.actions?.map((action, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        onMarkAsRead(alert.id);
                        if (action.url && onActionClick) {
                          onActionClick(alert.id, action.label, action.url);
                        } else if (action.handler === 'dismiss') {
                          onDismiss(alert.id);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                        action.primary
                          ? 'bg-accent text-white hover:bg-accent/90'
                          : 'bg-surface-high text-foreground hover:bg-hover'
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}

                  {/* Default dismiss button if no dismiss action */}
                  {!alert.actions?.find((a) => a.handler === 'dismiss') && (
                    <button
                      onClick={() => onDismiss(alert.id)}
                      className="p-1.5 text-tertiary hover:text-error transition-colors"
                      data-testid={`dismiss-button-${alert.id}`}
                      aria-label={t('dismiss')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Unread indicator */}
            {isUnread && (
              <div className="absolute top-4 right-4 h-2 w-2 rounded-full bg-accent" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Re-export Alert type for convenience
export type { Alert } from '@/lib/types/alerts';

// Import AlertOctagon for severity icon
import { AlertOctagon } from 'lucide-react';
