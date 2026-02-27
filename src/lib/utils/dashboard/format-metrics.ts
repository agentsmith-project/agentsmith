/**
 * Metrics Formatting Utilities
 *
 * Formats numbers, percentages, and other metrics for display.
 *
 * @module lib/utils/dashboard/format-metrics
 */

/**
 * Formats numbers with K/M/B suffixes
 */
export function formatNumber(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absValue = Math.abs(value);

  if (absValue >= 1_000_000_000) {
    return `${sign}${(absValue / 1_000_000_000).toFixed(1)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${sign}${(absValue / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}${(absValue / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

/**
 * Formats percentages with appropriate precision
 */
export function formatPercent(value: number, decimals: number = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Formats duration from milliseconds to human-readable
 */
export function formatDuration(ms: number): string {
  if (ms >= 3600000) {
    return `${(ms / 3600000).toFixed(1)}h`;
  }
  if (ms >= 60000) {
    return `${(ms / 60000).toFixed(1)}m`;
  }
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${ms}ms`;
}

/**
 * Formats bytes to human-readable (KB/MB/GB)
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)}GB`;
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}KB`;
  }
  return `${bytes}B`;
}

/**
 * Formats currency (USD)
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Formats timestamp to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '-';

  const diffMs = date.getTime() - Date.now();
  const isFuture = diffMs > 0;
  const absMs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const formatUnit = (value: number, unit: 'm' | 'h' | 'd') =>
    isFuture ? `in ${value}${unit}` : `${value}${unit} ago`;

  if (absMs < minute) {
    return isFuture ? 'in <1m' : 'just now';
  }
  if (absMs < hour) {
    return formatUnit(Math.floor(absMs / minute), 'm');
  }
  if (absMs < day) {
    return formatUnit(Math.floor(absMs / hour), 'h');
  }
  if (absMs < 7 * day) {
    return formatUnit(Math.floor(absMs / day), 'd');
  }

  return date.toISOString().slice(0, 10);
}
