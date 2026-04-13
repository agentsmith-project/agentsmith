'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { UsageView } from './UsageView';
import { useLimitsSummary, useUsageTimeseries } from '@/lib/hooks/use-audit-usage';
import { useUsagePageCapabilities } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { ErrorState } from '@/components/ui/error-state';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useEndpointsData } from '@/lib/endpoints/use-endpoints-data';
import { getReferenceNow } from '@/lib/reference-now';

export interface UsagePageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
  defaultEndUserId?: string;
  currentUserId?: string;
}

export function UsagePage({
  workspaceId,
  projectId,
  defaultEndUserId,
  currentUserId,
}: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const { canRead: canReadUsage } = useUsagePageCapabilities();
  const effectiveEndUserId = defaultEndUserId ?? currentUserId;
  const [selectedEndpointId, setSelectedEndpointId] = React.useState<string>('all');
  const referenceNow = React.useMemo(() => getReferenceNow(), []);

  const trendRange = React.useMemo(() => {
    const end = new Date(referenceNow);
    const start = new Date(end);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return {
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    };
  }, [referenceNow]);

  const timeseriesParams = React.useMemo(
    () => ({
      start_time: trendRange.start_time,
      end_time: trendRange.end_time,
      granularity: 'day' as const,
      metric: 'requests' as const,
      end_user_id: effectiveEndUserId,
      resource_type: selectedEndpointId === 'all' ? undefined : ('endpoint' as const),
      resource_id: selectedEndpointId === 'all' ? undefined : selectedEndpointId,
    }),
    [effectiveEndUserId, selectedEndpointId, trendRange.end_time, trendRange.start_time],
  );

  const { data: usageData, isLoading: usageLoading, error: usageError } = useUsageTimeseries(
    workspaceId,
    projectId,
    timeseriesParams,
    { enabled: canReadUsage },
  );

  const { data: limitsSummary } = useLimitsSummary(
    workspaceId,
    projectId,
    { end_user_id: effectiveEndUserId },
    {
      enabled: canReadUsage,
      refetchInterval: 15_000,
    },
  );
  const { endpoints } = useEndpointsData({
    workspaceId,
    projectId,
    canReadEndpoints: canReadUsage,
  });
  const endpointNameMap = React.useMemo(
    () => new Map(endpoints.map((item) => [item.id, item.name || item.id])),
    [endpoints],
  );

  const limitsOverview = React.useMemo(() => {
    const normalizedEndpoints = (limitsSummary?.endpoints ?? []).map((item) => ({
      endpointId: item.endpoint_id,
      endpointName: item.endpoint_name || endpointNameMap.get(item.endpoint_id) || item.endpoint_id,
      limits: (item.limits ?? []).map((rule) => ({
        kind: rule.kind,
        window: rule.window,
        metric: rule.metric,
        policyKey: rule.policy_key,
        used: rule.used,
        max: rule.max,
        remaining: rule.remaining,
        usagePct: rule.usage_pct,
        resetAt: rule.reset_at,
      })),
    }));

    return {
      endpoints: normalizedEndpoints,
    };
  }, [endpointNameMap, limitsSummary]);

  const endpointOptions = React.useMemo(() => {
    const fromLimits = limitsOverview.endpoints.map((item) => ({
      id: item.endpointId,
      name: item.endpointName || endpointNameMap.get(item.endpointId) || item.endpointId,
    }));
    if (fromLimits.length > 0) return fromLimits;
    const fromEndpointsApi = endpoints.map((item) => ({
      id: item.id,
      name: item.name || item.id,
    }));
    if (fromEndpointsApi.length > 0) return fromEndpointsApi;
    return [];
  }, [endpointNameMap, endpoints, limitsOverview.endpoints]);
  const totalLimitCards = limitsOverview.endpoints.reduce(
    (count, endpoint) =>
      count
      + endpoint.limits.filter(
        (rule) =>
          (rule.kind === 'rate_limit' || rule.kind === 'spending_limit')
          && (rule.window === '5h' || rule.window === 'day'),
      ).length,
    0,
  );

  React.useEffect(() => {
    if (selectedEndpointId === 'all' && endpointOptions.length > 0) {
      setSelectedEndpointId(endpointOptions[0]?.id ?? 'all');
      return;
    }
    if (endpointOptions.some((option) => option.id === selectedEndpointId)) return;
    setSelectedEndpointId('all');
  }, [endpointOptions, selectedEndpointId]);

  const handleRefresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.usage._def });
    toast.success(commonT('refreshed_data') || 'Refreshed usage data');
  }, [commonT, queryClient]);

  if (!canReadUsage) {
    return (
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="max-w-md rounded-md border border-border bg-surface p-8 text-center">
            <p className="text-sm text-tertiary">{t('permission_denied')}</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (usageError) {
    return (
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <ErrorState
          title={commonT('something_went_wrong')}
          message={t('load_failed_with_reason', {
            reason: usageError instanceof Error ? usageError.message : commonT('unknown_error'),
          })}
          onRetry={handleRefresh}
          retryLabel={commonT('retry')}
        />
      </PageLayout>
    );
  }

  return (
    <div data-testid="usage__view">
      <PageLayout
        header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          variant="compact"
          actions={(
            <Button variant="outline" onClick={handleRefresh} disabled={usageLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${usageLoading ? 'animate-spin' : ''}`} />
              {commonT('refresh')}
            </Button>
          )}
        />
      )}
      toolbar={(
        <PageToolbar className="w-full">
          <div className="w-full space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center rounded-full border border-subtle bg-surface-low px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-secondary"
                data-testid="usage__my-scope-badge"
              >
                {t('scope_my_usage')}
              </span>
              <p className="text-xs text-tertiary" data-testid="usage__scope-note">
                {t('view.scope_note')}
              </p>
            </div>
            <div
              className="flex flex-wrap items-center gap-2 text-xs text-tertiary"
              data-testid="usage__summary-line"
            >
              <span><span className="text-foreground">{endpointOptions.length}</span> {t('view.endpoints_label')}</span>
              <span aria-hidden="true">·</span>
              <span><span className="text-foreground">{totalLimitCards}</span> {t('view.active_limits')}</span>
              <span aria-hidden="true">·</span>
              <span>{t('view.last_30_days')}</span>
            </div>
          </div>
        </PageToolbar>
      )}
    >
      <UsageView
        trendPoints={usageData?.data_points ?? []}
        trendLoading={usageLoading}
        endpointOptions={endpointOptions}
        selectedEndpointId={selectedEndpointId}
        onEndpointChange={setSelectedEndpointId}
        referenceNow={usageData?.time_range?.end ?? trendRange.end_time}
        limitsOverview={limitsOverview}
      />
    </PageLayout>
    </div>
  );
}
