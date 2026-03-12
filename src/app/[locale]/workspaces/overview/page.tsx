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
  } = useWorkspaces();
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
            <header className="space-y-2">
              <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('overview_eyebrow')}</p>
              <h1 className="text-2xl font-semibold text-foreground" data-testid="workspace-overview__heading">
                {t('overview_title')}
              </h1>
              <p className="text-sm text-tertiary">{t('overview_subtitle')}</p>
            </header>

            {isLoading ? (
              <div className="rounded-md border border-subtle bg-surface p-4" data-testid="workspace-overview__loading">
                <p className="text-sm text-tertiary">{t('overview_loading')}</p>
              </div>
            ) : isError ? (
              <div className="rounded-md border border-warning/30 bg-surface p-4" data-testid="workspace-overview__error">
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
                  className="rounded-md border border-border bg-surface p-4"
                  data-testid="workspace-overview__summary"
                >
                  <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('overview_summary_label')}</p>
                  <p className="mt-2 text-2xl font-semibold text-foreground">{(workspaces ?? []).length}</p>
                  <p className="mt-1 text-sm text-tertiary">{t('overview_summary_value')}</p>
                </section>

                <section className="rounded-md border border-border bg-surface p-4" data-testid="workspace-overview__list">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-foreground">{t('overview_list_title')}</h2>
                      <p className="text-sm text-tertiary">{t('overview_list_subtitle')}</p>
                    </div>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder={t('overview_search_placeholder')}
                      className="h-9 min-w-[240px] rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                      data-testid="workspace-overview__search"
                    />
                  </div>

                  {(workspaces ?? []).length === 0 ? (
                    <div className="rounded-sm border border-dashed border-subtle bg-bg-base/20 p-6" data-testid="workspace-overview__empty">
                      <p className="text-sm font-medium text-foreground">{t('overview_empty_title')}</p>
                      <p className="mt-1 text-sm text-tertiary">{t('overview_empty_description')}</p>
                    </div>
                  ) : filteredWorkspaces.length === 0 ? (
                    <div className="rounded-sm border border-dashed border-subtle bg-bg-base/20 p-6" data-testid="workspace-overview__empty-filtered">
                      <p className="text-sm text-tertiary">{t('overview_empty_filtered')}</p>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {filteredWorkspaces.map((workspace) => (
                        <article
                          key={workspace.id}
                          className="rounded-md border border-subtle bg-bg-base/20 p-4"
                          data-testid={`workspace-overview__card--${workspace.id}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-sm bg-surface-high text-icon-default">
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
                              href={`/${locale}/workspaces/${workspace.id}/projects`}
                              className={cn(
                                'inline-flex h-9 items-center rounded-sm border border-subtle px-3 text-sm font-medium text-foreground transition-colors',
                                'hover:bg-hover',
                              )}
                              data-testid={`workspace-overview__open-projects--${workspace.id}`}
                            >
                              {t('overview_open_projects')}
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
