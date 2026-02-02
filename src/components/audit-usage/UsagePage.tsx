'use client';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { UsageKPICards } from './UsageKPICards';
import { UsageFilters } from './UsageFilters';
import { UsageTable } from './UsageTable';
import { useUsageKPI, useUsageRecords } from '@/lib/hooks/use-audit-usage';
import { toast } from '@/components/ui/toast';
import type { UsageListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';

export interface UsagePageProps {
  workspaceId: string;
  projectId: string;
  defaultEndUserId?: string; // For project-user permission
}

const DEFAULT_TIME_RANGE = {
  start_time: new Date().toISOString().split('T')[0] + 'T00:00:00.000Z', // Today start
  end_time: new Date().toISOString(), // Now
};

export function UsagePage({ workspaceId, projectId, defaultEndUserId }: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const [filters, setFilters] = React.useState<UsageListParams>({
    ...DEFAULT_TIME_RANGE,
    page: 1,
    page_size: 25,
    sort_by: 'time_bucket',
    sort_order: 'desc',
    group_by: 'day',
    ...(defaultEndUserId && { end_user_id: defaultEndUserId }),
  });

  const { data: kpiData, isLoading: kpiLoading } = useUsageKPI(
    workspaceId,
    projectId,
    filters.start_time,
    filters.end_time,
  );
  const { data, isLoading, error } = useUsageRecords(workspaceId, projectId, filters);

  const handleRefresh = () => {
    queryClient.invalidateQueries({
      queryKey: ['usage-kpi', workspaceId, projectId],
    });
    queryClient.invalidateQueries({
      queryKey: ['usage', workspaceId, projectId],
    });
    toast.success(commonT('refreshed_data') || 'Refreshed usage data');
  };

  const handleClearFilters = () => {
    setFilters({
      ...DEFAULT_TIME_RANGE,
      page: 1,
      page_size: 25,
      sort_by: 'time_bucket',
      sort_order: 'desc',
      group_by: 'day',
      ...(defaultEndUserId && { end_user_id: defaultEndUserId }),
    });
  };

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
          filters={filters}
          onChange={setFilters}
          onClear={handleClearFilters}
          defaultEndUserId={defaultEndUserId}
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
