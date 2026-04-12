'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import type { UsageDataPoint } from '@/lib/api/endpoints/audit-usage';

type UsageLimitRule = {
  kind: 'rate_limit' | 'spending_limit';
  window: 'minute' | '5h' | 'day';
  metric: 'requests' | 'usd' | 'tokens';
  policyKey: string;
  used: number;
  max: number;
  remaining: number;
  usagePct: number;
  resetAt: string;
};

export interface UsageViewProps {
  trendPoints: UsageDataPoint[];
  trendLoading?: boolean;
  endpointOptions?: Array<{ id: string; name: string }>;
  selectedEndpointId?: string;
  onEndpointChange?: (endpointId: string) => void;
  referenceNow?: string;
  limitsOverview?: {
    endpoints?: Array<{
      endpointId: string;
      endpointName: string;
      limits: Array<{
        kind: 'rate_limit' | 'spending_limit';
        window: 'minute' | '5h' | 'day';
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

type UsageCardRule = {
  id: string;
  titleKey: 'requests_5h' | 'requests_day' | 'spending_5h' | 'spending_day';
  unitKey: 'requests' | 'usd';
  rule: UsageLimitRule | null;
};

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

function getDayLabel(bucket: string): string {
  const date = new Date(bucket);
  if (Number.isNaN(date.getTime())) {
    return bucket.slice(5);
  }
  return date.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
  });
}

function formatValue(value: number, unit: 'requests' | 'usd'): string {
  if (unit === 'usd') {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  }
  return new Intl.NumberFormat().format(Math.round(value));
}

function buildLastThirtyDayBuckets(points: UsageDataPoint[], referenceNow?: string): UsageDataPoint[] {
  const byBucket = new Map(points.map((item) => [item.time_bucket.slice(0, 10), item]));
  const today = referenceNow ? new Date(referenceNow) : new Date();
  const items: UsageDataPoint[] = [];

  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = date.toISOString().slice(0, 10);
    const existing = byBucket.get(key);
    items.push(
      existing ?? {
        time_bucket: key,
        requests: 0,
        errors: 0,
      },
    );
  }

  return items;
}

function getProgressTone(remainingPct: number): {
  fillClassName: string;
  trackClassName: string;
  ringClassName: string;
  badgeClassName: string;
} {
  if (remainingPct < 30) {
    return {
      fillClassName: 'bg-error',
      trackClassName: 'bg-error/12',
      ringClassName: 'border-error/25',
      badgeClassName: 'bg-error/8 text-error',
    };
  }
  if (remainingPct < 60) {
    return {
      fillClassName: 'bg-foreground/70',
      trackClassName: 'bg-subtle',
      ringClassName: 'border-subtle',
      badgeClassName: 'bg-surface-low text-secondary',
    };
  }
  return {
    fillClassName: 'bg-foreground/70',
    trackClassName: 'bg-subtle',
    ringClassName: 'border-subtle',
    badgeClassName: 'bg-surface-low text-secondary',
  };
}

export function UsageView({
  trendPoints,
  trendLoading = false,
  endpointOptions = [],
  selectedEndpointId = 'all',
  onEndpointChange,
  referenceNow,
  limitsOverview,
}: UsageViewProps) {
  const t = useTranslations('usage');

  const endpointGroups = React.useMemo(() => {
    return (limitsOverview?.endpoints ?? []).map((endpoint) => ({
      endpointId: endpoint.endpointId,
      endpointName: endpoint.endpointName,
      limits: endpoint.limits,
    }));
  }, [limitsOverview?.endpoints]);

  const effectiveEndpointId = React.useMemo(() => {
    if (selectedEndpointId !== 'all') return selectedEndpointId;
    return endpointGroups[0]?.endpointId ?? endpointOptions[0]?.id ?? 'all';
  }, [endpointGroups, endpointOptions, selectedEndpointId]);

  const selectedEndpoint = React.useMemo(
    () => endpointGroups.find((endpoint) => endpoint.endpointId === effectiveEndpointId) ?? null,
    [effectiveEndpointId, endpointGroups],
  );

  const usageCards = React.useMemo<UsageCardRule[]>(() => {
    const limits = selectedEndpoint?.limits ?? [];
    const findRule = (kind: UsageLimitRule['kind'], window: UsageLimitRule['window']) =>
      limits.find((item) => item.kind === kind && item.window === window) ?? null;

    return [
      { id: 'requests-5h', titleKey: 'requests_5h', unitKey: 'requests', rule: findRule('rate_limit', '5h') },
      { id: 'requests-day', titleKey: 'requests_day', unitKey: 'requests', rule: findRule('rate_limit', 'day') },
      { id: 'spending-5h', titleKey: 'spending_5h', unitKey: 'usd', rule: findRule('spending_limit', '5h') },
      { id: 'spending-day', titleKey: 'spending_day', unitKey: 'usd', rule: findRule('spending_limit', 'day') },
    ];
  }, [selectedEndpoint]);

  const normalizedTrend = React.useMemo(
    () => buildLastThirtyDayBuckets(trendPoints, referenceNow),
    [referenceNow, trendPoints],
  );
  const maxRequests = React.useMemo(
    () => Math.max(1, ...normalizedTrend.map((item) => item.requests ?? 0)),
    [normalizedTrend],
  );

  return (
    <div
      className="space-y-6 rounded-md border border-subtle bg-surface/95 p-4 md:p-5"
      data-testid="usage__work-surface"
    >
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-lg font-semibold text-foreground">{t('view.limits_section_title')}</p>
            {selectedEndpoint ? (
              <p className="text-sm text-tertiary" data-testid="usage__selected-endpoint">
                {selectedEndpoint.endpointName}
              </p>
            ) : null}
          </div>
          {endpointGroups.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2" data-testid="usage__endpoint-tabs">
              {endpointGroups.map((endpoint) => {
                const active = endpoint.endpointId === effectiveEndpointId;
                return (
                  <button
                    key={endpoint.endpointId}
                    type="button"
                    onClick={() => onEndpointChange?.(endpoint.endpointId)}
                    className={`rounded-sm border px-3 py-1.5 text-sm transition ${
                      active
                        ? 'border-subtle bg-surface-low text-foreground'
                        : 'border-subtle bg-transparent text-tertiary hover:bg-surface-low hover:text-secondary'
                    }`}
                    data-testid={`usage__resource-tab-${endpoint.endpointId}`}
                  >
                    {endpoint.endpointName}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {selectedEndpoint ? (
          <div className="divide-y divide-subtle/70 border-y border-subtle/70" data-testid="usage__limits">
            {usageCards.map((card) => {
              const hasRule = card.rule !== null;
              const remainingPct = hasRule ? Math.max(0, 100 - clampPercent(card.rule.usagePct)) : 0;
              const tone = hasRule ? getProgressTone(remainingPct) : null;

              return (
                <div
                  key={card.id}
                  className="grid gap-3 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,0.9fr)] md:items-center"
                  data-testid="usage__limit-row"
                >
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">{t(`view.cards.${card.titleKey}`)}</p>
                    <p className="text-xs text-tertiary">
                      {hasRule
                        ? t('view.card_out_of', {
                            value: formatValue(card.rule.max, card.unitKey),
                          })
                        : t('view.limit_not_configured')}
                    </p>
                  </div>

                  {hasRule ? (
                    <>
                      <div className="space-y-1">
                        <p className="text-[11px] uppercase tracking-[0.12em] text-tertiary">usage</p>
                        <p className="text-sm text-foreground">
                          {formatValue(card.rule.used, card.unitKey)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone?.badgeClassName ?? 'bg-surface-low text-secondary'}`}>
                          {Math.round(remainingPct)}%
                        </div>
                        <p className="text-xs text-tertiary">
                          {t('view.limit_reset_at', { value: formatResetTime(card.rule.resetAt) })}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="md:col-span-3">
                      <p className="text-sm text-tertiary">{t('view.limit_not_configured')}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-subtle bg-bg-base/10 px-5 py-10 text-center">
            <p className="text-sm text-tertiary">{t('view.limits_empty')}</p>
          </div>
        )}
      </section>

      <section className="space-y-3 border-t border-subtle/70 pt-4">
        <div>
          <p className="text-lg font-semibold text-foreground">{t('view.trend_section_title')}</p>
          <p className="mt-1 text-sm text-tertiary">{t('view.trend_last_30_days')}</p>
        </div>
        <div className="space-y-3" data-testid="usage__trend">
          {trendLoading ? (
            <div className="h-72 animate-pulse rounded-md border border-subtle bg-bg-base/20" data-testid="usage__loading" />
          ) : normalizedTrend.every((item) => (item.requests ?? 0) === 0) ? (
            <div className="rounded-md border border-dashed border-subtle bg-bg-base/10 px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">{t('view.no_data')}</p>
              <p className="mt-2 text-xs text-tertiary">{t('view.no_data_hint')}</p>
            </div>
          ) : (
            <div className="pt-2">
              <div className="flex h-64 items-end gap-1.5 border-b border-subtle/80">
                {normalizedTrend.map((item, index) => {
                  const requests = item.requests ?? 0;
                  const height = Math.max(8, Math.round((requests / maxRequests) * 208));
                  const intensity = requests / maxRequests;
                  const barClassName = intensity > 0.5 ? 'bg-foreground/80' : 'bg-foreground/45';

                  return (
                    <div key={`${item.time_bucket}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <div
                        className={`w-full rounded-t-sm ${barClassName}`}
                        style={{ height }}
                        title={`${item.time_bucket}: ${requests}`}
                        data-testid="usage__trend-bar"
                      />
                      <span className="pb-1 text-[10px] text-tertiary">{getDayLabel(item.time_bucket)}</span>
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
