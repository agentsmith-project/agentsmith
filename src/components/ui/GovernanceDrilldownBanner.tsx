'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  buildGovernanceDrilldownQuery,
  type GovernanceDrilldownContext,
} from '@/lib/governance-drilldown-context';
import { classifyGovernanceEvidenceFocus, getGovernanceEvidenceCount } from '@/lib/governance-evidence';
import { cn } from '@/lib/utils';

interface GovernanceDrilldownBannerProps {
  context: GovernanceDrilldownContext;
  locale: string;
}

export function GovernanceDrilldownBanner({ context, locale }: GovernanceDrilldownBannerProps) {
  const t = useTranslations('common');
  const workspaceId = context.gov_workspace_id;
  const projectId = context.gov_project_id;
  const drilldownQuery = buildGovernanceDrilldownQuery(context);
  const focus = classifyGovernanceEvidenceFocus(context.gov_reason);
  const evidenceCount = getGovernanceEvidenceCount(context);
  const evidenceMetrics = [
    { key: 'governance_drilldown_metric_related_signals', value: context.gov_related_signals },
    { key: 'governance_drilldown_metric_blocked_signals', value: context.gov_blocked_signals },
    { key: 'governance_drilldown_metric_warning_signals', value: context.gov_warning_signals },
    { key: 'governance_drilldown_metric_project_signals', value: context.gov_project_signals },
    { key: 'governance_drilldown_metric_member_signals', value: context.gov_member_signals },
    { key: 'governance_drilldown_metric_workspace_risk_score', value: context.gov_workspace_risk_score },
    { key: 'governance_drilldown_metric_workspace_blocked_items', value: context.gov_workspace_blocked_items },
    { key: 'governance_drilldown_metric_workspace_warning_items', value: context.gov_workspace_warning_items },
    { key: 'governance_drilldown_metric_workspace_risky_projects', value: context.gov_workspace_risky_projects },
  ].filter((item) => typeof item.value === 'number');

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
      <p className="mt-1 text-xs text-tertiary" data-testid="governance-drilldown__focus">
        {t('governance_drilldown_focus', {
          focus: t(`governance_drilldown_focus_${focus}`),
          count: evidenceCount ?? 0,
        })}
      </p>
      {context.gov_action_id ? (
        <p className="mt-1 text-xs text-tertiary">
          {t('governance_drilldown_action_id', { value: context.gov_action_id })}
        </p>
      ) : null}
      {evidenceMetrics.length > 0 ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" data-testid="governance-drilldown__evidence">
          {evidenceMetrics.map((metric) => (
            <div
              key={metric.key}
              className="rounded-sm border border-warning/20 bg-warning/10 px-2 py-1.5"
              data-testid={`governance-drilldown__metric--${metric.key.replace(/_/g, '-')}`}
            >
              <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">{t(metric.key)}</p>
              <p className="mt-0.5 text-xs font-semibold text-foreground">{metric.value}</p>
            </div>
          ))}
        </div>
      ) : null}
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
            href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/resource-policy${drilldownQuery}`}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
              'hover:bg-hover',
            )}
            data-testid="governance-drilldown__open-policy"
          >
            {t('governance_drilldown_open_policy')}
          </Link>
        ) : null}
        {workspaceId && projectId ? (
          <Link
            href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/audit${drilldownQuery}`}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
              'hover:bg-hover',
            )}
            data-testid="governance-drilldown__open-audit"
          >
            {t('governance_drilldown_open_audit')}
          </Link>
        ) : null}
        {workspaceId && projectId ? (
          <Link
            href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/release-ops${drilldownQuery}`}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
              'hover:bg-hover',
            )}
            data-testid="governance-drilldown__open-release-ops"
          >
            {t('governance_drilldown_open_release_ops')}
          </Link>
        ) : null}
        {workspaceId && projectId && context.gov_member_id ? (
          <Link
            href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/members?member_id=${context.gov_member_id}&member_tab=people${drilldownQuery.replace('?', '&')}`}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
              'hover:bg-hover',
            )}
            data-testid="governance-drilldown__open-members"
          >
            {t('governance_drilldown_open_members')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
