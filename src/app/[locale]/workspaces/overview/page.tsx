'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { StatusBadge } from '@/components/ui/status-badge';
import { useOrganizationGovernanceRollup } from '@/lib/hooks/use-organization-governance-rollup';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { cn } from '@/lib/utils';

export default function WorkspacesOverviewPage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('workspace');
  const {
    data: workspaces,
    isLoading: isWorkspaceLoading,
    isError: isWorkspaceError,
    refetch: refetchWorkspaces,
  } = useWorkspaces();
  const orgRollup = useOrganizationGovernanceRollup(workspaces);
  const isLoading = isWorkspaceLoading || orgRollup.isLoading;
  const isError = isWorkspaceError || orgRollup.isError;

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-6xl space-y-5">
            <header className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('org_overview_eyebrow')}</p>
              <h1 className="text-2xl font-semibold text-foreground" data-testid="workspace-overview__heading">
                {t('org_overview_title')}
              </h1>
              <p className="text-sm text-tertiary">{t('org_overview_subtitle')}</p>
            </header>

            {isLoading ? (
              <div className="rounded-md border border-subtle bg-surface p-4" data-testid="workspace-overview__loading">
                <p className="text-sm text-tertiary">{t('org_overview_loading')}</p>
              </div>
            ) : isError || !orgRollup.rollup ? (
              <div className="rounded-md border border-warning/30 bg-surface p-4" data-testid="workspace-overview__error">
                <p className="text-sm font-medium text-foreground">{t('org_overview_error_title')}</p>
                <p className="mt-1 text-sm text-tertiary">{t('org_overview_error_description')}</p>
                <button
                  type="button"
                  className={cn(
                    'mt-3 inline-flex h-8 items-center rounded-sm border border-subtle px-3 text-xs font-medium text-foreground transition-colors',
                    'hover:bg-hover',
                  )}
                  onClick={() => {
                    void refetchWorkspaces();
                    void orgRollup.refetch();
                  }}
                  data-testid="workspace-overview__retry"
                >
                  {t('org_overview_retry')}
                </button>
              </div>
            ) : (
              <>
                <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" data-testid="workspace-overview__summary">
                  <MetricCard label={t('org_overview_metric_total_workspaces')} value={orgRollup.rollup.summary.totalWorkspaces} />
                  <MetricCard label={t('org_overview_metric_risky_workspaces')} value={orgRollup.rollup.summary.riskyWorkspaces} />
                  <MetricCard label={t('org_overview_metric_blocked_workspaces')} value={orgRollup.rollup.summary.blockedWorkspaces} />
                  <MetricCard label={t('org_overview_metric_warning_workspaces')} value={orgRollup.rollup.summary.warningWorkspaces} />
                  <MetricCard label={t('org_overview_metric_risky_projects')} value={orgRollup.rollup.summary.totalRiskyProjects} />
                </section>

                <section className="rounded-md border border-border bg-surface p-4" data-testid="workspace-overview__matrix">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-foreground">{t('org_overview_matrix_title')}</h2>
                    <StatusBadge status={orgRollup.rollup.summary.readiness}>
                      {t(`org_overview_status_${orgRollup.rollup.summary.readiness}`)}
                    </StatusBadge>
                  </div>
                  <div className="space-y-2">
                    {orgRollup.rollup.workspaceRanking.map((workspace) => (
                      <div
                        key={workspace.workspaceId}
                        className="grid gap-3 rounded-sm border border-subtle bg-bg-base/20 p-3 md:grid-cols-[1.2fr_auto_auto_auto_auto]"
                        data-testid={`workspace-overview__row--${workspace.workspaceId}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{workspace.workspaceName}</p>
                          <p className="text-xs text-tertiary">
                            {t('org_overview_matrix_meta', {
                              blocked: workspace.blockedItems,
                              warning: workspace.warningItems,
                              risky: workspace.riskyProjects,
                            })}
                          </p>
                        </div>
                        <div className="text-xs text-tertiary">
                          <div>{t('org_overview_risk_score')}</div>
                          <div className="text-sm font-semibold text-foreground">{workspace.riskScore}</div>
                        </div>
                        <div className="flex items-center">
                          <StatusBadge status={workspace.readiness}>{t(`org_overview_status_${workspace.readiness}`)}</StatusBadge>
                        </div>
                        <Link
                          href={`/${locale}/workspaces/${workspace.workspaceId}/settings`}
                          className={cn(
                            'inline-flex h-8 items-center justify-center rounded-sm border border-subtle px-2.5 text-xs font-medium text-foreground transition-colors',
                            'hover:bg-hover',
                          )}
                          data-testid={`workspace-overview__open-settings--${workspace.workspaceId}`}
                        >
                          {t('org_overview_open_settings')}
                        </Link>
                        <Link
                          href={`/${locale}/workspaces/${workspace.workspaceId}/projects`}
                          className={cn(
                            'inline-flex h-8 items-center justify-center rounded-sm border border-subtle px-2.5 text-xs font-medium text-foreground transition-colors',
                            'hover:bg-hover',
                          )}
                          data-testid={`workspace-overview__open-projects--${workspace.workspaceId}`}
                        >
                          {t('org_overview_open_projects')}
                        </Link>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-md border border-border bg-surface p-4" data-testid="workspace-overview__attention">
                  <h2 className="text-base font-semibold text-foreground">{t('org_overview_attention_title')}</h2>
                  {orgRollup.rollup.attention.length === 0 ? (
                    <p className="mt-2 text-sm text-tertiary">{t('org_overview_attention_empty')}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {orgRollup.rollup.attention.map((item) => {
                        const testIdSegment = item.id.replace(/:/g, '--');
                        return (
                        <div
                          key={item.id}
                          className="rounded-sm border border-subtle bg-bg-base/20 p-3"
                          data-testid={`workspace-overview__attention-item--${testIdSegment}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-medium text-foreground">{item.workspaceName}</p>
                            <StatusBadge status={item.severity}>{t(`org_overview_status_${item.severity}`)}</StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-tertiary">{item.title}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.projectId ? (
                              <>
                                <Link
                                  href={`/${locale}/workspaces/${item.workspaceId}/projects/${item.projectId}/audit`}
                                  className={cn(
                                    'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                    'hover:bg-hover',
                                  )}
                                  data-testid={`workspace-overview__attention-open-audit--${testIdSegment}`}
                                >
                                  {t('org_overview_open_audit')}
                                </Link>
                                <Link
                                  href={`/${locale}/workspaces/${item.workspaceId}/projects/${item.projectId}/release-ops`}
                                  className={cn(
                                    'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                    'hover:bg-hover',
                                  )}
                                  data-testid={`workspace-overview__attention-open-release-ops--${testIdSegment}`}
                                >
                                  {t('org_overview_open_release_ops')}
                                </Link>
                              </>
                            ) : null}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-md border border-border bg-surface p-4" data-testid="workspace-overview__actions-queue">
                  <h2 className="text-base font-semibold text-foreground">{t('org_overview_actions_queue_title')}</h2>
                  {orgRollup.rollup.actionsQueue.length === 0 ? (
                    <p className="mt-2 text-sm text-tertiary">{t('org_overview_actions_queue_empty')}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {orgRollup.rollup.actionsQueue.map((action) => (
                        <div
                          key={action.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-subtle bg-bg-base/20 p-3"
                          data-testid={`workspace-overview__actions-queue-item--${action.id.replace(/:/g, '--')}`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{action.workspaceName}</p>
                            <p className="text-xs text-tertiary">{t(`org_overview_action_type_${action.actionType}`)}</p>
                            <p className="mt-1 truncate text-xs text-tertiary">{action.title}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge status={action.severity}>{t(`org_overview_status_${action.severity}`)}</StatusBadge>
                            <Link
                              href={`/${locale}/workspaces/${action.workspaceId}/settings`}
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              data-testid={`workspace-overview__actions-queue-open-settings--${action.id.replace(/:/g, '--')}`}
                            >
                              {t('org_overview_open_settings')}
                            </Link>
                            {action.projectId ? (
                              <Link
                                href={`/${locale}/workspaces/${action.workspaceId}/projects/${action.projectId}/release-ops`}
                                className={cn(
                                  'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                  'hover:bg-hover',
                                )}
                                data-testid={`workspace-overview__actions-queue-open-release-ops--${action.id.replace(/:/g, '--')}`}
                              >
                                {t('org_overview_open_release_ops')}
                              </Link>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-subtle bg-surface p-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
