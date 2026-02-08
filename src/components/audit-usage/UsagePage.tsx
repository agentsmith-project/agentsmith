'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { UsageKPICards } from './UsageKPICards';
import { UsageFilters } from './UsageFilters';
import { UsageTable } from './UsageTable';
import { useUsageKPI, useUsageRecords } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import type { UsageListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

function formatDateTimeLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function UsagePage({ workspaceId, projectId, defaultEndUserId, currentUserId }: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const canReadUsage = useHasPermission('project:usage:view');

  // If defaultEndUserId is provided, scope is locked to the current user usage.
  const isScopeLocked = !!defaultEndUserId;
  const [scope, setScope] = React.useState<'my' | 'project'>(defaultEndUserId ? 'my' : 'project');

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

  const handleRefresh = React.useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['usage-kpi', workspaceId, projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ['usage', workspaceId, projectId],
    });
    toast.success(commonT('refreshed_data') || 'Refreshed usage data');
  }, [queryClient, workspaceId, projectId, commonT]);

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

  const currentPage = data?.page ?? filters.page ?? 1;
  const pageSize = data?.page_size ?? filters.page_size ?? 25;
  const totalItems = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const canGoPrev = currentPage > 1;
  const canGoNext = !!data?.has_more || currentPage < totalPages;
  const hasActiveFilters =
    !!apiFilters.resource_type ||
    !!apiFilters.resource_id ||
    !!apiFilters.end_user_id;
  const filterSummaryItems = [
    `${formatDateTimeLabel(apiFilters.start_time)} - ${formatDateTimeLabel(apiFilters.end_time)}`,
    ...(scope === 'my' ? [t('scope_my_usage')] : [t('scope_project_usage')]),
    ...(apiFilters.resource_type ? [apiFilters.resource_type] : []),
    ...(apiFilters.resource_id ? [`resource:${apiFilters.resource_id}`] : []),
    ...(apiFilters.end_user_id ? [`user:${apiFilters.end_user_id}`] : []),
  ];

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
        <div className="bg-error/10 border border-error/30 rounded-md p-4">
          <p className="text-error">
            Failed to load usage data: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}
      toolbar={(
        <PageToolbar className="w-full justify-between">
          <div className="flex items-center gap-2">
            {!isScopeLocked && currentUserId && (
              <Tabs value={scope} onValueChange={(value) => setScope(value as 'my' | 'project')}>
                <TabsList>
                  <TabsTrigger value="my">{t('scope_my_usage')}</TabsTrigger>
                  <TabsTrigger value="project">{t('scope_project_usage')}</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRefresh} disabled={isLoading || kpiLoading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || kpiLoading ? 'animate-spin' : ''}`} />
              {commonT('refresh')}
            </Button>
          </div>
        </PageToolbar>
      )}
    >
      {/* KPI Cards */}
      <UsageKPICards kpi={kpiData} loading={kpiLoading} />

      {/* Filters */}
      <div data-testid="usage__filters">
        <UsageFilters
          filters={apiFilters}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
          defaultEndUserId={effectiveEndUserId}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-3">
        <span className="text-xs text-tertiary">{t('summary.title')}</span>
        {filterSummaryItems.map((item) => (
          <Badge key={item} variant="outline" className="text-[11px]">
            {item}
          </Badge>
        ))}
        {hasActiveFilters && (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 ml-auto" onClick={handleClearFilters}>
            {commonT('clear_filters')}
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="rounded-md border border-border bg-surface p-3">
          <UsageTable
            data={data?.items || []}
            loading={isLoading}
            onClearFilters={handleClearFilters}
            hasActiveFilters={hasActiveFilters}
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
    </PageLayout>
  );
}
