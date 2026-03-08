/**
 * Epic C1: Cost Dashboard Utilities
 *
 * Helper functions for the Cost & Limit Dashboard feature.
 */

import type {
  CostTimeSeriesDataPoint,
  ResourceCostBreakdown,
  TimeRange,
  MetricType,
} from '../types/cost-dashboard';

// ============================================================================
// Limit Utilities
// ============================================================================

/**
 * Calculate percentage used for a limit summary
 */
export function calculatePercentageUsed(used: number, limit: number): number {
  if (limit === 0) return 0;
  return Math.round((used / limit) * 100 * 100) / 100; // Round to 2 decimal places
}

/**
 * Get limit status color based on percentage used
 * @returns Design system color token name
 */
export function getLimitStatusColor(percentageUsed: number): string {
  if (percentageUsed >= 100) return 'var(--error)';
  if (percentageUsed >= 80) return 'var(--warning)';
  if (percentageUsed >= 50) return 'var(--accent)';
  return 'var(--success)';
}

/**
 * Get limit status level for styling
 */
export type LimitStatusLevel = 'healthy' | 'warning' | 'critical' | 'exceeded';

export function getLimitStatusLevel(percentageUsed: number): LimitStatusLevel {
  if (percentageUsed >= 100) return 'exceeded';
  if (percentageUsed >= 80) return 'critical';
  if (percentageUsed >= 50) return 'warning';
  return 'healthy';
}

/**
 * Format limit value with appropriate unit
 */
export function formatLimitValue(value: number, unit: string): string {
  switch (unit) {
    case 'tokens':
      return formatNumber(value);
    case 'bytes':
      return formatBytes(value);
    case 'requests':
      return formatNumber(value);
    case 'files':
      return `${value} file${value !== 1 ? 's' : ''}`;
    default:
      return value.toString();
  }
}

/**
 * Calculate remaining time until limit reset
 */
export function getTimeUntilReset(resetAt: string): {
  value: number;
  unit: 'seconds' | 'minutes' | 'hours' | 'days';
  formatted: string;
} {
  const now = new Date();
  const reset = new Date(resetAt);
  const diffMs = reset.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { value: 0, unit: 'seconds' as const, formatted: 'Reset now' };
  }

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return { value: days, unit: 'days' as const, formatted: `in ${days} day${days > 1 ? 's' : ''}` };
  }
  if (hours > 0) {
    return { value: hours, unit: 'hours' as const, formatted: `in ${hours} hour${hours > 1 ? 's' : ''}` };
  }
  if (minutes > 0) {
    return { value: minutes, unit: 'minutes' as const, formatted: `in ${minutes} min` };
  }
  return { value: seconds, unit: 'seconds' as const, formatted: `in ${seconds}s` };
}

// Backward compatible aliases for legacy imports
export const getQuotaStatusColor = getLimitStatusColor;
export const getQuotaStatusLevel = getLimitStatusLevel;
export const formatQuotaValue = formatLimitValue;
export type QuotaStatusLevel = LimitStatusLevel;

// ============================================================================
// Cost/Usage Time Series Utilities
// ============================================================================

/**
 * Aggregate time series data by time bucket
 */
export function aggregateTimeSeriesByBucket(
  data: CostTimeSeriesDataPoint[],
  _granularity: 'hour' | 'day' | 'week'
): CostTimeSeriesDataPoint[] {
  // For now, return as-is. In the future, implement aggregation logic.
  return data;
}

/**
 * Calculate trend between two values
 */
