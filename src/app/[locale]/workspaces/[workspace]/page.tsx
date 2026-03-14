'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FolderKanban, Plus, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';

export default function WorkspaceHomePage() {
  const params = useParams();
  const t = useTranslations('workspace');
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const canCreateProjects = useHasWorkspacePermission('workspace:project:create');
  const canManageWorkspaceGovernance = useHasWorkspacePermission('workspace:governance:update');
  useSyncAuthFromUrl();

  const { data: workspace, isFetched: isWorkspaceFetched } = useWorkspace(workspaceId ?? '');

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('overview_error_title')}</h2>
          <p className="text-sm text-tertiary">{t('overview_error_description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadWorkspace) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('workspace_home_denied_title')}</h2>
          <p className="text-sm text-tertiary">{t('workspace_home_denied_description')}</p>
        </div>
      </PageState>
    );
  }

  if (isWorkspaceFetched && !workspace) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('workspace_home_unavailable_title')}</h2>
          <p className="text-sm text-tertiary">{t('workspace_home_unavailable_description')}</p>
        </div>
      </PageState>
    );
  }

  const workspaceName = workspace?.name ?? workspaceId;
  const workspaceBasePath = `/${locale}/workspaces/${workspaceId}`;

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 md:px-6 md:py-8">
            <section
              className="rounded-[24px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.22)] space-y-6 md:p-8"
              data-testid="workspace-home__page"
            >
              <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('workspace_home_eyebrow')}
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl" data-testid="workspace-home__heading">
                      {workspaceName}
                    </h1>
                    <p className="max-w-2xl text-sm text-secondary md:text-[15px]">
                      {t('workspace_home_description')}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href={`${workspaceBasePath}/projects`}
                    className={cn(buttonVariants({ variant: 'primary', size: 'lg' }), 'justify-start px-5')}
                    data-testid="workspace-home__open-projects"
                  >
                    <FolderKanban className="h-4 w-4" />
                    {t('workspace_open_projects')}
                  </Link>
                  {canCreateProjects ? (
                    <Link
                      href={`${workspaceBasePath}/projects?create=1`}
                      className={cn(buttonVariants({ variant: 'action', size: 'lg' }), 'justify-start px-5')}
                      data-testid="workspace-home__create-project"
                    >
                      <Plus className="h-4 w-4" />
                      {t('workspace_create_project')}
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="rounded-[18px] border border-white/6 bg-black/15 p-5">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_id_label')}</div>
                  <div className="mt-2 text-lg font-semibold text-foreground" data-testid="workspace-home__workspace-id">
                    {workspaceId}
                  </div>
                  <p className="mt-2 text-sm text-secondary">
                    {t('workspace_home_projects_title')}
                  </p>
                </div>
                {canManageWorkspaceGovernance ? (
                  <section
                    className="rounded-[18px] border border-white/6 bg-black/15 p-5 space-y-3"
                    data-testid="workspace-home__admin-section"
                  >
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold text-foreground">{t('workspace_home_admin_title')}</h2>
                      <p className="text-sm text-secondary">{t('workspace_home_open_settings')}</p>
                    </div>
                    <Link
                      href={`${workspaceBasePath}/settings`}
                      className={cn(buttonVariants({ variant: 'outline' }), 'justify-start')}
                      data-testid="workspace-home__open-settings"
                    >
                      <SettingsIcon className="mr-2 h-4 w-4" />
                      {t('workspace_home_open_settings')}
                    </Link>
                  </section>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <section
                  className="rounded-[18px] border border-white/6 bg-black/15 p-5 space-y-4"
                  data-testid="workspace-home__projects-section"
                >
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-foreground">{t('workspace_home_projects_title')}</h2>
                    <p className="text-sm text-secondary">{t('workspace_open_projects')}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_open_projects')}</div>
                      <div className="mt-2 text-sm text-primary">{workspaceName}</div>
                    </div>
                    <div className="rounded-2xl border border-white/6 bg-white/[0.03] p-4">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-tertiary">{t('workspace_create_project')}</div>
                      <div className="mt-2 text-sm text-primary">
                        {canCreateProjects ? t('workspace_create_project') : t('workspace_home_admin_title')}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </section>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
