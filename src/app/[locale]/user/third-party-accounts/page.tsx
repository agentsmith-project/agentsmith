'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  UserExternalConnectionsAPI,
  getApiClient,
  handleErrorForToast,
} from '@/lib/api';
import type {
  CreateUserExternalConnectionRequest,
  UpdateUserExternalConnectionRequest,
  UserExternalConnection,
  UserExternalConnectionFieldInput,
  UserExternalConnectionKind,
  UserExternalConnectionProvider,
  UserExternalConnectionStatus,
} from '@/lib/api';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { DataTable } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { StatusBadge } from '@/components/ui/status-badge';
import { Plus, PlugZap, RefreshCw, Trash2 } from 'lucide-react';

const columnHelper = createColumnHelper<UserExternalConnection>();

const PROVIDERS: readonly { value: UserExternalConnectionProvider; labelKey: string }[] = [
  { value: 'feishu', labelKey: 'provider_feishu' },
  { value: 'jira', labelKey: 'provider_jira' },
  { value: 'github', labelKey: 'provider_github' },
  { value: 'gitee', labelKey: 'provider_gitee' },
  { value: 'custom', labelKey: 'provider_custom' },
];

const CREATE_PROVIDERS = PROVIDERS.filter((item) => item.value !== 'feishu');

const KINDS: readonly { value: UserExternalConnectionKind; labelKey: string }[] = [
  { value: 'oauth_account', labelKey: 'kind_oauth_account' },
  { value: 'secret_bundle', labelKey: 'kind_secret_bundle' },
  { value: 'ssh_keypair', labelKey: 'kind_ssh_keypair' },
];

const STATUSES: readonly { value: UserExternalConnectionStatus; labelKey: string }[] = [
  { value: 'active', labelKey: 'status_active' },
  { value: 'expired', labelKey: 'status_expired' },
  { value: 'reauth_required', labelKey: 'status_reauth_required' },
  { value: 'error', labelKey: 'status_error' },
];

function statusBadgeTone(status: UserExternalConnectionStatus) {
  if (status === 'active') return 'active';
  if (status === 'expired' || status === 'reauth_required') return 'warning';
  return 'error';
}

function createEmptyField(): UserExternalConnectionFieldInput {
  return { key: '', value: '', description: '', secret: true };
}

function fieldValue(item: UserExternalConnection | null, key: string): string {
  return item?.fields.find((field) => field.key === key)?.masked_value ?? '';
}

