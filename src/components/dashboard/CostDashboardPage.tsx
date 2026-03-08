'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardKPICards, type DashboardKPI } from './DashboardKPICards';
import { TrendChart } from './TrendChart';
import { TopResourcesList, type ResourceUsageRank } from './TopResourcesList';
import { TopUsersList, type UserUsageRank } from './TopUsersList';
import { AnomalyAlertsPanel, type AnomalyAlert } from './AnomalyAlertsPanel';
import { DashboardFilters } from './DashboardFilters';
import type { DashboardFiltersProps } from './DashboardFilters';
import { useLimitsSummary, useUsageKPI, useUsageRecords, useUsageTimeseries } from '@/lib/hooks/use-audit-usage';
import { useQueryClient } from '@tanstack/react-query';

export interface CostDashboardPageProps {
  workspaceId: string;
  projectId: string;
  embedded?: boolean;
  onResourceDrillDown?: (resourceId: string, resourceType?: string) => void;
  onUserDrillDown?: (endUserId: string) => void;
  onAnomalyDrillDown?: (resourceId: string, resourceType?: string) => void;
}

function getDefaultTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

function toTrendSeries(dataPoints: Array<{ time_bucket: string; requests: number }>) {
  return dataPoints.map((point) => ({
    timestamp: point.time_bucket,
    value: point.requests,
  }));
}

function toTopResources(
  resourceBreakdown:
    | Array<{
      resource_id: string;
      resource_name: string;
      resource_type: string;
      requests: number;
      tokens?: number;
      estimated_cost: number;
    }>
    | undefined,
): ResourceUsageRank[] {
  if (!resourceBreakdown || resourceBreakdown.length === 0) {
    return [];
  }

  return resourceBreakdown
    .slice()
    .sort((a, b) => b.requests - a.requests)
    .map((item) => ({
      resource_id: item.resource_id,
      resource_type: item.resource_type as ResourceUsageRank['resource_type'],
      resource_name: item.resource_name,
      requests: item.requests,
      tokens: item.tokens,
      cost_usd: item.estimated_cost,
    }))
    .slice(0, 5);
}

function toTopUsers(
  usageItems: Array<{ end_user_id?: string; requests: number; tokens?: number }>,
): UserUsageRank[] {
  const byUser = new Map<string, { requests: number; tokens: number }>();

  for (const item of usageItems) {
    if (!item.end_user_id) continue;
    const prev = byUser.get(item.end_user_id) ?? { requests: 0, tokens: 0 };
    byUser.set(item.end_user_id, {
      requests: prev.requests + item.requests,
      tokens: prev.tokens + (item.tokens ?? 0),
    });
  }

  return Array.from(byUser.entries())
    .map(([endUserId, value]) => ({
      end_user_id: endUserId,
      user_name: endUserId,
      requests: value.requests,
      tokens: value.tokens,
    }))
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 5);
}

function toAnomalies(
  dataPoints: Array<{ time_bucket: string; requests: number }>,
  topResources: ResourceUsageRank[],
): AnomalyAlert[] {
  if (dataPoints.length < 3) return [];

  const average = dataPoints.reduce((sum, item) => sum + item.requests, 0) / dataPoints.length;
  const spikes = dataPoints
    .filter((item) => item.requests > average * 1.05)
    .slice(0, 3);

  return spikes.map((item, index) => ({
    id: `anom-${index + 1}-${item.time_bucket}`,
    timestamp: item.time_bucket,
    severity: 'high',
    type: 'requests_spike',
    description: `Requests spiked to ${item.requests.toLocaleString()}`,
    value: item.requests,
    expected_range: {
      min: Math.max(0, Math.round(average * 0.8)),
      max: Math.round(average * 1.2),
    },
    affected_resources: topResources.slice(0, 1).map((resource) => ({
      type: resource.resource_type,
      id: resource.resource_id,
      name: resource.resource_name,
    })),
  }));
}

function toDashboardKpi(
  kpi: {
    requests_today: number;
    errors_today: number;
    tokens_today?: number;
    requests_yesterday?: number;
    errors_yesterday?: number;
    tokens_yesterday?: number;
  } | undefined,
  totalCost?: number,
): DashboardKPI | undefined {
  if (!kpi) return undefined;
  const requestsChange = kpi.requests_yesterday
    ? ((kpi.requests_today - kpi.requests_yesterday) / Math.max(1, kpi.requests_yesterday)) * 100
    : undefined;
  const errorsChange = kpi.errors_yesterday
    ? ((kpi.errors_today - kpi.errors_yesterday) / Math.max(1, kpi.errors_yesterday)) * 100
    : undefined;
  const tokensChange =
    kpi.tokens_yesterday !== undefined && kpi.tokens_today !== undefined
      ? ((kpi.tokens_today - kpi.tokens_yesterday) / Math.max(1, kpi.tokens_yesterday)) * 100
      : undefined;

  return {
    total_requests: kpi.requests_today,
    total_errors: kpi.errors_today,
    total_tokens: kpi.tokens_today ?? 0,
    total_cost_usd: totalCost,
    requests_change_percent: requestsChange,
    errors_change_percent: errorsChange,
    tokens_change_percent: tokensChange,
  };
}

