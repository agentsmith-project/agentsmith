import type {
  UserExternalConnection,
  UserExternalConnectionFieldInput,
  UserExternalConnectionKind,
  UserExternalConnectionProvider,
  UserExternalConnectionStatus,
} from '@/lib/api';

export const PROVIDERS: readonly { value: UserExternalConnectionProvider; labelKey: string }[] = [
  { value: 'feishu', labelKey: 'provider_feishu' },
  { value: 'jira', labelKey: 'provider_jira' },
  { value: 'github', labelKey: 'provider_github' },
  { value: 'gitee', labelKey: 'provider_gitee' },
  { value: 'custom', labelKey: 'provider_custom' },
];

export const CREATE_PROVIDERS = PROVIDERS.filter((item) => item.value !== 'feishu');

export const KINDS: readonly { value: UserExternalConnectionKind; labelKey: string }[] = [
  { value: 'oauth_account', labelKey: 'kind_oauth_account' },
  { value: 'secret_bundle', labelKey: 'kind_secret_bundle' },
  { value: 'ssh_keypair', labelKey: 'kind_ssh_keypair' },
];

export function statusBadgeTone(status: UserExternalConnectionStatus) {
  if (status === 'active') return 'active';
  if (status === 'expired' || status === 'reauth_required') return 'warning';
  return 'error';
}

export function createEmptyField(): UserExternalConnectionFieldInput {
  return { key: '', value: '', description: '', secret: true };
}

export function fieldValue(item: UserExternalConnection | null, key: string): string {
  return item?.fields.find((field) => field.key === key)?.masked_value ?? '';
}

export function allowedKindsForProvider(provider: UserExternalConnectionProvider): readonly UserExternalConnectionKind[] {
  switch (provider) {
    case 'feishu':
      return ['oauth_account'];
    case 'jira':
      return ['secret_bundle'];
    case 'github':
      return ['secret_bundle', 'ssh_keypair'];
    case 'gitee':
      return ['ssh_keypair'];
    case 'custom':
      return ['secret_bundle'];
  }
}

export function defaultKindForProvider(provider: UserExternalConnectionProvider): UserExternalConnectionKind {
  return allowedKindsForProvider(provider)[0] ?? 'secret_bundle';
}

export function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
