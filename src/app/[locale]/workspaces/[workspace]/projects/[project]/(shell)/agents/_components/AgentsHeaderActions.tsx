'use client';

import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AgentsHeaderActionsProps {
  basePath: string;
  t: (key: string) => string;
}

export function AgentsHeaderActions({ basePath, t }: AgentsHeaderActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`${basePath}/chat`}
        className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
        data-testid="agents__open-chat"
      >
        {t('open_chat')}
      </Link>
      <Link
        href={`${basePath}/notebook`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="agents__open-notebook"
      >
        {t('open_notebook')}
      </Link>
      <Link
        href={`${basePath}/endpoints`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="agents__open-endpoints"
      >
        {t('open_endpoints')}
      </Link>
    </div>
  );
}
