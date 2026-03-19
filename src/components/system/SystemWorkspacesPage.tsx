'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Filter, Plus, Search, Settings2 } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SystemLogoutButton } from './SystemLogoutButton';
import { WorkspaceCard } from './system-workspaces/WorkspaceCard';
import { WorkspaceEditorPanel } from './system-workspaces/WorkspaceEditorPanel';
import { useSystemWorkspaces } from './system-workspaces/useSystemWorkspaces';

type WorkspaceListFilter = 'all' | 'attention' | 'ready' | 'draft' | 'disabled' | 'failed';

export function SystemWorkspacesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listFilter, setListFilter] = useState<WorkspaceListFilter>('all');
  const requestedWorkspaceId = searchParams.get('workspace');
  const {
    workspaces,
    filteredWorkspaces,
    isLoading,
    isError,
    isSubmitting,
    activeAction,
    searchQuery,
    saveError,
    saveNotice,
    editorState,
    adminSearchResults,
    adminSearchLoading,
    adminSearchError,
    idpVerificationNotice,
    setSearchQuery,
    loadWorkspaces,
    selectWorkspace,
    updateDraft,
    verifyIdentityProvider,
    submit,
    publish,
    disable,
    remove,
  } = useSystemWorkspaces({ t });

  const attentionCount = useMemo(
    () => workspaces.filter((workspace) => (
      workspace.provisioning_status === 'failed'
      || workspace.provisioning_status === 'provisioning'
      || workspace.provisioning_status === 'disabled'
      || workspace.workspace_admin_binding_required
      || !workspace.workspace_admin_user_id
    )).length,
    [workspaces],
  );

  const readyCount = useMemo(
    () => workspaces.filter((workspace) => workspace.provisioning_status === 'ready').length,
    [workspaces],
  );

  const listedWorkspaces = useMemo(() => {
    if (listFilter === 'all') return filteredWorkspaces;
    if (listFilter === 'attention') {
      return filteredWorkspaces.filter((workspace) => (
        workspace.provisioning_status === 'failed'
        || workspace.provisioning_status === 'provisioning'
        || workspace.provisioning_status === 'disabled'
        || workspace.workspace_admin_binding_required
        || !workspace.workspace_admin_user_id
      ));
    }
    return filteredWorkspaces.filter((workspace) => workspace.provisioning_status === listFilter);
  }, [filteredWorkspaces, listFilter]);

  useEffect(() => {
    if (workspaces.length === 0) return;
    if (requestedWorkspaceId) {
      const requested = workspaces.find((workspace) => workspace.id === requestedWorkspaceId);
      if (requested && editorState.selectedWorkspaceId !== requestedWorkspaceId) {
        selectWorkspace(requested);
        return;
      }
    }
    if (!editorState.selectedWorkspaceId) {
      selectWorkspace(workspaces[0]);
      return;
    }
    if (!workspaces.some((workspace) => workspace.id === editorState.selectedWorkspaceId)) {
      selectWorkspace(workspaces[0]);
    }
  }, [editorState.selectedWorkspaceId, requestedWorkspaceId, selectWorkspace, workspaces]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-[1500px] space-y-5">
            <header className="rounded-[30px] border border-subtle bg-surface/95 p-6 shadow-[0_24px_56px_rgba(0,0,0,0.2)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-3xl space-y-2">
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('eyebrow')}</p>
                  <h1 className="text-2xl font-semibold text-foreground" data-testid="system-workspaces__heading">
                    {t('workspaces_title')}
                  </h1>
                  <p className="text-sm leading-6 text-secondary">{t('workspaces_subtitle')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/${locale}/system/workspaces/new`}>
                    <Button type="button" data-testid="system-workspaces__new-workspace">
                      <Plus className="mr-2 h-4 w-4" />
                      {t('new_workspace')}
                    </Button>
                  </Link>
                  <Link href={`/${locale}/system/info`}>
                    <Button type="button" variant="outline" data-testid="system-workspaces__open-info">
                      {t('open_system_info')}
                    </Button>
                  </Link>
                  <SystemLogoutButton />
                </div>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-secondary">
                <span>{t('workspaces_summary_total_inline', { count: String(workspaces.length) })}</span>
                <span>{t('workspaces_attention_summary_inline', { count: String(attentionCount) })}</span>
                <span>{t('workspaces_ready_summary_inline', { count: String(readyCount) })}</span>
              </div>
            </header>

            <section className="grid gap-4 xl:grid-cols-[minmax(360px,0.78fr)_minmax(560px,1.22fr)]">
              <div
                className="space-y-4 rounded-[28px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
                data-testid="system-workspaces__list"
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_directory_label')}</p>
                      <p className="text-xl font-semibold text-foreground">{t('workspace_directory_title')}</p>
                      <p className="text-sm text-tertiary">{t('workspace_directory_description')}</p>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-subtle bg-background/70 px-3 py-2 text-xs text-tertiary">
                      <Filter className="h-3.5 w-3.5" />
                      {t('workspaces_filtered_summary', { count: String(listedWorkspaces.length) })}
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('search_placeholder')}
                      className="h-11 w-full rounded-2xl border border-subtle bg-surface-high pl-10 pr-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="system-workspaces__search"
                    />
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['all', t('workspace_filter_all')],
                        ['attention', t('workspace_filter_attention')],
                        ['ready', t('workspace_filter_ready')],
                        ['draft', t('workspace_filter_draft')],
                        ['failed', t('workspace_filter_failed')],
                        ['disabled', t('workspace_filter_disabled')],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setListFilter(value)}
                        className={[
                          'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          listFilter === value
                            ? 'border-accent/40 bg-accent/10 text-accent'
                            : 'border-subtle bg-background text-tertiary hover:text-secondary',
                        ].join(' ')}
                        data-testid={`system-workspaces__filter--${value}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {isLoading ? (
                  <p className="text-sm text-tertiary" data-testid="system-workspaces__loading">{t('loading')}</p>
                ) : isError ? (
                  <div className="space-y-3 rounded-[20px] border border-warning/30 bg-bg-base/20 p-4" data-testid="system-workspaces__error">
                    <p className="text-sm font-medium text-foreground">{t('load_error_title')}</p>
                    <p className="text-sm text-tertiary">{t('load_error_description')}</p>
                    <Button type="button" variant="outline" onClick={() => void loadWorkspaces()} data-testid="system-workspaces__retry">
                      {t('retry')}
                    </Button>
                  </div>
                ) : listedWorkspaces.length === 0 ? (
                  <div className="rounded-[20px] border border-dashed border-subtle bg-bg-base/20 p-5" data-testid="system-workspaces__empty">
                    <p className="text-sm text-tertiary">{t('empty')}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {listedWorkspaces.map((workspace) => (
                      <WorkspaceCard
                        key={workspace.id}
                        locale={locale}
                        t={t}
                        workspace={workspace}
                        selected={editorState.selectedWorkspaceId === workspace.id}
                        onSelect={selectWorkspace}
                      />
                    ))}
                  </div>
                )}
              </div>

              {editorState.selectedWorkspace ? (
                <WorkspaceEditorPanel
                  locale={locale}
                  t={t}
                  state={editorState}
                  isSubmitting={isSubmitting}
                  activeAction={activeAction}
                  saveError={saveError}
                  saveNotice={saveNotice}
                  adminSearchResults={adminSearchResults}
                  adminSearchLoading={adminSearchLoading}
                  adminSearchError={adminSearchError}
                  idpVerificationNotice={idpVerificationNotice}
                  onDraftChange={updateDraft}
                  onVerifyIdp={() => void verifyIdentityProvider()}
                  onSubmit={() => void submit()}
                  onPublish={() => void publish()}
                  onDisable={() => void disable()}
                  onDelete={() => setDeleteDialogOpen(true)}
                />
              ) : (
                <aside
                  className="flex min-h-[420px] flex-col justify-between rounded-[28px] border border-border bg-surface/95 p-6 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
                  data-testid="system-workspaces__editor-empty"
                >
                  <div className="space-y-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-background text-icon-default">
                      <Settings2 className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_detail_label')}</p>
                      <h2 className="text-2xl font-semibold text-foreground">{t('workspace_editor_empty_title')}</h2>
                      <p className="max-w-xl text-sm leading-6 text-secondary">{t('workspace_editor_empty_body')}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/${locale}/system/workspaces/new`}>
                      <Button type="button">{t('new_workspace')}</Button>
                    </Link>
                  </div>
                </aside>
              )}
            </section>
          </div>
        </div>
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent data-testid="system-workspaces__delete-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>{t('delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>{t('delete_confirm')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="system-workspaces__delete-cancel">{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => void remove()}
                data-testid="system-workspaces__delete-confirm"
              >
                {t('delete_action')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageLayout>
    </PageState>
  );
}
