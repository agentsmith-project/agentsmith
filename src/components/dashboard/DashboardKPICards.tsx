'use client';

import * as React from 'react';
import { Activity, AlertCircle, TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/utils/dashboard';

export interface DashboardKPI {
  total_requests: number;
  total_tokens: number;
  total_errors: number;
  total_cost_usd?: number;
  requests_change_percent?: number;
  tokens_change_percent?: number;
  errors_change_percent?: number;
}

export interface DashboardKPICardsProps {
  kpi?: DashboardKPI;
  loading?: boolean;
}

function _calculateTrend(current: number, previous?: number): { value: number; isPositive: boolean } | null {
  if (!previous || previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  return {
    value: Math.abs(change),
    isPositive: change >= 0,
  };
}

function TrendIndicator({ value, isError }: { value: number; isError?: boolean }) {
  const isPositive = value >= 0;
  return (
    <div className={cn(
      'flex items-center gap-1 text-xs',
      isError && isPositive ? 'text-error' : // Errors going up = bad
      isError && !isPositive ? 'text-success' : // Errors going down = good
      !isError && isPositive ? 'text-accent' : // Other metrics going up = good
      'text-tertiary'
    )}>
      {isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {value.toFixed(1)}%
    </div>
  );
}

export function DashboardKPICards({ kpi, loading }: DashboardKPICardsProps) {
  const t = useTranslations('dashboard');
  const hasCostCard = kpi?.total_cost_usd !== undefined;
  const gridColsClass = hasCostCard ? 'lg:grid-cols-4' : 'lg:grid-cols-3';

  if (loading) {
    return (
      <div className={cn(`grid grid-cols-1 md:grid-cols-2 ${gridColsClass} gap-3`)}>
        {[1, 2, 3, 4].slice(0, hasCostCard ? 4 : 3).map((i) => (
          <div key={i} className="bg-surface border border-border rounded-xl p-4 animate-pulse" data-testid={`dashboard-kpi__skeleton-${i}`}>
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

  // Calculate trends from change percentages
  const requestsTrend = kpi.requests_change_percent !== undefined
    ? { value: Math.abs(kpi.requests_change_percent), isPositive: kpi.requests_change_percent >= 0 }
    : null;
  const errorsTrend = kpi.errors_change_percent !== undefined
    ? { value: Math.abs(kpi.errors_change_percent), isPositive: kpi.errors_change_percent >= 0 }
    : null;

  return (
    <div className={cn(`grid grid-cols-1 md:grid-cols-2 ${gridColsClass} gap-3`)}>
      {/* Requests Today */}
      <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-kpi__requests">
        <div className="flex items-center justify-between mb-2">
          <Activity className="h-5 w-5 text-tertiary" />
          {requestsTrend && <TrendIndicator value={requestsTrend.value} />}
        </div>
        <div className="text-2xl font-semibold text-foreground mb-1">
          {formatNumber(kpi.total_requests)}
        </div>
        <div className="text-xs text-tertiary">{t('kpi.requests_today')}</div>
      </div>

      {/* Errors Today */}
      <div
        className={cn(
          'bg-surface border border-border rounded-xl p-4',
          errorsTrend?.isPositive && 'border-error/50 bg-error/5'
        )}
        data-testid="dashboard-kpi__errors"
      >
        <div className="flex items-center justify-between mb-2">
          <AlertCircle className="h-5 w-5 text-error" />
          {errorsTrend && <TrendIndicator value={errorsTrend.value} isError />}
        </div>
        <div className="text-2xl font-semibold text-error mb-1">
          {formatNumber(kpi.total_errors)}
        </div>
        <div className="text-xs text-tertiary">{t('kpi.errors_today')}</div>
      </div>

      {/* Tokens Today */}
      <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-kpi__tokens">
        <div className="flex items-center justify-between mb-2">
          <Activity className="h-5 w-5 text-tertiary" />
          {kpi.tokens_change_percent !== undefined && (
            <TrendIndicator value={Math.abs(kpi.tokens_change_percent)} />
          )}
        </div>
        <div className="text-2xl font-semibold text-foreground mb-1">
          {formatNumber(kpi.total_tokens)}
        </div>
        <div className="text-xs text-tertiary">{t('kpi.tokens_today')}</div>
      </div>

      {/* Cost Today (optional) */}
      {hasCostCard && (
        <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-kpi__cost">
          <div className="flex items-center justify-between mb-2">
            <DollarSign className="h-5 w-5 text-tertiary" />
          </div>
          <div className="text-2xl font-semibold text-foreground mb-1">
            {new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: 'USD',
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }).format(kpi.total_cost_usd!)}
          </div>
          <div className="text-xs text-tertiary">{t('kpi.cost_today')}</div>
        </div>
      )}
    </div>
  );
}
