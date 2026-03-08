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
  onOpenAdvanced?: () => void;
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
  onOpenAdvanced,
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
          <p className="text-xs text-tertiary">{t('lite.cards.period_requests')}</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{formatNumber(periodRequests)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4" data-testid="usage-lite__trend">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{t('lite.trend_title')}</p>
          {onOpenAdvanced ? (
            <Button variant="outline" size="sm" onClick={onOpenAdvanced} data-testid="usage-lite__open-advanced">
              {t('lite.open_advanced')}
            </Button>
          ) : null}
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