export function CostDashboardPage({
  workspaceId,
  projectId,
  embedded = false,
  onResourceDrillDown,
  onUserDrillDown,
  onAnomalyDrillDown,
}: CostDashboardPageProps) {
  const t = useTranslations('dashboard');
  const queryClient = useQueryClient();
  const [filters, setFilters] = React.useState<DashboardFiltersProps['filters']>({
    ...getDefaultTimeRange(),
    granularity: 'day',
  });

  const { data: kpiData, isLoading: kpiLoading } = useUsageKPI(
    workspaceId,
    projectId,
    filters.start_time,
    filters.end_time,
  );
  const { data: timeseriesData, isLoading: timeseriesLoading } = useUsageTimeseries(
    workspaceId,
    projectId,
    {
      start_time: filters.start_time,
      end_time: filters.end_time,
      granularity: filters.granularity,
      metric: 'requests',
      resource_type: filters.resource_type as 'endpoint' | 'source_library' | 'agent' | undefined,
    },
  );
  const { data: usageData, isLoading: usageLoading } = useUsageRecords(
    workspaceId,
    projectId,
    {
      start_time: filters.start_time,
      end_time: filters.end_time,
      page: 1,
      page_size: 200,
      sort_by: 'requests',
      sort_order: 'desc',
      group_by: 'day',
      resource_type: filters.resource_type,
      resource_id: filters.resource_id,
      end_user_id: filters.end_user_id,
    },
  );
  const { data: limitsOverview } = useLimitsSummary(workspaceId, projectId);

  const trendData = React.useMemo(
    () => toTrendSeries(timeseriesData?.data_points ?? []),
    [timeseriesData?.data_points],
  );
  const topResources = React.useMemo(
    () => toTopResources(timeseriesData?.resource_breakdown),
    [timeseriesData?.resource_breakdown],
  );
  const topUsers = React.useMemo(
    () => toTopUsers(usageData?.items ?? []),
    [usageData?.items],
  );
  const anomalies = React.useMemo(
    () => toAnomalies(timeseriesData?.data_points ?? [], topResources),
    [timeseriesData?.data_points, topResources],
  );
  const dashboardKpi = React.useMemo(
    () => toDashboardKpi(kpiData, timeseriesData?.total_cost),
    [kpiData, timeseriesData?.total_cost],
  );

  const totalLimitUsagePercentage = React.useMemo(() => {
    const totalLimit = limitsOverview?.total_limit ?? limitsOverview?.total_quota_limit;
    const totalUsed = limitsOverview?.total_limit_used ?? limitsOverview?.total_quota_used;
    if (!totalLimit || !totalUsed) return undefined;
    return Math.min(
      100,
      (totalUsed / Math.max(1, totalLimit)) * 100,
    );
  }, [
    limitsOverview?.total_limit,
    limitsOverview?.total_limit_used,
    limitsOverview?.total_quota_limit,
    limitsOverview?.total_quota_used,
  ]);

  const handleRefresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['usage-timeseries', workspaceId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['usage-kpi', workspaceId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['usage', workspaceId, projectId] });
    queryClient.invalidateQueries({ queryKey: ['usage-limits-summary', workspaceId, projectId] });
    toast.success(t('refreshed_data'));
  }, [projectId, queryClient, t, workspaceId]);

  const handleFiltersChange = (newFilters: Partial<DashboardFiltersProps['filters']>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const handleClearFilters = () => {
    setFilters({
      ...getDefaultTimeRange(),
      granularity: 'day',
    });
  };

  const content = (
    <div className="w-full space-y-3 min-h-0 flex-1 flex flex-col">
      {embedded && (
        <div className="flex items-center justify-end">
          <Button variant="action" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('refresh')}
          </Button>
        </div>
      )}

      <DashboardKPICards kpi={dashboardKpi} loading={kpiLoading} />

      {totalLimitUsagePercentage !== undefined && (
        <div
          className="rounded-xl border border-border bg-surface p-3 text-sm text-tertiary"
          data-testid="dashboard-limit-overview"
        >
          Limit usage: {totalLimitUsagePercentage.toFixed(1)}%
        </div>
      )}

      <DashboardFilters
        filters={filters}
        onChange={handleFiltersChange}
        onClear={handleClearFilters}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        <div className="space-y-3 flex flex-col">
          <TrendChart
            data={trendData}
            metric="requests"
            granularity={filters.granularity || 'day'}
            loading={timeseriesLoading}
          />
          <TopResourcesList
            resources={topResources}
            loading={timeseriesLoading}
            onResourceClick={(resourceId) => {
              const resource = topResources.find((item) => item.resource_id === resourceId);
              onResourceDrillDown?.(resourceId, resource?.resource_type);
            }}
          />
        </div>

        <div className="space-y-3 flex flex-col">
          <TopUsersList
            users={topUsers}
            loading={usageLoading}
            onUserClick={(userId) => onUserDrillDown?.(userId)}
          />
          <AnomalyAlertsPanel
            anomalies={anomalies}
            loading={timeseriesLoading}
            onAnomalyClick={(anomalyId) => {
              const anomaly = anomalies.find((item) => item.id === anomalyId);
              const firstResource = anomaly?.affected_resources[0];
              if (firstResource) {
                onAnomalyDrillDown?.(firstResource.id, firstResource.type);
              }
            }}
          />
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <PageLayout
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <Button variant="action" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('refresh')}
            </Button>
          )}
        />
      )}
    >
      {content}
    </PageLayout>
  );
}
