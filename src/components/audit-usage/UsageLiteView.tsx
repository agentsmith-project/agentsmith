'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { UsageKPI, UsageRecord } from '@/lib/api/types';
import { formatNumber } from '@/lib/utils/formatters';

export interface UsageLiteViewProps {
  kpi?: UsageKPI | null;
  records: UsageRecord[];
  loading?: boolean;
  periodDays: 7 | 30;
  onPeriodChange?: (days: 7 | 30) => void;
  onOpenAdvanced?: () => void;
  limitsSummary?: {
    endpoints?: Array<{
      resource_id: string;
      resource_name: string;
      quota_used: number;
      quota_limit: number;
      percentage_used: number;
      quota_reset_at: string;
    }>;
    total_quota_used?: number;
    total_quota_limit?: number;
  } | null;
}

function getBucketLabel(bucket: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bucket)) {
    return bucket.slice(5);
  }
  return bucket;
}

export function UsageLiteView({
  kpi,
  records,
  loading = false,
  periodDays,
  onPeriodChange,
  onOpenAdvanced,
  limitsSummary,
}: UsageLiteViewProps) {
  const t = useTranslations('usage');

  const periodRequests = React.useMemo(
    () => records.reduce((sum, item) => sum + (item.requests ?? 0), 0),
    [records],
  );
  const maxRequests = React.useMemo(
    () => Math.max(1, ...records.map((item) => item.requests ?? 0)),
    [records],
  );

  if (loading) {
    return (
      <div className="space-y-3" data-testid="usage-lite__loading">
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
    <div className="space-y-3" data-testid="usage-lite__view">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('lite.cards.requests_today')}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(kpi?.requests_today ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('lite.cards.errors_today')}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(kpi?.errors_today ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('lite.cards.tokens_today')}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(kpi?.tokens_today ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-tertiary">{t('lite.cards.period_requests', { days: periodDays })}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(periodRequests)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4" data-testid="usage-lite__limits">
        <p className="text-sm font-semibold text-foreground">{t('lite.limits_title')}</p>
        {typeof limitsSummary?.total_quota_limit === 'number' && limitsSummary.total_quota_limit > 0 ? (
          <div className="mt-3 rounded-md border border-subtle bg-bg-base/20 p-3">
            <div className="flex items-center justify-between text-xs text-tertiary">
              <span>{t('lite.total_quota')}</span>
              <span>
                {formatNumber(limitsSummary.total_quota_limit - (limitsSummary.total_quota_used ?? 0))}
                {' / '}
                {formatNumber(limitsSummary.total_quota_limit)}
              </span>
            </div>
            <div className="mt-2 h-2 rounded bg-surface-high">
              <div
                className="h-2 rounded bg-accent"
                style={{
                  width: `${Math.min(100, Math.max(0, ((limitsSummary.total_quota_used ?? 0) / limitsSummary.total_quota_limit) * 100))}%`,
                }}
              />
            </div>
          </div>
        ) : null}
        {Array.isArray(limitsSummary?.endpoints) && limitsSummary.endpoints.length > 0 ? (
          <div className="mt-3 space-y-2">
            {limitsSummary.endpoints.slice(0, 3).map((item) => (
              <div key={item.resource_id} className="rounded-md border border-subtle bg-bg-base/20 p-3">
                <div className="flex items-center justify-between text-xs text-tertiary">
                  <span className="truncate pr-2">{item.resource_name || item.resource_id}</span>
                  <span>{Math.max(0, 100 - Math.round(item.percentage_used))}%</span>
                </div>
                <div className="mt-2 h-2 rounded bg-surface-high">
                  <div className="h-2 rounded bg-accent" style={{ width: `${Math.min(100, Math.max(0, item.percentage_used))}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-tertiary">{t('lite.limits_empty')}</p>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-4" data-testid="usage-lite__trend">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{t('lite.trend_title', { days: periodDays })}</p>
          <div className="flex items-center gap-2">
            <Button
              variant={periodDays === 7 ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPeriodChange?.(7)}
              data-testid="usage-lite__period-7"
              data-active={periodDays === 7}
            >
              {t('lite.period.7d')}
            </Button>
            <Button
              variant={periodDays === 30 ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPeriodChange?.(30)}
              data-testid="usage-lite__period-30"
              data-active={periodDays === 30}
            >
              {t('lite.period.30d')}
            </Button>
            {onOpenAdvanced ? (
              <Button variant="outline" size="sm" onClick={onOpenAdvanced} data-testid="usage-lite__open-advanced">
                {t('lite.open_advanced')}
              </Button>
            ) : null}
          </div>
        </div>
        {records.length === 0 ? (
          <p className="text-sm text-tertiary">{t('lite.no_data')}</p>
        ) : (
          <div className="flex h-56 items-end gap-2">
            {records.map((item) => {
              const requests = item.requests ?? 0;
              const height = Math.max(8, Math.round((requests / maxRequests) * 180));
              return (
                <div key={item.id} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="w-full rounded-sm bg-error/90" style={{ height }} title={`${item.time_bucket}: ${requests}`} />
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
