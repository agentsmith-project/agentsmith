/**
 * ErrorTag Component
 *
 * Displays an abbreviated error category tag with appropriate colors.
 * Used in EndpointStatusBadge to show the type of health check failure.
 *
 * Error categories:
 * - auth: Authentication failed (invalid credential)
 * - rate_limit: Rate limited by provider (429)
 * - upstream: Upstream service error (5xx)
 * - network: Network error (DNS, connection refused)
 * - timeout: Request timed out
 * - unknown: Unknown error
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import type { EndpointHealthErrorCategory } from '@/lib/api/types/endpoints';

export interface ErrorTagProps {
  /** Error category */
  category: EndpointHealthErrorCategory;
  /** Size variant */
  size?: 'sm' | 'md';
  /** Show tooltip on hover */
  showTooltip?: boolean;
  /** Custom className */
  className?: string;
}

const errorTagConfig: Record<
  EndpointHealthErrorCategory,
  { label: string; colorClass: string; description: string }
> = {
  auth: {
    label: 'AUTH',
    colorClass: 'text-error border-error bg-error/10',
    description: 'Authentication error',
  },
  rate_limit: {
    label: '429',
    colorClass: 'text-warning border-warning bg-warning/10',
    description: 'Rate limit error',
  },
  upstream: {
    label: '5XX',
    colorClass: 'text-orange-500 border-orange-500 bg-orange-500/10',
    description: 'Upstream service error',
  },
  network: {
    label: 'NET',
    colorClass: 'text-purple-500 border-purple-500 bg-purple-500/10',
    description: 'Network error',
  },
  timeout: {
    label: 'TIMEOUT',
    colorClass: 'text-tertiary border-tertiary bg-tertiary/10',
    description: 'Timeout error',
  },
  unknown: {
    label: 'UNKNOWN',
    colorClass: 'text-tertiary border-tertiary bg-tertiary/10',
    description: 'Unknown error',
  },
};

const sizeClasses = {
  sm: 'text-xs px-1.5 py-0.5',
  md: 'text-sm px-2 py-1',
} as const;

export function ErrorTag({
  category,
  size = 'sm',
  showTooltip = true,
  className,
}: ErrorTagProps) {
  const config = errorTagConfig[category];

  return (
    <span
      data-testid={`error-tag-${category}`}
      className={cn(
        'inline-flex items-center rounded border font-medium',
        sizeClasses[size],
        config.colorClass,
        className
      )}
      role="status"
      aria-label={config.description}
      title={showTooltip ? config.description : undefined}
    >
      {config.label}
    </span>
  );
}
