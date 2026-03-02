'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { StatusBadge } from '@/components/ui/status-badge';
import { useOrganizationGovernanceRollup } from '@/lib/hooks/use-organization-governance-rollup';
import { useOrganizationActions } from '@/lib/hooks/use-organization-actions';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import type { OrganizationActionStatus } from '@/lib/stores/organization-actions-store';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [readinessFilter, setReadinessFilter] = useState<'all' | 'blocked' | 'warning' | 'ready'>('all');

  const filteredWorkspaceRanking = useMemo(() => {
    const items = orgRollup.rollup?.workspaceRanking ?? [];
    const query = searchQuery.trim().toLowerCase();
    return items.filter((workspace) => {
      if (readinessFilter !== 'all' && workspace.readiness !== readinessFilter) {
        return false;
      }
      if (query.length > 0 && !workspace.workspaceName.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [orgRollup.rollup?.workspaceRanking, readinessFilter, searchQuery]);

  const filteredActionsQueue = useMemo(() => {
    const actions = orgRollup.rollup?.actionsQueue ?? [];
    const query = searchQuery.trim().toLowerCase();
    return actions.filter((action) => {
      if (readinessFilter !== 'all' && action.severity !== readinessFilter) {
        return false;
      }
      if (query.length > 0 && !action.workspaceName.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [orgRollup.rollup?.actionsQueue, readinessFilter, searchQuery]);
  const { actionsWithState, updateActionStatus } = useOrganizationActions(filteredActionsQueue);

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
                  <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('org_overview_search_placeholder')}
                      className="h-9 rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="workspace-overview__search"
                    />
                    <select
                      value={readinessFilter}
                      onChange={(event) => setReadinessFilter(event.target.value as 'all' | 'blocked' | 'warning' | 'ready')}
                      className="h-9 rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground"
                      data-testid="workspace-overview__readiness-filter"
                    >
                      <option value="all">{t('org_overview_filter_all')}</option>
                      <option value="blocked">{t('org_overview_status_blocked')}</option>
                      <option value="warning">{t('org_overview_status_warning')}</option>
                      <option value="ready">{t('org_overview_status_ready')}</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    {filteredWorkspaceRanking.map((workspace) => (
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
                    {filteredWorkspaceRanking.length === 0 ? (
                      <p className="rounded-sm border border-subtle bg-bg-base/20 px-3 py-2 text-sm text-tertiary">
                        {t('org_overview_matrix_empty_filtered')}
                      </p>
                    ) : null}
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
                  {actionsWithState.length === 0 ? (
                    <p className="mt-2 text-sm text-tertiary">{t('org_overview_actions_queue_empty')}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {actionsWithState.map((action) => {
                        const actionIdForTest = action.id.replace(/:/g, '--');
                        return (
                        <div
                          key={action.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-subtle bg-bg-base/20 p-3"
                          data-testid={`workspace-overview__actions-queue-item--${actionIdForTest}`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{action.workspaceName}</p>
                            <p className="text-xs text-tertiary">{t(`org_overview_action_type_${action.actionType}`)}</p>
                            <p className="mt-1 truncate text-xs text-tertiary">{action.title}</p>
                            {action.updatedAt ? (
                              <p className="mt-1 text-[11px] text-tertiary">
                                {t('org_overview_action_updated_at', { value: new Date(action.updatedAt).toLocaleString() })}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge status={mapActionStatusToBadge(action.currentStatus)}>
                              {t(`org_overview_action_status_${action.currentStatus}`)}
                            </StatusBadge>
                            <StatusBadge status={action.severity}>{t(`org_overview_status_${action.severity}`)}</StatusBadge>
                            <button
                              type="button"
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              onClick={() => updateActionStatus(action.id, 'in_progress')}
                              data-testid={`workspace-overview__actions-queue-mark-in-progress--${actionIdForTest}`}
                            >
                              {t('org_overview_action_mark_in_progress')}
                            </button>
                            <button
                              type="button"
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              onClick={() => updateActionStatus(action.id, 'completed')}
                              data-testid={`workspace-overview__actions-queue-mark-completed--${actionIdForTest}`}
                            >
                              {t('org_overview_action_mark_completed')}
                            </button>
                            <button
                              type="button"
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              onClick={() => updateActionStatus(action.id, 'blocked')}
                              data-testid={`workspace-overview__actions-queue-mark-blocked--${actionIdForTest}`}
                            >
                              {t('org_overview_action_mark_blocked')}
                            </button>
                            <button
                              type="button"
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              onClick={() => updateActionStatus(action.id, 'pending')}
                              data-testid={`workspace-overview__actions-queue-mark-pending--${actionIdForTest}`}
                            >
                              {t('org_overview_action_mark_pending')}
                            </button>
                            <Link
                              href={`/${locale}/workspaces/${action.workspaceId}/settings`}
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              data-testid={`workspace-overview__actions-queue-open-settings--${actionIdForTest}`}
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
                                data-testid={`workspace-overview__actions-queue-open-release-ops--${actionIdForTest}`}
                              >
                                {t('org_overview_open_release_ops')}
                              </Link>
                            ) : null}
                          </div>
                          {action.history.length > 0 ? (
                            <div className="w-full rounded-sm border border-subtle bg-surface px-3 py-2" data-testid={`workspace-overview__actions-queue-history--${actionIdForTest}`}>
                              <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('org_overview_action_history')}</p>
                              <div className="mt-1 space-y-1">
                                {action.history.slice(-3).reverse().map((event) => (
                                  <p key={event.id} className="text-xs text-tertiary">
                                    {t('org_overview_action_history_line', {
                                      status: t(`org_overview_action_status_${event.status}`),
                                      actor: event.actorName,
                                      at: new Date(event.at).toLocaleString(),
                                    })}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        );
                      })}
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

function mapActionStatusToBadge(status: OrganizationActionStatus) {
  switch (status) {
    case 'in_progress':
      return 'active' as const;
    case 'completed':
      return 'success' as const;
    case 'blocked':
      return 'blocked' as const;
    default:
      return 'paused' as const;
  }
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-subtle bg-surface p-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
