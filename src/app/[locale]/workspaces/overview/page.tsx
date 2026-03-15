'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Building2, FolderKanban } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { Button } from '@/components/ui/button';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';
import { cn } from '@/lib/utils';

export default function WorkspacesOverviewPage() {
  const params = useParams();
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const t = useTranslations('workspace');
  const {
    data: workspaces,
    isLoading,
    isError,
    refetch,
  } = useWorkspaces({ public: true });
  const [searchQuery, setSearchQuery] = useState('');

  const filteredWorkspaces = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = workspaces ?? [];
    if (!query) {
      return items;
    }
    return items.filter((workspace) => {
      return workspace.name.toLowerCase().includes(query) || workspace.id.toLowerCase().includes(query);
    });
  }, [searchQuery, workspaces]);

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background p-4 md:p-6">
          <div className="mx-auto max-w-6xl space-y-5">
            <header className="rounded-[28px] border border-subtle bg-surface/95 p-6 shadow-[0_22px_50px_rgba(0,0,0,0.18)]">
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('overview_eyebrow')}</p>
                <h1 className="text-2xl font-semibold text-foreground" data-testid="workspace-overview__heading">
                  {t('overview_title')}
                </h1>
                <p className="text-sm leading-6 text-secondary">{t('overview_subtitle')}</p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div
                  className="rounded-[20px] border border-white/6 bg-white/[0.025] px-4 py-3"
                  data-testid="workspace-overview__summary"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                    {t('overview_summary_label')}
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{(workspaces ?? []).length}</p>
                  <p className="mt-1 text-sm text-secondary">{t('overview_summary_value')}</p>
                </div>
                <div className="rounded-[20px] border border-white/6 bg-white/[0.025] px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                    {t('overview_search_placeholder')}
                  </p>
                  <p className="mt-2 text-sm text-secondary">{searchQuery.trim() || t('overview_list_subtitle')}</p>
                </div>
                <div className="rounded-[20px] border border-white/6 bg-white/[0.025] px-4 py-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-tertiary">
                    {t('overview_projects_entry')}
                  </p>
                  <p className="mt-2 text-sm text-secondary">{t('overview_open_workspace')}</p>
                </div>
              </div>
            </header>

            {isLoading ? (
              <div
                className="rounded-[24px] border border-subtle bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
                data-testid="workspace-overview__loading"
              >
                <p className="text-sm text-tertiary">{t('overview_loading')}</p>
              </div>
            ) : isError ? (
              <div
                className="rounded-[24px] border border-warning/30 bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
                data-testid="workspace-overview__error"
              >
                <p className="text-sm font-medium text-foreground">{t('overview_error_title')}</p>
                <p className="mt-1 text-sm text-tertiary">{t('overview_error_description')}</p>
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3"
                  onClick={() => void refetch()}
                  data-testid="workspace-overview__retry"
                >
                  {t('overview_retry')}
                </Button>
              </div>
            ) : (
              <>
                <section
                  className="rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
                  data-testid="workspace-overview__list"
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">{t('overview_list_title')}</h2>
                      <p className="text-sm text-secondary">{t('overview_list_subtitle')}</p>
                    </div>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('overview_search_placeholder')}
                      className="h-10 min-w-[240px] rounded-xl border border-subtle bg-surface-high px-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="workspace-overview__search"
                    />
                  </div>

                  {(workspaces ?? []).length === 0 ? (
                    <div
                      className="rounded-[20px] border border-dashed border-subtle bg-bg-base/20 p-6"
                      data-testid="workspace-overview__empty"
                    >
                      <p className="text-sm font-medium text-foreground">{t('overview_empty_title')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('overview_empty_description')}</p>
                    </div>
                  ) : filteredWorkspaces.length === 0 ? (
                    <div
                      className="rounded-[20px] border border-dashed border-subtle bg-bg-base/20 p-6"
                      data-testid="workspace-overview__empty-filtered"
                    >
                      <p className="text-sm text-tertiary">{t('overview_empty_filtered')}</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {filteredWorkspaces.map((workspace) => (
                        <article
                          key={workspace.id}
                          className="rounded-[22px] border border-subtle bg-bg-base/20 p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)]"
                          data-testid={`workspace-overview__card--${workspace.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-[16px] bg-surface-high text-icon-default">
                              <Building2 className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="truncate text-base font-semibold text-foreground">{workspace.name}</h3>
                              <p className="mt-1 truncate text-sm text-tertiary">{workspace.id}</p>
                              <p className="mt-2 flex items-center gap-1 text-xs text-tertiary">
                                <FolderKanban className="h-3.5 w-3.5" />
                                {t('overview_projects_entry')}
                              </p>
                              <p className="mt-2 text-xs text-tertiary">
                                {t('overview_updated_at', {
                                  value: new Date(workspace.updated_at).toLocaleString(locale),
                                })}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 flex items-center gap-2">
                            <Link
                              href={`/${locale}/workspaces/${workspace.id}/login`}
                              className={cn(
                                'inline-flex h-9 items-center rounded-xl border border-subtle px-3 text-sm font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              data-testid={`workspace-overview__open-workspace--${workspace.id}`}
                            >
                              {t('overview_open_workspace')}
                            </Link>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      </PageLayout>
    </PageState>
  );
}
