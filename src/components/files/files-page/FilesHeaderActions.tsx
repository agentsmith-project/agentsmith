'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FilesHeaderActionsProps {
  basePath: string;
  t: (key: string) => string;
}

interface ActionLinkProps {
  className: string;
  href: string;
  testId: string;
  children: ReactNode;
}

function ActionLink({ className, href, testId, children }: ActionLinkProps) {
  return (
    <Link href={href} className={className} data-testid={testId}>
      {children}
    </Link>
  );
}

export function FilesHeaderActions({ basePath, t }: FilesHeaderActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionLink
        href={`${basePath}/chat`}
        className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
        testId="files__open-chat"
      >
        {t('open_chat')}
      </ActionLink>
      <ActionLink
        href={`${basePath}/notebook`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        testId="files__open-notebook"
      >
        {t('open_notebook')}
      </ActionLink>
      <ActionLink
        href={`${basePath}/endpoints`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        testId="files__open-endpoints"
      >
        {t('open_endpoints')}
      </ActionLink>
    </div>
  );
}
