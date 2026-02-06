'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { UsageKPICards } from './UsageKPICards';
import { UsageFilters } from './UsageFilters';
import { UsageTable } from './UsageTable';
import { useUsageKPI, useUsageRecords } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import type { UsageListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';

export interface UsagePageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string; // When set, user can only see own usage (locked)
  currentUserId?: string; // For scope switch when user has project-wide permission
}

function getDefaultTimeRange() {
  return {
    start_time: new Date().toISOString().split('T')[0] + 'T00:00:00.000Z', // Today start
    end_time: new Date().toISOString(), // Now
  };
}

export function UsagePage({ workspaceId, projectId, defaultEndUserId, currentUserId }: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const canReadUsage = useHasPermission('project:usage:read');

  // User role: locked to own usage. Owner/admin/developer: can switch scope
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
        ...(effectiveEndUserId && { end_user_id: effectiveEndUserId }),
      }));
    },
    [effectiveEndUserId]
  );

  if (!canReadUsage) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6">
        <div className="rounded-xl border border-border bg-surface p-8 text-center max-w-md">
          <p className="text-sm text-tertiary">{t('permission_denied')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-error/10 border border-error/30 rounded-md p-4">
          <p className="text-error">
            Failed to load usage data: {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="p-6 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
          <p className="text-sm text-tertiary mt-1">{t('subtitle')}</p>
          {!isScopeLocked && currentUserId && (
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setScope('my')}
                className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                  scope === 'my'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'text-tertiary hover:text-foreground'
                }`}
              >
                {t('scope_my_usage')}
              </button>
              <button
                type="button"
                onClick={() => setScope('project')}
                className={`text-sm px-3 py-1.5 rounded-md transition-colors ${
                  scope === 'project'
                    ? 'bg-accent/20 text-accent font-medium'
                    : 'text-tertiary hover:text-foreground'
                }`}
              >
                {t('scope_project_usage')}
              </button>
            </div>
          )}
        </div>
        <Button variant="outline" onClick={handleRefresh} disabled={isLoading || kpiLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || kpiLoading ? 'animate-spin' : ''}`} />
          {commonT('refresh')}
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="p-6">
        <UsageKPICards kpi={kpiData} loading={kpiLoading} />
      </div>

      {/* Filters */}
      <div className="px-6 pb-4">
        <UsageFilters
          filters={apiFilters}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
          defaultEndUserId={effectiveEndUserId}
        />
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <UsageTable
          data={data?.items || []}
          loading={isLoading}
          onClearFilters={handleClearFilters}
        />
      </div>
    </div>
  );
}
