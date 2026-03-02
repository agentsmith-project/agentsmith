'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { GovernanceDrilldownContext } from '@/lib/governance-drilldown-context';
import { cn } from '@/lib/utils';

interface GovernanceDrilldownBannerProps {
  context: GovernanceDrilldownContext;
  locale: string;
}

export function GovernanceDrilldownBanner({ context, locale }: GovernanceDrilldownBannerProps) {
  const t = useTranslations('common');
  const workspaceId = context.gov_workspace_id;
  const projectId = context.gov_project_id;

  return (
    <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 p-3" data-testid="governance-drilldown__banner">
      <p className="text-xs font-medium text-foreground">{t('governance_drilldown_title')}</p>
      <p className="mt-1 text-xs text-tertiary">
        {t('governance_drilldown_description', {
          from: context.gov_from,
          kind: context.gov_kind,
          reason: context.gov_reason ?? t('governance_drilldown_reason_none'),
        })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link
          href={`/${locale}/workspaces/overview`}
          className={cn(
            'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
            'hover:bg-hover',
          )}
          data-testid="governance-drilldown__back-org-overview"
        >
          {t('governance_drilldown_back_org')}
        </Link>
        {workspaceId && projectId ? (
          <Link
            href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/resource-policy`}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
              'hover:bg-hover',
            )}
            data-testid="governance-drilldown__open-policy"
          >
            {t('governance_drilldown_open_policy')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
