'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export function ConnectionBanner(args: {
  title: string;
  description: string;
  diagnosticsLinks?: {
    audit: string;
    usage: string;
  };
  openAuditLabel: string;
  openUsageLabel: string;
}) {
  const { title, description, diagnosticsLinks, openAuditLabel, openUsageLabel } = args;

  return (
    <div className="border-b border-subtle px-4 py-2" data-testid="agent-tasks__sse-status">
      <div className="text-xs font-medium text-primary">{title}</div>
      <div className="mt-0.5 text-xs text-tertiary">{description}</div>
      {diagnosticsLinks ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={diagnosticsLinks.audit}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="agent-tasks__sse-status-open-audit"
          >
            {openAuditLabel}
          </Link>
          <Link
            href={diagnosticsLinks.usage}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="agent-tasks__sse-status-open-usage"
          >
            {openUsageLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
