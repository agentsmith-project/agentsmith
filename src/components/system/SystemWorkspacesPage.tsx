'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, Database, ShieldCheck } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { SystemLogoutButton } from './SystemLogoutButton';
import { buildWorkspaceTenantPreview } from '@/lib/system-admin/config';
import type { PublicSystemWorkspaceRecord } from '@/lib/system-admin/workspace-registry';

export function SystemWorkspacesPage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');
  const [workspaces, setWorkspaces] = useState<PublicSystemWorkspaceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeAction, setActiveAction] = useState<'create' | 'update' | 'delete' | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftAdmin, setDraftAdmin] = useState('');
  const [draftIdpUrl, setDraftIdpUrl] = useState('');
  const [draftIdpRealm, setDraftIdpRealm] = useState('');
  const [draftIdpClientId, setDraftIdpClientId] = useState('');
  const [draftIdpClientSecret, setDraftIdpClientSecret] = useState('');

  const loadWorkspaces = async () => {
    setIsLoading(true);
    setIsError(false);
    try {
      const response = await fetch('/api/system/workspaces', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error('load_failed');
      }
      const data = (await response.json()) as { items?: PublicSystemWorkspaceRecord[] };
      setWorkspaces(Array.isArray(data.items) ? data.items : []);
    } catch {
      setIsError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = workspaces;
    if (!query) return items;
    return items.filter((workspace) => {
      return workspace.name.toLowerCase().includes(query) || workspace.id.toLowerCase().includes(query);
    });
  }, [searchQuery, workspaces]);

  const preview = useMemo(() => buildWorkspaceTenantPreview(draftName || 'workspace'), [draftName]);

  const resetDraft = () => {
    setSelectedWorkspaceId(null);
    setDraftName('');
    setDraftAdmin('');
    setDraftIdpUrl('');
    setDraftIdpRealm('');
    setDraftIdpClientId('');
    setDraftIdpClientSecret('');
  };

  const handleSelectWorkspace = (workspace: PublicSystemWorkspaceRecord) => {
    setSelectedWorkspaceId(workspace.id);
    setSaveError(null);
    setSaveNotice(null);
    setDraftName(workspace.name);
    setDraftAdmin(workspace.workspace_admin);
    setDraftIdpUrl(workspace.idp.url);
    setDraftIdpRealm(workspace.idp.realm);
    setDraftIdpClientId(workspace.idp.client_id);
    setDraftIdpClientSecret('');
  };

  const handleSubmit = async () => {
    const action: 'create' | 'update' = selectedWorkspaceId ? 'update' : 'create';
    setIsSubmitting(true);
    setActiveAction(action);
    setSaveError(null);
    setSaveNotice(null);
    try {
      const payload = {
        name: draftName,
        workspace_admin: draftAdmin,
        idp_url: draftIdpUrl,
        idp_realm: draftIdpRealm,
        idp_client_id: draftIdpClientId,
        idp_client_secret: draftIdpClientSecret || undefined,
      };
      const endpoint = selectedWorkspaceId
        ? `/api/system/workspaces/${selectedWorkspaceId}`
        : '/api/system/workspaces';
      const method = selectedWorkspaceId ? 'PATCH' : 'POST';
      const response = await fetch(endpoint, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => null)) as { error_message?: string } | null;
      if (!response.ok) {
        setSaveError(data?.error_message || 'invalid_system_workspace_payload');
        return;
      }
      await loadWorkspaces();
      if (!selectedWorkspaceId) {
        resetDraft();
      } else {
        setDraftIdpClientSecret('');
      }
      setSaveNotice(action === 'update' ? t('update_success') : t('create_success'));
    } finally {
      setIsSubmitting(false);
      setActiveAction(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedWorkspaceId) return;
    const confirmed = window.confirm(t('delete_confirm'));
    if (!confirmed) return;

    setIsSubmitting(true);
    setActiveAction('delete');
    setSaveError(null);
    setSaveNotice(null);
    try {
      const response = await fetch(`/api/system/workspaces/${selectedWorkspaceId}`, {
        method: 'DELETE',
      });
      const data = (await response.json().catch(() => null)) as { error_message?: string } | null;
      if (!response.ok) {
        setSaveError(data?.error_message || 'workspace_delete_failed');
        return;
      }
      await loadWorkspaces();
      resetDraft();
      setSaveNotice(t('delete_success'));
    } finally {
      setIsSubmitting(false);
      setActiveAction(null);
    }
  };

  const canSubmit =
    draftName.trim() &&
    draftAdmin.trim() &&
    draftIdpUrl.trim() &&
    draftIdpRealm.trim() &&
    draftIdpClientId.trim();
  const isEditingWorkspace = Boolean(selectedWorkspaceId);
  const primaryActionLabel = isSubmitting
    ? activeAction === 'update'
      ? t('updating')
      : activeAction === 'delete'
        ? t('deleting')
        : t('creating')
    : selectedWorkspaceId
      ? t('update_workspace')
      : t('create_workspace');
  const statusToneClass = saveError ? 'border-error/30 text-error' : saveNotice ? 'border-success/30 text-foreground' : 'border-subtle text-tertiary';
  const statusPrefix = saveError
    ? t('status_error')
    : saveNotice
      ? t('status_success')
      : t('status_idle');

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-7xl space-y-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('eyebrow')}</p>
                <h1 className="text-2xl font-semibold text-foreground" data-testid="system-workspaces__heading">
                  {t('workspaces_title')}
                </h1>
                <p className="text-sm text-tertiary">{t('workspaces_subtitle')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link href={`/${locale}/system/info`}>
                  <Button type="button" variant="outline" data-testid="system-workspaces__open-info">
                    {t('open_system_info')}
                  </Button>
                </Link>
                <SystemLogoutButton />
              </div>
            </header>

            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4 rounded-md border border-border bg-surface p-4" data-testid="system-workspaces__list">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_list_label')}</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">{workspaces.length}</p>
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('search_placeholder')}
                    className="h-9 min-w-[260px] rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="system-workspaces__search"
                  />
                </div>

                {isLoading ? (
                  <p className="text-sm text-tertiary" data-testid="system-workspaces__loading">{t('loading')}</p>
                ) : isError ? (
                  <div className="space-y-3 rounded-sm border border-warning/30 bg-bg-base/20 p-4" data-testid="system-workspaces__error">
                    <p className="text-sm font-medium text-foreground">{t('load_error_title')}</p>
                    <p className="text-sm text-tertiary">{t('load_error_description')}</p>
                    <Button type="button" variant="outline" onClick={() => void loadWorkspaces()} data-testid="system-workspaces__retry">
                      {t('retry')}
                    </Button>
                  </div>
                ) : filteredWorkspaces.length === 0 ? (
                  <div className="rounded-sm border border-dashed border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__empty">
                    <p className="text-sm text-tertiary">{t('empty')}</p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredWorkspaces.map((workspace) => (
                      <article
                        key={workspace.id}
                        className="rounded-sm border border-subtle bg-bg-base/20 p-4"
                        data-testid={`system-workspaces__card--${workspace.id}`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface-high text-icon-default">
                            <Building2 className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h2 className="truncate text-base font-semibold text-foreground">{workspace.name}</h2>
                            <p className="mt-1 truncate text-sm text-tertiary">{workspace.id}</p>
                            <div className="mt-3 rounded-sm border border-subtle bg-surface px-3 py-2">
                              <p className="text-[11px] uppercase tracking-[0.08em] text-tertiary">
                                {t('workspace_admin_card_label')}
                              </p>
                              <p className="mt-1 truncate text-sm font-medium text-foreground">
                                {workspace.workspace_admin}
                              </p>
                            </div>
                            <p className="mt-2 text-xs text-tertiary">
                              {t('updated_at', { value: new Date(workspace.updated_at).toLocaleString(locale) })}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => handleSelectWorkspace(workspace)}
                            data-testid={`system-workspaces__configure--${workspace.id}`}
                          >
                            {t('configure_workspace')}
                          </Button>
                          <Link href={`/${locale}/workspaces/${workspace.id}`}>
                            <Button type="button" variant="outline" data-testid={`system-workspaces__open-projects--${workspace.id}`}>
                              {t('open_workspace')}
                            </Button>
                          </Link>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <aside className="space-y-4 rounded-md border border-border bg-surface p-4" data-testid="system-workspaces__create">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('create_label')}</p>
                  <h2 className="text-lg font-semibold text-foreground">{t('create_title')}</h2>
                  <p className="text-sm text-tertiary">{t('create_subtitle')}</p>
                </div>

                <div className="rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__mode">
                  <p className="text-xs uppercase tracking-[0.08em] text-tertiary">
                    {isEditingWorkspace ? t('edit_mode_label') : t('create_mode_label')}
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    {isEditingWorkspace
                      ? t('editing_workspace', { workspaceId: selectedWorkspaceId ?? '' })
                      : t('creating_workspace')}
                  </p>
                </div>

                <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__basics">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_basics_label')}</p>
                    <p className="text-sm font-medium text-foreground">{t('workspace_basics_title')}</p>
                  </div>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">{t('workspace_name')}</span>
                    <input
                      type="text"
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      placeholder={t('workspace_name_placeholder')}
                      className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="system-workspaces__draft-name"
                    />
                  </label>

                </div>

                <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__admin">
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.08em] text-tertiary">{t('workspace_admin_label')}</p>
                    <p className="text-sm font-medium text-foreground">{t('workspace_admin_title')}</p>
                    <p className="text-sm text-tertiary">{t('workspace_admin_description')}</p>
                  </div>
                  <label className="block space-y-2">
                    <span className="text-sm font-medium text-foreground">{t('workspace_admin')}</span>
                    <input
                      type="text"
                      value={draftAdmin}
                      onChange={(event) => setDraftAdmin(event.target.value)}
                      placeholder={t('workspace_admin_placeholder')}
                      className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="system-workspaces__draft-admin"
                    />
                  </label>
                </div>

                <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__idp">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <ShieldCheck className="h-4 w-4" />
                    {t('idp_title')}
                  </div>
                  <input
                    type="text"
                    value={draftIdpUrl}
                    onChange={(event) => setDraftIdpUrl(event.target.value)}
                    placeholder={t('idp_url_placeholder')}
                    className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="system-workspaces__draft-idp-url"
                  />
                  <input
                    type="text"
                    value={draftIdpRealm}
                    onChange={(event) => setDraftIdpRealm(event.target.value)}
                    placeholder={t('idp_realm_placeholder')}
                    className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="system-workspaces__draft-idp-realm"
                  />
                  <input
                    type="text"
                    value={draftIdpClientId}
                    onChange={(event) => setDraftIdpClientId(event.target.value)}
                    placeholder={t('idp_client_id_placeholder')}
                    className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="system-workspaces__draft-idp-client-id"
                  />
                  <input
                    type="password"
                    value={draftIdpClientSecret}
                    onChange={(event) => setDraftIdpClientSecret(event.target.value)}
                    placeholder={t('idp_client_secret_placeholder')}
                    className="h-9 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="system-workspaces__draft-idp-client-secret"
                  />
                </div>

                <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4" data-testid="system-workspaces__preview">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Database className="h-4 w-4" />
                    {t('preview_title')}
                  </div>
                  <PreviewRow label={t('preview_workspace_id')} value={preview.workspace_id} />
                  <PreviewRow label={t('preview_substrate')} value={preview.substrate_label} />
                  <PreviewRow label={t('preview_database')} value={preview.database_name} />
                  <PreviewRow label={t('preview_collection_prefix')} value={preview.collection_prefix} />
                  <PreviewRow label={t('preview_key_prefix')} value={preview.key_prefix} />
                </div>

                <div
                  className={`rounded-sm border border-dashed bg-bg-base/20 p-4 text-sm ${statusToneClass}`}
                  data-testid="system-workspaces__notice"
                >
                  <p className="mb-1 text-[11px] uppercase tracking-[0.08em]" data-testid="system-workspaces__notice-status">
                    {statusPrefix}
                  </p>
                  {saveError ? (
                    <p className="text-error" data-testid="system-workspaces__save-error">{saveError}</p>
                  ) : saveNotice ? (
                    <p className="text-foreground" data-testid="system-workspaces__save-notice">{saveNotice}</p>
                  ) : (
                    t('create_notice')
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit || isSubmitting}
                    data-testid="system-workspaces__save"
                  >
                    {primaryActionLabel}
                  </Button>
                  {selectedWorkspaceId ? (
                    <Button type="button" variant="outline" onClick={resetDraft} data-testid="system-workspaces__reset">
                      {t('new_workspace')}
                    </Button>
                  ) : null}
                  {selectedWorkspaceId ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void handleDelete()}
                      disabled={isSubmitting}
                      data-testid="system-workspaces__delete"
                    >
                      {isSubmitting && activeAction === 'delete' ? t('deleting') : t('delete_workspace')}
                    </Button>
                  ) : null}
                </div>
              </aside>
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-tertiary">{label}</span>
      <code className="break-all text-right text-foreground">{value}</code>
    </div>
  );
}
