import type {
  UserExternalConnectionFieldInput,
  UserExternalConnectionStatus,
} from '@/lib/api';

export const CUSTOM_CONNECTION_PROVIDER = 'custom' as const;
export const CUSTOM_CONNECTION_KIND = 'secret_bundle' as const;

export function statusBadgeTone(status: UserExternalConnectionStatus) {
  if (status === 'active') return 'active';
  if (status === 'expired' || status === 'reauth_required') return 'warning';
  return 'error';
}

export function createEmptyField(): UserExternalConnectionFieldInput {
  return { key: '', value: '', description: '', secret: true };
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
