'use client';
import * as React from 'react';
import { Activity, AlertCircle, Sparkles, Database, TrendingUp, TrendingDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatNumber, formatBytes } from '@/lib/utils/formatters';
import type { UsageKPI } from '@/lib/api/types';

export interface UsageKPICardsProps {
  kpi: UsageKPI | null | undefined;
  loading?: boolean;
  className?: string;
}

function calculateTrend(current: number, previous?: number): { value: number; isPositive: boolean } | null {
  if (!previous || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  return {
    value: Math.abs(change),
    isPositive: change >= 0,
  };
}

export function UsageKPICards({ kpi, loading, className }: UsageKPICardsProps) {
  const t = useTranslations('usage');

  if (loading) {
    return (
      <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-surface border border-border rounded-md p-4 animate-pulse">
            <div className="h-4 w-20 bg-surface-high rounded mb-2" />
            <div className="h-8 w-16 bg-surface-high rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!kpi) {
    return null;
  }

  const requestsTrend = calculateTrend(kpi.requests_today, kpi.requests_yesterday);
  const errorsTrend = calculateTrend(kpi.errors_today, kpi.errors_yesterday);

  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      {/* Requests Today */}
      <div className="bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between mb-2">
          <Activity className="h-5 w-5 text-tertiary" />
          {requestsTrend && (
            <div className={cn('flex items-center gap-1 text-xs', requestsTrend.isPositive ? 'text-accent' : 'text-tertiary')}>
              {requestsTrend.isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {requestsTrend.value.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="text-2xl font-semibold text-foreground mb-1">
          {formatNumber(kpi.requests_today)}
        </div>
        <div className="text-xs text-tertiary">{t('kpi.requests_today')}</div>
      </div>

      {/* Errors Today */}
      <div className="bg-surface border border-border rounded-md p-4">
        <div className="flex items-center justify-between mb-2">
          <AlertCircle className="h-5 w-5 text-error" />
          {errorsTrend && (
            <div className={cn('flex items-center gap-1 text-xs', errorsTrend.isPositive ? 'text-error' : 'text-tertiary')}>
              {errorsTrend.isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              {errorsTrend.value.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="text-2xl font-semibold text-error mb-1">
          {formatNumber(kpi.errors_today)}
        </div>
        <div className="text-xs text-tertiary">{t('kpi.errors_today')}</div>
      </div>

      {/* Tokens Today */}
      {kpi.tokens_today !== undefined && (
        <div className="bg-surface border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <Sparkles className="h-5 w-5 text-tertiary" />
          </div>
          <div className="text-2xl font-semibold text-foreground mb-1">
            {formatNumber(kpi.tokens_today)}
          </div>
          <div className="text-xs text-tertiary">{t('kpi.tokens_today')}</div>
        </div>
      )}

      {/* UserData Bytes */}
      {kpi.userdata_bytes !== undefined && (
        <div className="bg-surface border border-border rounded-md p-4">
          <div className="flex items-center justify-between mb-2">
            <Database className="h-5 w-5 text-tertiary" />
          </div>
          <div className="text-2xl font-semibold text-foreground mb-1">
            {formatBytes(kpi.userdata_bytes)}
          </div>
          <div className="text-xs text-tertiary">{t('kpi.userdata_bytes')}</div>
        </div>
      )}
    </div>
  );
}
