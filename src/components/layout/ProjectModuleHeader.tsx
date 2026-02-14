import React from 'react';

import { cn } from '@/lib/utils';

type ProjectModuleHeaderProps = {
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  titleClassName?: string;
  actionsClassName?: string;
};

/**
 * Shared module header row used by project pages (chat/files/notebook).
 * Keeps title baseline, row height, and spacing consistent across modules.
 */
export function ProjectModuleHeader({
  title,
  actions,
  className,
  titleClassName,
  actionsClassName,
}: ProjectModuleHeaderProps) {
  return (
    <div className={cn('flex min-h-10 w-full items-center justify-between gap-2', className)}>
      <h1 className={cn('text-2xl font-semibold leading-tight text-foreground', titleClassName)}>{title}</h1>
      {actions ? <div className={cn('flex items-center gap-2', actionsClassName)}>{actions}</div> : null}
    </div>
  );
}
