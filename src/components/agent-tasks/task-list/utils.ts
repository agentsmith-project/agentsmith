'use client';

import { formatDisplayDateTime, resolveDisplayTimeZone } from '@/lib/utils/date-time-format';

function parseTaskDate(dateString: string): Date | null {
  const date = new Date(dateString);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getDisplayLocale(): string {
  if (typeof document !== 'undefined' && document.documentElement.lang) {
    return document.documentElement.lang;
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
  }
  return 'en-US';
}

function getDisplayTimeZone(locale = getDisplayLocale()): string {
  return resolveDisplayTimeZone(locale);
}

export function formatTaskRelativeTime(dateString: string): string {
  const date = parseTaskDate(dateString);
  if (!date) return '—';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatTaskDateTime(dateString);
}

export function formatTaskDateTime(dateString: string): string {
  const date = parseTaskDate(dateString);
  if (!date) return '—';
  const locale = getDisplayLocale();
  return formatDisplayDateTime(date.toISOString(), {
    locale,
    timeZone: getDisplayTimeZone(locale),
  });
}
