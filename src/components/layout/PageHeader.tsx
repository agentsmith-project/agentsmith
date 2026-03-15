import React from 'react';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  className?: string;
  variant?: 'default' | 'compact';
};

export function PageHeader({ title, subtitle, actions, className, variant = 'default' }: PageHeaderProps) {
  const isCompact = variant === 'compact';

  return (
    <div
      className={cn(
        isCompact
          ? 'rounded-[18px] border border-subtle bg-white/[0.02] px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.12)] md:px-5'
          : 'rounded-[20px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] px-5 py-4 shadow-[0_12px_30px_rgba(0,0,0,0.18)] md:px-6 md:py-5',
        `flex flex-col ${isCompact ? 'gap-3' : 'gap-4'} md:flex-row md:items-start md:justify-between`,
        className,
      )}
    >
      <div className={cn(isCompact ? 'space-y-1' : 'space-y-1.5')}>
        {isCompact ? null : (
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-tertiary">Project Surface</div>
        )}
        <h1 className={cn(isCompact ? 'text-[22px] font-semibold leading-tight text-foreground' : 'text-[28px] font-semibold leading-tight text-foreground')}>
          {title}
        </h1>
        {subtitle ? (
          <p className={cn(isCompact ? 'max-w-3xl text-sm text-tertiary' : 'max-w-3xl text-sm text-secondary md:text-[15px]')}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
    </div>
  );
}
