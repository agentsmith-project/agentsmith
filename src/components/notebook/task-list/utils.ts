'use client';

export function formatTaskRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function formatTaskDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

export function getTaskPresenceLabel(
  t: (key: string) => string,
  presence?: 'online' | 'offline' | 'managed' | 'unknown',
): string {
  switch (presence) {
    case 'online':
      return t('agent_online');
    case 'offline':
      return t('agent_offline');
    case 'managed':
      return t('agent_managed');
    default:
      return t('agent_unknown');
  }
}

export function getTaskPresenceVariant(
  presence?: 'online' | 'offline' | 'managed' | 'unknown',
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (presence) {
    case 'online':
      return 'default';
    case 'managed':
      return 'secondary';
    case 'offline':
      return 'destructive';
    default:
      return 'outline';
  }
}
