'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Download, RefreshCw } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

function yesNoBadge(value: boolean | undefined) {
  return value ? 'outline' : 'secondary';
}

function formatPercent(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${(value * 100).toFixed(1)}%`;
}

function formatDurationMs(value?: number): string {
  if (typeof value !== 'number' || Number.isNaN(value)) return '--';
  return `${Math.round(value)}ms`;
}

function downloadTextFile(filename: string, content: string, contentType: string): void {
  const blob = new Blob([content], { type: contentType });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export default function ReleaseOpsPage({ params }: ReleaseOpsPageProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const errorsT = useTranslations('errors');
  const settingsT = useTranslations('settings');
  const usageT = useTranslations('usage');
  const commonT = useTranslations('common');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; project?: string; locale?: string } | null>(null);
  const [timeRange] = useState(defaultTimeRange);
  const canReadUsage = useHasPermission('project:usage:view');
  const searchParamsKey = searchParams.toString();
  const [selectedReportName, setSelectedReportName] = useState<string | undefined>(searchParams.get('report') ?? undefined);
  const [reportSearch, setReportSearch] = useState(searchParams.get('report_search') ?? '');
  const [reportStatusFilter, setReportStatusFilter] = useState<'all' | 'pass' | 'fail'>(
    searchParams.get('report_status') === 'pass' || searchParams.get('report_status') === 'fail'
      ? searchParams.get('report_status') as 'pass' | 'fail'
      : 'all',
  );

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
  const releaseReports = useMemo(
    () => reportsQuery.data?.items ?? [],
    [reportsQuery.data?.items],
  );
  const filteredReleaseReports = useMemo(
    () => releaseReports.filter((item) => {
      const matchesSearch = !reportSearch.trim()
        || item.name.toLowerCase().includes(reportSearch.trim().toLowerCase())
        || (item.branch ?? '').toLowerCase().includes(reportSearch.trim().toLowerCase())
        || (item.commit_short ?? '').toLowerCase().includes(reportSearch.trim().toLowerCase());
      const matchesStatus = reportStatusFilter === 'all' || item.status === reportStatusFilter;
      return matchesSearch && matchesStatus;
    }),
    [releaseReports, reportSearch, reportStatusFilter],
  );

  useEffect(() => {
    const nextReport = searchParams.get('report') ?? undefined;
    const nextSearch = searchParams.get('report_search') ?? '';
    const nextStatus = searchParams.get('report_status') === 'pass' || searchParams.get('report_status') === 'fail'
      ? searchParams.get('report_status') as 'pass' | 'fail'
      : 'all';
    setSelectedReportName((prev) => prev === nextReport ? prev : nextReport);
    setReportSearch((prev) => prev === nextSearch ? prev : nextSearch);
    setReportStatusFilter((prev) => prev === nextStatus ? prev : nextStatus);
  }, [searchParams, searchParamsKey]);

  useEffect(() => {
    if (!selectedReportName && filteredReleaseReports.length > 0) {
      setSelectedReportName(filteredReleaseReports[0]?.name);
      return;
    }
    if (selectedReportName && !filteredReleaseReports.some((item) => item.name === selectedReportName)) {
      setSelectedReportName(filteredReleaseReports[0]?.name);
    }
  }, [filteredReleaseReports, selectedReportName]);

  useEffect(() => {
    const params = new URLSearchParams(searchParamsKey);
    const nextReport = selectedReportName ?? '';
    const nextSearch = reportSearch.trim();
    const nextStatus = reportStatusFilter;
    let changed = false;

    if ((params.get('report') ?? '') !== nextReport) {
      changed = true;
      if (nextReport) params.set('report', nextReport);
      else params.delete('report');
    }
    if ((params.get('report_search') ?? '') !== nextSearch) {
      changed = true;
      if (nextSearch) params.set('report_search', nextSearch);
      else params.delete('report_search');
    }
    const currentStatus = params.get('report_status') ?? 'all';
    if (currentStatus !== nextStatus) {
      changed = true;
      if (nextStatus === 'all') params.delete('report_status');
      else params.set('report_status', nextStatus);
    }

    if (!changed) return;
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [pathname, reportSearch, reportStatusFilter, router, searchParamsKey, selectedReportName]);

  const reportSummary = (reportDetailQuery.data?.report as {
    summary?: {
      status?: string;
      runtime_release_evidence?: {
        generated_at?: string;
        guardrails?: {
          release_readiness?: 'ready' | 'blocked';
          target?: string;
          planned_attempts?: number;
          blockers?: string[];
          warnings?: string[];
        };
        pricing_version_coverage?: {
          total_usage_facts?: number;
          covered_usage_facts?: number;
          missing_usage_facts?: number;
          missing_price_facts?: number;
          coverage_ratio?: number;
        };
      };
      usage_report_evidence?: {
        release_readiness?: 'ready' | 'blocked';
        active_schedules?: number;
        required_schedules?: number;
        successful_deliveries_last_7d?: number;
        failed_deliveries_last_7d?: number;
        unacknowledged_required_deliveries?: number;
        blockers?: string[];
        warnings?: string[];
      };
    };
  } | undefined)?.summary;
  const reportExecution = (reportDetailQuery.data?.report as {
    execution?: {
      total_checks?: number;
      passed?: number;
      failed?: number;
      skipped?: number;
      checks?: Array<{
        name?: string;
        category?: string;
        status?: string;
        duration_ms?: number;
      }>;
    };
  } | undefined)?.execution;
  const selectedReportSummary = JSON.stringify(reportSummary ?? {}, null, 2);
  const latestReport = filteredReleaseReports[0];
  const latestRuntimeReadiness = latestReport?.runtime_release_readiness ?? '--';
  const latestUsageReadiness = latestReport?.usage_release_readiness ?? '--';
  const currentRuntimeReadiness = runtimeQuery.data && runtimeQuery.data.health_summary.terminal_error_requests === 0 ? 'ready' : 'blocked';
  const currentUsageReadiness = evidenceQuery.data?.release_readiness ?? '--';
  const runtimeReadinessChanged = String(currentRuntimeReadiness) !== String(latestRuntimeReadiness);
  const usageReadinessChanged = String(currentUsageReadiness) !== String(latestUsageReadiness);

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

              <div className="rounded-xl border border-border bg-surface p-4" data-testid="release-ops__online-vs-latest">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-foreground">{settingsT('release_ops_compare_title')}</h3>
                  <p className="text-xs text-tertiary">{settingsT('release_ops_compare_subtitle')}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__compare-runtime">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_runtime')}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={currentRuntimeReadiness === 'ready' ? 'outline' : 'secondary'}>{String(currentRuntimeReadiness)}</Badge>
                      <span className="text-xs text-tertiary">vs {String(latestRuntimeReadiness)}</span>
                      <Badge variant={yesNoBadge(runtimeReadinessChanged)}>{runtimeReadinessChanged ? settingsT('runtime_release_yes') : settingsT('runtime_release_no')}</Badge>
                    </div>
                  </div>
                  <div className="rounded-md border border-subtle bg-bg-base/40 p-3" data-testid="release-ops__compare-usage">
                    <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_usage')}</div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={currentUsageReadiness === 'ready' ? 'outline' : 'secondary'}>{String(currentUsageReadiness)}</Badge>
                      <span className="text-xs text-tertiary">vs {String(latestUsageReadiness)}</span>
                      <Badge variant={yesNoBadge(usageReadinessChanged)}>{usageReadinessChanged ? settingsT('runtime_release_yes') : settingsT('runtime_release_no')}</Badge>
                    </div>
                  </div>
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
                <div className="mb-3 grid gap-3 md:grid-cols-[1fr_180px]">
                  <Input
                    value={reportSearch}
                    onChange={(event) => setReportSearch(event.target.value)}
                    placeholder={settingsT('release_ops_reports_search_placeholder')}
                    data-testid="release-ops__report-search"
                  />
                  <Select value={reportStatusFilter} onValueChange={(value: 'all' | 'pass' | 'fail') => setReportStatusFilter(value)}>
                    <SelectTrigger data-testid="release-ops__report-status-filter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{settingsT('release_ops_reports_filter_all')}</SelectItem>
                      <SelectItem value="pass">{settingsT('release_ops_reports_filter_pass')}</SelectItem>
                      <SelectItem value="fail">{settingsT('release_ops_reports_filter_fail')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  {filteredReleaseReports.length === 0 ? (
                    <div className="text-sm text-tertiary">{settingsT('release_ops_reports_empty')}</div>
                  ) : filteredReleaseReports.slice(0, 6).map((item, index) => (
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
                      {reportDetailQuery.data.markdown ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => downloadTextFile(`${reportDetailQuery.data?.name}.md`, reportDetailQuery.data?.markdown ?? '', 'text/markdown; charset=utf-8')}
                          data-testid="release-ops__report-download-markdown"
                        >
                          <Download className="mr-2 h-4 w-4" />
                          {settingsT('release_ops_reports_download_markdown')}
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3" data-testid="release-ops__report-metadata">
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_reports_meta_branch')}</div>
                        <div className="mt-1 text-sm font-medium text-foreground">
                          {((reportDetailQuery.data.report as { metadata?: { git?: { branch?: string } } }).metadata?.git?.branch) ?? '--'}
                        </div>
                      </div>
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_reports_meta_commit')}</div>
                        <div className="mt-1 font-mono text-sm text-foreground">
                          {((reportDetailQuery.data.report as { metadata?: { git?: { commit_short?: string } } }).metadata?.git?.commit_short) ?? '--'}
                        </div>
                      </div>
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_reports_meta_generated_at')}</div>
                        <div className="mt-1 text-sm text-foreground">
                          {formatDateTime(((reportDetailQuery.data.report as { metadata?: { timestamp?: string } }).metadata?.timestamp))}
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2" data-testid="release-ops__report-structured-summary">
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_runtime')}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant={reportSummary?.runtime_release_evidence?.guardrails?.release_readiness === 'ready' ? 'outline' : 'secondary'}>
                            {reportSummary?.runtime_release_evidence?.guardrails?.release_readiness ?? '--'}
                          </Badge>
                          <span className="text-xs text-tertiary">
                            b:{reportSummary?.runtime_release_evidence?.guardrails?.blockers?.length ?? 0}
                            {' · '}
                            w:{reportSummary?.runtime_release_evidence?.guardrails?.warnings?.length ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_compare_usage')}</div>
                        <div className="mt-2 flex items-center gap-2">
                          <Badge variant={reportSummary?.usage_report_evidence?.release_readiness === 'ready' ? 'outline' : 'secondary'}>
                            {reportSummary?.usage_report_evidence?.release_readiness ?? '--'}
                          </Badge>
                          <span className="text-xs text-tertiary">
                            b:{reportSummary?.usage_report_evidence?.blockers?.length ?? 0}
                            {' · '}
                            w:{reportSummary?.usage_report_evidence?.warnings?.length ?? 0}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-runtime-evidence">
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_section_runtime_evidence')}</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_target')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.runtime_release_evidence?.guardrails?.target ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_planned_attempts')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.runtime_release_evidence?.guardrails?.planned_attempts ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_coverage')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{formatPercent(reportSummary?.runtime_release_evidence?.pricing_version_coverage?.coverage_ratio)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_runtime_missing_price')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.runtime_release_evidence?.pricing_version_coverage?.missing_price_facts ?? '--'}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-usage-evidence">
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_section_usage_evidence')}</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_active_schedules')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.active_schedules ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_required_schedules')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.required_schedules ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_successful_deliveries')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.successful_deliveries_last_7d ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_usage_failed_deliveries')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportSummary?.usage_report_evidence?.failed_deliveries_last_7d ?? '--'}</div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-3" data-testid="release-ops__report-execution-checks">
                      <div className="rounded-md border border-subtle bg-surface p-3">
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-tertiary">{settingsT('release_ops_section_execution_checks')}</div>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_total')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.total_checks ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_passed')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.passed ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_failed')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.failed ?? '--'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-tertiary">{settingsT('release_ops_execution_skipped')}</div>
                            <div className="mt-1 text-sm font-medium text-foreground">{reportExecution?.skipped ?? '--'}</div>
                          </div>
                        </div>
                        <div className="mt-3 space-y-2">
                          {(reportExecution?.checks ?? []).slice(0, 5).map((check, index) => (
                            <div key={`${check.name}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-subtle px-3 py-2" data-testid={`release-ops__report-check-${index}`}>
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-foreground">{check.name ?? '--'}</div>
                                <div className="text-xs text-tertiary">{check.category ?? '--'}</div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={check.status === 'pass' ? 'outline' : 'secondary'}>{check.status ?? '--'}</Badge>
                                <span className="text-xs text-tertiary">{formatDurationMs(check.duration_ms)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
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
