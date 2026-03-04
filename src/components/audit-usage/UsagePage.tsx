'use client';
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { UsageKPICards } from './UsageKPICards';
import { UsageFilters } from './UsageFilters';
import { UsageFactDetailDrawer } from './UsageFactDetailDrawer';
import { UsageTable } from './UsageTable';
import { useUsageFacts, useUsageKPI, useUsageRecords } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { ErrorState } from '@/components/ui/error-state';
import type { UsageListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
import type { UsageRecord } from '@/lib/api/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getApiClient, UsageAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export interface UsagePageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
  defaultEndUserId?: string;
  currentUserId?: string;
  initialFilters?: Partial<UsageListParams>;
  initialPanel?: 'usage' | 'dashboard';
}

function getDefaultTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

function getBucketRange(timeBucket: string, groupBy: 'day' | 'hour' | 'minute'): { start: string; end: string } | null {
  if (groupBy === 'day') {
    const start = new Date(`${timeBucket}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  if (groupBy === 'hour') {
    const normalized = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(timeBucket)
      ? `${timeBucket.replace(' ', 'T')}:00.000Z`
      : timeBucket;
    const start = new Date(normalized);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 60 * 60 * 1000 - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(timeBucket)
    ? `${timeBucket.replace(' ', 'T')}:00.000Z`
    : timeBucket;
  const start = new Date(normalized);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 60 * 1000 - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function UsagePage({
  workspaceId,
  projectId,
  locale = 'en-US',
  defaultEndUserId,
  currentUserId,
  initialFilters,
}: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const searchParams = useSearchParams();
  const traceSource = searchParams.get('trace_source') ?? undefined;
  const traceRef = searchParams.get('trace_ref') ?? undefined;
  const traceIncidentId = searchParams.get('trace_incident_id') ?? undefined;
  const traceEscalationId = searchParams.get('trace_escalation_id') ?? undefined;
  const traceRunId = searchParams.get('trace_run_id') ?? undefined;
  const queryClient = useQueryClient();
  const canReadUsage = useHasPermission('project:endpoint:use');
  const canExportUsage = useHasPermission('project:manage');
  const usageApi = React.useMemo(() => new UsageAPI(getApiClient()), []);
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const effectiveEndUserId = defaultEndUserId ?? currentUserId;
  const [selectedUsageRecord, setSelectedUsageRecord] = React.useState<UsageRecord | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [exportingFormat, setExportingFormat] = React.useState<'csv' | 'json' | null>(null);
  const [filters, setFilters] = React.useState<UsageListParams>(() => ({
    ...getDefaultTimeRange(),
    page: 1,
    page_size: 25,
    sort_by: 'time_bucket',
    sort_order: 'desc',
    group_by: 'minute',
    ...initialFilters,
    ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
  }));

  const apiFilters = React.useMemo(
    () => ({ ...filters, end_user_id: effectiveEndUserId }),
    [filters, effectiveEndUserId],
  );

  const { data: kpiData, isLoading: kpiLoading } = useUsageKPI(
    workspaceId,
    projectId,
    apiFilters.start_time,
    apiFilters.end_time,
    apiFilters.end_user_id,
    { enabled: canReadUsage },
  );

  const { data, isLoading, error } = useUsageRecords(workspaceId, projectId, apiFilters, {
    enabled: canReadUsage,
  });

  const usageDetailRange = React.useMemo(
    () =>
      selectedUsageRecord
        ? getBucketRange(
            selectedUsageRecord.time_bucket,
            apiFilters.group_by === 'day' || apiFilters.group_by === 'hour'
              ? apiFilters.group_by
              : 'minute',
          )
        : null,
    [selectedUsageRecord, apiFilters.group_by],
  );

  const usageFactsQuery = useUsageFacts(
    workspaceId,
    projectId,
    {
      start_time: usageDetailRange?.start ?? '',
      end_time: usageDetailRange?.end ?? '',
      resource_type: selectedUsageRecord?.resource_type,
      resource_id: selectedUsageRecord?.resource_id,
      end_user_id: selectedUsageRecord?.end_user_id,
      result: apiFilters.result,
      provider: apiFilters.provider,
      model: apiFilters.model,
      error_class: apiFilters.error_class,
      page: 1,
      page_size: 20,
      sort_order: 'desc',
    },
    { enabled: canReadUsage && detailOpen && !!selectedUsageRecord && !!usageDetailRange },
  );

  const handleRefresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.usage._def });
    toast.success(commonT('refreshed_data') || 'Refreshed usage data');
  }, [queryClient, commonT]);

  const handleExport = React.useCallback(
    async (format: 'csv' | 'json') => {
      setExportingFormat(format);
      try {
        const exportResult = await usageApi.exportReport(workspaceId, projectId, {
          start_time: apiFilters.start_time,
          end_time: apiFilters.end_time,
          format,
          resource_type: apiFilters.resource_type,
          resource_id: apiFilters.resource_id,
          end_user_id: apiFilters.end_user_id,
          provider: apiFilters.provider,
          model: apiFilters.model,
          result: apiFilters.result,
          error_class: apiFilters.error_class,
        });
        const url = window.URL.createObjectURL(exportResult.blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = exportResult.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.URL.revokeObjectURL(url);
        toast.success(t('export.success'));
      } catch (err) {
        toast.error(
          t('export.failed_with_reason', {
            reason: err instanceof Error ? err.message : commonT('unknown_error'),
          }),
        );
      } finally {
        setExportingFormat(null);
      }
    },
    [usageApi, workspaceId, projectId, apiFilters, t, commonT],
  );

  const handleClearFilters = React.useCallback(() => {
    setFilters({
      ...getDefaultTimeRange(),
      page: 1,
      page_size: 25,
      sort_by: 'time_bucket',
      sort_order: 'desc',
      group_by: 'minute',
      ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
    });
  }, [effectiveEndUserId]);

  const handleFiltersChange = React.useCallback(
    (newFilters: UsageListParams) => {
      setFilters((prev) => ({
        ...prev,
        ...newFilters,
        page: 1,
        ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
      }));
    },
    [effectiveEndUserId],
  );

  const currentPage = data?.page ?? filters.page ?? 1;
  const pageSize = data?.page_size ?? filters.page_size ?? 25;
  const totalItems = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const canGoPrev = currentPage > 1;
  const canGoNext = !!data?.has_more || currentPage < totalPages;
  const hasActiveFilters = !!apiFilters.resource_type
    || !!apiFilters.resource_id
    || !!apiFilters.end_user_id
    || !!apiFilters.provider
    || !!apiFilters.model
    || !!apiFilters.result
    || !!apiFilters.error_class;

  const handleSelectUsageRecord = React.useCallback((record: UsageRecord) => {
    setSelectedUsageRecord(record);
    setDetailOpen(true);
  }, []);

  if (!canReadUsage) {
    return (
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <div className="flex flex-col items-center justify-center flex-1">
          <div className="rounded-xl border border-border bg-surface p-8 text-center max-w-md">
            <p className="text-sm text-tertiary">{t('permission_denied')}</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <ErrorState
          title={commonT('something_went_wrong')}
          message={t('load_failed_with_reason', {
            reason: error instanceof Error ? error.message : commonT('unknown_error'),
          })}
          onRetry={handleRefresh}
          retryLabel={commonT('retry')}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex items-center gap-2">
              {canExportUsage && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="action" disabled={exportingFormat !== null} data-testid="usage__export-trigger">
                      <Download className="h-4 w-4 mr-2" />
                      {t('export.label')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => void handleExport('csv')} data-testid="usage__export-option-csv">
                      {t('export.csv')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleExport('json')} data-testid="usage__export-option-json">
                      {t('export.json')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="outline" onClick={handleRefresh} disabled={isLoading || kpiLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || kpiLoading ? 'animate-spin' : ''}`} />
                {commonT('refresh')}
              </Button>
            </div>
          )}
        />
      )}
      toolbar={(
        <PageToolbar className="w-full">
          <div className="rounded-md border border-subtle bg-bg-base/20 px-3 py-2 text-xs text-tertiary" data-testid="usage__my-scope-badge">
            {t('scope_my_usage')}
          </div>
        </PageToolbar>
      )}
    >
      <div className="w-full space-y-3 min-h-0 flex-1 flex flex-col">
        {traceRef ? (
          <div className="rounded-md border border-subtle bg-bg-base/20 p-3" data-testid="usage__trace-context">
            <p className="text-xs font-medium text-foreground">{commonT('trace_context_title')}</p>
            <p className="mt-1 text-xs text-tertiary">
              {commonT('trace_context_summary', {
                source: traceSource ?? 'unknown',
                ref: traceRef,
              })}
            </p>
            <p className="mt-1 text-xs text-tertiary">
              {traceIncidentId ? `incident=${traceIncidentId}` : null}
              {traceEscalationId ? ` · escalation=${traceEscalationId}` : null}
              {traceRunId ? ` · run=${traceRunId}` : null}
            </p>
          </div>
        ) : null}

        <UsageKPICards kpi={kpiData} loading={kpiLoading} />

        <div data-testid="usage__filters">
          <UsageFilters
            filters={apiFilters}
            onChange={handleFiltersChange}
            onClear={handleClearFilters}
            defaultEndUserId={effectiveEndUserId}
          />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="rounded-xl border border-border bg-surface p-3">
            <UsageTable
              data={data?.items || []}
              loading={isLoading}
              onClearFilters={handleClearFilters}
              hasActiveFilters={hasActiveFilters}
              onSelectRecord={handleSelectUsageRecord}
            />
            <div className="mt-3 flex items-center justify-between border-t border-subtle pt-3">
              <p className="text-xs text-tertiary">
                {commonT('page_of', { page: String(currentPage), total: String(totalPages) })} ·{' '}
                {commonT('total_items', { count: String(totalItems) })}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canGoPrev || isLoading}
                  onClick={() => setFilters((prev) => ({ ...prev, page: Math.max(1, (prev.page ?? 1) - 1) }))}
                >
                  {commonT('previous')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canGoNext || isLoading}
                  onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
                >
                  {commonT('next')}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <UsageFactDetailDrawer
          open={detailOpen}
          onOpenChange={setDetailOpen}
          facts={usageFactsQuery.data?.items ?? []}
          loading={usageFactsQuery.isLoading}
          aggregateLabel={selectedUsageRecord?.time_bucket}
          basePath={basePath}
        />
      </div>
    </PageLayout>
  );
}
