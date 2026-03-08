'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { UsageKPI, UsageRecord } from '@/lib/api/types';
import { formatNumber } from '@/lib/utils/formatters';

export interface UsageViewProps {
  kpi?: UsageKPI | null;
  records: UsageRecord[];
  loading?: boolean;
  periodDays: 7 | 30;
  onPeriodChange?: (days: 7 | 30) => void;
  limitsOverview?: {
    endpoints?: Array<{
      endpointId: string;
      endpointName: string;
      limits: Array<{
        kind: 'rate_limit' | 'spending_limit';
        window: 'minute' | '5h' | 'day' | 'current';
        metric: 'requests' | 'usd';
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

export function UsageView({
  kpi,
  records,
  loading = false,
  periodDays,
  onPeriodChange,
  limitsOverview,
}: UsageViewProps) {
  const t = useTranslations('usage');

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
          <p className="text-xs text-tertiary">{t('view.cards.period_requests', { days: periodDays })}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(periodRequests)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4" data-testid="usage__limits">
        <p className="text-sm font-semibold text-foreground">{t('view.limits_title')}</p>
        {typeof limitsOverview?.projectSummary?.projectMax === 'number' && limitsOverview.projectSummary.projectMax > 0 ? (
          <div className="mt-3 rounded-md border border-subtle bg-bg-base/20 p-3">
            <div className="flex items-center justify-between text-xs text-tertiary">
              <span>{t('view.total_limit')}</span>
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
        {Array.isArray(limitsOverview?.endpoints) && limitsOverview.endpoints.length > 0 ? (
          <div className="mt-3 space-y-3" data-testid="usage__endpoint-limits">
            {endpointLimitGroups.map((endpoint) => (
              <div key={endpoint.endpointId} className="rounded-md border border-subtle bg-bg-base/20 p-3" data-testid="usage__endpoint-card">
                <div className="flex items-center justify-between">
                  <p className="truncate pr-2 text-sm font-medium text-foreground">{endpoint.endpointName || endpoint.endpointId}</p>
                  <p className="text-[11px] text-tertiary">{endpoint.endpointId}</p>
                </div>

                <div className="mt-3 space-y-3">
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
          <p className="text-sm font-semibold text-foreground">{t('view.trend_title', { days: periodDays })}</p>
          <div className="flex items-center gap-2">
            <Button
              variant={periodDays === 7 ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPeriodChange?.(7)}
              data-testid="usage__period-7"
              data-active={periodDays === 7}
            >
              {t('view.period.7d')}
            </Button>
            <Button
              variant={periodDays === 30 ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPeriodChange?.(30)}
              data-testid="usage__period-30"
              data-active={periodDays === 30}
            >
              {t('view.period.30d')}
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
