import * as React from 'react';
import { cn } from '@/lib/utils';

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: 'active' | 'paused' | 'error' | 'success' | 'warning';
  children?: React.ReactNode;
}

export function StatusBadge({ status, children, className, ...props }: StatusBadgeProps) {
  const baseStyles = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors duration-200';

  const statusStyles = {
    active: 'bg-success/20 text-success',
    success: 'bg-success/20 text-success',
    paused: 'bg-warning/20 text-warning',
    warning: 'bg-warning/20 text-warning',
    error: 'bg-error/20 text-error',
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
