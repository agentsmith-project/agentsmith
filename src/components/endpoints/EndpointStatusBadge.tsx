/**
 * EndpointStatusBadge Component
 *
 * Displays the health status of an endpoint with appropriate colors and icons.
 * Supports displaying error category tags and last check time.
 *
 * Status values:
 * - healthy: Endpoint is responding correctly
 * - degraded: Endpoint is responding but with issues (e.g., high latency)
 * - unavailable: Endpoint is not responding
 * - unknown: Endpoint health has not been checked
 */

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { EndpointHealthErrorCategory } from '@/lib/api/types/endpoints';

export interface EndpointStatusBadgeProps {
  /** Health status of the endpoint */
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  /** ISO timestamp of last health check */
  lastCheck?: string;
  /** Error category when status is not healthy */
  errorCategory?: EndpointHealthErrorCategory;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Custom className */
  className?: string;
}

const statusConfig = {
  healthy: {
    colorClass: 'text-success',
    dotClass: 'bg-success',
  },
  degraded: {
    colorClass: 'text-warning',
    dotClass: 'bg-warning',
  },
  unavailable: {
    colorClass: 'text-error',
    dotClass: 'bg-error',
  },
  unknown: {
    colorClass: 'text-tertiary',
    dotClass: 'bg-tertiary',
  },
} as const;

const errorCategoryLabels: Record<EndpointHealthErrorCategory, string> = {
  auth: 'AUTH',
  network: 'NET',
  upstream: '5XX',
  timeout: 'TIMEOUT',
  rate_limit: '429',
  unknown: 'UNKNOWN',
};

const errorCategoryColorClasses: Record<EndpointHealthErrorCategory, string> = {
  auth: 'text-error border-error bg-error/10',
  network: 'text-purple-500 border-purple-500 bg-purple-500/10',
  upstream: 'text-error border-error bg-error/10',
  timeout: 'text-tertiary border-tertiary bg-tertiary/10',
  rate_limit: 'text-warning border-warning bg-warning/10',
  unknown: 'text-tertiary border-tertiary bg-tertiary/10',
};

/**
 * Status indicator dot component
 */
function StatusDot({ status }: { status: keyof typeof statusConfig }) {
  return (
    <span
      data-testid="endpoint-status-dot"
      className={cn(
        'inline-block w-2 h-2 rounded-full',
        statusConfig[status].dotClass
      )}
      aria-hidden="true"
    />
  );
}

/**
 * Error category tag component
 */
function ErrorTag({ category }: { category: EndpointHealthErrorCategory }) {
  return (
    <span
      data-testid="endpoint-error-tag"
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border',
        errorCategoryColorClasses[category]
      )}
      aria-label={`Error: ${category}`}
    >
      {errorCategoryLabels[category]}
    </span>
  );
}

export function EndpointStatusBadge({
  status,
  lastCheck,
  errorCategory,
  size = 'md',
  className,
}: EndpointStatusBadgeProps) {
  const t = useTranslations('endpoints.status_badge');
  const config = statusConfig[status];
  const showErrorTag = errorCategory && (status === 'degraded' || status === 'unavailable');

  const sizeClasses = size === 'sm' ? 'text-xs' : 'text-sm';

  const tr = (key: string, fallback: string): string => {
    const value = t(key);
    return value === key ? fallback : value;
  };

  const statusLabel = (() => {
    switch (status) {
      case 'healthy':
        return tr('healthy', 'Healthy');
      case 'degraded':
        return tr('degraded', 'Degraded');
      case 'unavailable':
        return tr('unavailable', 'Unavailable');
      case 'unknown':
      default:
        return tr('unknown', 'Unknown');
    }
  })();

  const relativeTime = (() => {
    if (!lastCheck) return null;
    const now = new Date();
    const past = new Date(lastCheck);
    const diffMs = now.getTime() - past.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return tr('just_now', 'just now');
    if (diffMins < 60) return tr('minutes_ago', `${diffMins}m ago`).replace('{count}', String(diffMins));
    if (diffHours < 24) return tr('hours_ago', `${diffHours}h ago`).replace('{count}', String(diffHours));
    return tr('days_ago', `${diffDays}d ago`).replace('{count}', String(diffDays));
  })();

  // Build aria-label - use lowercase status value
  let ariaLabel = `${tr('aria_prefix', 'Endpoint status')}: ${status}`;
  if (showErrorTag && errorCategory) {
    ariaLabel += `. ${tr('aria_error_prefix', 'Error')}: ${errorCategory}`;
  }

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      {/* Status badge with dot */}
      <span
        data-testid="endpoint-status-badge"
        className={cn('inline-flex items-center gap-1.5', config.colorClass, sizeClasses)}
        aria-label={ariaLabel}
      >
        <StatusDot status={status} />
        <span>{statusLabel}</span>
      </span>

      {/* Error category tag */}
      {showErrorTag && <ErrorTag category={errorCategory} />}

      {/* Last check time */}
      {relativeTime && (
        <span
          data-testid="endpoint-last-check"
          className={cn('text-tertiary', sizeClasses)}
          aria-label={`${tr('aria_last_checked_prefix', 'Last checked')} ${relativeTime}`}
        >
          {relativeTime}
        </span>
      )}
    </div>
  );
}
