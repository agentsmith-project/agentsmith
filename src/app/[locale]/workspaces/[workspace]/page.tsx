'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FolderKanban, Settings as SettingsIcon } from 'lucide-react';
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

  const { data: workspace } = useWorkspace(workspaceId ?? '');

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

  const workspaceName = workspace?.name ?? workspaceId;
  const workspaceBasePath = `/${locale}/workspaces/${workspaceId}`;

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-4 md:px-5 md:py-5">
            <section
              className="rounded-xl border border-border bg-surface p-6 space-y-5"
              data-testid="workspace-home__page"
            >
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-[0.12em] text-tertiary">{t('workspace_home_eyebrow')}</p>
                <h1 className="text-2xl font-semibold text-foreground" data-testid="workspace-home__heading">
                  {workspaceName}
                </h1>
              </div>

              <div className="rounded-lg border border-subtle bg-bg-base/20 p-4">
                <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_id_label')}</div>
                <div className="mt-1 text-sm font-medium text-foreground" data-testid="workspace-home__workspace-id">
                  {workspaceId}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <section
                  className="rounded-lg border border-subtle bg-bg-base/20 p-4 space-y-3"
                  data-testid="workspace-home__projects-section"
                >
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-foreground">{t('workspace_home_projects_title')}</h2>
                  </div>
                  <Link
                    href={`${workspaceBasePath}/projects`}
                    className={cn(buttonVariants({ variant: 'primary' }))}
                    data-testid="workspace-home__open-projects"
                  >
                    <FolderKanban className="mr-2 h-4 w-4" />
                    {t('workspace_open_projects')}
                  </Link>
                  {canCreateProjects ? (
                    <Link
                      href={`${workspaceBasePath}/projects?create=1`}
                      className={cn(buttonVariants({ variant: 'outline' }))}
                      data-testid="workspace-home__create-project"
                    >
                      <FolderKanban className="mr-2 h-4 w-4" />
                      {t('workspace_create_project')}
                    </Link>
                  ) : null}
                </section>

                {canManageWorkspaceGovernance ? (
                  <section
                    className="rounded-lg border border-subtle bg-bg-base/20 p-4 space-y-3"
                    data-testid="workspace-home__admin-section"
                  >
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold text-foreground">{t('workspace_home_admin_title')}</h2>
                    </div>
                    <Link
                      href={`${workspaceBasePath}/settings`}
                      className={cn(buttonVariants({ variant: 'outline' }))}
                      data-testid="workspace-home__open-settings"
                    >
                      <SettingsIcon className="mr-2 h-4 w-4" />
                      {t('workspace_home_open_settings')}
                    </Link>
                  </section>
                ) : null}
              </div>
            </section>
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
