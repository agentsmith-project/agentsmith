'use client';

type TaskPresence = 'online' | 'offline' | 'managed' | 'unknown';
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

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

function formatTaskDate(date: Date): string {
  return new Intl.DateTimeFormat(getDisplayLocale(), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
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
  return formatTaskDate(date);
}

export function formatTaskDateTime(dateString: string): string {
  const date = parseTaskDate(dateString);
  if (!date) return '—';
  return new Intl.DateTimeFormat(getDisplayLocale(), {
    dateStyle: 'medium',
    hour12: false,
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function getTaskPresenceLabel(
  t: (key: string) => string,
  presence?: TaskPresence,
): string | null {
  switch (presence) {
    case 'online':
      return t('agent_online');
    case 'offline':
      return t('agent_offline');
    case 'managed':
      return t('agent_managed');
    case 'unknown':
      return t('agent_presence_not_reported');
    default:
      return null;
  }
}

export function getTaskPresenceVariant(
  presence?: TaskPresence,
): BadgeVariant | null {
  switch (presence) {
    case 'online':
      return 'default';
    case 'managed':
      return 'secondary';
    case 'offline':
      return 'destructive';
    case 'unknown':
      return 'outline';
    default:
      return null;
  }
}
