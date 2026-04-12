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
        href={`${basePath}/endpoints`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        data-testid="agents__open-endpoints"
      >
        {t('open_endpoints')}
      </Link>
    </div>
  );
}
