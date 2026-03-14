import React from 'react';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        'rounded-[20px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] px-5 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.18)] md:px-6 md:py-5',
        'flex flex-col gap-4 md:flex-row md:items-start md:justify-between',
        className,
      )}
    >
      <div className="space-y-1.5">
        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tertiary">Project Surface</div>
        <h1 className="text-[28px] font-semibold leading-tight text-foreground">{title}</h1>
        {subtitle ? <p className="max-w-3xl text-sm text-secondary md:text-[15px]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
    </div>
  );
}
