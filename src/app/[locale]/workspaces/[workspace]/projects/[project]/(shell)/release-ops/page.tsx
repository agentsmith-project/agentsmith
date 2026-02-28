'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { useRuntimeObservability, useUsageOperationsSummary, useUsageReportEvidence, useUsageReportSchedules } from '@/lib/hooks/use-audit-usage';
import { useReleaseReportDetail, useReleaseReportList } from '@/lib/hooks/use-release-ops';
import { ReleaseOpsDashboard } from '@/components/runtime/ReleaseOpsDashboard';
import { UsageOperationsSummary } from '@/components/audit-usage/UsageOperationsSummary';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ReleaseOpsPageProps {
  params: Promise<{ workspace: string; project: string; locale: string }>;
}

function defaultTimeRange() {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

function formatDateTime(value?: string): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export default function ReleaseOpsPage({ params }: ReleaseOpsPageProps) {
  const errorsT = useTranslations('errors');
  const settingsT = useTranslations('settings');
  const usageT = useTranslations('usage');
  const commonT = useTranslations('common');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const [timeRange] = useState(defaultTimeRange);
  const canReadUsage = useHasPermission('project:usage:view');
  const [selectedReportName, setSelectedReportName] = useState<string | undefined>();

  useEffect(() => {
    params.then((p) => setResolvedParams({
      workspace: validateWorkspaceParam(p.workspace),
      project: validateProjectParam(p.project),
      locale: p.locale,
    }));
  }, [params]);

  const workspaceId = resolvedParams?.workspace ?? '';
  const projectId = resolvedParams?.project ?? '';
  const locale = resolvedParams?.locale ?? 'en-US';
  const enabled = !!workspaceId && !!projectId && canReadUsage;

  const runtimeQuery = useRuntimeObservability(workspaceId, projectId, timeRange, { enabled });
  const summaryQuery = useUsageOperationsSummary(workspaceId, projectId, timeRange, { enabled });
  const evidenceQuery = useUsageReportEvidence(workspaceId, projectId, { enabled });
  const schedulesQuery = useUsageReportSchedules(workspaceId, projectId, { enabled });
  const reportsQuery = useReleaseReportList({ enabled });
  const reportDetailQuery = useReleaseReportDetail(selectedReportName, { enabled });

  useEffect(() => {
    if (!selectedReportName && (reportsQuery.data?.items?.length ?? 0) > 0) {
      setSelectedReportName(reportsQuery.data?.items[0]?.name);
    }
  }, [reportsQuery.data?.items, selectedReportName]);

  const refresh = () => {
    runtimeQuery.refetch();
    summaryQuery.refetch();
    evidenceQuery.refetch();
    schedulesQuery.refetch();
    reportsQuery.refetch();
    reportDetailQuery.refetch();
  };

  const blockers = evidenceQuery.data?.blockers ?? [];
  const warnings = evidenceQuery.data?.warnings ?? [];
  const topSchedules = useMemo(
    () => (schedulesQuery.data?.items ?? []).slice(0, 5),
    [schedulesQuery.data?.items],
  );
  const releaseReports = reportsQuery.data?.items ?? [];
  const selectedReportSummary = JSON.stringify((reportDetailQuery.data?.report as { summary?: unknown } | undefined)?.summary ?? {}, null, 2);

  if (!resolvedParams) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!resolvedParams.workspace || !resolvedParams.project) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{errorsT('validation_error')}</h2>
          <p className="text-sm text-tertiary">{errorsT('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadUsage) {
    return (
      <PageState state="error">
        <div className="max-w-md space-y-2 text-center">
          <h2 className="text-lg font-semibold">{errorsT('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{errorsT('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout
        header={(
          <PageHeader
            title={settingsT('release_ops_title')}
            subtitle={settingsT('release_ops_subtitle')}
            actions={(
              <>
                <Link
                  href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/runtime-observability`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="release-ops__open-runtime-observability"
                >
                  {settingsT('runtime_observability_open_console')}
                </Link>
                <Link
                  href={`/${locale}/workspaces/${workspaceId}/projects/${projectId}/usage`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="release-ops__open-usage"
                >
                  {usageT('title')}
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={refresh}
                  disabled={runtimeQuery.isFetching || summaryQuery.isFetching || evidenceQuery.isFetching}
                  data-testid="release-ops__refresh"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${(runtimeQuery.isFetching || summaryQuery.isFetching || evidenceQuery.isFetching) ? 'animate-spin' : ''}`} />
                  {commonT('refresh')}
                </Button>
              </>
            )}
          />
        )}
      >
        <div className="space-y-4" data-testid="release-ops__page">
          <ReleaseOpsDashboard
            runtime={runtimeQuery.data}
            usageEvidence={evidenceQuery.data}
            operationsSummary={summaryQuery.data}
            loading={runtimeQuery.isLoading || summaryQuery.isLoading || evidenceQuery.isLoading}
          />

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <UsageOperationsSummary
              summary={summaryQuery.data}
              loading={summaryQuery.isLoading}
            />

            <section className="space-y-4">
              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__evidence-summary">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{usageT('report_schedules.evidence_title')}</h3>
                    <p className="text-xs text-tertiary">{usageT('report_schedules.evidence_subtitle')}</p>
                  </div>
                  {evidenceQuery.data ? (
                    <Badge variant={evidenceQuery.data.release_readiness === 'ready' ? 'outline' : 'secondary'}>
                      {usageT(`report_schedules.release_${evidenceQuery.data.release_readiness}`)}
                    </Badge>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__evidence-blockers">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{usageT('report_schedules.evidence_failed')}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{blockers.length}</div>
                  </div>
                  <div className="rounded-md border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__evidence-warnings">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{usageT('report_schedules.evidence_unacknowledged')}</div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{warnings.length}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-2 text-xs text-tertiary">
                  {blockers.length === 0 && warnings.length === 0 ? (
                    <div>{settingsT('release_ops_webhook_empty')}</div>
                  ) : null}
                  {blockers.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-md border border-subtle bg-bg-base/40 px-3 py-2" data-testid={`release-ops__blocker-${index}`}>
                      {item}
                    </div>
                  ))}
                  {warnings.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-md border border-subtle bg-bg-base/40 px-3 py-2" data-testid={`release-ops__warning-${index}`}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__schedules">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{usageT('report_schedules.title')}</h3>
                    <p className="text-xs text-tertiary">{usageT('report_schedules.subtitle')}</p>
                  </div>
                  <Badge variant="outline">{topSchedules.length}</Badge>
                </div>
                <div className="space-y-2">
                  {topSchedules.length === 0 ? (
                    <div className="text-sm text-tertiary">{commonT('empty')}</div>
                  ) : topSchedules.map((schedule, index) => (
                    <div key={schedule.id} className="rounded-md border border-subtle bg-bg-base/40 px-3 py-2" data-testid={`release-ops__schedule-${index}`}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{schedule.name}</div>
                          <div className="text-xs text-tertiary">{schedule.delivery_channel} · {schedule.format} · {schedule.cadence}</div>
                        </div>
                        <Badge variant={schedule.status === 'active' ? 'outline' : 'secondary'}>{schedule.status}</Badge>
                      </div>
                      <div className="mt-2 text-xs text-tertiary">
                        {formatDateTime(schedule.next_run_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__reports">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-foreground">{settingsT('release_ops_reports_title')}</h3>
                  <p className="text-xs text-tertiary">{settingsT('release_ops_reports_subtitle')}</p>
                </div>
                <div className="space-y-2">
                  {releaseReports.length === 0 ? (
                    <div className="text-sm text-tertiary">{settingsT('release_ops_reports_empty')}</div>
                  ) : releaseReports.slice(0, 6).map((item, index) => (
                    <button
                      key={item.name}
                      type="button"
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left transition-colors',
                        selectedReportName === item.name
                          ? 'border-border bg-bg-base/60'
                          : 'border-subtle bg-bg-base/40 hover:bg-bg-base/60',
                      )}
                      onClick={() => setSelectedReportName(item.name)}
                      data-testid={`release-ops__report-item-${index}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-sm text-foreground">{item.name}</div>
                          <div className="text-xs text-tertiary">
                            {item.branch ?? '--'} · {item.commit_short ?? '--'} · {formatDateTime(item.generated_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={item.status === 'pass' ? 'outline' : 'secondary'}>{item.status}</Badge>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
                {reportDetailQuery.data ? (
                  <div className="mt-4 space-y-3 rounded-md border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__report-detail">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{reportDetailQuery.data.name}</Badge>
                      {reportDetailQuery.data.markdown ? (
                        <Badge variant="outline">{settingsT('release_ops_reports_markdown')}</Badge>
                      ) : null}
                    </div>
                    <pre className="overflow-x-auto rounded-md border border-subtle bg-surface p-3 text-xs text-foreground" data-testid="release-ops__report-summary-json">
                      {selectedReportSummary}
                    </pre>
                    {reportDetailQuery.data.markdown ? (
                      <div className="rounded-md border border-subtle bg-surface p-3 text-xs text-tertiary" data-testid="release-ops__report-markdown-preview">
                        {reportDetailQuery.data.markdown.slice(0, 600)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
