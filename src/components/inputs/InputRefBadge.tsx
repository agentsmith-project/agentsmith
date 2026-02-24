'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface InputRefBadgeProps {
  label: string;
  className?: string;
}

export function InputRefBadge({ label, className }: InputRefBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-subtle bg-surface-high px-1.5 py-0.5 text-[11px] leading-none text-tertiary',
        className,
      )}
    >
      {label}
    </span>
  );
}

