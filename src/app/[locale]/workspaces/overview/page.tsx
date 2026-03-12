'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { StatusBadge } from '@/components/ui/status-badge';
import { useOrganizationGovernanceRollup } from '@/lib/hooks/use-organization-governance-rollup';
import { useOrganizationActions } from '@/lib/hooks/use-organization-actions';
import { buildGovernanceDrilldownQuery } from '@/lib/governance-drilldown-context';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { cn } from '@/lib/utils';
import type { OrganizationActionStatus } from '@/lib/stores/organization-actions-store';

type WorkspaceReadinessFilter = 'all' | 'blocked' | 'warning' | 'ready';
type WorkspaceSortOption = 'risk_desc' | 'risk_asc' | 'name_asc' | 'name_desc' | 'blocked_desc';

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
  const [readinessFilter, setReadinessFilter] = useState<WorkspaceReadinessFilter>('all');
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSortOption>('risk_desc');
  const [selectedWorkspaceIds, setSelectedWorkspaceIds] = useState<Set<string>>(new Set());
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  const filteredWorkspaceRanking = useMemo(() => {
    const items = orgRollup.rollup?.workspaceRanking ?? [];
    const query = searchQuery.trim().toLowerCase();
    const filtered = items.filter((workspace) => {
      if (readinessFilter !== 'all' && workspace.readiness !== readinessFilter) {
        return false;
      }
      if (query.length > 0 && !workspace.workspaceName.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
    return filtered.sort((left, right) => compareWorkspaceRanking(left, right, workspaceSort));
  }, [orgRollup.rollup?.workspaceRanking, readinessFilter, searchQuery, workspaceSort]);

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
  const visibleWorkspaceIds = useMemo(
    () => new Set(filteredWorkspaceRanking.map((workspace) => workspace.workspaceId)),
    [filteredWorkspaceRanking],
  );
  const allVisibleSelected = filteredWorkspaceRanking.length > 0 && filteredWorkspaceRanking.every((workspace) => selectedWorkspaceIds.has(workspace.workspaceId));
  const selectedWorkspaceCount = selectedWorkspaceIds.size;
  const batchPreviewActions = useMemo(
    () => actionsWithState.filter((action) => selectedWorkspaceIds.has(action.workspaceId)),
    [actionsWithState, selectedWorkspaceIds],
  );
  const batchPreviewSummary = useMemo(
    () => ({
      total: batchPreviewActions.length,
      blocked: batchPreviewActions.filter((action) => action.severity === 'blocked').length,
      warning: batchPreviewActions.filter((action) => action.severity === 'warning').length,
      pending: batchPreviewActions.filter((action) => action.currentStatus === 'pending').length,
      inProgress: batchPreviewActions.filter((action) => action.currentStatus === 'in_progress').length,
      completed: batchPreviewActions.filter((action) => action.currentStatus === 'completed').length,
      blockedStatus: batchPreviewActions.filter((action) => action.currentStatus === 'blocked').length,
    }),
    [batchPreviewActions],
  );

  useEffect(() => {
    setSelectedWorkspaceIds((previous) => {
      const next = new Set<string>();
      for (const id of previous) {
        if (visibleWorkspaceIds.has(id)) {
          next.add(id);
        }
      }
      return next.size === previous.size ? previous : next;
    });
  }, [visibleWorkspaceIds]);

  const toggleWorkspaceSelection = (workspaceId: string, checked: boolean) => {
    setSelectedWorkspaceIds((previous) => {
      const next = new Set(previous);
      if (checked) {
        next.add(workspaceId);
      } else {
        next.delete(workspaceId);
      }
      return next;
    });
  };
  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedWorkspaceIds((previous) => {
      const next = new Set(previous);
      for (const workspace of filteredWorkspaceRanking) {
        if (checked) {
          next.add(workspace.workspaceId);
        } else {
          next.delete(workspace.workspaceId);
        }
      }
      return next;
    });
  };
  const applyBatchActionStatus = (status: OrganizationActionStatus) => {
    for (const action of batchPreviewActions) {
      updateActionStatus(action.id, status, t('org_overview_actions_batch_note'));
    }
  };

  const selectedAction = useMemo(() => {
    if (actionsWithState.length === 0) {
      return null;
    }
    if (!selectedActionId) {
      return actionsWithState[0] ?? null;
    }
    return actionsWithState.find((action) => action.id === selectedActionId) ?? actionsWithState[0] ?? null;
  }, [actionsWithState, selectedActionId]);
  const selectedActionEvidence = useMemo(() => {
    return getActionEvidence(orgRollup.rollup, selectedAction);
  }, [orgRollup.rollup, selectedAction]);
  const selectedActionDrilldownQuery = useMemo(() => {
    if (!selectedAction) {
      return '';
    }
    return buildGovernanceDrilldownQuery({
      gov_from: 'organization_overview',
      gov_action_id: selectedAction.id,
      gov_kind: selectedAction.memberId ? 'member' : selectedAction.projectId ? 'project' : 'workspace',
      gov_workspace_id: selectedAction.workspaceId,
      gov_project_id: selectedAction.projectId,
      gov_member_id: selectedAction.memberId,
      gov_reason: selectedAction.description,
      gov_related_signals: selectedActionEvidence?.relatedAttention.length,
      gov_blocked_signals: selectedActionEvidence?.blockedSignals,
      gov_warning_signals: selectedActionEvidence?.warningSignals,
      gov_project_signals: selectedActionEvidence?.projectSignals,
      gov_member_signals: selectedActionEvidence?.memberSignals,
      gov_workspace_risk_score: selectedActionEvidence?.workspaceSnapshot?.riskScore,
      gov_workspace_blocked_items: selectedActionEvidence?.workspaceSnapshot?.blockedItems,
      gov_workspace_warning_items: selectedActionEvidence?.workspaceSnapshot?.warningItems,
      gov_workspace_risky_projects: selectedActionEvidence?.workspaceSnapshot?.riskyProjects,
    });
  }, [selectedAction, selectedActionEvidence]);

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
                      onChange={(event) => setReadinessFilter(event.target.value as WorkspaceReadinessFilter)}
                      className="h-9 rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground"
                      data-testid="workspace-overview__readiness-filter"
                    >
                      <option value="all">{t('org_overview_filter_all')}</option>
                      <option value="blocked">{t('org_overview_status_blocked')}</option>
                      <option value="warning">{t('org_overview_status_warning')}</option>
                      <option value="ready">{t('org_overview_status_ready')}</option>
                    </select>
                  </div>
                  <div className="mb-3 grid gap-2 md:grid-cols-[auto_auto_1fr] md:items-center">
                    <label className="inline-flex items-center gap-2 text-xs text-tertiary" htmlFor="workspace-overview-sort">
                      <span>{t('org_overview_sort_label')}</span>
                      <select
                        id="workspace-overview-sort"
                        value={workspaceSort}
                        onChange={(event) => setWorkspaceSort(event.target.value as WorkspaceSortOption)}
                        className="h-8 rounded-sm border border-subtle bg-surface px-2.5 text-xs text-foreground"
                        data-testid="workspace-overview__sort"
                      >
                        <option value="risk_desc">{t('org_overview_sort_risk_desc')}</option>
                        <option value="risk_asc">{t('org_overview_sort_risk_asc')}</option>
                        <option value="blocked_desc">{t('org_overview_sort_blocked_desc')}</option>
                        <option value="name_asc">{t('org_overview_sort_name_asc')}</option>
                        <option value="name_desc">{t('org_overview_sort_name_desc')}</option>
                      </select>
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-tertiary">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                        data-testid="workspace-overview__matrix-select-all"
                      />
                      <span>{t('org_overview_select_all_visible')}</span>
                    </label>
                    <p className="text-xs text-tertiary" data-testid="workspace-overview__matrix-selection-count">
                      {t('org_overview_selected_workspaces_count', { count: selectedWorkspaceCount })}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {filteredWorkspaceRanking.map((workspace) => (
                      <div
                        key={workspace.workspaceId}
                        className="grid gap-3 rounded-sm border border-subtle bg-bg-base/20 p-3 md:grid-cols-[auto_1.2fr_auto_auto_auto_auto_auto]"
                        data-testid={`workspace-overview__row--${workspace.workspaceId}`}
                      >
                        <label className="mt-0.5 inline-flex items-center justify-center">
                          <input
                            type="checkbox"
                            checked={selectedWorkspaceIds.has(workspace.workspaceId)}
                            onChange={(event) => toggleWorkspaceSelection(workspace.workspaceId, event.target.checked)}
                            data-testid={`workspace-overview__matrix-select--${workspace.workspaceId}`}
                          />
                        </label>
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
                        {workspace.topRiskProjectId ? (
                          <Link
                            href={`/${locale}/workspaces/${workspace.workspaceId}/projects/${workspace.topRiskProjectId}/audit${buildGovernanceDrilldownQuery({
                              gov_from: 'organization_overview',
                              gov_kind: 'workspace',
                              gov_workspace_id: workspace.workspaceId,
                              gov_project_id: workspace.topRiskProjectId,
                              gov_reason: 'workspace_audit_review',
                              gov_workspace_risk_score: workspace.riskScore,
                              gov_workspace_blocked_items: workspace.blockedItems,
                              gov_workspace_warning_items: workspace.warningItems,
                              gov_workspace_risky_projects: workspace.riskyProjects,
                            })}`}
                            className={cn(
                              'inline-flex h-8 items-center justify-center rounded-sm border border-subtle px-2.5 text-xs font-medium text-foreground transition-colors',
                              'hover:bg-hover',
                            )}
                            data-testid={`workspace-overview__open-audit--${workspace.workspaceId}`}
                          >
                            {t('org_overview_open_audit')}
                          </Link>
                        ) : (
                          <span
                            className="inline-flex h-8 items-center justify-center rounded-sm border border-subtle px-2.5 text-xs text-tertiary"
                            data-testid={`workspace-overview__open-audit-disabled--${workspace.workspaceId}`}
                          >
                            {t('org_overview_open_audit')}
                          </span>
                        )}
                      </div>
                    ))}
                    {filteredWorkspaceRanking.length === 0 ? (
                      <p className="rounded-sm border border-subtle bg-bg-base/20 px-3 py-2 text-sm text-tertiary">
                        {t('org_overview_matrix_empty_filtered')}
                      </p>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-md border border-border bg-surface p-4" data-testid="workspace-overview__batch-preview">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-base font-semibold text-foreground">{t('org_overview_batch_preview_title')}</h2>
                    <p className="text-xs text-tertiary" data-testid="workspace-overview__batch-preview-count">
                      {t('org_overview_batch_preview_count', { count: batchPreviewSummary.total })}
                    </p>
                  </div>
                  {batchPreviewSummary.total === 0 ? (
                    <p className="mt-2 text-sm text-tertiary">{t('org_overview_batch_preview_empty')}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <EvidenceMetric
                          testId="workspace-overview__batch-preview-metric-blocked"
                          label={t('org_overview_action_explain_blocked_signals')}
                          value={batchPreviewSummary.blocked}
                        />
                        <EvidenceMetric
                          testId="workspace-overview__batch-preview-metric-warning"
                          label={t('org_overview_action_explain_warning_signals')}
                          value={batchPreviewSummary.warning}
                        />
                        <EvidenceMetric
                          testId="workspace-overview__batch-preview-metric-pending"
                          label={t('org_overview_action_status_pending')}
                          value={batchPreviewSummary.pending}
                        />
                        <EvidenceMetric
                          testId="workspace-overview__batch-preview-metric-in-progress"
                          label={t('org_overview_action_status_in_progress')}
                          value={batchPreviewSummary.inProgress}
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                        <EvidenceMetric
                          testId="workspace-overview__batch-preview-metric-completed"
                          label={t('org_overview_action_status_completed')}
                          value={batchPreviewSummary.completed}
                        />
                        <EvidenceMetric
                          testId="workspace-overview__batch-preview-metric-blocked-status"
                          label={t('org_overview_action_status_blocked')}
                          value={batchPreviewSummary.blockedStatus}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => applyBatchActionStatus('in_progress')}
                          className={cn(
                            'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                            'hover:bg-hover',
                          )}
                          data-testid="workspace-overview__batch-mark-in-progress"
                        >
                          {t('org_overview_action_mark_in_progress')}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyBatchActionStatus('completed')}
                          className={cn(
                            'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                            'hover:bg-hover',
                          )}
                          data-testid="workspace-overview__batch-mark-completed"
                        >
                          {t('org_overview_action_mark_completed')}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyBatchActionStatus('blocked')}
                          className={cn(
                            'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                            'hover:bg-hover',
                          )}
                          data-testid="workspace-overview__batch-mark-blocked"
                        >
                          {t('org_overview_action_mark_blocked')}
                        </button>
                        <button
                          type="button"
                          onClick={() => applyBatchActionStatus('pending')}
                          className={cn(
                            'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                            'hover:bg-hover',
                          )}
                          data-testid="workspace-overview__batch-mark-pending"
                        >
                          {t('org_overview_action_mark_pending')}
                        </button>
                      </div>
                      <div className="space-y-1">
                        {batchPreviewActions.slice(0, 8).map((action) => {
                          const actionIdForTest = action.id.replace(/:/g, '--');
                          return (
                            <p
                              key={`batch-preview-${action.id}`}
                              className="text-xs text-tertiary"
                              data-testid={`workspace-overview__batch-preview-item--${actionIdForTest}`}
                            >
                              {action.workspaceName} · {t(`org_overview_action_type_${action.actionType}`)} · {t(`org_overview_action_status_${action.currentStatus}`)}
                            </p>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>

                <section className="rounded-md border border-border bg-surface p-4" data-testid="workspace-overview__attention">
                  <h2 className="text-base font-semibold text-foreground">{t('org_overview_attention_title')}</h2>
                  {orgRollup.rollup.attention.length === 0 ? (
                    <p className="mt-2 text-sm text-tertiary">{t('org_overview_attention_empty')}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      {orgRollup.rollup.attention.map((item) => {
                        const testIdSegment = item.id.replace(/:/g, '--');
                        const drilldownQuery = buildGovernanceDrilldownQuery({
                          gov_from: 'organization_overview',
                          gov_kind: item.kind,
                          gov_workspace_id: item.workspaceId,
                          gov_project_id: item.projectId,
                          gov_member_id: item.memberId,
                          gov_reason: item.description,
                        });
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
                                  href={`/${locale}/workspaces/${item.workspaceId}/projects/${item.projectId}/audit${drilldownQuery}`}
                                  className={cn(
                                    'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                    'hover:bg-hover',
                                  )}
                                  data-testid={`workspace-overview__attention-open-audit--${testIdSegment}`}
                                >
                                  {t('org_overview_open_audit')}
                                </Link>
                                <Link
                                  href={`/${locale}/workspaces/${item.workspaceId}/projects/${item.projectId}/audit${drilldownQuery}`}
                                  className={cn(
                                    'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                    'hover:bg-hover',
                                  )}
                                  data-testid={`workspace-overview__attention-open-audit-secondary--${testIdSegment}`}
                                >
                                  {t('org_overview_open_audit')}
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
                        const actionEvidence = getActionEvidence(orgRollup.rollup, action);
                        const actionDrilldownQuery = buildGovernanceDrilldownQuery({
                          gov_from: 'organization_overview',
                          gov_action_id: action.id,
                          gov_kind: action.memberId ? 'member' : action.projectId ? 'project' : 'workspace',
                          gov_workspace_id: action.workspaceId,
                          gov_project_id: action.projectId,
                          gov_member_id: action.memberId,
                          gov_reason: action.description,
                          gov_related_signals: actionEvidence?.relatedAttention.length,
                          gov_blocked_signals: actionEvidence?.blockedSignals,
                          gov_warning_signals: actionEvidence?.warningSignals,
                          gov_project_signals: actionEvidence?.projectSignals,
                          gov_member_signals: actionEvidence?.memberSignals,
                          gov_workspace_risk_score: actionEvidence?.workspaceSnapshot?.riskScore,
                          gov_workspace_blocked_items: actionEvidence?.workspaceSnapshot?.blockedItems,
                          gov_workspace_warning_items: actionEvidence?.workspaceSnapshot?.warningItems,
                          gov_workspace_risky_projects: actionEvidence?.workspaceSnapshot?.riskyProjects,
                        });
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
                            <button
                              type="button"
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              onClick={() => setSelectedActionId(action.id)}
                              data-testid={`workspace-overview__actions-queue-open-explain--${actionIdForTest}`}
                            >
                              {t('org_overview_action_open_explain')}
                            </button>
                            <Link
                              href={`/${locale}/workspaces/${action.workspaceId}/settings${actionDrilldownQuery}`}
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
                                href={`/${locale}/workspaces/${action.workspaceId}/projects/${action.projectId}/audit${actionDrilldownQuery}`}
                                className={cn(
                                  'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                  'hover:bg-hover',
                                )}
                                data-testid={`workspace-overview__actions-queue-open-audit-secondary--${actionIdForTest}`}
                              >
                                {t('org_overview_open_audit')}
                              </Link>
                            ) : null}
                            {action.projectId && action.memberId ? (
                              <Link
                                href={`/${locale}/workspaces/${action.workspaceId}/projects/${action.projectId}/members?member_id=${action.memberId}&member_tab=people${actionDrilldownQuery.replace('?', '&')}`}
                                className={cn(
                                  'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                  'hover:bg-hover',
                                )}
                                data-testid={`workspace-overview__actions-queue-open-members--${actionIdForTest}`}
                              >
                                {t('org_overview_open_members')}
                              </Link>
                            ) : null}
                            {action.projectId ? (
                              <Link
                                href={`/${locale}/workspaces/${action.workspaceId}/projects/${action.projectId}/audit${actionDrilldownQuery}`}
                                className={cn(
                                  'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                  'hover:bg-hover',
                                )}
                                data-testid={`workspace-overview__actions-queue-open-audit--${actionIdForTest}`}
                              >
                                {t('org_overview_open_audit')}
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

                <section className="rounded-md border border-border bg-surface p-4" data-testid="workspace-overview__action-explain-panel">
                  <h2 className="text-base font-semibold text-foreground">{t('org_overview_action_explain_title')}</h2>
                  {!selectedAction ? (
                    <p className="mt-2 text-sm text-tertiary">{t('org_overview_action_explain_empty')}</p>
                  ) : (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm font-medium text-foreground">{selectedAction.workspaceName}</p>
                      <p className="text-xs text-tertiary">{t(`org_overview_action_type_${selectedAction.actionType}`)}</p>
                      <p className="text-xs text-tertiary">{selectedAction.description || t('org_overview_action_explain_reason_fallback')}</p>
                      {selectedActionEvidence ? (
                        <div
                          className="rounded-sm border border-subtle bg-bg-base/20 p-3"
                          data-testid="workspace-overview__action-explain-evidence"
                        >
                          <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">
                            {t('org_overview_action_explain_evidence_title')}
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-related-signals"
                              label={t('org_overview_action_explain_related_signals')}
                              value={selectedActionEvidence.relatedAttention.length}
                            />
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-blocked-signals"
                              label={t('org_overview_action_explain_blocked_signals')}
                              value={selectedActionEvidence.blockedSignals}
                            />
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-warning-signals"
                              label={t('org_overview_action_explain_warning_signals')}
                              value={selectedActionEvidence.warningSignals}
                            />
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-project-signals"
                              label={t('org_overview_action_explain_project_signals')}
                              value={selectedActionEvidence.projectSignals}
                            />
                          </div>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-member-signals"
                              label={t('org_overview_action_explain_member_signals')}
                              value={selectedActionEvidence.memberSignals}
                            />
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-workspace-risk-score"
                              label={t('org_overview_risk_score')}
                              value={selectedActionEvidence.workspaceSnapshot?.riskScore ?? 0}
                            />
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-workspace-blocked-items"
                              label={t('org_overview_action_explain_workspace_blocked_items')}
                              value={selectedActionEvidence.workspaceSnapshot?.blockedItems ?? 0}
                            />
                            <EvidenceMetric
                              testId="workspace-overview__action-explain-metric-workspace-warning-items"
                              label={t('org_overview_action_explain_workspace_warning_items')}
                              value={selectedActionEvidence.workspaceSnapshot?.warningItems ?? 0}
                            />
                          </div>
                          <p className="mt-2 text-xs text-tertiary">
                            {t('org_overview_action_explain_workspace_risky_projects', {
                              count: selectedActionEvidence.workspaceSnapshot?.riskyProjects ?? 0,
                            })}
                          </p>
                          {selectedAction.projectId &&
                          selectedActionEvidence.workspaceSnapshot?.topRiskProjectId === selectedAction.projectId ? (
                            <p className="text-xs text-tertiary">{t('org_overview_action_explain_top_risk_project')}</p>
                          ) : null}
                          {selectedActionEvidence.relatedAttention.length > 0 ? (
                            <div className="mt-2 space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">
                                {t('org_overview_action_explain_related_feed_title')}
                              </p>
                              {selectedActionEvidence.relatedAttention.slice(0, 3).map((item) => {
                                const itemIdForTest = item.id.replace(/:/g, '--');
                                return (
                                  <p
                                    key={item.id}
                                    className="text-xs text-tertiary"
                                    data-testid={`workspace-overview__action-explain-related-item--${itemIdForTest}`}
                                  >
                                    {item.title} · {item.description}
                                  </p>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Link
                          href={`/${locale}/workspaces/${selectedAction.workspaceId}/settings${selectedActionDrilldownQuery}`}
                          className={cn(
                            'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                            'hover:bg-hover',
                          )}
                          data-testid="workspace-overview__action-explain-open-settings"
                        >
                          {t('org_overview_open_settings')}
                        </Link>
                        {selectedAction.projectId ? (
                          <>
                            <Link
                              href={`/${locale}/workspaces/${selectedAction.workspaceId}/projects/${selectedAction.projectId}/audit${selectedActionDrilldownQuery}`}
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              data-testid="workspace-overview__action-explain-open-audit"
                            >
                              {t('org_overview_open_audit')}
                            </Link>
                            <Link
                              href={`/${locale}/workspaces/${selectedAction.workspaceId}/projects/${selectedAction.projectId}/resource-policy${selectedActionDrilldownQuery}`}
                              className={cn(
                                'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              data-testid="workspace-overview__action-explain-open-policy"
                            >
                              {t('org_overview_open_policy')}
                            </Link>
                            {selectedAction.memberId ? (
                              <Link
                                href={`/${locale}/workspaces/${selectedAction.workspaceId}/projects/${selectedAction.projectId}/members?member_id=${selectedAction.memberId}&member_tab=people${selectedActionDrilldownQuery.replace('?', '&')}`}
                                className={cn(
                                  'inline-flex h-7 items-center rounded-sm border border-subtle px-2 text-xs font-medium text-foreground transition-colors',
                                  'hover:bg-hover',
                                )}
                                data-testid="workspace-overview__action-explain-open-members"
                              >
                                {t('org_overview_open_members')}
                              </Link>
                            ) : null}
                          </>
                        ) : null}
                      </div>
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

function compareWorkspaceRanking(
  left: {
    workspaceName: string;
    riskScore: number;
    blockedItems: number;
    warningItems: number;
  },
  right: {
    workspaceName: string;
    riskScore: number;
    blockedItems: number;
    warningItems: number;
  },
  sortBy: WorkspaceSortOption,
) {
  switch (sortBy) {
    case 'risk_asc':
      return left.riskScore - right.riskScore || left.workspaceName.localeCompare(right.workspaceName);
    case 'name_asc':
      return left.workspaceName.localeCompare(right.workspaceName);
    case 'name_desc':
      return right.workspaceName.localeCompare(left.workspaceName);
    case 'blocked_desc':
      return (
        right.blockedItems - left.blockedItems ||
        right.warningItems - left.warningItems ||
        right.riskScore - left.riskScore ||
        left.workspaceName.localeCompare(right.workspaceName)
      );
    case 'risk_desc':
    default:
      return right.riskScore - left.riskScore || left.workspaceName.localeCompare(right.workspaceName);
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

function EvidenceMetric({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div className="rounded-sm border border-subtle bg-surface px-2.5 py-2" data-testid={testId}>
      <p className="text-[11px] uppercase tracking-[0.1em] text-tertiary">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

type OrganizationRollupPayload = NonNullable<ReturnType<typeof useOrganizationGovernanceRollup>['rollup']>;

interface ActionEvidence {
  workspaceSnapshot: OrganizationRollupPayload['workspaceRanking'][number] | undefined;
  relatedAttention: OrganizationRollupPayload['attention'];
  blockedSignals: number;
  warningSignals: number;
  projectSignals: number;
  memberSignals: number;
}

function getActionEvidence(
  rollup: OrganizationRollupPayload | null | undefined,
  action:
    | {
        workspaceId: string;
        projectId?: string;
        memberId?: string;
      }
    | null
    | undefined,
): ActionEvidence | null {
  if (!rollup || !action) {
    return null;
  }
  const workspaceSnapshot = rollup.workspaceRanking.find((item) => item.workspaceId === action.workspaceId);
  const relatedAttention = rollup.attention.filter((item) => {
    if (item.workspaceId !== action.workspaceId) {
      return false;
    }
    if (action.projectId && item.projectId === action.projectId) {
      return true;
    }
    if (action.memberId && item.memberId === action.memberId) {
      return true;
    }
    return !action.projectId && !action.memberId;
  });
  return {
    workspaceSnapshot,
    relatedAttention,
    blockedSignals: relatedAttention.filter((item) => item.severity === 'blocked').length,
    warningSignals: relatedAttention.filter((item) => item.severity === 'warning').length,
    projectSignals: relatedAttention.filter((item) => item.kind === 'project').length,
    memberSignals: relatedAttention.filter((item) => item.kind === 'member').length,
  };
}
