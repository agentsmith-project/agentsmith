'use client';

import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChatHeaderActionsProps {
  basePath: string;
  t: (key: string) => string;
}

export function ChatHeaderActions({ basePath, t }: ChatHeaderActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`${basePath}/notebook`}
        className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
        data-testid="chat__open-notebook"
      >
        {t('open_notebook')}
      </Link>
      <Link
        href={`${basePath}/endpoints`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="chat__open-endpoints"
      >
        {t('open_endpoints')}
      </Link>
      <Link
        href={`${basePath}/files`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="chat__open-files"
      >
        {t('open_files')}
      </Link>
    </div>
  );
}
