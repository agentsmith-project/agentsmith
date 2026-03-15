'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
} from '@/lib/api';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { Plus, PlugZap, ShieldCheck, Link2 } from 'lucide-react';

import { ConnectionFormFields } from './_components/ConnectionFormFields';
import { FeishuOAuthCard } from './_components/FeishuOAuthCard';
import { ThirdPartyAccountsTable } from './_components/ThirdPartyAccountsTable';
import {
  allowedKindsForProvider,
  createEmptyField,
  defaultKindForProvider,
  fieldValue,
} from './third-party-accounts-utils';

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
  const [displayName, setDisplayName] = React.useState('');
  const [note, setNote] = React.useState('');
  const [customDomain, setCustomDomain] = React.useState('');
  const [fields, setFields] = React.useState<UserExternalConnectionFieldInput[]>([createEmptyField()]);
  const [jiraBaseUrl, setJiraBaseUrl] = React.useState('');
  const [jiraApiToken, setJiraApiToken] = React.useState('');
  const [githubApiBaseUrl, setGithubApiBaseUrl] = React.useState('https://api.github.com');
  const [githubToken, setGithubToken] = React.useState('');
  const [gitHost, setGitHost] = React.useState('github.com');
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
    setDisplayName('');
    setNote('');
    setCustomDomain('');
    setFields([createEmptyField()]);
    setJiraBaseUrl('');
    setJiraApiToken('');
    setGithubApiBaseUrl('https://api.github.com');
    setGithubToken('');
    setGitHost('github.com');
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
    setDisplayName(item.display_name);
    setNote(item.note ?? '');
    setCustomDomain(item.custom_domain ?? '');
    setJiraBaseUrl(fieldValue(item, 'base_url'));
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
        const normalizedGitHost = gitHost.trim() || (provider === 'gitee' ? 'gitee.com' : 'github.com');
        return [
          { key: 'git_host', value: normalizedGitHost, description: 'Git host', secret: false },
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
      note: note.trim() || null,
      status: 'active' as const,
      fields: sanitizedFields,
      account_identity: undefined,
      scopes: undefined,
      expires_at: undefined,
      last_error: undefined,
    };

    if (!payloadBase.display_name) return;
    if (provider === 'custom' && !payloadBase.custom_domain) return;
    if (provider === 'jira' && (!jiraBaseUrl.trim() || (!editing && !jiraApiToken))) return;
    if (provider === 'github' && kind === 'secret_bundle' && (!githubApiBaseUrl.trim() || (!editing && !githubToken))) return;
    if ((provider === 'github' || provider === 'gitee') && kind === 'ssh_keypair' && (!sshPublicKey.trim() || (!editing && !sshPrivateKey))) return;

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

  const isPending = createMutation.isPending || updateMutation.isPending;
  const canSubmit = (() => {
    if (!displayName.trim()) return false;
    if (provider === 'custom') return Boolean(customDomain.trim());
    if (provider === 'jira') return Boolean(jiraBaseUrl.trim() && (editing || jiraApiToken));
    if (provider === 'github' && kind === 'secret_bundle') return Boolean(githubApiBaseUrl.trim() && (editing || githubToken));
    if ((provider === 'github' || provider === 'gitee') && kind === 'ssh_keypair') {
      return Boolean(sshPublicKey.trim() && (editing || sshPrivateKey));
    }
    return true;
  })();
  const activeItems = React.useMemo(
    () => items.filter((item) => item.status === 'active'),
    [items],
  );
  const oauthItems = React.useMemo(
    () => items.filter((item) => item.provider === 'feishu'),
    [items],
  );
  const providerCount = React.useMemo(
    () => new Set(items.map((item) => item.provider)).size,
    [items],
  );

  return (
    <PageState state="success">
      <PageLayout>
        <div className="max-w-6xl mx-auto w-full px-4 py-4 md:px-5 md:py-5 space-y-5">
          <section className="rounded-2xl border border-border bg-surface px-5 py-5 shadow-sm shadow-black/10 md:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="max-w-3xl space-y-2">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                  <Link2 className="h-3.5 w-3.5" />
                  {t('summary_badge')}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-foreground">{t('title')}</h1>
                  <p className="text-tertiary mt-1">{t('description')}</p>
                </div>
                <p className="max-w-2xl text-sm leading-6 text-secondary">{t('summary_intro')}</p>
              </div>
              <Button variant="action" onClick={openCreateDialog} data-testid="third-party-accounts__create-btn">
                <Plus className="w-4 h-4" />
                {t('create')}
              </Button>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <ShieldCheck className="h-3.5 w-3.5 text-accent" />
                  {t('summary_active_label')}
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">{activeItems.length}</div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_active_hint')}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <PlugZap className="h-3.5 w-3.5 text-accent" />
                  {t('summary_oauth_label')}
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">{oauthItems.length}</div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_oauth_hint')}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-surface-high p-4">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-secondary">
                  <Link2 className="h-3.5 w-3.5 text-accent" />
                  {t('summary_provider_label')}
                </div>
                <div className="mt-3 text-2xl font-semibold text-foreground">{providerCount}</div>
                <p className="mt-1 text-sm text-tertiary">{t('summary_provider_hint')}</p>
              </div>
            </div>
          </section>

          <FeishuOAuthCard
            authConfigured={feishuConfig?.auth_configured}
            callbackUri={feishuConfig?.callback_uri}
            interactiveLoginRequired={feishuConfig?.interactive_login_required}
            connectPending={startFeishuMutation.isPending}
            onConnect={() => startFeishuMutation.mutate()}
            t={t}
          />

          <section className="rounded-2xl border border-border bg-surface shadow-sm shadow-black/10">
            <div className="border-b border-border px-5 py-4 md:px-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-secondary">
                    {t('list_title')}
                  </h2>
                  <p className="mt-1 text-sm text-tertiary">{t('list_description')}</p>
                </div>
                <div className="rounded-full border border-border/70 bg-surface-high px-3 py-1 text-xs font-medium text-secondary">
                  {t('summary_total_label', { count: String(items.length) })}
                </div>
              </div>
            </div>
            <div className="px-5 py-5 md:px-6">
              {isLoading ? (
                <div className="py-12 text-sm text-tertiary">{commonT('loading')}</div>
              ) : items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-surface-high/70 px-6 py-16 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-dashed border-subtle text-tertiary">
                    <Plus className="w-5 h-5" />
                  </div>
                  <p className="mb-2 text-foreground font-medium">{t('empty_title')}</p>
                  <p className="mx-auto mb-5 max-w-xl text-sm leading-6 text-tertiary">{t('empty_description')}</p>
                  <Button variant="action" onClick={openCreateDialog}>
                    <Plus className="w-4 h-4" />
                    {t('create')}
                  </Button>
                </div>
              ) : (
                <ThirdPartyAccountsTable
                  items={items}
                  onDelete={setDeleteId}
                  onEdit={openEditDialog}
                  onRefresh={handleRefresh}
                  t={t}
                />
              )}
            </div>
          </section>
        </div>

        <Dialog open={createOpen} onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetForm();
        }}>
          <DialogContent className="sm:max-w-[760px]" data-testid="third-party-accounts__dialog">
            <DialogHeader className="space-y-3">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                <Link2 className="h-3.5 w-3.5" />
                External Access
              </div>
              <DialogTitle>{editing ? t('edit_title') : t('create_title')}</DialogTitle>
              <DialogDescription>{t('dialog_description')}</DialogDescription>
            </DialogHeader>

            <div className="rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(124,160,255,0.08),rgba(124,160,255,0.02))] p-4">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">
                    {editing ? t('edit_title') : t('create_title')}
                  </p>
                  <p className="text-sm leading-6 text-secondary">{t('dialog_description')}</p>
                </div>
              </div>
            </div>

            <ConnectionFormFields
              createEmptyField={createEmptyField}
              customDomain={customDomain}
              displayName={displayName}
              editing={Boolean(editing)}
              fields={fields}
              gitHost={gitHost}
              githubApiBaseUrl={githubApiBaseUrl}
              githubToken={githubToken}
              jiraApiToken={jiraApiToken}
              jiraBaseUrl={jiraBaseUrl}
              kind={kind}
              note={note}
              provider={provider}
              sshPrivateKey={sshPrivateKey}
              sshPublicKey={sshPublicKey}
              t={t}
              onCustomDomainChange={setCustomDomain}
              onDisplayNameChange={setDisplayName}
              onFieldsChange={setFields}
              onGitHostChange={setGitHost}
              onGithubApiBaseUrlChange={setGithubApiBaseUrl}
              onGithubTokenChange={setGithubToken}
              onJiraApiTokenChange={setJiraApiToken}
              onJiraBaseUrlChange={setJiraBaseUrl}
              onKindChange={setKind}
              onNoteChange={setNote}
              onProviderChange={setProvider}
              onSshPrivateKeyChange={setSshPrivateKey}
              onSshPublicKeyChange={setSshPublicKey}
            />

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
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setFeishuCallbackUrl(event.target.value)}
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
