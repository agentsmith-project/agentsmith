'use client';
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { AIReadyStatus } from '@/lib/api/types';

export interface AIReadyStatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: AIReadyStatus;
  children?: React.ReactNode;
}

const statusConfig: Record<
  AIReadyStatus,
  { label: string; className: string }
> = {
  idle: {
    label: 'Not Ready',
    className: 'bg-surface-high text-tertiary border-subtle',
  },
  preparing: {
    label: 'Preparing',
    className: 'bg-primary/15 text-primary border-primary/30',
  },
  ready: {
    label: 'Ready',
    className: 'bg-success/15 text-success border-success/30',
  },
  failed: {
    label: 'Failed',
    className: 'bg-error/10 text-error border-error/30',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-warning/15 text-warning border-warning/30',
  },
};

export function AIReadyStatusBadge({
  status,
  children,
  className,
  ...props
}: AIReadyStatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-200 border',
        config.className,
        className,
      )}
      {...props}
    >
      {children || config.label}
    </span>
  );
}
