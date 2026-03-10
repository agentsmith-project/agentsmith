'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { UsageKPI, UsageRecord } from '@/lib/api/types';
import { formatNumber } from '@/lib/utils/formatters';

export interface UsageViewProps {
  kpi?: UsageKPI | null;
  records: UsageRecord[];
  loading?: boolean;
  periodHours: 24 | 48;
  onPeriodChange?: (hours: 24 | 48) => void;
  endpointOptions?: Array<{ id: string; name: string }>;
  selectedEndpointId?: string;
  onEndpointChange?: (endpointId: string) => void;
  limitsOverview?: {
    endpoints?: Array<{
      endpointId: string;
      endpointName: string;
      limits: Array<{
        kind: 'rate_limit' | 'spending_limit';
        window: 'minute' | '5h' | 'day' | 'current';
        metric: 'requests' | 'usd' | 'tokens';
        policyKey: string;
        used: number;
        max: number;
        remaining: number;
        usagePct: number;
        resetAt: string;
      }>;
    }>;
    projectSummary?: {
      projectUsed: number;
      projectMax: number;
      projectRemaining: number;
      projectUsagePct: number;
    };
  } | null;
}

function getBucketLabel(bucket: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    return bucket.slice(5);
  }
  return bucket;
}

function formatMetricLabel(metric: 'requests' | 'usd' | 'tokens'): string {
  if (metric === 'usd') return 'USD';
  if (metric === 'tokens') return 'tokens';
  return 'requests';
}