function allowedKindsForProvider(provider: UserExternalConnectionProvider): readonly UserExternalConnectionKind[] {
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

function defaultKindForProvider(provider: UserExternalConnectionProvider): UserExternalConnectionKind {
  return allowedKindsForProvider(provider)[0] ?? 'secret_bundle';
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function ThirdPartyAccountsPage() {
  const t = useTranslations('third_party_accounts');
  const commonT = useTranslations('common');
  const queryClient = useQueryClient();
  const api = React.useMemo(() => new UserExternalConnectionsAPI(getApiClient()), []);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<UserExternalConnection | null>(null);
  const [feishuBindOpen, setFeishuBindOpen] = React.useState(false);
  const [feishuCallbackUrl, setFeishuCallbackUrl] = React.useState('');
  const [feishuAuthState, setFeishuAuthState] = React.useState('');
  const [feishuAuthUrl, setFeishuAuthUrl] = React.useState('');

  const [provider, setProvider] = React.useState<UserExternalConnectionProvider>('jira');
  const [kind, setKind] = React.useState<UserExternalConnectionKind>('secret_bundle');
  const [status, setStatus] = React.useState<UserExternalConnectionStatus>('active');
  const [displayName, setDisplayName] = React.useState('');
  const [customDomain, setCustomDomain] = React.useState('');
  const [scopesText, setScopesText] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [lastError, setLastError] = React.useState('');
  const [externalName, setExternalName] = React.useState('');
  const [externalEmail, setExternalEmail] = React.useState('');
  const [fields, setFields] = React.useState<UserExternalConnectionFieldInput[]>([createEmptyField()]);
  const [jiraBaseUrl, setJiraBaseUrl] = React.useState('');
  const [jiraAccountEmail, setJiraAccountEmail] = React.useState('');
  const [jiraApiToken, setJiraApiToken] = React.useState('');
  const [githubApiBaseUrl, setGithubApiBaseUrl] = React.useState('https://api.github.com');
  const [githubToken, setGithubToken] = React.useState('');
  const [gitHost, setGitHost] = React.useState('');
  const [sshPublicKey, setSshPublicKey] = React.useState('');
  const [sshPrivateKey, setSshPrivateKey] = React.useState('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['me', 'external-connections'],
    queryFn: () => api.list(),
  });

  const { data: feishuConfig } = useQuery({
    queryKey: ['me', 'external-connections', 'provider', 'feishu'],
    queryFn: () => api.getProviderConfig('feishu'),
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['me', 'external-connections'] });
  }, [queryClient]);

  const resetForm = React.useCallback(() => {
    setProvider('jira');
    setKind(defaultKindForProvider('jira'));
    setStatus('active');
    setDisplayName('');
    setCustomDomain('');
    setScopesText('');
    setExpiresAt('');
    setLastError('');
    setExternalName('');
    setExternalEmail('');
    setFields([createEmptyField()]);
    setJiraBaseUrl('');
    setJiraAccountEmail('');
    setJiraApiToken('');
    setGithubApiBaseUrl('https://api.github.com');
    setGithubToken('');
    setGitHost('');
    setSshPublicKey('');
    setSshPrivateKey('');
    setEditing(null);
  }, []);

  React.useEffect(() => {
    const allowed = allowedKindsForProvider(provider);
    if (!allowed.includes(kind)) {
      setKind(defaultKindForProvider(provider));
    }
  }, [provider, kind]);

  const createMutation = useMutation({
    mutationFn: (payload: CreateUserExternalConnectionRequest) => api.create(payload),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (error) => handleErrorForToast(error),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateUserExternalConnectionRequest }) =>
      api.update(id, payload),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      resetForm();
    },
    onError: (error) => handleErrorForToast(error),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
    },
    onError: (error) => handleErrorForToast(error),
  });

  const startFeishuMutation = useMutation({
    mutationFn: () => api.startFeishuOAuth(),
    onSuccess: (data) => {
      setFeishuAuthState(data.state);
      setFeishuAuthUrl(data.authorization_url);
      setFeishuCallbackUrl('');
      setFeishuBindOpen(true);
      window.open(data.authorization_url, '_blank', 'noopener,noreferrer');
    },
    onError: (error) => handleErrorForToast(error),
  });

  const completeFeishuMutation = useMutation({
    mutationFn: () => api.completeFeishuOAuth({
      callback_url: feishuCallbackUrl.trim() || undefined,
      state: feishuAuthState || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setFeishuBindOpen(false);
      setFeishuCallbackUrl('');
      setFeishuAuthState('');
      setFeishuAuthUrl('');
    },
    onError: (error) => handleErrorForToast(error),
  });

  const refreshMutation = useMutation({
    mutationFn: (connectionId: string) => api.refresh(connectionId),
    onSuccess: () => {
      invalidate();
    },
    onError: (error) => handleErrorForToast(error),
  });

  const handleRefresh = React.useCallback((connectionId: string) => {
    refreshMutation.mutate(connectionId);
  }, [refreshMutation]);

  const openCreateDialog = () => {
    resetForm();
    setCreateOpen(true);
  };

  const openEditDialog = (item: UserExternalConnection) => {
    setEditing(item);
    setProvider(item.provider);
    setKind(item.kind);
    setStatus(item.status);
    setDisplayName(item.display_name);
    setCustomDomain(item.custom_domain ?? '');
    setScopesText((item.scopes ?? []).join(', '));
    setExpiresAt(item.expires_at ?? '');
    setLastError(item.last_error ?? '');
    setExternalName(item.account_identity?.external_name ?? '');
    setExternalEmail(item.account_identity?.external_email ?? '');
    setJiraBaseUrl(fieldValue(item, 'base_url'));
    setJiraAccountEmail(fieldValue(item, 'account_email'));
    setJiraApiToken('');
    setGithubApiBaseUrl(fieldValue(item, 'api_base_url') || 'https://api.github.com');
    setGithubToken('');
    setGitHost(fieldValue(item, 'git_host') || (item.provider === 'gitee' ? 'gitee.com' : 'github.com'));
    setSshPublicKey(fieldValue(item, 'public_key'));
    setSshPrivateKey('');
    setFields(
      item.fields.length > 0
        ? item.fields.map((field) => ({
            key: field.key,
            value: '',
            description: field.description ?? '',
            secret: field.secret,
          }))
        : [createEmptyField()]
    );
    setCreateOpen(true);
  };

  const saveConnection = () => {
    const sanitizedFields = (() => {
      if (provider === 'jira') {
        return [
          { key: 'base_url', value: jiraBaseUrl.trim(), description: 'Jira base URL', secret: false },
          { key: 'account_email', value: jiraAccountEmail.trim(), description: 'Jira account email', secret: false },
          { key: 'api_token', value: jiraApiToken, description: 'Jira API token', secret: true },
        ].filter((field) => field.key && (field.value || (editing && field.secret)));
      }
      if (provider === 'github' && kind === 'secret_bundle') {
        return [
          { key: 'api_base_url', value: githubApiBaseUrl.trim(), description: 'GitHub API base URL', secret: false },
          { key: 'token', value: githubToken, description: 'GitHub token', secret: true },
        ].filter((field) => field.key && (field.value || (editing && field.secret)));
      }
      if ((provider === 'github' || provider === 'gitee') && kind === 'ssh_keypair') {
        return [
          { key: 'git_host', value: gitHost.trim(), description: 'Git host', secret: false },
          { key: 'public_key', value: sshPublicKey.trim(), description: 'SSH public key', secret: false },
          { key: 'private_key', value: sshPrivateKey, description: 'SSH private key', secret: true },
        ].filter((field) => field.key && (field.value || (editing && field.secret)));
      }
      return fields
        .map((field: UserExternalConnectionFieldInput) => ({
          key: field.key.trim(),
          value: field.value,
          description: field.description?.trim() || undefined,
          secret: field.secret !== false,
        }))
        .filter((field) => field.key && (field.value || (editing && field.secret)));
    })();

    const payloadBase = {
      custom_domain: provider === 'custom' ? customDomain.trim() || undefined : undefined,
      display_name: displayName.trim(),
      status,
      fields: sanitizedFields,
      account_identity: externalName || externalEmail
        ? {
            external_name: externalName.trim() || undefined,
            external_email: externalEmail.trim() || undefined,
          }
        : undefined,
      scopes: scopesText
        ? scopesText.split(',').map((item) => item.trim()).filter(Boolean)
        : undefined,
      expires_at: expiresAt.trim() || null,
      last_error: lastError.trim() || null,
    };

    if (!payloadBase.display_name) return;
    if (provider === 'custom' && !payloadBase.custom_domain) return;
    if (provider === 'jira' && (!jiraBaseUrl.trim() || !jiraAccountEmail.trim() || (!editing && !jiraApiToken))) return;
    if (provider === 'github' && kind === 'secret_bundle' && (!githubApiBaseUrl.trim() || (!editing && !githubToken))) return;
    if ((provider === 'github' || provider === 'gitee') && kind === 'ssh_keypair' && (!gitHost.trim() || !sshPublicKey.trim() || (!editing && !sshPrivateKey))) return;

    if (editing) {
      updateMutation.mutate({ id: editing.id, payload: payloadBase });
      return;
    }

    createMutation.mutate({
      provider,
      kind,
      ...payloadBase,
    });
  };

  const columns = React.useMemo(
    () => [
      columnHelper.accessor('display_name', {
        header: t('table_name'),
        cell: ({ row }) => (
          <button
            type="button"
            className="text-left"
            onClick={() => openEditDialog(row.original)}
            data-testid={`third-party-accounts__row-${row.original.id}`}
          >
            <div className="font-medium text-primary">{row.original.display_name}</div>
            <div className="text-xs text-tertiary">
              {row.original.provider === 'custom'
                ? row.original.custom_domain || t('provider_custom')
                : t(`provider_${row.original.provider}`)}
            </div>
          </button>
        ),
      }),
      columnHelper.accessor('kind', {
        header: t('table_kind'),
        cell: (info) => <span className="text-tertiary">{t(`kind_${info.getValue()}`)}</span>,
      }),
      columnHelper.accessor('status', {
        header: t('table_status'),
        cell: (info) => (
          <StatusBadge status={statusBadgeTone(info.getValue())}>
            {t(`status_${info.getValue()}`)}
          </StatusBadge>
        ),
      }),
      columnHelper.display({
        id: 'fields',
        header: t('table_fields'),
        cell: ({ row }) => (
          <span className="text-tertiary">
            {row.original.fields.map((field: UserExternalConnection['fields'][number]) => field.key).join(', ') || '—'}
          </span>
        ),
      }),
      columnHelper.accessor('updated_at', {
        header: t('table_updated'),
        cell: (info) => <span className="text-tertiary">{formatDateTime(info.getValue())}</span>,
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1">
            {row.original.provider === 'feishu' ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRefresh(row.original.id)}
                data-testid={`third-party-accounts__refresh-${row.original.id}`}
                title={t('refresh_connection')}
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              className="text-error hover:text-error"
              onClick={() => setDeleteId(row.original.id)}
              data-testid={`third-party-accounts__delete-${row.original.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ),
      }),
    ],
    [handleRefresh, t]
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const canSubmit = (() => {
    if (!displayName.trim()) return false;
    if (provider === 'custom') return Boolean(customDomain.trim());
    if (provider === 'jira') return Boolean(jiraBaseUrl.trim() && jiraAccountEmail.trim() && (editing || jiraApiToken));
    if (provider === 'github' && kind === 'secret_bundle') return Boolean(githubApiBaseUrl.trim() && (editing || githubToken));
    if ((provider === 'github' || provider === 'gitee') && kind === 'ssh_keypair') {
      return Boolean(gitHost.trim() && sshPublicKey.trim() && (editing || sshPrivateKey));
    }
    return true;
  })();

  return (
    <PageState state="success">
      <PageLayout>
        <div className="max-w-6xl mx-auto w-full px-4 py-4 md:px-5 md:py-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
              <p className="text-tertiary mt-1">{t('description')}</p>
            </div>
            <Button variant="action" onClick={openCreateDialog} data-testid="third-party-accounts__create-btn">
              <Plus className="w-4 h-4" />
              {t('create')}
            </Button>
          </div>

          <div className="rounded-md border border-border bg-surface p-5 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <PlugZap className="w-4 h-4 text-icon-default" />
              {t('feishu_oauth_title')}
            </div>
            <p className="text-sm text-tertiary">{t('feishu_oauth_description')}</p>
            <div className="grid gap-2 text-sm text-tertiary md:grid-cols-2">
              <div>{t('callback_uri_label')}: <code className="text-primary">{feishuConfig?.callback_uri ?? '—'}</code></div>
              <div>{t('interactive_login_label')}: <span className="text-primary">{feishuConfig?.interactive_login_required ? t('yes') : t('no')}</span></div>
            </div>
            <div className="pt-2">
              <Button
                variant="action"
                onClick={() => startFeishuMutation.mutate()}
                disabled={!feishuConfig?.auth_configured || startFeishuMutation.isPending}
                data-testid="third-party-accounts__feishu-connect"
              >
                <PlugZap className="w-4 h-4" />
                {t('connect_feishu')}
              </Button>
              {!feishuConfig?.auth_configured ? (
                <p className="mt-2 text-xs text-warning">{t('feishu_not_configured')}</p>
              ) : null}
            </div>
          </div>

          {isLoading ? (
            <div className="text-tertiary py-12">{commonT('loading')}</div>
          ) : items.length === 0 ? (
            <div className="py-20 text-center border border-border rounded-md bg-surface">
              <PlugZap className="w-12 h-12 text-tertiary mx-auto mb-4" />
              <p className="text-foreground font-medium mb-2">{t('empty_title')}</p>
              <p className="text-tertiary mb-4">{t('empty_description')}</p>
              <Button variant="action" onClick={openCreateDialog}>
                <Plus className="w-4 h-4" />
                {t('create')}
              </Button>
            </div>
          ) : (
            <DataTable table={table} testId="third-party-accounts__table" />
          )}
        </div>

        <Dialog open={createOpen} onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetForm();
        }}>
          <DialogContent className="sm:max-w-[760px]" data-testid="third-party-accounts__dialog">
            <DialogHeader>
              <DialogTitle>{editing ? t('edit_title') : t('create_title')}</DialogTitle>
              <DialogDescription>{t('dialog_description')}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-1 gap-4 py-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('provider_label')}</label>
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as UserExternalConnectionProvider)}
                  disabled={Boolean(editing)}
                  aria-label={t('provider_label')}
                  className="w-full h-10 px-3 rounded-md border border-subtle bg-surface-high text-primary text-sm"
                >
                  {(editing ? PROVIDERS : CREATE_PROVIDERS).map((item) => (
                    <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('kind_label')}</label>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as UserExternalConnectionKind)}
                  disabled={Boolean(editing) || provider === 'feishu'}
                  aria-label={t('kind_label')}
                  className="w-full h-10 px-3 rounded-md border border-subtle bg-surface-high text-primary text-sm"
                >
                  {KINDS.filter((item) => allowedKindsForProvider(provider).includes(item.value)).map((item) => (
                    <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                  ))}
                </select>
              </div>

              {provider === 'custom' ? (
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-medium">{t('custom_domain_label')}</label>
                  <Input aria-label={t('custom_domain_label')} value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder={t('custom_domain_placeholder')} />
                </div>
              ) : null}

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">{t('display_name_label')}</label>
                <Input aria-label={t('display_name_label')} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t('display_name_placeholder')} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('status_label')}</label>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as UserExternalConnectionStatus)}
                  aria-label={t('status_label')}
                  className="w-full h-10 px-3 rounded-md border border-subtle bg-surface-high text-primary text-sm"
                >
                  {STATUSES.map((item) => (
                    <option key={item.value} value={item.value}>{t(item.labelKey)}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('expires_at_label')}</label>
                <Input aria-label={t('expires_at_label')} value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} placeholder={t('expires_at_placeholder')} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('external_name_label')}</label>
                <Input aria-label={t('external_name_label')} value={externalName} onChange={(event) => setExternalName(event.target.value)} placeholder={t('external_name_placeholder')} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">{t('external_email_label')}</label>
                <Input aria-label={t('external_email_label')} value={externalEmail} onChange={(event) => setExternalEmail(event.target.value)} placeholder={t('external_email_placeholder')} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">{t('scopes_label')}</label>
                <Input aria-label={t('scopes_label')} value={scopesText} onChange={(event) => setScopesText(event.target.value)} placeholder={t('scopes_placeholder')} />
              </div>

              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium">{t('last_error_label')}</label>
                <Textarea aria-label={t('last_error_label')} value={lastError} onChange={(event) => setLastError(event.target.value)} rows={2} placeholder={t('last_error_placeholder')} />
              </div>

              {provider === 'jira' ? (
                <div className="space-y-3 md:col-span-2">
                  <div className="rounded-md border border-subtle bg-surface-high p-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium">{t('jira_base_url_label')}</label>
                      <Input aria-label={t('jira_base_url_label')} value={jiraBaseUrl} onChange={(event) => setJiraBaseUrl(event.target.value)} placeholder={t('jira_base_url_placeholder')} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('jira_email_label')}</label>
                      <Input aria-label={t('jira_email_label')} value={jiraAccountEmail} onChange={(event) => setJiraAccountEmail(event.target.value)} placeholder={t('jira_email_placeholder')} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('jira_token_label')}</label>
                      <Input aria-label={t('jira_token_label')} type="password" value={jiraApiToken} onChange={(event) => setJiraApiToken(event.target.value)} placeholder={editing ? t('secret_keep_existing_hint') : t('jira_token_placeholder')} />
                    </div>
                  </div>
                </div>
              ) : null}

              {provider === 'github' && kind === 'secret_bundle' ? (
                <div className="space-y-3 md:col-span-2">
                  <div className="rounded-md border border-subtle bg-surface-high p-4 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium">{t('github_api_base_url_label')}</label>
                      <Input aria-label={t('github_api_base_url_label')} value={githubApiBaseUrl} onChange={(event) => setGithubApiBaseUrl(event.target.value)} placeholder={t('github_api_base_url_placeholder')} />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-medium">{t('github_token_label')}</label>
                      <Input aria-label={t('github_token_label')} type="password" value={githubToken} onChange={(event) => setGithubToken(event.target.value)} placeholder={editing ? t('secret_keep_existing_hint') : t('github_token_placeholder')} />
                    </div>
                  </div>
                </div>
              ) : null}

              {(provider === 'github' || provider === 'gitee') && kind === 'ssh_keypair' ? (
                <div className="space-y-3 md:col-span-2">
                  <div className="rounded-md border border-subtle bg-surface-high p-4 grid gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('git_host_label')}</label>
                      <Input aria-label={t('git_host_label')} value={gitHost} onChange={(event) => setGitHost(event.target.value)} placeholder={provider === 'gitee' ? 'gitee.com' : 'github.com'} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('ssh_public_key_label')}</label>
                      <Textarea aria-label={t('ssh_public_key_label')} value={sshPublicKey} onChange={(event) => setSshPublicKey(event.target.value)} rows={4} placeholder={t('ssh_public_key_placeholder')} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('ssh_private_key_label')}</label>
                      <Textarea aria-label={t('ssh_private_key_label')} value={sshPrivateKey} onChange={(event) => setSshPrivateKey(event.target.value)} rows={6} placeholder={editing ? t('secret_keep_existing_hint') : t('ssh_private_key_placeholder')} />
                    </div>
                  </div>
                </div>
              ) : null}

              {provider === 'custom' ? (
                <div className="space-y-3 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">{t('fields_label')}</label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setFields((current) => [...current, createEmptyField()])}
                    >
                      <Plus className="w-4 h-4" />
                      {t('add_field')}
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {fields.map((field, index) => (
                      <div key={`${index}-${field.key}`} className="rounded-md border border-subtle bg-surface-high p-3 space-y-3">
                        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                          <Input
                            value={field.key}
                            onChange={(event) => setFields((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))}
                            placeholder={t('field_key_placeholder')}
                          />
                          <Input
                            value={field.value}
                            onChange={(event) => setFields((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))}
                            placeholder={editing && field.secret ? t('secret_keep_existing_hint') : t('field_value_placeholder')}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-error hover:text-error"
                            onClick={() => setFields((current) => current.length > 1 ? current.filter((_, itemIndex) => itemIndex !== index) : [createEmptyField()])}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                          <Input
                            value={field.description ?? ''}
                            onChange={(event) => setFields((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))}
                            placeholder={t('field_description_placeholder')}
                          />
                          <label className="inline-flex items-center gap-2 text-sm text-tertiary">
                            <input
                              type="checkbox"
                              checked={field.secret !== false}
                              onChange={(event) => setFields((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, secret: event.target.checked } : item))}
                            />
                            {t('field_secret_label')}
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isPending}>
                {commonT('cancel')}
              </Button>
              <Button
                variant="action"
                onClick={saveConnection}
                disabled={isPending || !canSubmit}
              >
                {editing ? t('save') : t('create')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={feishuBindOpen} onOpenChange={setFeishuBindOpen}>
          <DialogContent className="sm:max-w-[720px]" data-testid="third-party-accounts__feishu-dialog">
            <DialogHeader>
              <DialogTitle>{t('feishu_bind_title')}</DialogTitle>
              <DialogDescription>{t('feishu_bind_description')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="rounded-md border border-subtle bg-surface-high p-3 text-sm text-tertiary">
                <div className="font-medium text-foreground mb-2">{t('authorization_url_label')}</div>
                <code className="block break-all text-primary">{feishuAuthUrl || '—'}</code>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('callback_url_input_label')}</label>
                <Textarea
                  value={feishuCallbackUrl}
                  onChange={(event) => setFeishuCallbackUrl(event.target.value)}
                  rows={4}
                  placeholder={t('callback_url_input_placeholder')}
                />
                <p className="text-xs text-tertiary">{t('callback_url_input_hint')}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFeishuBindOpen(false)}>
                {commonT('cancel')}
              </Button>
              <Button
                variant="action"
                onClick={() => completeFeishuMutation.mutate()}
                disabled={completeFeishuMutation.isPending || !feishuCallbackUrl.trim()}
              >
                {t('complete_feishu_binding')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('delete_confirm_description')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{commonT('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
                className="bg-error hover:bg-error/90"
              >
                {commonT('delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageLayout>
    </PageState>
  );
}
