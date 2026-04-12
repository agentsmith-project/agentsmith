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
          ? 'surface-card px-4 py-4 md:px-5'
          : 'surface-elevated px-5 py-5 md:px-6 md:py-6',
        `flex flex-col ${isCompact ? 'gap-3' : 'gap-4'} md:flex-row md:items-start md:justify-between`,
        className,
      )}
    >
      <div className={cn(isCompact ? 'space-y-1.5' : 'space-y-2')}>
        {isCompact ? null : (
          <div className="type-caption text-tertiary">Project surface</div>
        )}
        <h1 className={cn(isCompact ? 'type-subheading' : 'type-section-heading', 'text-foreground')}>
          {title}
        </h1>
        {subtitle ? (
          <p className={cn(isCompact ? 'type-body-ui max-w-3xl text-secondary' : 'type-body-serif max-w-3xl text-secondary')}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
    </div>
  );
}
