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
    <div className="inline-flex items-center gap-0.5 rounded-full border border-white/8 bg-white/[0.02] p-0.5">
      {items.map((item) => (
        <Link
          key={item.testId}
          href={item.href}
          data-testid={item.testId}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
            item.active
              ? 'bg-white/[0.07] text-foreground'
              : 'text-secondary hover:bg-white/[0.05] hover:text-foreground',
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
}

export function ProjectWorkbenchBar({
  title,
  meta,
  actions,
  switcher,
  className,
}: ProjectWorkbenchBarProps) {
  return (
    <div
      data-testid="project-workbench"
      className={cn(
        'flex items-start justify-between gap-3 rounded-[16px] border border-white/6 bg-white/[0.02] px-3.5 py-2 shadow-none',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          data-testid="project-workbench__heading"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-tertiary"
        >
          {title}
        </div>
        {meta ? <div data-testid="project-workbench__meta" className="mt-1 min-w-0">{meta}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        {actions}
        {switcher}
      </div>
    </div>
  );
}
