'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ResourcePolicyHeaderActions(args: {
  basePath: string;
  openMembersLabel: string;
  openCredentialsLabel: string;
  openAuditLabel: string;
}) {
  const { basePath, openMembersLabel, openCredentialsLabel, openAuditLabel } = args;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`${basePath}/members`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="resource-policy__open-members"
      >
        {openMembersLabel}
      </Link>
      <Link
        href={`${basePath}/credentials`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="resource-policy__open-credentials"
      >
        {openCredentialsLabel}
      </Link>
      <Link
        href={`${basePath}/audit`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="resource-policy__open-audit"
      >
        {openAuditLabel}
      </Link>
    </div>
  );
}
