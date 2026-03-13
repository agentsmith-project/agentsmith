'use client';

import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';

export function ConnectionBanner(args: {
  title: string;
  description: string;
  diagnosticsLinks?: {
    audit: string;
    usage: string;
    agent?: string | null;
  };
  openAuditLabel: string;
  openUsageLabel: string;
  openAgentDiagnosticsLabel: string;
}) {
  const { title, description, diagnosticsLinks, openAuditLabel, openUsageLabel, openAgentDiagnosticsLabel } = args;

  return (
    <div className="border-b border-subtle px-4 py-2" data-testid="notebook__sse-status">
      <div className="text-xs font-medium text-primary">{title}</div>
      <div className="mt-0.5 text-xs text-tertiary">{description}</div>
      {diagnosticsLinks ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={diagnosticsLinks.audit}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="notebook__sse-status-open-audit"
          >
            {openAuditLabel}
          </Link>
          <Link
            href={diagnosticsLinks.usage}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="notebook__sse-status-open-usage"
          >
            {openUsageLabel}
          </Link>
          {diagnosticsLinks.agent ? (
            <Link
              href={diagnosticsLinks.agent}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              data-testid="notebook__sse-status-open-agent"
            >
              {openAgentDiagnosticsLabel}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
