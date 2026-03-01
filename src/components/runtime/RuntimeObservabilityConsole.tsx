'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UsageFactDetailDrawer } from '@/components/audit-usage/UsageFactDetailDrawer';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeRangePicker, type TimeRange } from '@/components/audit-usage/TimeRangePicker';
import { EmptyState } from '@/components/audit-usage/EmptyState';
import { useRuntimeObservability, useUsageFacts } from '@/lib/hooks/use-audit-usage';
import type { UsageListParams } from '@/lib/api/types';
import { buildSharedOpsFilterQuery } from '@/lib/ops-filter-context';

type RuntimeObservabilityConsoleProps = {
  workspaceId: string;
  projectId: string;
  initialFilters?: Partial<RuntimeObservabilityFilters>;
};

type RuntimeObservabilityFilters = {
  start_time: string;
  end_time: string;
  provider?: string;
  model?: string;
  result?: 'ok' | 'error';
  error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
};

type RuntimeDrillDown = {
  label: string;
  params: Omit<UsageListParams, 'group_by' | 'sort_by'>;
};

function defaultTimeRange(): RuntimeObservabilityFilters {
  return {
    start_time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date().toISOString(),
  };
}

function formatUsd(value?: number): string {
  return `$${(value ?? 0).toFixed(6)}`;
}

function formatPercent(value?: number): string {
  return `${(((value ?? 0) * 100)).toFixed(2)}%`;
}

function formatMs(value?: number): string {
  return typeof value === 'number' ? `${Math.round(value)}ms` : '-';
}

