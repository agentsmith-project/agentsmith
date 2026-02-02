import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variantStyles = {
    default: 'bg-accent/20 text-accent border-accent/30',
    secondary: 'bg-surface-high text-tertiary border-border',
    destructive: 'bg-error/10 text-error border-error/30',
    outline: 'bg-transparent text-foreground border-border',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-200 border',
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
}
