'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { UsageKPICards } from './UsageKPICards';
import { UsageFilters } from './UsageFilters';
import { UsageFactDetailDrawer } from './UsageFactDetailDrawer';
import { UsageOperationsSummary } from './UsageOperationsSummary';
import { UsageReportSchedulesPanel } from './UsageReportSchedulesPanel';
import { UsageTable } from './UsageTable';
import { useUsageFacts, useUsageKPI, useUsageOperationsSummary, useUsageRecords, useUsageReportEvidence, useUsageReportSchedules } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { ErrorState } from '@/components/ui/error-state';
import type { UsageListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CostDashboardPage } from '@/components/dashboard';
import type { UsageRecord } from '@/lib/api/types';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getApiClient, UsageAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { UsageReportDelivery, UsageReportSchedule } from '@/lib/api/endpoints/audit-usage';

export interface UsagePageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string; // When set, user can only see own usage (locked)
  currentUserId?: string; // For scope switch when user has project-wide permission
}

function getDefaultTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

function getBucketRange(timeBucket: string, groupBy: 'day' | 'hour'): { start: string; end: string } | null {
  if (groupBy === 'day') {
    const start = new Date(`${timeBucket}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) return null;
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }

  const normalized = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(timeBucket)
    ? `${timeBucket.replace(' ', 'T')}:00.000Z`
    : timeBucket;
  const start = new Date(normalized);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 60 * 60 * 1000 - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function UsagePage({ workspaceId, projectId, defaultEndUserId, currentUserId }: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const canReadUsage = useHasPermission('project:usage:view');
  const canExportUsage = useHasPermission('project:usage:export');
  const canManageReportSchedules = useHasPermission('project:usage:report_schedule');
  const usageApi = React.useMemo(() => new UsageAPI(getApiClient()), []);

  // If defaultEndUserId is provided, scope is locked to the current user usage.
  const isScopeLocked = !!defaultEndUserId;
  const [scope, setScope] = React.useState<'my' | 'project'>(defaultEndUserId ? 'my' : 'project');
  const [panel, setPanel] = React.useState<'usage' | 'dashboard'>('usage');
  const [selectedUsageRecord, setSelectedUsageRecord] = React.useState<UsageRecord | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [exportingFormat, setExportingFormat] = React.useState<'csv' | 'json' | null>(null);

  const effectiveEndUserId = isScopeLocked
    ? defaultEndUserId
    : scope === 'my' && currentUserId
      ? currentUserId
      : undefined;

  const [filters, setFilters] = React.useState<UsageListParams>(() => ({
    ...getDefaultTimeRange(),
    page: 1,
    page_size: 25,
    sort_by: 'time_bucket',
    sort_order: 'desc',
    group_by: 'day',
    ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
  }));

  const apiFilters = React.useMemo(
    () => ({ ...filters, end_user_id: effectiveEndUserId }),
    [filters, effectiveEndUserId]
  );

  const { data: kpiData, isLoading: kpiLoading } = useUsageKPI(
    workspaceId,
    projectId,
    apiFilters.start_time,
    apiFilters.end_time,
    apiFilters.end_user_id,
    { enabled: canReadUsage }
  );
  const { data, isLoading, error } = useUsageRecords(workspaceId, projectId, apiFilters, {
    enabled: canReadUsage,
  });
  const operationsSummaryQuery = useUsageOperationsSummary(workspaceId, projectId, apiFilters, {
    enabled: canReadUsage && panel === 'usage',
  });
  const reportSchedulesQuery = useUsageReportSchedules(workspaceId, projectId, {
    enabled: canReadUsage && panel === 'usage',
  });
  const reportEvidenceQuery = useUsageReportEvidence(workspaceId, projectId, {
    enabled: canReadUsage && panel === 'usage',
  });
  const usageDetailRange = React.useMemo(
    () => selectedUsageRecord ? getBucketRange(selectedUsageRecord.time_bucket, apiFilters.group_by === 'hour' ? 'hour' : 'day') : null,
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

  const handleExport = React.useCallback(async (format: 'csv' | 'json') => {
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
    } catch (error) {
      toast.error(
        t('export.failed_with_reason', {
          reason: error instanceof Error ? error.message : commonT('unknown_error'),
        }),
      );
    } finally {
      setExportingFormat(null);
    }
  }, [usageApi, workspaceId, projectId, apiFilters, t, commonT]);

  const refreshUsagePanels = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.usage.reportSchedules(workspaceId, projectId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.usage.reportEvidence(workspaceId, projectId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.usage._def });
  }, [projectId, queryClient, workspaceId]);

  const handleCreateReportSchedule = React.useCallback(async (
    payload: Parameters<React.ComponentProps<typeof UsageReportSchedulesPanel>['onCreate']>[0],
  ) => {
    try {
      await usageApi.createReportSchedule(workspaceId, projectId, payload);
      refreshUsagePanels();
      toast.success(t('report_schedules.create_success'));
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleUpdateScheduleStatus = React.useCallback(async (
    schedule: { id: string },
    status: 'active' | 'paused',
  ) => {
    try {
      await usageApi.updateReportSchedule(workspaceId, projectId, schedule.id, { status });
      refreshUsagePanels();
      toast.success(t('report_schedules.update_success'));
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleDeleteSchedule = React.useCallback(async (schedule: { id: string }) => {
    try {
      await usageApi.deleteReportSchedule(workspaceId, projectId, schedule.id);
      refreshUsagePanels();
      toast.success(t('report_schedules.delete_success'));
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleTestScheduleDelivery = React.useCallback(async (schedule: { id: string }) => {
    try {
      const result = await usageApi.testReportScheduleDelivery(workspaceId, projectId, schedule.id);
      refreshUsagePanels();
      toast.success(t('report_schedules.test_success'));
      return result;
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
      return null;
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleRunScheduleNow = React.useCallback(async (schedule: UsageReportSchedule) => {
    try {
      const result = await usageApi.runReportScheduleNow(workspaceId, projectId, schedule.id);
      refreshUsagePanels();
      toast.success(result.status === 'success' ? t('report_schedules.run_now_success') : t('report_schedules.run_now_failed'));
      return result;
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
      return null;
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleRetryScheduleDelivery = React.useCallback(async (schedule: UsageReportSchedule, delivery: UsageReportDelivery) => {
    try {
      const result = await usageApi.retryReportScheduleDelivery(workspaceId, projectId, schedule.id, delivery.id);
      refreshUsagePanels();
      toast.success(result.status === 'success' ? t('report_schedules.retry_success') : t('report_schedules.retry_failed'));
      return result;
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
      return null;
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleAcknowledgeDelivery = React.useCallback(async (schedule: UsageReportSchedule, delivery: UsageReportDelivery) => {
    try {
      await usageApi.acknowledgeReportScheduleDelivery(workspaceId, projectId, schedule.id, delivery.id);
      refreshUsagePanels();
      toast.success(t('report_schedules.acknowledge_success'));
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleRunDueSchedules = React.useCallback(async () => {
    try {
      const result = await usageApi.runDueReportSchedules(workspaceId, projectId);
      refreshUsagePanels();
      toast.success(t('report_schedules.run_due_success', { count: result.deliveries.length }));
    } catch (error) {
      toast.error(t('report_schedules.failed_with_reason', {
        reason: error instanceof Error ? error.message : commonT('unknown_error'),
      }));
    }
  }, [commonT, projectId, refreshUsagePanels, t, usageApi, workspaceId]);

  const handleClearFilters = React.useCallback(() => {
    setFilters({
      ...getDefaultTimeRange(),
      page: 1,
      page_size: 25,
      sort_by: 'time_bucket',
      sort_order: 'desc',
      group_by: 'day',
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
    [effectiveEndUserId]
  );

  const applyDrillDown = React.useCallback(
    (payload: { resourceId?: string; resourceType?: string; endUserId?: string }) => {
      setPanel('usage');
      setFilters((prev) => ({
        ...prev,
        resource_id: payload.resourceId,
        resource_type: payload.resourceType,
        end_user_id: payload.endUserId,
        page: 1,
      }));
    },
    []
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
                    <Button
                      variant="outline"
                      disabled={exportingFormat !== null}
                      data-testid="usage__export-trigger"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      {t('export.label')}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => void handleExport('csv')}
                      data-testid="usage__export-option-csv"
                    >
                      {t('export.csv')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => void handleExport('json')}
                      data-testid="usage__export-option-json"
                    >
                      {t('export.json')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button variant="action" onClick={handleRefresh} disabled={isLoading || kpiLoading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || kpiLoading ? 'animate-spin' : ''}`} />
                {commonT('refresh')}
              </Button>
            </div>
          )}
        />
      )}
      toolbar={(
        <PageToolbar className="w-full">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs value={panel} onValueChange={(value) => setPanel(value as 'usage' | 'dashboard')}>
              <TabsList>
                <TabsTrigger value="usage" data-testid="usage__panel-tab--usage">{t('title')}</TabsTrigger>
                <TabsTrigger value="dashboard" data-testid="usage__panel-tab--dashboard">{t('dashboard')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {!isScopeLocked && currentUserId && (
              <Tabs value={scope} onValueChange={(value) => setScope(value as 'my' | 'project')}>
                <TabsList>
                  <TabsTrigger value="my">{t('scope_my_usage')}</TabsTrigger>
                  <TabsTrigger value="project">{t('scope_project_usage')}</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
        </PageToolbar>
      )}
    >
      {panel === 'dashboard' ? (
        <CostDashboardPage
          workspaceId={workspaceId}
          projectId={projectId}
          embedded
          onResourceDrillDown={(resourceId, resourceType) => {
            applyDrillDown({ resourceId, resourceType });
          }}
          onUserDrillDown={(endUserId) => {
            applyDrillDown({ endUserId });
          }}
          onAnomalyDrillDown={(resourceId, resourceType) => {
            applyDrillDown({ resourceId, resourceType });
          }}
        />
      ) : (
        <div className="w-full space-y-3 min-h-0 flex-1 flex flex-col">
          <UsageKPICards kpi={kpiData} loading={kpiLoading} />

          <div data-testid="usage__filters">
            <UsageFilters
              filters={apiFilters}
              onChange={handleFiltersChange}
              onClear={handleClearFilters}
              defaultEndUserId={effectiveEndUserId}
            />
          </div>

          <UsageOperationsSummary
            summary={operationsSummaryQuery.data}
            loading={operationsSummaryQuery.isLoading}
          />

          <UsageReportSchedulesPanel
            schedules={reportSchedulesQuery.data?.items ?? []}
            loading={reportSchedulesQuery.isLoading}
            evidence={reportEvidenceQuery.data}
            evidenceLoading={reportEvidenceQuery.isLoading}
            canManage={canManageReportSchedules}
            currentFilters={apiFilters}
            onCreate={handleCreateReportSchedule}
            onUpdateStatus={handleUpdateScheduleStatus}
            onDelete={handleDeleteSchedule}
            onTestDelivery={handleTestScheduleDelivery}
            onRunNow={handleRunScheduleNow}
            onRetryDelivery={handleRetryScheduleDelivery}
            onAcknowledgeDelivery={handleAcknowledgeDelivery}
            onRunDue={handleRunDueSchedules}
          />

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
                  {commonT('page_of', { page: String(currentPage), total: String(totalPages) })} ·
                  {' '}
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
          />
        </div>
      )}
    </PageLayout>
  );
}