function getBucketRange(timeBucket: string): { start: string; end: string } | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeBucket)) {
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

export function RuntimeObservabilityConsole({
  workspaceId,
  projectId,
  initialFilters,
}: RuntimeObservabilityConsoleProps) {
  const settingsT = useTranslations('settings');
  const commonT = useTranslations('common');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [filters, setFilters] = React.useState<RuntimeObservabilityFilters>(() => ({
    ...defaultTimeRange(),
    ...initialFilters,
  }));
  const [drillDown, setDrillDown] = React.useState<RuntimeDrillDown | null>(null);

  const observabilityQuery = useRuntimeObservability(workspaceId, projectId, filters, {
    enabled: !!workspaceId && !!projectId,
  });
  const usageFactsQuery = useUsageFacts(
    workspaceId,
    projectId,
    drillDown?.params ?? {
      start_time: '',
      end_time: '',
      page: 1,
      page_size: 20,
      sort_order: 'desc',
    },
    {
      enabled: !!workspaceId && !!projectId && !!drillDown,
    },
  );
  const observability = observabilityQuery.data;
  const fallbackRatio = observability && observability.total_requests > 0
    ? 1 - ((observability.fallback_hops_histogram['0'] ?? 0) / observability.total_requests)
    : 0;
  const handleTimeRangeChange = React.useCallback((range: TimeRange) => {
    setFilters((prev) => ({
      ...prev,
      start_time: range.start_time,
      end_time: range.end_time,
    }));
  }, []);

  const setTextFilter = React.useCallback((key: 'provider' | 'model', value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value.trim() ? value.trim() : undefined,
    }));
  }, []);

  const providerRows = observability?.provider_breakdown ?? [];
  const modelRows = observability?.model_breakdown ?? [];
  const latestTrendBucket = observability?.request_trend.at(-1);
  const openDrillDown = React.useCallback((label: string, params: Partial<RuntimeDrillDown['params']>) => {
    setDrillDown({
      label,
      params: {
        start_time: params.start_time ?? filters.start_time,
        end_time: params.end_time ?? filters.end_time,
        resource_type: params.resource_type,
        resource_id: params.resource_id,
        end_user_id: params.end_user_id,
        provider: params.provider,
        model: params.model,
        result: params.result,
        error_class: params.error_class,
        page: 1,
        page_size: 20,
        sort_order: 'desc',
      },
    });
  }, [filters]);

  const openBucketDrillDown = React.useCallback((label: string, timeBucket: string, params: Partial<RuntimeDrillDown['params']> = {}) => {
    const range = getBucketRange(timeBucket);
    openDrillDown(label, {
      ...params,
      start_time: range?.start ?? filters.start_time,
      end_time: range?.end ?? filters.end_time,
    });
  }, [filters.end_time, filters.start_time, openDrillDown]);

  React.useEffect(() => {
    const nextQuery = buildSharedOpsFilterQuery(filters);
    const currentQuery = searchParams.toString();
    const normalizedCurrent = currentQuery ? `?${currentQuery}` : '';
    if (nextQuery === normalizedCurrent) return;
    router.replace(`${pathname}${nextQuery}`, { scroll: false });
  }, [filters, pathname, router, searchParams]);

  return (
    <>
      <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{settingsT('runtime_observability_console_title')}</h2>
            <p className="text-sm text-tertiary">{settingsT('runtime_observability_console_subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => observabilityQuery.refetch()}
              disabled={observabilityQuery.isFetching}
              data-testid="runtime-observability__refresh"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${observabilityQuery.isFetching ? 'animate-spin' : ''}`} />
              {commonT('refresh')}
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <TimeRangePicker
            className="lg:col-span-1"
            value={{ start_time: filters.start_time, end_time: filters.end_time }}
            onChange={handleTimeRangeChange}
            presets={['last_24h', 'last_7d', 'last_30d', 'today', 'this_month', 'custom']}
            showResolvedRangeLabel={false}
          />
          <div>
            <label className="mb-1 block text-xs text-tertiary">{settingsT('runtime_observability_filter_provider')}</label>
            <Input
              value={filters.provider ?? ''}
              placeholder={settingsT('runtime_observability_filter_provider_placeholder')}
              onChange={(event) => setTextFilter('provider', event.target.value)}
              data-testid="runtime-observability__filter-provider"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-tertiary">{settingsT('runtime_observability_filter_model')}</label>
            <Input
              value={filters.model ?? ''}
              placeholder={settingsT('runtime_observability_filter_model_placeholder')}
              onChange={(event) => setTextFilter('model', event.target.value)}
              data-testid="runtime-observability__filter-model"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-tertiary">{settingsT('runtime_observability_filter_result')}</label>
            <Select
              value={filters.result ?? 'all'}
              onValueChange={(value) => setFilters((prev) => ({
                ...prev,
                result: value === 'all'
                  ? undefined
                  : value as RuntimeObservabilityFilters['result'],
              }))}
            >
              <SelectTrigger data-testid="runtime-observability__filter-result">
                <SelectValue placeholder={commonT('all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{commonT('all')}</SelectItem>
                <SelectItem value="ok">{settingsT('runtime_observability_filter_result_ok')}</SelectItem>
                <SelectItem value="error">{settingsT('runtime_observability_filter_result_error')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-tertiary">{settingsT('runtime_observability_filter_error_class')}</label>
            <Select
              value={filters.error_class ?? 'all'}
              onValueChange={(value) => setFilters((prev) => ({
                ...prev,
                error_class: value === 'all'
                  ? undefined
                  : value as RuntimeObservabilityFilters['error_class'],
              }))}
            >
              <SelectTrigger data-testid="runtime-observability__filter-error-class">
                <SelectValue placeholder={commonT('all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{commonT('all')}</SelectItem>
                <SelectItem value="provider_retryable">{settingsT('runtime_error_class_provider_retryable')}</SelectItem>
                <SelectItem value="provider_non_retryable">{settingsT('runtime_error_class_provider_non_retryable')}</SelectItem>
                <SelectItem value="system_error">{settingsT('runtime_error_class_system_error')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__kpi-total-requests">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_total_requests')}</div>
          <div className="text-xl font-semibold text-foreground">{observability?.total_requests ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__kpi-error-rate">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_error_rate')}</div>
          <div className="text-xl font-semibold text-foreground">{formatPercent(observability?.error_rate)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__kpi-fallback-rate">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_fallback_rate')}</div>
          <div className="text-xl font-semibold text-foreground">{formatPercent(fallbackRatio)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__kpi-p95-cost">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_p95_cost')}</div>
          <div className="text-xl font-semibold text-foreground">{formatUsd(observability?.p95_estimated_cost)}</div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__health-recovered">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_health_recovered')}</div>
          <div className="text-lg font-semibold text-foreground">{observability?.health_summary.recovered_requests ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__health-terminal-errors">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_health_terminal_errors')}</div>
          <div className="text-lg font-semibold text-foreground">{observability?.health_summary.terminal_error_requests ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__health-missing-price">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_health_missing_price')}</div>
          <div className="text-lg font-semibold text-foreground">{observability?.health_summary.missing_price_facts ?? 0}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="runtime-observability__health-catalog">
          <div className="text-xs text-tertiary">{settingsT('runtime_observability_health_catalog')}</div>
          <div className="text-lg font-semibold text-foreground">
            {(observability?.health_summary.provider_count ?? 0)}
            {' / '}
            {(observability?.health_summary.model_count ?? 0)}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">{settingsT('runtime_observability_request_trend_title')}</h3>
            <p className="text-xs text-tertiary">{settingsT('runtime_observability_request_trend_subtitle')}</p>
          </div>
          {(observability?.request_trend?.length ?? 0) === 0 ? (
            <EmptyState
              title={settingsT('runtime_observability_empty_title')}
              description={settingsT('runtime_observability_empty_description')}
            />
          ) : (
            <div className="space-y-2" data-testid="runtime-observability__request-trend">
              {observability?.request_trend.slice(-8).map((item) => (
                <div key={item.time_bucket} className="rounded-lg border border-subtle bg-bg-base/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-mono text-xs text-foreground">{item.time_bucket}</div>
                    <div className="text-xs text-tertiary">
                      {settingsT('runtime_observability_request_trend_value', {
                        requests: item.requests,
                        errors: item.errors,
                        recovered: item.recovered_requests,
                      })}
                    </div>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-xs text-tertiary">
                    <span>{settingsT('runtime_observability_avg_cost_label')}: {formatUsd(item.avg_estimated_cost)}</span>
                    <div className="flex items-center gap-3">
                      <span>{settingsT('runtime_observability_p95_latency_label')}: {formatMs(item.duration_p95_ms)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-2 py-1 text-xs"
                        onClick={() => openBucketDrillDown(item.time_bucket, item.time_bucket)}
                        data-testid={`runtime-observability__trend-detail-${item.time_bucket}`}
                      >
                        {commonT('view_details')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">{settingsT('runtime_observability_distribution_title')}</h3>
            <p className="text-xs text-tertiary">{settingsT('runtime_observability_distribution_subtitle')}</p>
          </div>
          <div className="space-y-3" data-testid="runtime-observability__distributions">
            <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
              <div className="text-xs text-tertiary">{settingsT('runtime_observability_distribution_latency')}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-foreground">
                <div>P50 {formatMs(observability?.latency_distribution_ms.p50)}</div>
                <div>P95 {formatMs(observability?.latency_distribution_ms.p95)}</div>
                <div>P99 {formatMs(observability?.latency_distribution_ms.p99)}</div>
              </div>
            </div>
            <div className="rounded-lg border border-subtle bg-bg-base/40 p-3">
              <div className="text-xs text-tertiary">{settingsT('runtime_observability_distribution_cost')}</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm text-foreground">
                <div>P50 {formatUsd(observability?.cost_distribution_usd.p50)}</div>
                <div>P95 {formatUsd(observability?.cost_distribution_usd.p95)}</div>
                <div>P99 {formatUsd(observability?.cost_distribution_usd.p99)}</div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">{settingsT('runtime_observability_signals_title')}</h3>
          <p className="text-xs text-tertiary">{settingsT('runtime_observability_signals_subtitle')}</p>
        </div>
        {(observability?.degradation_signals?.length ?? 0) === 0 ? (
          <div className="rounded-lg border border-subtle bg-bg-base/40 px-3 py-4 text-sm text-tertiary" data-testid="runtime-observability__signals-empty">
            {settingsT('runtime_observability_signals_empty')}
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2" data-testid="runtime-observability__signals">
            {observability?.degradation_signals.map((signal) => (
              <div key={signal.id} className="rounded-lg border border-subtle bg-bg-base/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">{signal.title}</div>
                    <div className="mt-1 text-xs text-tertiary">{signal.message}</div>
                  </div>
                  <Badge variant={signal.severity === 'high' ? 'destructive' : 'outline'}>
                    {settingsT(`runtime_observability_signal_severity_${signal.severity}`)}
                  </Badge>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-2 py-1 text-xs"
                    onClick={() => {
                      if (signal.kind === 'error_rate_spike' && latestTrendBucket) {
                        openBucketDrillDown(signal.title, latestTrendBucket.time_bucket, { result: 'error' });
                        return;
                      }
                      if ((signal.kind === 'fallback_spike' || signal.kind === 'latency_spike') && latestTrendBucket) {
                        openBucketDrillDown(signal.title, latestTrendBucket.time_bucket);
                        return;
                      }
                      openDrillDown(signal.title, {});
                    }}
                    data-testid={`runtime-observability__signal-detail-${signal.id}`}
                  >
                    {commonT('view_details')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{settingsT('runtime_observability_provider_breakdown_title')}</h3>
              <p className="text-xs text-tertiary">{settingsT('runtime_observability_provider_breakdown_subtitle')}</p>
            </div>
          </div>
          {providerRows.length === 0 ? (
            <EmptyState
              title={settingsT('runtime_observability_empty_title')}
              description={settingsT('runtime_observability_empty_description')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="runtime-observability__provider-table">
                <thead className="text-left text-xs uppercase tracking-[0.12em] text-tertiary">
                  <tr>
                    <th className="pb-2">{settingsT('runtime_observability_col_provider')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_requests')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_error_rate')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_fallback_rate')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_avg_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {providerRows.slice(0, 8).map((row, index) => (
                    <tr key={`${row.provider}-${index}`} className="border-t border-subtle" data-testid={`runtime-observability__provider-row-${index}`}>
                      <td className="py-3 text-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-mono">{row.provider}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto px-2 py-1 text-xs"
                            onClick={() => openDrillDown(row.provider, { provider: row.provider })}
                            data-testid={`runtime-observability__provider-detail-${index}`}
                          >
                            {commonT('view_details')}
                          </Button>
                        </div>
                      </td>
                      <td className="py-3 text-right text-foreground">{row.requests}</td>
                      <td className="py-3 text-right text-foreground">{formatPercent(row.error_rate)}</td>
                      <td className="py-3 text-right text-foreground">{formatPercent(row.fallback_rate)}</td>
                      <td className="py-3 text-right text-foreground">{formatUsd(row.avg_estimated_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-foreground">{settingsT('runtime_observability_model_breakdown_title')}</h3>
            <p className="text-xs text-tertiary">{settingsT('runtime_observability_model_breakdown_subtitle')}</p>
          </div>
          {modelRows.length === 0 ? (
            <EmptyState
              title={settingsT('runtime_observability_empty_title')}
              description={settingsT('runtime_observability_empty_description')}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="runtime-observability__model-table">
                <thead className="text-left text-xs uppercase tracking-[0.12em] text-tertiary">
                  <tr>
                    <th className="pb-2">{settingsT('runtime_observability_col_model')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_requests')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_error_rate')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_missing_price')}</th>
                    <th className="pb-2 text-right">{settingsT('runtime_observability_col_p95_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {modelRows.slice(0, 10).map((row, index) => (
                    <tr key={`${row.provider}-${row.model}-${index}`} className="border-t border-subtle" data-testid={`runtime-observability__model-row-${index}`}>
                      <td className="py-3 text-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-mono">{row.provider}/{row.model}</div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto px-2 py-1 text-xs"
                            onClick={() => openDrillDown(`${row.provider}/${row.model}`, {
                              provider: row.provider,
                              model: row.model,
                            })}
                            data-testid={`runtime-observability__model-detail-${index}`}
                          >
                            {commonT('view_details')}
                          </Button>
                        </div>
                      </td>
                      <td className="py-3 text-right text-foreground">{row.requests}</td>
                      <td className="py-3 text-right text-foreground">{formatPercent(row.error_rate)}</td>
                      <td className="py-3 text-right text-foreground">{row.missing_price_facts}</td>
                      <td className="py-3 text-right text-foreground">{formatUsd(row.p95_estimated_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      </div>
      <UsageFactDetailDrawer
        open={!!drillDown}
        onOpenChange={(open) => {
          if (!open) setDrillDown(null);
        }}
        facts={usageFactsQuery.data?.items ?? []}
        loading={usageFactsQuery.isLoading || usageFactsQuery.isFetching}
        aggregateLabel={drillDown?.label}
      />
    </>
  );
}
