/**
 * Formatting Utilities
 * 
 * Centralized formatting functions for numbers, bytes, durations, and dates.
 * All functions handle undefined/null/NaN safely.
 */

export interface FormatNumberOptions {
  defaultValue?: string;
  decimals?: number;
  locale?: string;
}

export interface FormatBytesOptions {
  defaultValue?: string;
  binary?: boolean; // Use 1024 vs 1000
}

/**
 * Format number with K/M suffixes
 */
export function formatNumber(
  num: number | undefined | null,
  options?: FormatNumberOptions
): string {
  const { defaultValue = '0', decimals = 1, locale } = options || {};
  if (num === undefined || num === null || isNaN(num)) return defaultValue;
  
  if (locale) {
    // Use Intl.NumberFormat for localization
    if (num >= 1000000) {
      return new Intl.NumberFormat(locale, {
        style: 'decimal',
        maximumFractionDigits: decimals,
        notation: 'compact',
        compactDisplay: 'short',
      }).format(num);
    }
  }
  
  if (num >= 1000000) return `${(num / 1000000).toFixed(decimals)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(decimals)}K`;
  return num.toString();
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(
  bytes: number | undefined | null,
  options?: FormatBytesOptions
): string {
  const { defaultValue = '0 B', binary = true } = options || {};
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes === 0) {
    return defaultValue;
  }
  
  const k = binary ? 1024 : 1000;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '-';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(
  dateString: string,
  locale?: string
): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  // Use Intl.RelativeTimeFormat if locale is provided
  if (locale) {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (diffDays < 30) return rtf.format(-diffDays, 'day');
    if (diffDays < 365) return rtf.format(-Math.floor(diffDays / 30), 'month');
    return rtf.format(-Math.floor(diffDays / 365), 'year');
  }
  
  // Fallback
  return date.toLocaleDateString();
}
