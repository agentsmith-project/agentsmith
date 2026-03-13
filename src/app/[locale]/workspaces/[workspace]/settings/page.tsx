'use client';

import Link from 'next/link';
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FolderOpen, Plus, Settings as SettingsIcon, Users } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { SectionHeading } from '@/components/ui/section-heading';
import { StatusBadge } from '@/components/ui/status-badge';
import { cn } from '@/lib/utils';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useWorkspace, useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { useProjects } from '@/lib/hooks/use-projects-queries';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { buildProjectAdminSummary } from '@/lib/projects/project-view';
import { useQueryClient } from '@tanstack/react-query';

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const t = useTranslations('settings');
  const tErrors = useTranslations('errors');
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const queryClient = useQueryClient();
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const canManageWorkspaceGovernance = useHasWorkspacePermission('workspace:governance:update');
  useSyncAuthFromUrl();

  const { data: currentWorkspace } = useWorkspace(workspaceId ?? '');
  const { data: members = [] } = useWorkspaceMembers(workspaceId ?? '');
  const { data: projects = [] } = useProjects(workspaceId ?? '');
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [projectCreators, setProjectCreators] = React.useState<Array<{ id: string; user_id: string; name: string; email: string }>>([]);
  const [projectCreatorsDraft, setProjectCreatorsDraft] = React.useState('');
  const [projectCreatorsLoading, setProjectCreatorsLoading] = React.useState(false);
  const [projectCreatorsSaving, setProjectCreatorsSaving] = React.useState(false);

  const memberNameById = React.useMemo(
    () => new Map(members.map((member) => [member.user_id, member.name || member.email || member.user_id])),
    [members],
  );

  const workspace = currentWorkspace || { id: workspaceId, name: workspaceId };
  const workspaceDisplayName: string = workspace.name ?? workspace.id ?? workspaceId ?? '';
  const workspaceDisplayId: string = workspace.id ?? workspaceId ?? '';
  const workspaceBasePath = `/${locale}/workspaces/${workspaceId}`;
  const activeProjects = projects.filter((project) => project.status !== 'archived');

  const handleCreateProjectSuccess = React.useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ['workspaces', workspaceId, 'projects'],
    });
  }, [queryClient, workspaceId]);

  const loadProjectCreators = React.useCallback(async () => {
    if (!workspaceId || !canManageWorkspaceGovernance) return;
    setProjectCreatorsLoading(true);
    try {
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/project-creators`, { cache: 'no-store' });
      const data = (await response.json().catch(() => ({ items: [] }))) as { items?: Array<{ id: string; user_id: string; name: string; email: string }> };
      const items = Array.isArray(data.items) ? data.items : [];
      setProjectCreators(items);
      setProjectCreatorsDraft(items.map((item) => item.user_id || item.email || item.name).join('\n'));
    } finally {
      setProjectCreatorsLoading(false);
    }
  }, [canManageWorkspaceGovernance, workspaceId]);

  React.useEffect(() => {
    void loadProjectCreators();
  }, [loadProjectCreators]);

  const handleSaveProjectCreators = React.useCallback(async () => {
    if (!workspaceId) return;
    setProjectCreatorsSaving(true);
    try {
      const projectCreatorIds = projectCreatorsDraft
        .split('\n')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      const response = await fetch(`/api/v1/workspaces/${workspaceId}/project-creators`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project_creators: projectCreatorIds }),
      });
      if (!response.ok) {
        return;
      }
      await loadProjectCreators();
      await queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] });
    } finally {
      setProjectCreatorsSaving(false);
    }
  }, [loadProjectCreators, projectCreatorsDraft, queryClient, workspaceId]);

  if (!workspaceId) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  if (!canReadWorkspace || !canManageWorkspaceGovernance) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-4 md:px-5 md:py-5 space-y-5">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
                <SettingsIcon className="w-6 h-6 text-icon-default" />
                {t('workspace_title')}
              </h1>
            </div>

            <section className="rounded-xl border border-border bg-surface p-5" data-testid="ws-settings__workspace">
              <SectionHeading
                eyebrow={t('workspace_general')}
                title={workspaceDisplayName}
              />

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_id_label')}</div>
                  <div className="mt-1 text-sm font-medium text-foreground" data-testid="ws-settings__name">{workspaceDisplayId}</div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_projects_count')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{projects.length}</div>
                </div>
                <div className="rounded-lg border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_active_projects_count')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{activeProjects.length}</div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`${workspaceBasePath}/projects`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="ws-settings__open-projects"
                >
                  {t('workspace_open_projects')}
                </Link>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-surface p-5" data-testid="ws-settings__projects">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeading
                  title={t('workspace_projects_title')}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="ws-settings__create-project"
                  onClick={() => setCreateProjectOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('workspace_create_project')}
                </Button>
              </div>

              {projects.length === 0 ? (
                <p className="mt-4 text-sm text-tertiary">{t('workspace_projects_empty')}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="rounded-lg border border-subtle bg-bg-base/20 p-4"
                      data-testid={`ws-settings__project--${project.id}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{project.name}</p>
                            <StatusBadge status={project.status === 'archived' ? 'info' : 'ready'}>
                              {project.status}
                            </StatusBadge>
                          </div>
                          <p className="mt-1 text-xs text-tertiary">
                            {t('workspace_projects_admin_summary')}
                          </p>
                          <p className="mt-1 text-sm text-foreground">
                            {buildProjectAdminSummary(project, memberNameById)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`${workspaceBasePath}/projects/${project.id}/overview`}
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                            data-testid={`ws-settings__project-open-overview--${project.id}`}
                          >
                            <FolderOpen className="mr-2 h-4 w-4" />
                            {t('workspace_open_project')}
                          </Link>
                          <Link
                            href={`${workspaceBasePath}/projects/${project.id}/members`}
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                            data-testid={`ws-settings__project-open-members--${project.id}`}
                          >
                            <Users className="mr-2 h-4 w-4" />
                            {t('workspace_open_project_members')}
                          </Link>
                          <Link
                            href={`${workspaceBasePath}/projects/${project.id}/settings`}
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                            data-testid={`ws-settings__project-open-settings--${project.id}`}
                          >
                            <SettingsIcon className="mr-2 h-4 w-4" />
                            {t('workspace_open_project_settings')}
                          </Link>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border bg-surface p-5" data-testid="ws-settings__project-creators">
              <SectionHeading title={t('workspace_project_creators_title')} />
              <div className="mt-4 space-y-3">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">{t('workspace_project_creators_field')}</span>
                  <textarea
                    value={projectCreatorsDraft}
                    onChange={(event) => setProjectCreatorsDraft(event.target.value)}
                    placeholder={t('workspace_project_creators_placeholder')}
                    className="min-h-[120px] w-full rounded-sm border border-subtle bg-surface px-3 py-2 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="ws-settings__project-creators-input"
                  />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-tertiary" data-testid="ws-settings__project-creators-summary">
                    {projectCreatorsLoading
                      ? t('workspace_project_creators_loading')
                      : t('workspace_project_creators_summary', { count: String(projectCreators.length) })}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveProjectCreators()}
                    disabled={projectCreatorsSaving}
                    data-testid="ws-settings__project-creators-save"
                  >
                    {projectCreatorsSaving ? t('workspace_project_creators_saving') : t('workspace_project_creators_save')}
                  </Button>
                </div>
              </div>
            </section>

            <CreateProjectDialog
              open={createProjectOpen}
              onOpenChange={setCreateProjectOpen}
              workspaceId={workspaceId}
              onSuccess={handleCreateProjectSuccess}
            />
          </main>
        </div>
      </PageLayout>
    </PageState>
  );
}
