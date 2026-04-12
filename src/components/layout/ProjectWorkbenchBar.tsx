import Link from 'next/link';
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ProjectWorkbenchNavItem {
  href: string;
  label: string;
  testId: string;
  active?: boolean;
}

interface ProjectWorkbenchSwitcherProps {
  items: ProjectWorkbenchNavItem[];
}

export function ProjectWorkbenchSwitcher({ items }: ProjectWorkbenchSwitcherProps) {
  return (
    <div
      data-testid="project-workbench-switcher"
      className="inline-flex items-center gap-0.5 rounded-md border border-subtle/70 bg-surface-low/60 p-0.5"
    >
      {items.map((item) => (
        <Link
          key={item.testId}
          href={item.href}
          data-testid={item.testId}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'rounded-[6px] px-2.5 py-1 text-[11px] font-medium transition-colors',
            item.active
              ? 'bg-surface text-foreground shadow-none'
              : 'text-secondary hover:bg-surface hover:text-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

interface ProjectWorkbenchBarProps {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  switcher?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'utility';
}

export function ProjectWorkbenchBar({
  title,
  meta,
  actions,
  switcher,
  className,
  variant = 'default',
}: ProjectWorkbenchBarProps) {
  return (
    <div
      data-testid="project-workbench"
      className={cn(
        'flex items-start justify-between border-b border-subtle/70 bg-transparent',
        variant === 'utility'
          ? 'gap-2 px-3 py-1.5 md:px-4'
          : 'gap-3 px-3 py-2 md:px-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          data-testid="project-workbench__heading"
          className={cn(
            'font-semibold uppercase text-tertiary',
            variant === 'utility' ? 'text-[9px] tracking-[0.12em]' : 'text-[10px] tracking-[0.14em]',
          )}
        >
          {title}
        </div>
        {meta ? <div data-testid="project-workbench__meta" className="mt-0.5 min-w-0">{meta}</div> : null}
      </div>
      <div className={cn('flex shrink-0 flex-wrap items-center justify-end', variant === 'utility' ? 'gap-1' : 'gap-1.5')}>
        {actions}
        {switcher}
      </div>
    </div>
  );
}
