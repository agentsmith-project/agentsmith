import * as React from 'react';
import { cn } from '@/lib/utils';

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: 'active' | 'paused' | 'error' | 'success' | 'warning';
  children?: React.ReactNode;
}

export function StatusBadge({ status, children, className, ...props }: StatusBadgeProps) {
  const baseStyles =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-200 border';

  const statusStyles = {
    active: 'bg-success/15 text-success border-success/30',
    success: 'bg-success/15 text-success border-success/30',
    paused: 'bg-warning/15 text-warning border-warning/30',
    warning: 'bg-warning/15 text-warning border-warning/30',
    error: 'bg-error/10 text-error border-error/30',
  };

  return (
    <span
      className={cn(baseStyles, statusStyles[status], className)}
      {...props}
    >
      {children || status}
    </span>
  );
}
