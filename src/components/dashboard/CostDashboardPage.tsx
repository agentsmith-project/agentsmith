'use client';

import * as React from 'react';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardKPICards } from './DashboardKPICards';
import { TrendChart } from './TrendChart';
import { TopResourcesList } from './TopResourcesList';
import { TopUsersList } from './TopUsersList';
import { AnomalyAlertsPanel } from './AnomalyAlertsPanel';
import { DashboardFilters } from './DashboardFilters';
import type { DashboardFiltersProps } from './DashboardFilters';

export interface CostDashboardPageProps {
  workspaceId: string;
  projectId: string;
}

// Mock data for development - replace with API calls
const mockDashboardKPI = {
  total_requests: 4500,
  total_tokens: 2400000,
  total_errors: 23,
  total_cost_usd: 12.50,
  requests_change_percent: 5.2,
  tokens_change_percent: 3.1,
  errors_change_percent: -2.5,
};

const mockTrendData = [
  { timestamp: '2026-02-01T00:00:00Z', value: 4500 },
  { timestamp: '2026-02-02T00:00:00Z', value: 4800 },
  { timestamp: '2026-02-03T00:00:00Z', value: 4600 },
  { timestamp: '2026-02-04T00:00:00Z', value: 5100 },
  { timestamp: '2026-02-05T00:00:00Z', value: 5300 },
  { timestamp: '2026-02-06T00:00:00Z', value: 4900 },
  { timestamp: '2026-02-07T00:00:00Z', value: 5200 },
];

const mockTopResources = [
  {
    resource_id: 'ep_1',
    resource_type: 'endpoint' as const,
    resource_name: 'GPT-4',
    requests: 15230,
    tokens: 8450000,
    errors: 45,
    cost_usd: 12.50,
  },
  {
    resource_id: 'agent_1',
    resource_type: 'agent' as const,
    resource_name: 'Research Agent',
    requests: 8450,
    tokens: 4200000,
    errors: 12,
    cost_usd: 6.20,
  },
];

const mockTopUsers = [
  {
    end_user_id: 'user_1',
    user_name: 'Alice Johnson',
    requests: 8450,
    tokens: 4500000,
    errors: 12,
    cost_usd: 6.20,
  },
  {
    end_user_id: 'user_2',
    user_name: 'Bob Smith',
    requests: 5200,
    tokens: 2800000,
    errors: 8,
    cost_usd: 3.80,
  },
];

const mockAnomalies = [
  {
    id: 'anom_1',
    timestamp: '2026-02-15T14:30:00Z',
    severity: 'high' as const,
    type: 'requests_spike' as const,
    description: 'Unusual spike in requests',
    value: 12500,
    expected_range: { min: 3000, max: 6000 },
    affected_resources: [
      { type: 'endpoint', id: 'ep_1', name: 'GPT-4' },
    ],
  },
];

function getDefaultTimeRange() {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

export function CostDashboardPage({ workspaceId: _workspaceId, projectId: _projectId }: CostDashboardPageProps) {
  const t = useTranslations('dashboard');
  const [isLoading, setIsLoading] = useState(false);

  // Filters state
  const [filters, setFilters] = useState<DashboardFiltersProps['filters']>({
    ...getDefaultTimeRange(),
    granularity: 'day' as const,
  });

  const handleRefresh = () => {
    setIsLoading(true);
    // TODO: Refetch data from API
    setTimeout(() => {
      setIsLoading(false);
      toast.success(t('refreshed_data') || 'Refreshed dashboard data');
    }, 500);
  };

  const handleFiltersChange = (newFilters: Partial<DashboardFiltersProps['filters']>) => {
    setFilters((prev: DashboardFiltersProps['filters']) => ({ ...prev, ...newFilters }));
  };

  const handleClearFilters = () => {
    setFilters({
      ...getDefaultTimeRange(),
      granularity: 'day',
    });
  };

  return (
    <PageLayout
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <button
              onClick={handleRefresh}
              disabled={isLoading}
              className="px-3 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              {t('refresh')}
            </button>
          )}
        />
      )}
    >
      <div className="w-full space-y-3 min-h-0 flex-1 flex flex-col">
        {/* KPI Cards */}
        <DashboardKPICards kpi={mockDashboardKPI} loading={false} />

        {/* Filters */}
        <DashboardFilters
          filters={filters}
          onChange={handleFiltersChange}
          onClear={handleClearFilters}
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
          {/* Left Column: Chart + Top Resources */}
          <div className="space-y-3 flex flex-col">
            <TrendChart
              data={mockTrendData}
              metric="requests"
              granularity={filters.granularity || 'day'}
            />
            <TopResourcesList resources={mockTopResources} />
          </div>

          {/* Right Column: Top Users + Anomalies */}
          <div className="space-y-3 flex flex-col">
            <TopUsersList users={mockTopUsers} />
            <AnomalyAlertsPanel anomalies={mockAnomalies} />
          </div>
        </div>
      </div>
    </PageLayout>
  );
}
