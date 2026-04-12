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
      fillClassName: 'bg-[linear-gradient(90deg,#ff6b6b_0%,#f87171_100%)]',
      trackClassName: 'bg-[rgba(248,113,113,0.18)]',
      ringClassName: 'border-[color:rgb(var(--error-rgb,239_68_68)/0.35)]',
      badgeClassName: 'bg-[color:rgb(var(--error-rgb,239_68_68)/0.12)] text-[color:rgb(var(--error-rgb,239_68_68))]',
    };
  }
  if (remainingPct < 60) {
    return {
      fillClassName: 'bg-[linear-gradient(90deg,#f6c453_0%,#fbbf24_100%)]',
      trackClassName: 'bg-[rgba(251,191,36,0.16)]',
      ringClassName: 'border-[rgba(245,158,11,0.28)]',
      badgeClassName: 'bg-[rgba(245,158,11,0.12)] text-[rgb(245,158,11)]',
    };
  }
  return {
    fillClassName: 'bg-[linear-gradient(90deg,#22c55e_0%,#34d399_100%)]',
    trackClassName: 'bg-[rgba(34,197,94,0.12)]',
    ringClassName: 'border-[rgba(34,197,94,0.22)]',
    badgeClassName: 'bg-[color:rgb(var(--success-rgb,34_197_94)/0.12)] text-[color:rgb(var(--success-rgb,34_197_94))]',
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
    <div className="space-y-6" data-testid="usage__view">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-foreground">{t('view.limits_section_title')}</p>
            {selectedEndpoint ? (
              <p className="mt-1 text-sm text-tertiary" data-testid="usage__selected-endpoint">
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
                    className={`rounded-full border px-3 py-1.5 text-sm transition ${
                      active
                        ? 'border-accent/35 bg-accent/10 text-foreground'
                        : 'border-subtle bg-bg-base/20 text-tertiary hover:border-white/12 hover:text-secondary'
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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="usage__limits">
            {usageCards.map((card) => {
              if (!card.rule) {
                return (
                  <div
                    key={card.id}
                    className="rounded-md border border-dashed border-subtle bg-bg-base/10 px-5 py-5"
                    data-testid="usage__progress-card"
                  >
                    <p className="text-sm text-tertiary">{t(`view.cards.${card.titleKey}`)}</p>
                    <p className="mt-3 text-sm text-tertiary">{t('view.limit_not_configured')}</p>
                  </div>
                );
              }

              const remainingPct = Math.max(0, 100 - clampPercent(card.rule.usagePct));
              const tone = getProgressTone(remainingPct);

              return (
                <div
                  key={card.id}
                  className={`rounded-md border bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(255,255,255,0.01)_100%)] p-5 ${tone.ringClassName}`}
                  data-testid="usage__progress-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-tertiary">{t(`view.cards.${card.titleKey}`)}</p>
                      <p className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                        {formatValue(card.rule.used, card.unitKey)}
                      </p>
                      <p className="mt-1 text-xs text-tertiary">
                        {t('view.card_out_of', {
                          value: formatValue(card.rule.max, card.unitKey),
                        })}
                      </p>
                    </div>
                    <div className={`rounded-full px-2.5 py-1 text-xs font-medium ${tone.badgeClassName}`}>
                      {Math.round(remainingPct)}%
                    </div>
                  </div>
                  <div className={`mt-4 h-2.5 rounded-full ${tone.trackClassName}`}>
                    <div
                      className={`h-2.5 rounded-full ${tone.fillClassName}`}
                      style={{ width: `${remainingPct}%` }}
                    />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 text-xs text-tertiary">
                    <span>
                      {t('view.card_remaining', {
                        value: formatValue(card.rule.remaining, card.unitKey),
                      })}
                    </span>
                    <span>{t('view.limit_reset_at', { value: formatResetTime(card.rule.resetAt) })}</span>
                  </div>
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

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-foreground">{t('view.trend_section_title')}</p>
            <p className="mt-1 text-sm text-tertiary">{t('view.trend_last_30_days')}</p>
          </div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-5 shadow-sm" data-testid="usage__trend">
          {trendLoading ? (
            <div className="h-72 animate-pulse rounded-md border border-subtle bg-bg-base/20" data-testid="usage__loading" />
          ) : normalizedTrend.every((item) => (item.requests ?? 0) === 0) ? (
            <div className="rounded-md border border-dashed border-subtle bg-bg-base/10 px-5 py-10 text-center">
              <p className="text-sm font-medium text-foreground">{t('view.no_data')}</p>
              <p className="mt-2 text-xs text-tertiary">{t('view.no_data_hint')}</p>
            </div>
          ) : (
            <div className="rounded-md border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(255,255,255,0)_100%)] px-3 pb-4 pt-6">
              <div className="flex h-64 items-end gap-1.5 border-b border-subtle/80">
                {normalizedTrend.map((item, index) => {
                  const requests = item.requests ?? 0;
                  const height = Math.max(8, Math.round((requests / maxRequests) * 208));
                  const intensity = requests / maxRequests;
                  const barClassName =
                    intensity > 0.75
                      ? 'bg-[linear-gradient(180deg,#ef4444_0%,#f97316_100%)]'
                      : intensity > 0.45
                        ? 'bg-[linear-gradient(180deg,#f43f5e_0%,#ec4899_100%)]'
                        : 'bg-[linear-gradient(180deg,#fb7185_0%,#f472b6_100%)]';

                  return (
                    <div key={`${item.time_bucket}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                      <div
                        className={`w-full rounded-t-sm ${barClassName} shadow-[0_0_18px_rgba(244,63,94,0.1)]`}
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