export function calculateTrend(
  current: number,
  previous: number
): { value: number; isPositive: boolean } | null {
  if (previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  return {
    value: Math.abs(change),
    isPositive: change >= 0,
  };
}

/**
 * Get trend icon component name (for Lucide React)
 */
export function getTrendIcon(trend: { value: number; isPositive: boolean } | null): string {
  if (!trend) return 'Minus';
  return trend.isPositive ? 'TrendingUp' : 'TrendingDown';
}

/**
 * Get trend color class
 */
export function getTrendColor(trend: { value: number; isPositive: boolean } | null): string {
  if (!trend) return 'text-tertiary';
  // For errors, higher is worse (red)
  // For other metrics, context matters
  return trend.isPositive ? 'text-accent' : 'text-tertiary';
}

// ============================================================================
// Cost Breakdown Utilities
// ============================================================================

/**
 * Calculate cost breakdown percentages
 */
export function calculateCostBreakdownPercentages(
  breakdown: ResourceCostBreakdown[]
): ResourceCostBreakdown[] {
  const total = breakdown.reduce((sum, item) => sum + item.estimated_cost, 0);
  return breakdown.map((item) => ({
    ...item,
    percentage_of_total: total > 0 ? (item.estimated_cost / total) * 100 : 0,
  }));
}

/**
 * Sort cost breakdown by cost (descending)
 */
export function sortCostBreakdown(
  breakdown: ResourceCostBreakdown[],
  sortBy: 'cost' | 'name' | 'requests' = 'cost'
): ResourceCostBreakdown[] {
  return [...breakdown].sort((a, b) => {
    switch (sortBy) {
      case 'cost':
        return b.estimated_cost - a.estimated_cost;
      case 'name':
        return a.resource_name.localeCompare(b.resource_name);
      case 'requests':
        return b.requests - a.requests;
      default:
        return 0;
    }
  });
}

// ============================================================================
// Time Range Utilities
// ============================================================================

/**
 * Get time range from preset
 */
export function getTimeRangeFromPreset(preset: '1h' | '24h' | '7d' | '30d' | '90d'): TimeRange {
  const now = new Date();
  const start = new Date(now);

  switch (preset) {
    case '1h':
      start.setHours(start.getHours() - 1);
      break;
    case '24h':
      start.setHours(start.getHours() - 24);
      break;
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
    case '90d':
      start.setDate(start.getDate() - 90);
      break;
  }

  return {
    start: start.toISOString(),
    end: now.toISOString(),
    preset,
  };
}

/**
 * Get appropriate granularity for time range
 */
export function getGranularityForTimeRange(preset: string): 'hour' | 'day' {
  switch (preset) {
    case '1h':
    case '24h':
      return 'hour';
    default:
      return 'day';
  }
}

/**
 * Format time bucket for display
 */
export function formatTimeBucket(isoString: string, granularity: 'hour' | 'day'): string {
  const date = new Date(isoString);

  if (granularity === 'hour') {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// ============================================================================
// Metric Formatting Utilities
// ============================================================================

/**
 * Format number with locale
 */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format bytes to human-readable format
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let scaledValue = bytes;

  while (Math.abs(scaledValue) >= 1024 && unitIndex < units.length - 1) {
    scaledValue /= 1024;
    unitIndex++;
  }

  return `${scaledValue.toFixed(scaledValue < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

/**
 * Format duration in milliseconds to human-readable format
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Format currency value
 */
export function formatCurrency(amount: number, currency = 'USD'): string {
  return amount.toLocaleString(undefined, {
    style: 'currency',
    currency,
  });
}

/**
 * Format percentage
 */
export function formatPercentage(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

// ============================================================================
// Chart Data Preparation Utilities
// ============================================================================

/**
 * Prepare time series data for Recharts
 */
export function prepareTimeSeriesChartData(
  data: CostTimeSeriesDataPoint[],
  metrics: MetricType[]
): Array<{ time_bucket: string; [key: string]: string | number }> {
  return data.map((point) => {
    const chartPoint: { time_bucket: string; [key: string]: string | number } = {
      time_bucket: formatTimeBucket(point.time_bucket, 'day'),
    };

    for (const metric of metrics) {
      switch (metric) {
        case 'requests':
          chartPoint.requests = point.requests;
          break;
        case 'tokens':
          chartPoint.tokens = point.tokens ?? 0;
          break;
        case 'errors':
          chartPoint.errors = point.errors;
          break;
        case 'cost':
          chartPoint.cost = point.estimated_cost ?? 0;
          break;
        case 'bytes_in':
          chartPoint.bytes_in = point.bytes_in ?? 0;
          break;
        case 'bytes_out':
          chartPoint.bytes_out = point.bytes_out ?? 0;
          break;
        case 'duration_p95':
          chartPoint.duration_p95 = point.duration_p95_ms ?? 0;
          break;
      }
    }

    return chartPoint;
  });
}

/**
 * Prepare cost breakdown data for bar/pie chart
 */
export function prepareCostBreakdownChartData(
  breakdown: ResourceCostBreakdown[]
): Array<{ name: string; value: number; cost: number }> {
  return breakdown.map((item) => ({
    name: item.resource_name,
    value: item.estimated_cost,
    cost: item.estimated_cost,
  }));
}

/**
 * Get metric display name
 */
export function getMetricDisplayName(metric: MetricType): string {
  const names: Record<MetricType, string> = {
    requests: 'Requests',
    tokens: 'Tokens',
    errors: 'Errors',
    cost: 'Cost (USD)',
    bytes_in: 'Bytes In',
    bytes_out: 'Bytes Out',
    duration_p95: 'P95 Latency',
  };
  return names[metric];
}

/**
 * Get metric color
 */
export function getMetricColor(metric: MetricType): string {
  const colors: Record<MetricType, string> = {
    requests: 'var(--accent)',
    tokens: 'var(--accent)',
    errors: 'var(--error)',
    cost: 'var(--success)',
    bytes_in: 'var(--accent)',
    bytes_out: 'var(--accent)',
    duration_p95: 'var(--warning)',
  };
  return colors[metric];
}
