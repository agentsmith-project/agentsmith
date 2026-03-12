'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, Database, ShieldCheck } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { SystemLogoutButton } from './SystemLogoutButton';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { buildWorkspaceTenantPreview } from '@/lib/system-admin/config';

export function SystemWorkspacesPage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');
  const { data: workspaces, isLoading, isError, refetch } = useWorkspaces({ public: true });
  const [searchQuery, setSearchQuery] = useState('');
  const [draftName, setDraftName] = useState('');
  const [draftAdmin, setDraftAdmin] = useState('');
  const [draftIdpUrl, setDraftIdpUrl] = useState('');
  const [draftIdpRealm, setDraftIdpRealm] = useState('');
  const [draftIdpClientId, setDraftIdpClientId] = useState('');

  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = workspaces ?? [];
    if (!query) return items;
    return items.filter((workspace) => {
      return workspace.name.toLowerCase().includes(query) || workspace.id.toLowerCase().includes(query);
    });
  }, [searchQuery, workspaces]);

  const preview = useMemo(() => buildWorkspaceTenantPreview(draftName || 'workspace'), [draftName]);

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
                    <p className="mt-1 text-2xl font-semibold text-foreground">{(workspaces ?? []).length}</p>
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
                    <Button type="button" variant="outline" onClick={() => void refetch()} data-testid="system-workspaces__retry">
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
                            <p className="mt-2 text-xs text-tertiary">
                              {t('updated_at', { value: new Date(workspace.updated_at).toLocaleString(locale) })}
                            </p>
                          </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2">
                          <Link href={`/${locale}/workspaces/${workspace.id}/projects`}>
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

                <div className="space-y-3 rounded-sm border border-subtle bg-bg-base/20 p-4">
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

                <div className="rounded-sm border border-dashed border-subtle bg-bg-base/20 p-4 text-sm text-tertiary" data-testid="system-workspaces__notice">
                  {t('create_notice')}
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
