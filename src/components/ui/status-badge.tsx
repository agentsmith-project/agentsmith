import * as React from 'react';
import { cn } from '@/lib/utils';

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status:
    | 'active'
    | 'paused'
    | 'error'
    | 'success'
    | 'warning'
    | 'ready'
    | 'blocked'
    | 'recovered'
    | 'terminal'
    | 'pending_override'
    | 'releasable_with_override'
    | 'due_soon'
    | 'overdue'
    | 'info';
  children?: React.ReactNode;
}

export function StatusBadge({ status, children, className, ...props }: StatusBadgeProps) {
  const baseStyles =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-200 border';

  const statusStyles = {
    active: 'bg-success/15 text-success border-success/30',
    success: 'bg-success/15 text-success border-success/30',
    ready: 'bg-success/15 text-success border-success/30',
    recovered: 'bg-success/15 text-success border-success/30',
    paused: 'bg-warning/15 text-warning border-warning/30',
    warning: 'bg-warning/15 text-warning border-warning/30',
    due_soon: 'bg-warning/15 text-warning border-warning/30',
    pending_override: 'bg-warning/15 text-warning border-warning/30',
    error: 'bg-error/10 text-error border-error/30',
    blocked: 'bg-error/10 text-error border-error/30',
    terminal: 'bg-error/10 text-error border-error/30',
    overdue: 'bg-error/10 text-error border-error/30',
    releasable_with_override: 'bg-accent/10 text-accent border-accent/30',
    info: 'bg-bg-hover text-foreground border-border',
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
