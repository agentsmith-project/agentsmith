'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Building2, CheckCircle2, Filter, Search } from 'lucide-react';
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
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [listFilter, setListFilter] = useState<WorkspaceListFilter>('all');
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
    resetDraft,
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

  const selectedWorkspaceId = editorState.selectedWorkspaceId;

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
                  <Link href={`/${locale}/system/info`}>
                    <Button type="button" variant="outline" data-testid="system-workspaces__open-info">
                      {t('open_system_info')}
                    </Button>
                  </Link>
                  <SystemLogoutButton />
                  </div>
                </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <SummaryTile
                  icon={<Building2 className="h-4 w-4" />}
                  label={t('workspace_list_label')}
                  value={String(workspaces.length)}
                  description={t('workspaces_summary_total')}
                />
                <SummaryTile
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label={t('workspaces_attention_summary_label')}
                  value={String(attentionCount)}
                  description={t('workspaces_attention_summary_body')}
                  tone={attentionCount > 0 ? 'warning' : 'neutral'}
                />
                <SummaryTile
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label={t('workspaces_ready_summary_label')}
                  value={String(readyCount)}
                  description={t('workspaces_ready_summary_body')}
                  tone="success"
                />
              </div>
            </header>

            <section className="grid gap-4 xl:grid-cols-[minmax(360px,0.86fr)_minmax(520px,1.14fr)]">
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

                  <div>
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
                  <div
                    className="space-y-3 rounded-[20px] border border-warning/30 bg-bg-base/20 p-4"
                    data-testid="system-workspaces__error"
                  >
                    <p className="text-sm font-medium text-foreground">{t('load_error_title')}</p>
                    <p className="text-sm text-tertiary">{t('load_error_description')}</p>
                    <Button type="button" variant="outline" onClick={() => void loadWorkspaces()} data-testid="system-workspaces__retry">
                      {t('retry')}
                    </Button>
                  </div>
                ) : listedWorkspaces.length === 0 ? (
                  <div
                    className="rounded-[20px] border border-dashed border-subtle bg-bg-base/20 p-5"
                    data-testid="system-workspaces__empty"
                  >
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
                        selected={selectedWorkspaceId === workspace.id}
                        onSelect={selectWorkspace}
                      />
                    ))}
                  </div>
                )}
              </div>

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
                onReset={resetDraft}
                onDelete={() => setDeleteDialogOpen(true)}
              />
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

function SummaryTile({
  icon,
  label,
  value,
  description,
  tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  description: string;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  const toneClassName = (
    tone === 'warning'
      ? 'border-warning/30 bg-warning/10'
      : tone === 'success'
        ? 'border-success/30 bg-success/10'
        : 'border-white/6 bg-white/[0.025]'
  );

  return (
    <div className={`rounded-[20px] border px-4 py-3 ${toneClassName}`}>
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-secondary">{description}</p>
    </div>
  );
}
