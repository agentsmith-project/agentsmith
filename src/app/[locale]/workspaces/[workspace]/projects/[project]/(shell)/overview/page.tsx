'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, ArrowRight, Bot, Clock3, Gauge, MessageSquare, Server, Sparkles, Wrench } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { buttonVariants } from '@/components/ui/button';
import { ActivityTimeline, ProjectNavigation } from '@/components/dashboard';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { useRuntimeObservability, useUsageOperationsSummary, useUsageReportEvidence, useAuditEvents } from '@/lib/hooks/use-audit-usage';
import { useCurrentPermissions, useHasPermission } from '@/lib/hooks/use-permissions';
import { useReleaseEscalationList, useReleaseGateRunList, useReleaseReportList } from '@/lib/hooks/use-release-ops';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { formatNumber } from '@/lib/utils/formatters';
import { cn } from '@/lib/utils';
import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';
import type { NavItem } from '@/components/dashboard/ProjectNavigation';
import type { ReleaseGateRunListItem, ReleaseReportListItem } from '@/lib/api/endpoints/release-ops';

type TimeRangePreset = '24h' | '7d';
type HomeStatusTone = 'ready' | 'warning' | 'blocked';
type AttentionItem = {
  id: string;
  tone: HomeStatusTone;
  title: string;
  body: string;
  href: string;
  actionLabel: string;
};
type PrimaryActionItem = {
  id: string;
  tone: HomeStatusTone;
  title: string;
  body: string;
  href: string;
  actionLabel: string;
};

function getTimeRange(preset: TimeRangePreset): { start_time: string; end_time: string } {
  const end = new Date();
  const start = new Date();
  if (preset === '24h') {
    start.setHours(start.getHours() - 24);
  } else {
    start.setDate(start.getDate() - 7);
  }
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

function sortByNewest<T extends { generated_at?: string; started_at?: string; created_at?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.generated_at ?? a.started_at ?? a.created_at ?? 0).getTime();
    const bTime = new Date(b.generated_at ?? b.started_at ?? b.created_at ?? 0).getTime();
    return bTime - aTime;
  });
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
}

function formatUsd(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--';
  return `$${value.toFixed(6)}`;
}

function mapEnforcementTone(
  decision?: 'ready' | 'warning' | 'blocked' | 'pending_override' | 'releasable_with_override',
): HomeStatusTone {
  if (!decision) return 'warning';
  if (decision === 'blocked' || decision === 'pending_override') return 'blocked';
  if (decision === 'warning' || decision === 'releasable_with_override') return 'warning';
  return 'ready';
}

function latestRun(items?: ReleaseGateRunListItem[]): ReleaseGateRunListItem | null {
  if (!items || items.length === 0) return null;
  return sortByNewest(items)[0] ?? null;
}

function latestReport(items?: ReleaseReportListItem[]): ReleaseReportListItem | null {
  if (!items || items.length === 0) return null;
  return sortByNewest(items)[0] ?? null;
}

function statusToneClassName(tone: HomeStatusTone): string {
  if (tone === 'blocked') return 'border-error/25 bg-error/5';
  if (tone === 'warning') return 'border-accent/25 bg-accent/5';
  return 'border-success/25 bg-success/5';
}

