'use client';

import Link from 'next/link';
import * as React from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FolderOpen, Link2, Loader2, Plus, Settings as SettingsIcon, ShieldCheck, Users } from 'lucide-react';
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
import { buildProjectAdminSummary, getWorkspaceSettingsProjectActions } from '@/lib/projects/project-view';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiClient, ProjectAPI, WorkspaceAPI } from '@/lib/api';
import { APIError } from '@/lib/api/errors';
import type { WorkspaceDirectoryUser } from '@/lib/api/types';
import { queryKeys } from '@/lib/query-keys';

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const t = useTranslations('settings');
  const tProjects = useTranslations('projects');
  const tErrors = useTranslations('errors');
  const locale = typeof params?.locale === 'string' ? params.locale : 'en-US';
  const workspaceId = validateWorkspaceParam(params?.workspace);
  const queryClient = useQueryClient();
  const workspaceAPI = React.useMemo(() => new WorkspaceAPI(getApiClient()), []);
  const projectAPI = React.useMemo(() => new ProjectAPI(getApiClient()), []);
  const canReadWorkspace = useHasWorkspacePermission('workspace:read');
  const canManageWorkspaceGovernance = useHasWorkspacePermission('workspace:governance:update');
  useSyncAuthFromUrl();

  const {
    data: currentWorkspace,
    isFetched: isWorkspaceFetched,
  } = useWorkspace(workspaceId ?? '');
  const { data: feishuIntegration } = useQuery({
    queryKey: ['workspace', workspaceId, 'feishu-integration'],
    queryFn: () => workspaceAPI.getFeishuIntegration(workspaceId ?? ''),
    enabled: Boolean(workspaceId && canManageWorkspaceGovernance),
  });
  const { data: members = [] } = useWorkspaceMembers(workspaceId ?? '');
  const {
    data: projects = [],
    isError: isProjectsError,
    error: projectsError,
  } = useProjects(workspaceId ?? '');
  const [createProjectOpen, setCreateProjectOpen] = React.useState(false);
  const [projectCreators, setProjectCreators] = React.useState<Array<{ id: string; user_id: string; name: string | null; email: string }>>([]);
  const [projectCreatorsLoading, setProjectCreatorsLoading] = React.useState(false);
  const [projectCreatorsSaving, setProjectCreatorsSaving] = React.useState(false);
  const [projectCreatorQuery, setProjectCreatorQuery] = React.useState('');
  const [projectCreatorSearchResults, setProjectCreatorSearchResults] = React.useState<WorkspaceDirectoryUser[]>([]);
  const [projectCreatorSearchLoading, setProjectCreatorSearchLoading] = React.useState(false);
  const [projectCreatorSearchError, setProjectCreatorSearchError] = React.useState<string | null>(null);
  const [selectedProjectOwners, setSelectedProjectOwners] = React.useState<Record<string, string>>({});
  const [savingProjectOwnerId, setSavingProjectOwnerId] = React.useState<string | null>(null);
  const previousProjectOwnersRef = React.useRef<Record<string, string>>({});

  const memberNameById = React.useMemo(
    () => new Map(members.map((member) => [member.user_id, member.name || member.email || member.user_id])),
    [members],
  );

  const workspace = currentWorkspace || { id: workspaceId, name: workspaceId };
  const workspaceDisplayName: string = workspace.name ?? workspace.id ?? workspaceId ?? '';
  const workspaceDisplayId: string = workspace.id ?? workspaceId ?? '';
  const workspaceBasePath = `/${locale}/workspaces/${workspaceId}`;
  const activeProjects = projects.filter((project) => project.status !== 'archived');
  const hasLegacyProjectCreatorBindings = React.useMemo(
    () =>
      projectCreators.some((creator) => creator.user_id === creator.email || creator.email.endsWith('@workspace.local')),
    [projectCreators],
  );

  const handleCreateProjectSuccess = React.useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: ['workspaces', workspaceId, 'projects'],
    });
  }, [queryClient, workspaceId]);

  const loadProjectCreators = React.useCallback(async () => {
    if (!workspaceId || !canManageWorkspaceGovernance) return;
    setProjectCreatorsLoading(true);
    try {
      const items = await workspaceAPI.listProjectCreators(workspaceId);
      setProjectCreators(items);
    } finally {
      setProjectCreatorsLoading(false);
    }
  }, [canManageWorkspaceGovernance, workspaceAPI, workspaceId]);

  React.useEffect(() => {
    void loadProjectCreators();
  }, [loadProjectCreators]);

  const handleSaveProjectCreators = React.useCallback(async () => {
    if (!workspaceId) return;
    setProjectCreatorsSaving(true);
    try {
      const projectCreatorIds = projectCreators.map((item) => item.user_id);
      await workspaceAPI.updateProjectCreators(workspaceId, projectCreatorIds);
      await loadProjectCreators();
      await queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'members'] });
    } finally {
      setProjectCreatorsSaving(false);
    }
  }, [loadProjectCreators, projectCreators, queryClient, workspaceAPI, workspaceId]);

  React.useEffect(() => {
    if (!workspaceId || !canManageWorkspaceGovernance || projectCreatorQuery.trim().length < 2) {
      setProjectCreatorSearchResults([]);
      setProjectCreatorSearchError(null);
      return;
    }
    let cancelled = false;
    const timeoutHandle = window.setTimeout(async () => {
      setProjectCreatorSearchLoading(true);
      setProjectCreatorSearchError(null);
      try {
        const items = await workspaceAPI.searchDirectoryUsers(workspaceId, projectCreatorQuery);
        if (!cancelled) {
          setProjectCreatorSearchResults(items);
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof APIError ? error.message : 'keycloak_directory_unavailable';
          setProjectCreatorSearchResults([]);
          setProjectCreatorSearchError(message);
        }
      } finally {
        if (!cancelled) {
          setProjectCreatorSearchLoading(false);
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutHandle);
    };
  }, [canManageWorkspaceGovernance, projectCreatorQuery, workspaceAPI, workspaceId]);

  const handleAddProjectCreator = React.useCallback((user: WorkspaceDirectoryUser) => {
    setProjectCreators((current) => {
      if (current.some((item) => item.user_id === user.user_id)) {
        return current;
      }
      return [
        ...current,
        {
          id: user.user_id,
          user_id: user.user_id,
          name: user.name ?? user.email,
          email: user.email,
        },
      ];
    });
    setProjectCreatorQuery('');
    setProjectCreatorSearchResults([]);
  }, []);

  const handleRemoveProjectCreator = React.useCallback((userId: string) => {
    setProjectCreators((current) => current.filter((item) => item.user_id !== userId));
  }, []);

  React.useEffect(() => {
    const nextProjectOwners = Object.fromEntries(projects.map((project) => [project.id, project.owner_id]));

    setSelectedProjectOwners((current) => {
      const next = { ...current };
      let changed = false;

      for (const project of projects) {
        const previousOwnerId = previousProjectOwnersRef.current[project.id];
        if (!(project.id in next) || previousOwnerId !== project.owner_id) {
          next[project.id] = project.owner_id;
          changed = true;
        }
      }

      for (const projectId of Object.keys(next)) {
        if (!(projectId in nextProjectOwners)) {
          delete next[projectId];
          changed = true;
        }
      }

      previousProjectOwnersRef.current = nextProjectOwners;
      return changed ? next : current;
    });
  }, [projects]);

  const handleProjectOwnerChange = React.useCallback((projectId: string, ownerId: string) => {
    setSelectedProjectOwners((current) => ({
      ...current,
      [projectId]: ownerId,
    }));
  }, []);

  const handleSaveProjectOwner = React.useCallback(async (projectId: string) => {
    if (!workspaceId || !canManageWorkspaceGovernance) return;
    const currentProject = projects.find((project) => project.id === projectId);
    const nextOwnerId = selectedProjectOwners[projectId]?.trim();
    if (!currentProject || !nextOwnerId || nextOwnerId === currentProject.owner_id) return;

    setSavingProjectOwnerId(projectId);
    try {
      await projectAPI.update(workspaceId, projectId, { owner_id: nextOwnerId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'projects'] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'projects', projectId] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectGroups.list(workspaceId, projectId) }),
      ]);
    } finally {
      setSavingProjectOwnerId(null);
    }
  }, [
    canManageWorkspaceGovernance,
    projects,
    queryClient,
    selectedProjectOwners,
    projectAPI,
    workspaceId,
  ]);

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

  const isProjectsNotFound =
    isProjectsError && projectsError instanceof APIError && projectsError.isNotFoundError();

  if ((isWorkspaceFetched && !currentWorkspace) || isProjectsNotFound) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tProjects('workspace_unavailable_title')}</h2>
          <p className="text-sm text-tertiary">{tProjects('workspace_unavailable_description')}</p>
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
            <section className="rounded-[28px] border border-border bg-surface/95 px-5 py-5 shadow-[0_22px_50px_rgba(0,0,0,0.18)] md:px-6">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl space-y-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                    <SettingsIcon className="h-3.5 w-3.5" />
                    {t('workspace_settings_badge')}
                  </div>
                  <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
                      <SettingsIcon className="w-6 h-6 text-icon-default" />
                      {t('workspace_title')}
                    </h1>
                    <p className="mt-1 text-sm text-tertiary">{t('workspace_settings_description')}</p>
                  </div>
                </div>
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
            </section>

            <section
              className="rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
              data-testid="ws-settings__workspace"
            >
              <SectionHeading
                eyebrow={t('workspace_general')}
                title={workspaceDisplayName}
              />

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_id_label')}</div>
                  <div className="mt-1 text-sm font-medium text-foreground" data-testid="ws-settings__name">{workspaceDisplayId}</div>
                </div>
                <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-tertiary">{t('workspace_projects_count')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{projects.length}</div>
                </div>
                <div className="rounded-[18px] border border-subtle bg-bg-base/20 p-3">
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
                <Link
                  href={`${workspaceBasePath}/settings/context`}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                  data-testid="ws-settings__open-context"
                >
                  {t('workspace_open_context')}
                </Link>
              </div>
            </section>

            <section
              className="rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
              data-testid="ws-settings__integrations"
            >
              <div className="space-y-4">
                <SectionHeading
                  title={t('workspace_integrations_title')}
                  subtitle={t('workspace_integrations_description')}
                />

                <div
                  className="rounded-[20px] border border-subtle bg-bg-base/20 p-4 shadow-[0_12px_26px_rgba(0,0,0,0.12)]"
                  data-testid="ws-settings__integration-feishu"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-tertiary">
                        <Link2 className="h-4 w-4 text-icon-default" />
                        {t('workspace_integration_feishu_label')}
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {t(`feishu_status_${feishuIntegration?.status ?? 'not_configured'}`)}
                      </p>
                      <p className="max-w-2xl text-sm text-secondary">
                        {t('workspace_integration_feishu_scope')}
                      </p>
                      <p className="text-xs text-tertiary">
                        {feishuIntegration?.verified_by_email
                          ? t('workspace_integration_feishu_verified_by', { email: feishuIntegration.verified_by_email })
                          : t('workspace_integration_feishu_verified_pending')}
                      </p>
                    </div>

                    <Link
                      href={`${workspaceBasePath}/settings/feishu`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                      data-testid="ws-settings__open-feishu"
                    >
                      <Link2 className="mr-2 h-4 w-4" />
                      {feishuIntegration?.status === 'enabled'
                        ? t('workspace_open_feishu_review')
                        : t('workspace_open_feishu_setup')}
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            <section
              className="rounded-[24px] border border-border bg-surface/95 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)]"
              data-testid="ws-settings__projects"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <SectionHeading
                  title={t('workspace_projects_title')}
                  subtitle={t('workspace_projects_description')}
                />
              </div>

              {projects.length === 0 ? (
                <p className="mt-4 text-sm text-tertiary">{t('workspace_projects_empty')}</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="rounded-[20px] border border-subtle bg-bg-base/20 p-4 shadow-[0_12px_26px_rgba(0,0,0,0.12)]"
                      data-testid={`ws-settings__project--${project.id}`}
                    >
                      {(() => {
                        const actions = getWorkspaceSettingsProjectActions(project);
                        const selectedOwnerId = selectedProjectOwners[project.id] ?? project.owner_id;
                        const isSavingProjectOwner = savingProjectOwnerId === project.id;
                        return (
                          <div className="flex flex-wrap items-start justify-between gap-5">
                            <div className="min-w-0 flex-1">
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
                          <p className="mt-3 text-xs text-tertiary">
                            {t('workspace_project_owner_current', {
                              owner: memberNameById.get(project.owner_id) || project.owner_id,
                            })}
                          </p>
                              {canManageWorkspaceGovernance ? (
                                <div className="mt-4 rounded-[18px] border border-subtle bg-surface/60 p-3">
                                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                    <ShieldCheck className="h-3.5 w-3.5 text-icon-default" />
                                    {t('workspace_project_governance_override')}
                                  </div>
                                  <p className="mt-2 text-sm text-secondary">{t('workspace_project_owner_override_help')}</p>
                                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end">
                                    <label className="min-w-0 flex-1 space-y-2">
                                      <span className="text-sm font-medium text-foreground">{t('workspace_project_owner_label')}</span>
                                      <select
                                        value={selectedOwnerId}
                                        onChange={(event) => handleProjectOwnerChange(project.id, event.target.value)}
                                        disabled={isSavingProjectOwner}
                                        className="h-10 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                                        data-testid={`ws-settings__project-owner-select--${project.id}`}
                                      >
                                        {members.map((member) => (
                                          <option key={member.user_id} value={member.user_id}>
                                            {member.name || member.email || member.user_id}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => void handleSaveProjectOwner(project.id)}
                                      disabled={isSavingProjectOwner || selectedOwnerId === project.owner_id}
                                      data-testid={`ws-settings__project-owner-save--${project.id}`}
                                    >
                                      {isSavingProjectOwner ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        t('workspace_project_owner_save')
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <div className="flex min-w-[220px] flex-col gap-3">
                              <div className="space-y-2">
                                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-tertiary">
                                  {t('workspace_project_open_actions_title')}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {actions.canOpenOverview ? (
                                    <Link
                                      href={`${workspaceBasePath}/projects/${project.id}/overview`}
                                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                                      data-testid={`ws-settings__project-open-overview--${project.id}`}
                                    >
                                      <FolderOpen className="mr-2 h-4 w-4" />
                                      {t('workspace_open_project')}
                                    </Link>
                                  ) : null}
                                  {actions.canOpenMembers ? (
                                    <Link
                                      href={`${workspaceBasePath}/projects/${project.id}/members`}
                                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                                      data-testid={`ws-settings__project-open-members--${project.id}`}
                                    >
                                      <Users className="mr-2 h-4 w-4" />
                                      {t('workspace_open_project_members')}
                                    </Link>
                                  ) : null}
                                  {actions.canOpenSettings ? (
                                    <Link
                                      href={`${workspaceBasePath}/projects/${project.id}/settings`}
                                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                                      data-testid={`ws-settings__project-open-settings--${project.id}`}
                                    >
                                      <SettingsIcon className="mr-2 h-4 w-4" />
                                      {t('workspace_open_project_settings')}
                                    </Link>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border bg-surface p-5" data-testid="ws-settings__project-creators">
              <SectionHeading
                title={t('workspace_project_creators_title')}
                subtitle={t('workspace_project_creators_description')}
              />
              <div className="mt-4 space-y-3">
                {hasLegacyProjectCreatorBindings ? (
                  <div
                    className="rounded-[18px] border border-warning/30 bg-warning/10 px-4 py-3"
                    data-testid="ws-settings__project-creators-binding-warning"
                  >
                    <p className="text-sm font-medium text-foreground">{t('workspace_project_creators_binding_warning_title')}</p>
                    <p className="mt-1 text-sm text-secondary">{t('workspace_project_creators_binding_warning_body')}</p>
                  </div>
                ) : null}
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">{t('workspace_project_creators_field')}</span>
                  <input
                    type="text"
                    value={projectCreatorQuery}
                    onChange={(event) => setProjectCreatorQuery(event.target.value)}
                    placeholder={t('workspace_project_creators_placeholder')}
                    className="h-10 w-full rounded-sm border border-subtle bg-surface px-3 text-sm text-foreground placeholder:text-tertiary"
                    data-testid="ws-settings__project-creators-input"
                  />
                </label>
                <div className="space-y-2" data-testid="ws-settings__project-creators-results">
                  {projectCreatorSearchLoading ? (
                    <p className="text-sm text-tertiary">{t('workspace_project_creators_loading')}</p>
                  ) : null}
                  {!projectCreatorSearchLoading && projectCreatorSearchError ? (
                    <p className="text-sm text-error">{t('workspace_project_creators_search_error')}</p>
                  ) : null}
                  {!projectCreatorSearchLoading && !projectCreatorSearchError && projectCreatorQuery.trim().length >= 2 ? (
                    projectCreatorSearchResults.length > 0 ? (
                      projectCreatorSearchResults.map((user) => (
                        <button
                          key={user.user_id}
                          type="button"
                          className="flex w-full items-start justify-between rounded-sm border border-subtle bg-bg-base/20 px-3 py-2 text-left transition hover:border-accent/40"
                          onClick={() => handleAddProjectCreator(user)}
                          data-testid={`ws-settings__project-creator-option--${user.user_id}`}
                        >
                          <span>
                            <span className="block text-sm font-medium text-foreground">{user.name || user.email}</span>
                            <span className="block text-xs text-tertiary">{user.email}</span>
                          </span>
                          <span className="text-xs text-tertiary">{t('workspace_project_creators_add')}</span>
                        </button>
                      ))
                    ) : (
                      <p className="text-sm text-tertiary">{t('workspace_project_creators_search_empty')}</p>
                    )
                  ) : null}
                </div>
                <div className="space-y-2" data-testid="ws-settings__project-creators-selected">
                  {projectCreators.map((creator) => (
                    <div
                      key={creator.user_id}
                      className="flex items-center justify-between rounded-sm border border-subtle bg-bg-base/20 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{creator.name || creator.email}</p>
                        <p className="text-xs text-tertiary">{creator.email}</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRemoveProjectCreator(creator.user_id)}
                        data-testid={`ws-settings__project-creator-remove--${creator.user_id}`}
                      >
                        {t('workspace_project_creators_remove')}
                      </Button>
                    </div>
                  ))}
                </div>
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
