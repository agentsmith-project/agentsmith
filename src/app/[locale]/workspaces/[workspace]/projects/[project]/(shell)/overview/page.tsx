/**
 * Overview Page (Simplified)
 *
 * Project overview dashboard with KPI cards and navigation.
 */

'use client';

import * as React from 'react';
import { KPICard, ProjectNavigation, ActivityTimeline } from '@/components/dashboard';
import { useParams } from 'next/navigation';
import { Activity, AlertCircle, Clock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { UsageAPI, AuditAPI } from '@/lib/api';
import { getApiClient } from '@/lib/api';
import { validateUsageKPI } from '@/lib/api/validators';
import { formatNumber } from '@/lib/utils/formatters';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type TimeRangePreset = '7d' | '30d';

function getTimeRange(preset: TimeRangePreset): { start_time: string; end_time: string } {
  const end = new Date();
  const start = new Date();
  if (preset === '7d') {
    start.setDate(start.getDate() - 7);
  } else {
    start.setDate(start.getDate() - 30);
  }
  return {
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };
}

function calculateTrend(current: number, previous?: number) {
  if (!previous || previous === 0) return undefined;
  const delta = ((current - previous) / previous) * 100;
  return {
    value: `${Math.abs(delta).toFixed(1)}%`,
    direction: delta >= 0 ? 'up' : 'down',
  } as const;
}

export default function OverviewPage() {
  const t = useTranslations('overview');
  const tErrors = useTranslations('errors');
  const params = useParams();
  const workspaceId = validateWorkspaceParam(params.workspace);
  const projectId = validateProjectParam(params.project);
  const locale = (params.locale as string) || 'en-US';
  const canReadOverview = useHasPermission('project:read');
  const isValidParams = !!workspaceId && !!projectId;

  // Must run on every render to keep hooks order stable
  useSyncAuthFromUrl();

  const [timeRangePreset, setTimeRangePreset] = React.useState<TimeRangePreset>('7d');
  const timeRange = React.useMemo(() => getTimeRange(timeRangePreset), [timeRangePreset]);

  const apiClient = getApiClient();
  const usageAPI = new UsageAPI(apiClient);
  const auditAPI = new AuditAPI(apiClient);

  // Fetch KPI data with validation
  const { data: kpiData } = useQuery({
    queryKey: ['usage', 'kpi', workspaceId, projectId, timeRange.start_time, timeRange.end_time],
    queryFn: async () => {
      const data = await usageAPI.getKPI(
        workspaceId!,
        projectId!,
        timeRange.start_time,
        timeRange.end_time
      );
      return validateUsageKPI(data);
    },
    enabled: isValidParams && canReadOverview,
  });

  // Fetch recent activity
  const { data: auditEvents } = useQuery({
    queryKey: ['audit', workspaceId, projectId, timeRange.start_time, timeRange.end_time],
    queryFn: () =>
      auditAPI.list(workspaceId!, projectId!, {
        page: 1,
        page_size: 5,
        start_time: timeRange.start_time,
        end_time: timeRange.end_time,
      }),
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

  // Use validated KPI data with safe defaults
  const kpi = kpiData || {
    requests_today: 0,
    errors_today: 0,
  };
  const requestsTrend = calculateTrend(kpi.requests_today, kpi.requests_yesterday);
  const errorsTrend = calculateTrend(kpi.errors_today, kpi.errors_yesterday);
  const tokensTrend = calculateTrend(kpi.tokens_today ?? 0, kpi.tokens_yesterday);

  // Activity timeline items (will be replaced with real audit data)
  const activityItems = auditEvents?.items.map((event) => ({
    id: event.id,
    icon: Activity,
    title: `${event.actor_type === 'user' ? t('recent_activity') : t('recent_activity')} ${event.action}`,
    description: event.resource_type ? `${event.resource_type}: ${event.resource_id}` : undefined,
    timestamp: new Date(event.timestamp).toLocaleString(),
    copyableId: event.request_id,
  })) || [];

  return (
    <PageState state="success">
      <PageLayout
        header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}
        toolbar={(
          <PageToolbar>
            <Select value={timeRangePreset} onValueChange={(v) => setTimeRangePreset(v as TimeRangePreset)}>
              <SelectTrigger className="w-[140px]" data-testid="overview__time-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </PageToolbar>
        )}
      >
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <KPICard
            icon={Activity}
            label={t('kpi.requests_today')}
            value={formatNumber(kpi.requests_today)}
            trend={requestsTrend}
            vsLastPeriodLabel={t('kpi.vs_last_period')}
            data-testid="overview__kpi-card--requests"
          />
          <KPICard
            icon={AlertCircle}
            label={t('kpi.errors_today')}
            value={formatNumber(kpi.errors_today)}
            trend={errorsTrend}
            vsLastPeriodLabel={t('kpi.vs_last_period')}
            data-testid="overview__kpi-card--errors"
          />
          <KPICard
            icon={Clock}
            label={t('kpi.tokens_today')}
            value={formatNumber(kpi.tokens_today, { defaultValue: '--' })}
            trend={tokensTrend}
            vsLastPeriodLabel={t('kpi.vs_last_period')}
            data-testid="overview__kpi-card--tokens"
          />
        </div>

        {/* Project Navigation */}
        <div data-testid="overview__quick-access">
          <h2 className="text-lg font-semibold text-primary mb-4">{t('quick_access')}</h2>
          <ProjectNavigation basePath={basePath} columns={3} translations={t} />
        </div>

        {/* Recent Activity */}
        <div data-testid="overview__activity-timeline">
          <ActivityTimeline
            items={activityItems}
            maxItems={5}
            viewAllLink={`${basePath}/audit`}
            translations={t}
          />
        </div>
      </PageLayout>
    </PageState>
  );
}
