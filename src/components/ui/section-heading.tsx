'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function SectionHeading({ eyebrow, title, subtitle, actions, className }: SectionHeadingProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div>
        {eyebrow ? (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-tertiary">
            {eyebrow}
          </div>
        ) : null}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {subtitle ? <p className="mt-1 text-xs text-tertiary">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
