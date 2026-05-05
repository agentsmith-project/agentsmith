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
        href={`${basePath}/agent-runners`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
        data-testid="endpoints__open-agent-runners"
      >
        {t('open_agent_runners')}
      </Link>
    </div>
  );
}
