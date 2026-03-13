'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function CredentialsHeaderActions(args: {
  basePath: string;
  openMembersLabel: string;
  openResourcePolicyLabel: string;
  openAuditLabel: string;
}) {
  const { basePath, openMembersLabel, openResourcePolicyLabel, openAuditLabel } = args;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={`${basePath}/members`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="credentials__open-members"
      >
        {openMembersLabel}
      </Link>
      <Link
        href={`${basePath}/resource-policy`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="credentials__open-resource-policy"
      >
        {openResourcePolicyLabel}
      </Link>
      <Link
        href={`${basePath}/audit`}
        className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
        data-testid="credentials__open-audit"
      >
        {openAuditLabel}
      </Link>
    </div>
  );
}