export default function OverviewPage() {
  const t = useTranslations('overview');
  const tErrors = useTranslations('errors');
  const tNav = useTranslations('nav');
  const params = useParams();
  const workspaceId = validateWorkspaceParam(params.workspace);
  const projectId = validateProjectParam(params.project);
  const locale = (params.locale as string) || 'en-US';
  const canReadOverview = useHasPermission('project:endpoint:use');
  const currentPermissions = useCurrentPermissions();
  const isValidParams = !!workspaceId && !!projectId;

  useSyncAuthFromUrl();

  const [timeRangePreset, setTimeRangePreset] = React.useState<TimeRangePreset>('24h');
  const timeRange = React.useMemo(() => getTimeRange(timeRangePreset), [timeRangePreset]);

  const auditEventsQuery = useAuditEvents(workspaceId ?? '', projectId ?? '', {
    page: 1,
    page_size: 5,
    start_time: timeRange.start_time,
    end_time: timeRange.end_time,
  }, {
    enabled: isValidParams && canReadOverview,
  });
  const runtimeQuery = useRuntimeObservability(workspaceId ?? '', projectId ?? '', timeRange, {
    enabled: isValidParams && canReadOverview,
  });
  const operationsSummaryQuery = useUsageOperationsSummary(workspaceId ?? '', projectId ?? '', timeRange, {
    enabled: isValidParams && canReadOverview,
  });
  const usageEvidenceQuery = useUsageReportEvidence(workspaceId ?? '', projectId ?? '', {
    enabled: isValidParams && canReadOverview,
  });
  const releaseReportsQuery = useReleaseReportList({ workspaceId: workspaceId ?? '', projectId: projectId ?? '' }, {
    enabled: isValidParams && canReadOverview,
  });
  const releaseRunsQuery = useReleaseGateRunList({ workspaceId: workspaceId ?? '', projectId: projectId ?? '' }, {
    enabled: isValidParams && canReadOverview,
  });
  const escalationsQuery = useReleaseEscalationList({
    enabled: isValidParams && canReadOverview,
  });

  if (!workspaceId || !projectId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadOverview) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;
  // WP-03: Updated to new runtime-console route with monitoring tab
  const runtimeHref = `${basePath}/runtime-console?tab=monitoring${buildSharedOpsFilterQuery(timeRange)}`;
  const usageHref = `${basePath}/usage${buildSharedOpsFilterQuery(timeRange, { panel: 'usage' })}`;
  // WP-03: Updated to new runtime-console route with control tab
  const releaseOpsHref = `${basePath}/runtime-console?tab=control${buildSharedOpsFilterQuery(timeRange)}`;

  const runtime = runtimeQuery.data;
  const operationsSummary = operationsSummaryQuery.data;
  const usageEvidence = usageEvidenceQuery.data;
  const latestReportItem = latestReport(releaseReportsQuery.data?.items);
  const latestRunItem = latestRun(releaseRunsQuery.data?.items);
  const openEscalations = (escalationsQuery.data?.items ?? []).filter((item) => item.status === 'open');
  const criticalOpenEscalations = openEscalations.filter((item) => item.severity === 'critical');
  const overdueEscalations = openEscalations.filter((item) => item.sla_status === 'overdue');
  const dueSoonEscalations = openEscalations.filter((item) => item.sla_status === 'due_soon');

  const runtimeTone: HomeStatusTone = runtime
    ? runtime.health_summary.missing_price_facts > 0 || runtime.health_summary.terminal_error_requests > 0
      ? 'blocked'
      : runtime.error_rate > 0.03 || runtime.health_summary.recovered_requests > 0 || runtime.degradation_signals.length > 0
        ? 'warning'
        : 'ready'
    : 'warning';
  const costTone: HomeStatusTone = runtime?.health_summary.missing_price_facts
    ? 'blocked'
    : ((operationsSummary?.anomaly_peaks ?? []).some((item) => item.metric === 'cost' && item.severity === 'high')
      ? 'warning'
      : 'ready');
  const releaseTone: HomeStatusTone = mapEnforcementTone(latestReportItem?.policy_enforcement?.decision);
  const incidentTone: HomeStatusTone = overdueEscalations.length > 0 || criticalOpenEscalations.length > 0
    ? 'blocked'
    : openEscalations.length > 0 || dueSoonEscalations.length > 0
      ? 'warning'
      : 'ready';

  const attentionItems: AttentionItem[] = [];
  if (releaseTone === 'blocked') {
    attentionItems.push({
      id: 'release-blocked',
      tone: 'blocked',
      title: t('attention.release_blocked_title'),
      body: t('attention.release_blocked_body'),
      href: releaseOpsHref,
      actionLabel: t('attention.open_release_ops'),
    });
  }
  if (overdueEscalations.length > 0) {
    attentionItems.push({
      id: 'escalations-overdue',
      tone: 'blocked',
      title: t('attention.overdue_escalations_title', { count: overdueEscalations.length }),
      body: t('attention.overdue_escalations_body'),
      href: releaseOpsHref,
      actionLabel: t('attention.handle_incident'),
    });
  }
  if ((runtime?.health_summary.missing_price_facts ?? 0) > 0) {
    attentionItems.push({
      id: 'missing-price',
      tone: 'blocked',
      title: t('attention.missing_price_title', { count: runtime?.health_summary.missing_price_facts ?? 0 }),
      body: t('attention.missing_price_body'),
      // WP-03: Updated to new runtime-console route with monitoring tab
      href: `${basePath}/runtime-console?tab=monitoring${buildSharedOpsFilterQuery({
        ...timeRange,
        result: 'error',
      })}`,
      actionLabel: t('attention.review_runtime'),
    });
  }
  if (usageEvidence?.release_readiness === 'blocked') {
    attentionItems.push({
      id: 'usage-evidence-blocked',
      tone: 'blocked',
      title: t('attention.usage_evidence_blocked_title'),
      body: t('attention.usage_evidence_blocked_body'),
      href: usageHref,
      actionLabel: t('attention.review_cost'),
    });
  }
  if ((operationsSummary?.anomaly_peaks ?? []).some((item) => item.metric === 'cost')) {
    attentionItems.push({
      id: 'cost-anomaly',
      tone: 'warning',
      title: t('attention.cost_anomaly_title'),
      body: t('attention.cost_anomaly_body'),
      href: usageHref,
      actionLabel: t('attention.review_cost'),
    });
  }
  if ((runtime?.degradation_signals ?? []).some((signal) => signal.kind === 'fallback_spike' || signal.kind === 'error_rate_spike')) {
    attentionItems.push({
      id: 'runtime-degradation',
      tone: 'warning',
      title: t('attention.runtime_degradation_title'),
      body: t('attention.runtime_degradation_body'),
      // WP-03: Updated to new runtime-console route with monitoring tab
      href: `${basePath}/runtime-console?tab=monitoring${buildSharedOpsFilterQuery({
        ...timeRange,
        result: 'error',
      })}`,
      actionLabel: t('attention.investigate_runtime'),
    });
  }

  const primaryActions: PrimaryActionItem[] = [];
  primaryActions.push(
    releaseTone === 'blocked'
      ? {
          id: 'resolve-release-blockers',
          tone: 'blocked',
          title: t('primary_actions.resolve_release_blockers_title'),
          body: t('primary_actions.resolve_release_blockers_body'),
          href: releaseOpsHref,
          actionLabel: t('primary_actions.open_release_ops'),
        }
      : {
          id: 'review-release-readiness',
          tone: releaseTone,
          title: t('primary_actions.review_release_readiness_title'),
          body: t('primary_actions.review_release_readiness_body'),
          href: releaseOpsHref,
          actionLabel: t('primary_actions.open_release_ops'),
        },
  );
  primaryActions.push(
    runtimeTone === 'blocked' || runtimeTone === 'warning'
      ? {
          id: 'investigate-runtime',
          tone: runtimeTone,
          title: t('primary_actions.investigate_runtime_title'),
          body: t('primary_actions.investigate_runtime_body'),
          // WP-03: Updated to new runtime-console route with monitoring tab
          href: `${basePath}/runtime-console?tab=monitoring${buildSharedOpsFilterQuery({
            ...timeRange,
            result: 'error',
          })}`,
          actionLabel: t('primary_actions.open_runtime'),
        }
      : {
          id: 'review-runtime-health',
          tone: 'ready',
          title: t('primary_actions.review_runtime_health_title'),
          body: t('primary_actions.review_runtime_health_body'),
          href: runtimeHref,
          actionLabel: t('primary_actions.open_runtime'),
        },
  );
  primaryActions.push(
    costTone === 'blocked' || costTone === 'warning'
      ? {
          id: 'review-cost-anomalies',
          tone: costTone,
          title: t('primary_actions.review_cost_anomalies_title'),
          body: t('primary_actions.review_cost_anomalies_body'),
          href: `${basePath}/usage${buildSharedOpsFilterQuery({
            ...timeRange,
            result: costTone === 'blocked' ? 'error' : undefined,
          }, { panel: 'usage' })}`,
          actionLabel: t('primary_actions.open_usage'),
        }
      : {
          id: 'review-cost-health',
          tone: 'ready',
          title: t('primary_actions.review_cost_health_title'),
          body: t('primary_actions.review_cost_health_body'),
          href: usageHref,
          actionLabel: t('primary_actions.open_usage'),
        },
  );
  primaryActions.push(
    incidentTone === 'blocked' || incidentTone === 'warning'
      ? {
          id: 'handle-open-incidents',
          tone: incidentTone,
          title: t('primary_actions.handle_open_incidents_title'),
          body: t('primary_actions.handle_open_incidents_body'),
          href: releaseOpsHref,
          actionLabel: t('primary_actions.open_release_ops'),
        }
      : {
          id: 'review-incident-ownership',
          tone: 'ready',
          title: t('primary_actions.review_incident_ownership_title'),
          body: t('primary_actions.review_incident_ownership_body'),
          href: releaseOpsHref,
          actionLabel: t('primary_actions.open_release_ops'),
        },
  );

  const quickActions: NavItem[] = [
    {
      icon: MessageSquare,
      label: tNav('chat'),
      href: '/chat',
      description: t('actions.chat'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Wrench,
      label: tNav('notebook'),
      href: '/notebook',
      description: t('actions.notebook'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Bot,
      label: tNav('agents'),
      href: '/agents',
      description: t('actions.agents'),
      requiresPermission: 'project:agent:manage',
    },
    {
      icon: Server,
      label: tNav('endpoints'),
      href: '/endpoints',
      description: t('actions.endpoints'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Sparkles,
      label: t('actions.runtime'),
      // WP-03: Updated to new runtime-console route with monitoring tab
      href: '/runtime-console?tab=monitoring',
      description: t('actions.runtime_description'),
      requiresPermission: 'project:endpoint:use',
    },
    {
      icon: Gauge,
      label: tNav('release_ops'),
      // WP-03: Updated to new runtime-console route with control tab
      href: '/runtime-console?tab=control',
      description: t('actions.release_ops'),
      requiresPermission: 'project:endpoint:use',
    },
  ];

  const activityItems = (auditEventsQuery.data?.items ?? []).map((event) => ({
    id: event.id,
    icon: event.result === 'error' ? AlertCircle : Clock3,
    title: event.action,
    description: event.resource_type ? `${event.resource_type}: ${event.resource_id}` : undefined,
    timestamp: new Date(event.timestamp).toLocaleString(),
    copyableId: event.request_id,
  }));

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={t('title')}
            subtitle={t('subtitle')}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={runtimeHref}
                  className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                  data-testid="overview__open-runtime"
                >
                  {t('open_runtime')}
                </Link>
                <Link
                  href={usageHref}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="overview__open-usage"
                >
                  {t('open_usage')}
                </Link>
                <Link
                  href={releaseOpsHref}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="overview__open-release-ops"
                >
                  {t('open_release_ops')}
                </Link>
              </div>
            )}
          />
        )}
        toolbar={(
          <PageToolbar>
            <Select value={timeRangePreset} onValueChange={(value) => setTimeRangePreset(value as TimeRangePreset)}>
              <SelectTrigger className="w-[160px]" data-testid="overview__time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="24h">{t('time_ranges.last_24h')}</SelectItem>
                <SelectItem value="7d">{t('time_ranges.last_7d')}</SelectItem>
              </SelectContent>
            </Select>
          </PageToolbar>
        )}
      >
        <div className="space-y-6" data-testid="overview__ai-ops-home">
          <div className="grid gap-4 xl:grid-cols-4" data-testid="overview__status-strip">
            <Card className={statusToneClassName(runtimeTone)} data-testid="overview__status-runtime">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground">{t('status.runtime')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge status={runtimeTone}>{t(`status_labels.${runtimeTone}`)}</StatusBadge>
                  <span className="text-xs text-tertiary">{formatPercent(runtime?.error_rate)}</span>
                </div>
                <div className="text-sm text-tertiary">
                  {t('status.runtime_body', {
                    requests: formatNumber(runtime?.total_requests ?? 0),
                    recovered: formatNumber(runtime?.health_summary.recovered_requests ?? 0),
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className={statusToneClassName(costTone)} data-testid="overview__status-cost">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground">{t('status.cost')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge status={costTone}>{t(`status_labels.${costTone}`)}</StatusBadge>
                  <span className="text-xs text-tertiary">{formatUsd(runtime?.p95_estimated_cost)}</span>
                </div>
                <div className="text-sm text-tertiary">
                  {t('status.cost_body', {
                    avg_cost: formatUsd(runtime?.avg_estimated_cost),
                    anomalies: formatNumber((operationsSummary?.anomaly_peaks ?? []).length),
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className={statusToneClassName(releaseTone)} data-testid="overview__status-release">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground">{t('status.release')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge status={latestReportItem?.policy_enforcement?.decision ?? releaseTone}>
                    {latestReportItem?.policy_enforcement?.decision
                      ? t(`release_labels.${latestReportItem.policy_enforcement.decision}`)
                      : t('release_labels.unknown')}
                  </StatusBadge>
                  <span className="text-xs text-tertiary">{latestReportItem?.name ?? '--'}</span>
                </div>
                <div className="text-sm text-tertiary">
                  {t('status.release_body', {
                    blockers: formatNumber(latestReportItem?.policy_enforcement?.blocker_count ?? 0),
                    warnings: formatNumber(latestReportItem?.policy_enforcement?.warning_count ?? 0),
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className={statusToneClassName(incidentTone)} data-testid="overview__status-incidents">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-foreground">{t('status.incidents')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge status={incidentTone}>{t(`status_labels.${incidentTone}`)}</StatusBadge>
                  <span className="text-xs text-tertiary">{formatNumber(openEscalations.length)}</span>
                </div>
                <div className="text-sm text-tertiary">
                  {t('status.incidents_body', {
                    overdue: formatNumber(overdueEscalations.length),
                    due_soon: formatNumber(dueSoonEscalations.length),
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="overview__attention">
            <CardHeader>
              <CardTitle>{t('attention.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              {attentionItems.length > 0 ? (
                <div className="space-y-3">
                  {attentionItems.map((item, index) => (
                    <div
                      key={item.id}
                      className={cn('flex flex-col gap-3 rounded-xl border p-4 md:flex-row md:items-center md:justify-between', statusToneClassName(item.tone))}
                      data-testid={`overview__attention-item-${index}`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={item.tone}>{t(`status_labels.${item.tone}`)}</StatusBadge>
                          <span className="text-sm font-medium text-foreground">{item.title}</span>
                        </div>
                        <p className="text-sm text-tertiary">{item.body}</p>
                      </div>
                      <Link
                        href={item.href}
                        data-testid={`overview__attention-link-${index}`}
                        className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
                      >
                        {item.actionLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-success/25 bg-success/5 p-4 text-sm text-tertiary" data-testid="overview__attention-empty">
                  {t('attention.empty')}
                </div>
              )}
            </CardContent>
          </Card>

          <Card data-testid="overview__primary-actions">
            <CardHeader>
              <CardTitle>{t('primary_actions.title')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 xl:grid-cols-2">
                {primaryActions.map((item, index) => (
                  <div
                    key={item.id}
                    className={cn('flex flex-col gap-3 rounded-xl border p-4', statusToneClassName(item.tone))}
                    data-testid={`overview__primary-action-${index}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={item.tone}>{t(`status_labels.${item.tone}`)}</StatusBadge>
                        <span className="text-sm font-medium text-foreground">{item.title}</span>
                      </div>
                      <p className="text-sm text-tertiary">{item.body}</p>
                    </div>
                    <div>
                      <Link
                        href={item.href}
                        data-testid={`overview__primary-action-link-${index}`}
                        className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
                      >
                        {item.actionLabel}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card data-testid="overview__snapshot-runtime">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>{t('snapshots.runtime_title')}</CardTitle>
                <Link href={runtimeHref} data-testid="overview__snapshot-runtime-link" className="text-sm font-medium text-accent hover:underline">{t('open_runtime')}</Link>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.requests')}</div>
                  <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(runtime?.total_requests ?? 0)}</div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.error_rate')}</div>
                  <div className="mt-1 text-xl font-semibold text-foreground">{formatPercent(runtime?.error_rate)}</div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.recovered_requests')}</div>
                  <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(runtime?.health_summary.recovered_requests ?? 0)}</div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.missing_price')}</div>
                  <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(runtime?.health_summary.missing_price_facts ?? 0)}</div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="overview__snapshot-cost">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>{t('snapshots.cost_title')}</CardTitle>
                <Link href={usageHref} data-testid="overview__snapshot-cost-link" className="text-sm font-medium text-accent hover:underline">{t('open_usage')}</Link>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.avg_cost')}</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{formatUsd(runtime?.avg_estimated_cost)}</div>
                  </div>
                  <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.p95_cost')}</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{formatUsd(runtime?.p95_estimated_cost)}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                  <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.top_cost_surfaces')}</div>
                  <div className="mt-2 space-y-2 text-sm text-tertiary">
                    {(operationsSummary?.top_models ?? []).slice(0, 2).map((item, index) => (
                      <div key={`${item.provider}-${item.model}-${index}`} className="flex items-center justify-between gap-3">
                        <span>{item.provider}/{item.model}</span>
                        <span className="text-foreground">{formatUsd(item.estimated_cost)}</span>
                      </div>
                    ))}
                    {(operationsSummary?.top_models ?? []).length === 0 ? <div>{t('empty_cost_snapshot')}</div> : null}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="overview__snapshot-release">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>{t('snapshots.release_title')}</CardTitle>
                <Link href={releaseOpsHref} data-testid="overview__snapshot-release-link" className="text-sm font-medium text-accent hover:underline">{t('open_release_ops')}</Link>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.policy')}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {latestReportItem?.policy_enforcement?.decision
                        ? t(`release_labels.${latestReportItem.policy_enforcement.decision}`)
                        : t('release_labels.unknown')}
                    </div>
                  </div>
                  <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.latest_run')}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{latestRunItem?.status ?? '--'}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3 text-sm text-tertiary">
                  {t('snapshots.release_details', {
                    blockers: formatNumber(latestReportItem?.policy_enforcement?.blocker_count ?? 0),
                    warnings: formatNumber(latestReportItem?.policy_enforcement?.warning_count ?? 0),
                    overrides: formatNumber(latestReportItem?.policy_enforcement?.approved_override_count ?? 0),
                  })}
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3 text-sm text-tertiary">
                  {t('snapshots.usage_readiness', {
                    status: usageEvidence?.release_readiness ? t(`status_labels.${usageEvidence.release_readiness === 'blocked' ? 'blocked' : 'ready'}`) : '--',
                  })}
                </div>
              </CardContent>
            </Card>

            <Card data-testid="overview__snapshot-incidents">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle>{t('snapshots.incidents_title')}</CardTitle>
                <Link href={releaseOpsHref} data-testid="overview__snapshot-incidents-link" className="text-sm font-medium text-accent hover:underline">{t('open_release_ops')}</Link>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.open_incidents')}</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(openEscalations.length)}</div>
                  </div>
                  <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                    <div className="text-xs uppercase tracking-wide text-tertiary">{t('snapshots.critical_incidents')}</div>
                    <div className="mt-1 text-xl font-semibold text-foreground">{formatNumber(criticalOpenEscalations.length)}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/40 p-3 text-sm text-tertiary">
                  {openEscalations[0]
                    ? t('snapshots.incident_details', {
                        assignee: openEscalations[0].assignee_name || openEscalations[0].assignee_user_id || '--',
                        sla: openEscalations[0].sla_status || '--',
                      })
                    : t('snapshots.incident_empty')}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card data-testid="overview__quick-actions">
            <CardHeader>
              <CardTitle>{t('quick_actions')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ProjectNavigation
                basePath={basePath}
                columns={3}
                items={quickActions}
                userPermissions={Array.from(currentPermissions)}
              />
            </CardContent>
          </Card>

          <div data-testid="overview__activity-timeline">
            <ActivityTimeline
              items={activityItems}
              maxItems={5}
              viewAllLink={`${basePath}/audit`}
              translations={t}
            />
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
