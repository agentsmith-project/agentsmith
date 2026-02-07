'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type ResourcePolicyStatus = 'loading' | 'default' | 'overridden' | 'allow_list';

interface ResourcePolicyStatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: ResourcePolicyStatus;
  label: string;
  title: string;
}

const statusClasses: Record<ResourcePolicyStatus, string> = {
  loading: 'border-subtle text-tertiary',
  default: 'border-subtle text-tertiary',
  overridden: 'border-subtle text-foreground',
  allow_list: 'border-[rgb(var(--accent))] text-primary',
};

export function ResourcePolicyStatusBadge({
  status,
  label,
  title,
  className,
  ...props
}: ResourcePolicyStatusBadgeProps) {
  return (
    <span
      title={title}
      aria-label={`${label}. ${title}`}
      className={cn('text-xs rounded-full border px-2 py-0.5', statusClasses[status], className)}
      {...props}
    >
      {label}
    </span>
  );
}
