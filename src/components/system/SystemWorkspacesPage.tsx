'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { SystemLogoutButton } from './SystemLogoutButton';
import { WorkspaceCard } from './system-workspaces/WorkspaceCard';
import { WorkspaceEditorPanel } from './system-workspaces/WorkspaceEditorPanel';
import { useSystemWorkspaces } from './system-workspaces/useSystemWorkspaces';

export function SystemWorkspacesPage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('system');
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
    preview,
    editorState,
    adminSearchResults,
    adminSearchLoading,
    adminSearchError,
    setSearchQuery,
    loadWorkspaces,
    resetDraft,
    selectWorkspace,
    updateDraft,
    submit,
    publish,
    disable,
    remove,
  } = useSystemWorkspaces({ t });

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-7xl space-y-5">
            <header className="rounded-[28px] border border-subtle bg-surface/95 p-6 shadow-[0_22px_50px_rgba(0,0,0,0.18)]">
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
                <div className="rounded-[20px] border border-white/6 bg-white/[0.025] px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                    {t('workspace_list_label')}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{workspaces.length}</p>
                </div>
                <div className="rounded-[20px] border border-white/6 bg-white/[0.025] px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                    {t('search_placeholder')}
                  </p>
                  <p className="mt-2 text-sm text-secondary">{searchQuery.trim() || t('workspaces_subtitle')}</p>
                </div>
                <div className="rounded-[20px] border border-white/6 bg-white/[0.025] px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                    {t('open_system_info')}
                  </p>
                  <p className="mt-2 text-sm text-secondary">{t('workspaces_title')}</p>
                </div>
              </div>
            </header>

            <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <div
                className="space-y-4 rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
                data-testid="system-workspaces__list"
              >
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
                    className="h-10 min-w-[260px] rounded-xl border border-subtle bg-surface-high px-3 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="system-workspaces__search"
                  />
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
                ) : filteredWorkspaces.length === 0 ? (
                  <div
                    className="rounded-[20px] border border-dashed border-subtle bg-bg-base/20 p-5"
                    data-testid="system-workspaces__empty"
                  >
                    <p className="text-sm text-tertiary">{t('empty')}</p>
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {filteredWorkspaces.map((workspace) => (
                      <WorkspaceCard
                        key={workspace.id}
                        locale={locale}
                        t={t}
                        workspace={workspace}
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
                preview={preview}
                isSubmitting={isSubmitting}
                activeAction={activeAction}
                saveError={saveError}
                saveNotice={saveNotice}
                adminSearchResults={adminSearchResults}
                adminSearchLoading={adminSearchLoading}
                adminSearchError={adminSearchError}
                onDraftChange={updateDraft}
                onSubmit={() => void submit()}
                onPublish={() => void publish()}
                onDisable={() => void disable()}
                onReset={resetDraft}
                onDelete={() => void remove()}
              />
            </section>
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
