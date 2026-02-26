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
  // TODO: Implement with TDD approach
  return timestamp;
}
