'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { UsageKPI, UsageRecord } from '@/lib/api/types';

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
  } | null;
}

function getBucketLabel(bucket: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    return bucket.slice(5);
  }
  return bucket;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function formatResetTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getProgressTone(remainingPct: number): {
  fillClassName: string;
  ringClassName: string;
  badgeClassName: string;
} {
  if (remainingPct <= 20) {
    return {
      fillClassName: 'bg-[linear-gradient(90deg,var(--error)_0%,#f97066_100%)]',
      ringClassName: 'border-[color:rgb(var(--error-rgb,239_68_68)/0.35)]',
      badgeClassName: 'bg-[color:rgb(var(--error-rgb,239_68_68)/0.12)] text-[color:rgb(var(--error-rgb,239_68_68))]',
    };
  }
  if (remainingPct <= 40) {
    return {
      fillClassName: 'bg-[linear-gradient(90deg,#f59e0b_0%,#fbbf24_100%)]',
      ringClassName: 'border-[rgba(245,158,11,0.28)]',
      badgeClassName: 'bg-[rgba(245,158,11,0.12)] text-[rgb(245,158,11)]',
    };
  }
  return {
    fillClassName: 'bg-[linear-gradient(90deg,var(--success)_0%,#32d583_100%)]',
    ringClassName: 'border-subtle',
    badgeClassName: 'bg-[color:rgb(var(--success-rgb,34_197_94)/0.12)] text-[color:rgb(var(--success-rgb,34_197_94))]',
  };
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

  const maxRequests = React.useMemo(
    () => Math.max(1, ...records.map((item) => item.requests ?? 0)),
    [records],
  );
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
  const effectiveEndpointId = React.useMemo(
    () => {
      if (selectedEndpointId !== 'all') return selectedEndpointId;
      return endpointLimitGroups[0]?.endpointId ?? endpointOptions[0]?.id ?? 'all';
    },
    [endpointLimitGroups, endpointOptions, selectedEndpointId],
  );
  const selectedEndpoint = React.useMemo(
    () => endpointLimitGroups.find((endpoint) => endpoint.endpointId === effectiveEndpointId) ?? null,
    [effectiveEndpointId, endpointLimitGroups],
  );

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
    <div className="space-y-6" data-testid="usage__view">
      <section className="space-y-3">
        <div>
          <p className="text-lg font-semibold text-foreground">{t('view.panel_title')}</p>
          <p className="mt-1 text-sm text-tertiary">{t('view.panel_subtitle')}</p>
        </div>
        <div className="rounded-[28px] border border-border bg-surface p-5 shadow-sm" data-testid="usage__planning-controls">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-tertiary">{t('view.endpoint_tabs_label')}</p>
              <div className="flex flex-wrap gap-2" data-testid="usage__endpoint-tabs">
                {endpointOptions.map((endpoint) => (
                  <button
                    key={endpoint.id}
                    type="button"
                    className={[
                      'inline-flex items-center rounded-full border px-3.5 py-2 text-sm transition-colors',
                      effectiveEndpointId === endpoint.id
                        ? 'border-border bg-surface-high text-foreground shadow-sm'
                        : 'border-subtle bg-bg-base/20 text-tertiary hover:border-border hover:text-foreground',
                    ].join(' ')}
                    onClick={() => onEndpointChange?.(endpoint.id)}
                    data-testid={`usage__endpoint-tab-${endpoint.id}`}
                  >
                    {endpoint.name}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs uppercase tracking-[0.18em] text-tertiary">{t('view.limit_mode_label')}</p>
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
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-lg font-semibold text-foreground">{t('view.limits_section_title')}</p>
          <p className="mt-1 text-sm text-tertiary">{t('view.limits_section_subtitle')}</p>
        </div>
        <div className="rounded-[28px] border border-border bg-surface p-5 shadow-sm" data-testid="usage__limits">
          {selectedEndpoint ? (
            <Tabs value={effectiveEndpointId} onValueChange={(value) => onEndpointChange?.(value)} className="space-y-4">
              <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-2xl border border-subtle bg-bg-base/20 p-1.5">
                {endpointLimitGroups.map((endpoint) => (
                  <TabsTrigger
                    key={endpoint.endpointId}
                    value={endpoint.endpointId}
                    className="rounded-xl px-4 py-2.5 text-sm"
                    data-testid={`usage__resource-tab-${endpoint.endpointId}`}
                  >
                    {endpoint.endpointName}
                  </TabsTrigger>
                ))}
              </TabsList>

              {endpointLimitGroups.map((endpoint) => {
                const cards = [
                  ...endpoint.rateLimits.map((item) => ({ ...item, bucket: 'rate' as const })),
                  ...endpoint.spendingLimits.map((item) => ({ ...item, bucket: 'spending' as const })),
                ].filter((item) => {
                  if (limitMetricMode === 'all') return true;
                  if (limitMetricMode === 'rate') return item.bucket === 'rate';
                  return item.bucket === 'spending';
                });

                return (
                  <TabsContent
                    key={endpoint.endpointId}
                    value={endpoint.endpointId}
                    className="data-[state=inactive]:hidden"
                    data-testid="usage__endpoint-dimensions"
                  >
                    <div className="mb-5 border-b border-subtle pb-4">
                      <p className="text-xl font-semibold text-foreground">{endpoint.endpointName}</p>
                    </div>

                    {cards.length > 0 ? (
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      {cards.map((limit, index) => {
                        const usagePct = clampPercent(limit.usagePct);
                        const remainingPct = Math.max(0, 100 - usagePct);
                        const tone = getProgressTone(remainingPct);
                        return (
                          <div
                            key={`${endpoint.endpointId}-dim-${limit.bucket}-${index}`}
                            className={`rounded-[28px] border bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(255,255,255,0.01)_100%)] p-6 ${tone.ringClassName}`}
                            data-testid="usage__progress-card"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm text-tertiary">
                                  {limit.bucket === 'rate' ? t('view.rate_limit_title') : t('view.spending_limit_title')}
                                </p>
                                <p className="mt-1 text-xs text-tertiary">{t(`view.window.${limit.window}`)}</p>
                              </div>
                              <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tone.badgeClassName}`}>
                                {t('view.status_badge', { value: Math.round(remainingPct) })}
                              </span>
                            </div>
                            <p className="mt-5 text-4xl font-semibold tracking-tight text-foreground">
                              {Math.round(remainingPct)}%
                              <span className="ml-2 text-lg font-medium text-tertiary">{t('view.remaining_suffix')}</span>
                            </p>
                            <div className="mt-5 h-3 rounded-full bg-surface-high">
                              <div
                                className={`h-3 rounded-full ${tone.fillClassName}`}
                                style={{ width: `${remainingPct}%` }}
                              />
                            </div>
                            {limit.resetAt ? (
                              <p className="mt-4 text-xs text-tertiary">{t('view.limit_reset_at', { value: formatResetTime(limit.resetAt) })}</p>
                            ) : null}
                          </div>
                        );
                      })}
                      </div>
                    ) : (
                      <p className="text-sm text-tertiary">{t('view.limit_group_empty')}</p>
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          ) : (
            <p className="mt-3 text-sm text-tertiary">{t('view.limits_empty')}</p>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-lg font-semibold text-foreground">{t('view.trend_section_title')}</p>
          <p className="mt-1 text-sm text-tertiary">{t('view.trend_section_subtitle')}</p>
        </div>
        <div className="rounded-[28px] border border-border bg-surface p-5 shadow-sm" data-testid="usage__trend">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">{t('view.trend_title', { hours: periodHours })}</p>
              <p className="mt-1 text-xs text-tertiary">{t('view.trend_focus_note')}</p>
            </div>
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
            <div className="rounded-[24px] border border-dashed border-subtle bg-bg-base/10 px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">{t('view.no_data')}</p>
              <p className="mt-2 text-xs text-tertiary">{t('view.no_data_hint')}</p>
            </div>
          ) : (
            <div className="rounded-[24px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(255,255,255,0)_100%)] px-4 pb-4 pt-6">
              <div className="flex h-56 items-end gap-2 border-b border-subtle/80">
              {records.map((item) => {
                const requests = item.requests ?? 0;
                const height = Math.max(8, Math.round((requests / maxRequests) * 180));
                const intensity = requests / maxRequests;
                const barClassName = intensity > 0.75
                  ? 'bg-[linear-gradient(180deg,#ef4444_0%,#f97316_100%)]'
                  : intensity > 0.45
                    ? 'bg-[linear-gradient(180deg,#f43f5e_0%,#ec4899_100%)]'
                    : 'bg-[linear-gradient(180deg,#fb7185_0%,#f472b6_100%)]';
                return (
                  <div key={item.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div
                      className={`w-full rounded-t-md ${barClassName} shadow-[0_0_24px_rgba(244,63,94,0.12)]`}
                      style={{ height }}
                      title={`${item.time_bucket}: ${requests}`}
                    />
                    <span className="pb-1 text-[10px] text-tertiary">{getBucketLabel(item.time_bucket)}</span>
                  </div>
                );
              })}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