export function UsageView({
  kpi,
  records,
  loading = false,
  periodHours,
  onPeriodChange,
  endpointOptions = [],
  selectedEndpointId = 'all',
  onEndpointChange,
  limitsOverview,
}: UsageViewProps) {
  const t = useTranslations('usage');
  const [limitMetricMode, setLimitMetricMode] = React.useState<'all' | 'rate' | 'spending'>('all');

  const periodRequests = React.useMemo(
    () => records.reduce((sum, item) => sum + (item.requests ?? 0), 0),
    [records],
  );
  const maxRequests = React.useMemo(
    () => Math.max(1, ...records.map((item) => item.requests ?? 0)),
    [records],
  );
  const totalLimitRemaining = React.useMemo(() => {
    if (typeof limitsOverview?.projectSummary?.projectRemaining !== 'number') return 0;
    return Math.max(0, limitsOverview.projectSummary.projectRemaining);
  }, [limitsOverview?.projectSummary?.projectRemaining]);
  const totalLimitRemainingPercent = React.useMemo(() => {
    const projectMax = limitsOverview?.projectSummary?.projectMax;
    if (typeof projectMax !== 'number' || projectMax <= 0) return 0;
    return Math.round((totalLimitRemaining / projectMax) * 100);
  }, [limitsOverview?.projectSummary?.projectMax, totalLimitRemaining]);
  const endpointLimitGroups = React.useMemo(() => {
    const endpoints = limitsOverview?.endpoints ?? [];
    const order: Record<'minute' | '5h' | 'day' | 'current', number> = {
      minute: 1,
      '5h': 2,
      day: 3,
      current: 4,
    };
    return endpoints.map((endpoint) => {
      const rateLimits = endpoint.limits
        .filter((row) => row.kind === 'rate_limit')
        .sort((a, b) => order[a.window] - order[b.window]);
      const spendingLimits = endpoint.limits
        .filter((row) => row.kind === 'spending_limit')
        .sort((a, b) => order[a.window] - order[b.window]);
      return {
        endpointId: endpoint.endpointId,
        endpointName: endpoint.endpointName,
        rateLimits,
        spendingLimits,
      };
    });
  }, [limitsOverview?.endpoints]);
  const displayedEndpointGroups = React.useMemo(
    () => endpointLimitGroups.filter((endpoint) => selectedEndpointId === 'all' || endpoint.endpointId === selectedEndpointId),
    [endpointLimitGroups, selectedEndpointId],
  );
  const selectedEndpoint = React.useMemo(
    () => displayedEndpointGroups[0] ?? null,
    [displayedEndpointGroups],
  );
  const selectedEndpointDimensionCards = React.useMemo(() => {
    if (!selectedEndpoint) return [];
    const candidates = [
      ...selectedEndpoint.rateLimits.map((item) => ({ ...item, bucket: 'rate' as const })),
      ...selectedEndpoint.spendingLimits.map((item) => ({ ...item, bucket: 'spending' as const })),
    ];
    return candidates.filter((item) => {
      if (limitMetricMode === 'all') return true;
      if (limitMetricMode === 'rate') return item.bucket === 'rate';
      return item.bucket === 'spending';
    });
  }, [limitMetricMode, selectedEndpoint]);

  if (loading) {
    return (
      <div className="space-y-3" data-testid="usage__loading">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-surface" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl border border-border bg-surface" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="usage__view">
      <div className="rounded-xl border border-border bg-surface p-4" data-testid="usage__planning-controls">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-tertiary">{t('view.endpoint_filter_label')}</p>
            <Select value={selectedEndpointId} onValueChange={(value) => onEndpointChange?.(value)}>
              <SelectTrigger data-testid="usage__endpoint-select">
                <SelectValue placeholder={t('view.endpoint_filter_all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('view.endpoint_filter_all')}</SelectItem>
                {endpointOptions.map((endpoint) => (
                  <SelectItem key={endpoint.id} value={endpoint.id}>
                    {endpoint.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="mb-1 text-xs text-tertiary">{t('view.limit_mode_label')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={limitMetricMode === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLimitMetricMode('all')}
                data-testid="usage__limit-mode-all"
              >
                {t('view.limit_mode_all')}
              </Button>
              <Button
                type="button"
                variant={limitMetricMode === 'rate' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLimitMetricMode('rate')}
                data-testid="usage__limit-mode-rate"
              >
                {t('view.limit_mode_rate')}
              </Button>
              <Button
                type="button"
                variant={limitMetricMode === 'spending' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLimitMetricMode('spending')}
                data-testid="usage__limit-mode-spending"
              >
                {t('view.limit_mode_spending')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('view.cards.requests_today')}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(kpi?.requests_today ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('view.cards.remaining_limit')}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{totalLimitRemainingPercent}%</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('view.cards.tokens_today')}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(kpi?.tokens_today ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('view.cards.period_requests', { hours: periodHours })}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(periodRequests)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4" data-testid="usage__limits">
        <p className="text-sm font-semibold text-foreground">{t('view.limits_title')}</p>
        {typeof limitsOverview?.projectSummary?.projectMax === 'number' && limitsOverview.projectSummary.projectMax > 0 ? (
          <div className="mt-3 rounded-md border border-subtle bg-bg-base/20 p-3">
            <div className="flex items-center justify-between text-xs text-tertiary">
              <span>{t('view.project_max')}</span>
              <span>
                {formatNumber(limitsOverview.projectSummary.projectRemaining)}
                {' / '}
                {formatNumber(limitsOverview.projectSummary.projectMax)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded bg-surface-high">
              <div
                className="h-2 rounded bg-accent"
                style={{
                  width: `${Math.min(100, Math.max(0, limitsOverview.projectSummary.projectUsagePct))}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[11px] text-tertiary">{t('view.limit_reset')}</p>
          </div>
        ) : null}
        {selectedEndpointId !== 'all' ? (
          <div className="mt-3 rounded-md border border-subtle bg-bg-base/20 p-3" data-testid="usage__endpoint-dimensions">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">{selectedEndpoint?.endpointName ?? selectedEndpointId}</p>
              <p className="text-[11px] text-tertiary">{selectedEndpoint?.endpointId ?? selectedEndpointId}</p>
            </div>
            {selectedEndpointDimensionCards.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {selectedEndpointDimensionCards.map((limit, index) => {
                  const remainingPct = Math.max(0, 100 - Math.min(100, Math.max(0, limit.usagePct)));
                  return (
                    <div key={`${selectedEndpoint?.endpointId ?? selectedEndpointId}-dim-${limit.bucket}-${index}`} className="rounded-md border border-subtle bg-surface p-3">
                      <p className="text-xs text-tertiary">
                        {limit.bucket === 'rate' ? t('view.rate_limit_title') : t('view.spending_limit_title')}
                        {' · '}
                        {t(`view.window.${limit.window}`)}
                      </p>
                      <p className="mt-1 text-2xl font-semibold text-foreground">
                        {formatNumber(Math.round(remainingPct))}
                        %
                        <span className="ml-1 text-sm font-medium text-tertiary">{t('view.remaining_suffix')}</span>
                      </p>
                      <div className="mt-2 h-2 rounded bg-surface-high">
                        <div className="h-2 rounded bg-accent" style={{ width: `${remainingPct}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-tertiary">
                        {formatNumber(limit.used)}
                        {' / '}
                        {formatNumber(limit.max)}
                        {' '}
                        {formatMetricLabel(limit.metric)}
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-tertiary">{t('view.limit_group_empty')}</p>
            )}
          </div>
        ) : null}
        {displayedEndpointGroups.length > 0 ? (
          <div className="mt-3 space-y-3" data-testid="usage__endpoint-limits">
            {displayedEndpointGroups.map((endpoint) => (
              <div key={endpoint.endpointId} className="rounded-md border border-subtle bg-bg-base/20 p-3" data-testid="usage__endpoint-card">
                <div className="flex items-center justify-between">
                  <p className="truncate pr-2 text-sm font-medium text-foreground">{endpoint.endpointName || endpoint.endpointId}</p>
                  <p className="text-[11px] text-tertiary">{endpoint.endpointId}</p>
                </div>

                <div className="mt-3 space-y-3">
                  {limitMetricMode !== 'spending' ? (
                    <div>
                      <p className="text-xs font-semibold text-foreground">{t('view.rate_limit_title')}</p>
                      {endpoint.rateLimits.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {endpoint.rateLimits.map((limit, index) => (
                            <div key={`${endpoint.endpointId}-rate-${index}`} className="rounded border border-subtle p-2">
                              <div className="flex items-center justify-between text-xs text-tertiary">
                                <span>{t(`view.window.${limit.window}`)}</span>
                                <span>{formatNumber(limit.used)} / {formatNumber(limit.max)} {limit.metric}</span>
                              </div>
                              <div className="mt-2 h-2 rounded bg-surface-high">
                                <div className="h-2 rounded bg-accent" style={{ width: `${Math.min(100, Math.max(0, limit.usagePct))}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-tertiary">{t('view.limit_group_empty')}</p>
                      )}
                    </div>
                  ) : null}

                  {limitMetricMode !== 'rate' ? (
                    <div>
                      <p className="text-xs font-semibold text-foreground">{t('view.spending_limit_title')}</p>
                      {endpoint.spendingLimits.length > 0 ? (
                        <div className="mt-2 space-y-2">
                          {endpoint.spendingLimits.map((limit, index) => (
                            <div key={`${endpoint.endpointId}-spending-${index}`} className="rounded border border-subtle p-2">
                              <div className="flex items-center justify-between text-xs text-tertiary">
                                <span>{t(`view.window.${limit.window}`)}</span>
                                <span>{formatNumber(limit.used)} / {formatNumber(limit.max)} {limit.metric}</span>
                              </div>
                              <div className="mt-2 h-2 rounded bg-surface-high">
                                <div className="h-2 rounded bg-accent" style={{ width: `${Math.min(100, Math.max(0, limit.usagePct))}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-tertiary">{t('view.limit_group_empty')}</p>
                      )}
                    </div>
                  ) : null}
                </div>

                {(endpoint.rateLimits[0]?.resetAt || endpoint.spendingLimits[0]?.resetAt) ? (
                  <p className="mt-2 text-[11px] text-tertiary">{t('view.limit_reset')}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-tertiary">{t('view.limits_empty')}</p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4" data-testid="usage__trend">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{t('view.trend_title', { hours: periodHours })}</p>
          <div className="flex items-center gap-2">
            <Button
              variant={periodHours === 24 ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPeriodChange?.(24)}
              data-testid="usage__period-24"
              data-active={periodHours === 24}
            >
              {t('view.period.24h')}
            </Button>
            <Button
              variant={periodHours === 48 ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPeriodChange?.(48)}
              data-testid="usage__period-48"
              data-active={periodHours === 48}
            >
              {t('view.period.48h')}
            </Button>
          </div>
        </div>
        {records.length === 0 ? (
          <p className="text-sm text-tertiary">{t('view.no_data')}</p>
        ) : (
          <div className="flex h-56 items-end gap-2">
            {records.map((item) => {
              const requests = item.requests ?? 0;
              const height = Math.max(8, Math.round((requests / maxRequests) * 180));
              return (
                <div key={item.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="w-full rounded-sm bg-accent/90" style={{ height }} title={`${item.time_bucket}: ${requests}`} />
                  <span className="text-[10px] text-tertiary">{getBucketLabel(item.time_bucket)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
