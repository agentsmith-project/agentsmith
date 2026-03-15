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
    <div className="inline-flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.03] p-1">
      {items.map((item) => (
        <Link
          key={item.testId}
          href={item.href}
          data-testid={item.testId}
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            item.active
              ? 'bg-white/[0.08] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
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
        'flex items-start justify-between gap-4 rounded-[20px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] px-4 py-3 shadow-[0_16px_32px_rgba(0,0,0,0.14)]',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          data-testid="project-workbench__heading"
          className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary"
        >
          {title}
        </div>
        {meta ? <div data-testid="project-workbench__meta" className="mt-1.5 min-w-0">{meta}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {actions}
        {switcher}
      </div>
    </div>
  );
}
