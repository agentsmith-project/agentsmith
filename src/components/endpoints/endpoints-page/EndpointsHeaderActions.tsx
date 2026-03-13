'use client';

import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EndpointsHeaderActionsProps {
  basePath: string;
  t: (key: string) => string;
}

export function EndpointsHeaderActions({
  basePath,
  t,
}: EndpointsHeaderActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`${basePath}/chat`}
        className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
        data-testid="endpoints__open-chat"
      >
        {t('open_chat')}
      </Link>
      <Link
        href={`${basePath}/notebook`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="endpoints__open-notebook"
      >
        {t('open_notebook')}
      </Link>
      <Link
        href={`${basePath}/agents`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="endpoints__open-agents"
      >
        {t('open_agents')}
      </Link>
    </div>
  );
}
