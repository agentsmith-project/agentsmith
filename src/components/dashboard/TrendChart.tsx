'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

export interface TrendChartProps {
  data: Array<{ timestamp?: string; date?: string; value: number; label?: string }>;
  metric: string;
  granularity: 'day' | 'week' | 'month';
  onPointClick?: (data: { date: string; value: number }) => void;
}

export function TrendChart({ data, metric, granularity, onPointClick, loading }: TrendChartProps & { loading?: boolean }) {
  const t = useTranslations('dashboard');

  // Normalize data to have timestamp field (supports both timestamp and date)
  const normalizedData = data.map((item) => ({
    ...item,
    timestamp: item.timestamp || item.date || '',
  }));

  if (loading) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-trend-chart__loading">
        <div className="animate-pulse">
          <div className="h-4 w-20 bg-surface-high rounded mb-4" />
          <div className="h-48 bg-surface-high rounded" />
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 flex items-center justify-center h-52" data-testid="dashboard-trend-chart">
        <p className="text-sm text-tertiary">{t('no_data')}</p>
      </div>
    );
  }

  // Format X-axis labels based on granularity
  const formatXAxisLabel = (value: string) => {
    const date = new Date(value);
    switch (granularity) {
      case 'day':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case 'week':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case 'month':
        return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      default:
        return value;
    }
  };

  // Format tooltip
  const formatTooltip = (value: number | undefined, _name: string | undefined) => {
    if (value === undefined) return ['', metric];
    return [value.toLocaleString(), metric];
  };

  return (
    <div className="bg-surface border border-border rounded-xl p-4" data-testid="dashboard-trend-chart">
      <div className="mb-4">
        <h3 className="text-sm font-medium text-foreground capitalize">{metric}</h3>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart
          data={normalizedData}
          margin={{ top: 5, right: 5, bottom: 5, left: 5 }}
          onClick={onPointClick ? () => {
            const lastPoint = normalizedData[normalizedData.length - 1];
            if (lastPoint && onPointClick) {
              onPointClick({ date: lastPoint.timestamp, value: lastPoint.value });
            }
          } : undefined}
          style={onPointClick ? { cursor: 'pointer' } : undefined}
        >
          <CartesianGrid strokeDasharray="3 3" className="stroke-border-subtle" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatXAxisLabel}
            className="text-xs text-tertiary"
            tick={{ fill: 'var(--text-tertiary)' }}
          />
          <YAxis
            className="text-xs text-tertiary"
            tick={{ fill: 'var(--text-tertiary)' }}
            tickFormatter={(value) => {
              if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
              if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
              return value.toString();
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'var(--bg-surface-high)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
            }}
            labelStyle={{ color: 'var(--text-primary)' }}
            itemStyle={{ color: 'var(--text-strong)' }}
            formatter={formatTooltip}
            labelFormatter={(timestamp) => formatXAxisLabel(timestamp)}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ fill: 'var(--accent)', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
