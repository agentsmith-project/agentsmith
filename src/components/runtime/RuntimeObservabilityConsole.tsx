'use client';

import * as React from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TimeRangePicker, type TimeRange } from '@/components/audit-usage/TimeRangePicker';
import { EmptyState } from '@/components/audit-usage/EmptyState';
import { useRuntimeObservability } from '@/lib/hooks/use-audit-usage';
import { cn } from '@/lib/utils';

type RuntimeObservabilityConsoleProps = {
  workspaceId: string;
  projectId: string;
  locale?: string;
  embedded?: boolean;
};

type RuntimeObservabilityFilters = {
  start_time: string;
  end_time: string;
  provider?: string;
  model?: string;
  error_class?: 'provider_retryable' | 'provider_non_retryable' | 'system_error';
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

export function RuntimeObservabilityConsole({
  workspaceId,
  projectId,
  locale,
  embedded = false,
}: RuntimeObservabilityConsoleProps) {
  const settingsT = useTranslations('settings');
  const commonT = useTranslations('common');
  const [filters, setFilters] = React.useState<RuntimeObservabilityFilters>(() => defaultTimeRange());

  const observabilityQuery = useRuntimeObservability(workspaceId, projectId, filters, {
    enabled: !!workspaceId && !!projectId,
  });
  const observability = observabilityQuery.data;
  const fallbackRatio = observability && observability.total_requests > 0
    ? 1 - ((observability.fallback_hops_histogram['0'] ?? 0) / observability.total_requests)
    : 0;
  const controlPlaneHref = locale
    ? `/${locale}/workspaces/${workspaceId}/projects/${projectId}/runtime-control-plane`
    : null;

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

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">{settingsT('runtime_observability_console_title')}</h2>
            <p className="text-sm text-tertiary">{settingsT('runtime_observability_console_subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {controlPlaneHref && !embedded && (
              <Link
                href={controlPlaneHref}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="runtime-observability__open-control-plane"
              >
                {settingsT('runtime_observability_open_control_plane')}
              </Link>
            )}
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
                      <td className="py-3 font-mono text-foreground">{row.provider}</td>
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
                        <div className="font-mono">{row.provider}/{row.model}</div>
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
  );
}
