/**
 * Alert Notification Item Component
 *
 * Single alert notification display.
 *
 * @module alerts/AlertNotificationItem
 */

import type { AlertNotification } from '@/lib/types/alerts';
import { Button } from '@/components/ui/button';

export interface AlertNotificationItemProps {
  notification: AlertNotification;
  onAcknowledge: () => void;
  onSilence: () => void;
}

/**
 * Alert notification item component
 *
 * Features:
 * - Rule name and status
 * - Metric value and threshold
 * - Affected resource context
 * - Timestamp
 * - Acknowledge/silence buttons
 *
 * @param props - Component props
 * @returns Notification item component
 */
export function AlertNotificationItem(_props: AlertNotificationItemProps) {
  const { notification, onAcknowledge, onSilence } = _props;
  const isResolved = notification.status === 'resolved';

  return (
    <article className="rounded-lg border border-border bg-surface p-4" data-testid={`alert-notification__${notification.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">{notification.rule_name}</h4>
          <p className="text-xs text-tertiary mt-1">
            {notification.metric} {notification.operator} {notification.threshold} (actual: {notification.actual_value})
          </p>
          <p className="text-xs text-tertiary mt-1">
            {new Date(notification.triggered_at).toLocaleString()}
          </p>
        </div>
        <span className="text-xs text-tertiary uppercase">{notification.status}</span>
      </div>

      {(notification.context.resource_name || notification.context.resource_id) && (
        <p className="text-xs text-tertiary mt-2">
          Resource: {notification.context.resource_name ?? notification.context.resource_id}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAcknowledge}
          disabled={isResolved}
          data-testid={`alert-notification__acknowledge--${notification.id}`}
        >
          Acknowledge
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSilence}
          disabled={isResolved}
          data-testid={`alert-notification__silence--${notification.id}`}
        >
          Silence
        </Button>
      </div>
    </article>
  );
}
