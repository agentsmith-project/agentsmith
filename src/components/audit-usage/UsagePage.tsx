'use client';

import * as React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { UsageView } from './UsageView';
import { useLimitsSummary, useUsageKPI, useUsageRecords } from '@/lib/hooks/use-audit-usage';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { toast } from '@/components/ui/toast';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { ErrorState } from '@/components/ui/error-state';
import type { UsageListParams } from '@/lib/api/types';
import { useQueryClient } from '@tanstack/react-query';
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

export function UsagePage({
  workspaceId,
  projectId,
  defaultEndUserId,
  currentUserId,
}: UsagePageProps) {
  const t = useTranslations('usage');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const canReadUsage = useHasPermission('project:endpoint:use');
  const effectiveEndUserId = defaultEndUserId ?? currentUserId;
  const [periodDays, setPeriodDays] = React.useState<7 | 30>(30);

  const usageRange = React.useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - periodDays * 24 * 60 * 60 * 1000);
    return {
      start_time: start.toISOString(),
      end_time: end.toISOString(),
    };
  }, [periodDays]);

  const { data: kpiData, isLoading: kpiLoading } = useUsageKPI(
    workspaceId,
    projectId,
    usageRange.start_time,
    usageRange.end_time,
    effectiveEndUserId,
    { enabled: canReadUsage },
  );

  const usageParams = React.useMemo<UsageListParams>(
    () => ({
      start_time: usageRange.start_time,
      end_time: usageRange.end_time,
      end_user_id: effectiveEndUserId,
      page: 1,
      page_size: 30,
      group_by: 'day',
      sort_by: 'time_bucket',
      sort_order: 'asc',
    }),
    [effectiveEndUserId, usageRange.end_time, usageRange.start_time],
  );

  const { data: usageData, isLoading: usageLoading, error: usageError } = useUsageRecords(
    workspaceId,
    projectId,
    usageParams,
    { enabled: canReadUsage },
  );

  const { data: limitsSummary } = useLimitsSummary(workspaceId, projectId, {
    enabled: canReadUsage,
  });

  const limitsOverview = React.useMemo(
    () => ({
      endpoints: (limitsSummary?.endpoints ?? []).map((item) => ({
        resourceId: item.resource_id,
        resourceName: item.resource_name,
        limitUsed: item.quota_used,
        limitTotal: item.quota_limit,
        percentageUsed: item.percentage_used,
        resetAt: item.quota_reset_at,
      })),
      totalLimitUsed: limitsSummary?.total_quota_used,
      totalLimit: limitsSummary?.total_quota_limit,
    }),
    [limitsSummary],
  );

  const handleRefresh = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.usage._def });
    toast.success(commonT('refreshed_data') || 'Refreshed usage data');
  }, [commonT, queryClient]);

  if (!canReadUsage) {
    return (
      <PageLayout header={<PageHeader title={t('title')} subtitle={t('subtitle')} />}>
        <div className="flex flex-1 flex-col items-center justify-center">
          <div className="max-w-md rounded-xl border border-border bg-surface p-8 text-center">
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
    <PageLayout
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <Button variant="outline" onClick={handleRefresh} disabled={usageLoading || kpiLoading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${usageLoading || kpiLoading ? 'animate-spin' : ''}`} />
              {commonT('refresh')}
            </Button>
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
      <UsageView
        kpi={kpiData}
        records={usageData?.items ?? []}
        loading={usageLoading || kpiLoading}
        periodDays={periodDays}
        onPeriodChange={setPeriodDays}
        limitsOverview={limitsOverview}
      />
    </PageLayout>
  );
}
