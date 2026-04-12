'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Building2, FolderKanban, Search } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspaces } from '@/lib/hooks/use-workspaces';

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
      <PageLayout
        header={(
          <div data-testid="workspace-overview__heading">
            <PageHeader
              title={t('overview_title')}
              subtitle={t('overview_subtitle')}
            />
          </div>
        )}
      >
        <div className="space-y-5">
          {isLoading ? (
            <section
              className="pt-2"
              data-testid="workspace-overview__loading"
            >
              <p className="type-body-ui text-secondary">{t('overview_loading')}</p>
            </section>
          ) : isError ? (
            <section
              className="pt-2"
              data-testid="workspace-overview__error"
            >
              <div className="space-y-3">
                <div className="space-y-1">
                  <h2 className="type-title text-foreground">{t('overview_error_title')}</h2>
                  <p className="type-body-ui text-secondary">{t('overview_error_description')}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refetch()}
                  data-testid="workspace-overview__retry"
                >
                  {t('overview_retry')}
                </Button>
              </div>
            </section>
          ) : (
            <section
              className="pt-2"
              data-testid="workspace-overview__list"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div className="space-y-1.5">
                  <p className="type-system-caption text-tertiary">{(workspaces ?? []).length} · {t('overview_summary_label')}</p>
                  <h2 className="type-subheading text-foreground">{t('overview_list_title')}</h2>
                  <p className="type-body-ui text-secondary">{t('overview_list_subtitle')}</p>
                </div>
                <label className="relative block w-full max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-icon-default" />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t('overview_search_placeholder')}
                    className="pl-10"
                    data-testid="workspace-overview__search"
                  />
                </label>
              </div>

              {(workspaces ?? []).length === 0 ? (
                <div
                  className="mt-5 border-t border-dashed border-subtle pt-5"
                  data-testid="workspace-overview__empty"
                >
                  <div className="space-y-1.5">
                    <h3 className="type-title text-foreground">{t('overview_empty_title')}</h3>
                    <p className="type-body-ui text-secondary">{t('overview_empty_description')}</p>
                  </div>
                </div>
              ) : filteredWorkspaces.length === 0 ? (
                <div
                  className="mt-5 border-t border-dashed border-subtle pt-5"
                  data-testid="workspace-overview__empty-filtered"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <p className="type-body-ui text-secondary">{t('overview_empty_filtered')}</p>
                    <Button type="button" variant="outline" onClick={() => setSearchQuery('')}>
                      {t('overview_clear_search')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-5 divide-y divide-subtle border-y border-subtle">
                  {filteredWorkspaces.map((workspace) => (
                    <article
                      key={workspace.id}
                      className="flex flex-col gap-4 py-5 md:flex-row md:items-center md:justify-between"
                      data-testid={`workspace-overview__card--${workspace.id}`}
                    >
                      <div className="min-w-0 space-y-2">
                        <div className="flex items-center gap-3">
                          <Building2 className="h-4.5 w-4.5 text-icon-default" />
                          <h3 className="type-title truncate text-foreground">{workspace.name}</h3>
                          <p className="type-system-caption truncate text-tertiary">{workspace.id}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">
                          <span className="inline-flex items-center gap-1.5">
                            <FolderKanban className="h-3.5 w-3.5 text-icon-default" />
                            {t('overview_projects_entry')}
                          </span>
                          <span className="text-tertiary">
                            {t('overview_updated_at', {
                              value: new Date(workspace.updated_at).toLocaleString(locale),
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 md:pl-6">
                        <Button asChild variant="action">
                          <Link
                            href={`/${locale}/workspaces/${workspace.id}/login`}
                            data-testid={`workspace-overview__open-workspace--${workspace.id}`}
                          >
                            {t('overview_open_workspace')}
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </PageLayout>
    </PageState>
  );
}
