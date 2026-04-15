/**
 * Shared workspace entry page content.
 *
 * Used by both:
 * - /workspaces/[workspace]
 * - /workspaces/[workspace]/projects
 */

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
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
import {
  ArrowLeft,
  FolderKanban,
  FolderOpen,
  Pin,
  Plus,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import type { ProjectWithMembership } from '@/lib/hooks/use-permissions';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { ProjectsTable } from '@/components/projects/ProjectsTable';
import { ProjectEntryActionCluster } from '@/components/projects/ProjectsTable';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { ProjectAPI, getApiClient } from '@/lib/api';
import { APIError } from '@/lib/api/errors';
import { toast } from '@/components/ui/toast';
import { useProjects } from '@/lib/hooks/use-projects-queries';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { useQueryClient } from '@tanstack/react-query';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import {
  buildProjectAdminSummary,
  canSelfJoinProject,
  isPendingProjectMembership,
  requiresProjectJoinFlow,
  type Project,
} from '@/lib/projects/project-view';
import {
  resolveWorkspaceProjectEntryPath,
} from '@/lib/projects/project-surface-access';
import { useCreateJoinRequest } from '@/lib/hooks/use-join-requests';

interface WorkspaceProjectsEntryPageProps {
  showBackLink?: boolean;
  workspaceIdOverride?: string | null;
}

const EMPTY_PROJECTS: Project[] = [];
const EMPTY_WORKSPACE_MEMBERS: Array<{
  id: string;
  user_id: string;
  name: string | null;
  email: string;
  groups: Array<{ id: string; name: string; permission_template_id?: string; built_in?: boolean; system_key?: string }>;
  status: string;
  joined_at: string;
}> = [];

export function WorkspaceProjectsEntryPage({
  showBackLink = true,
  workspaceIdOverride = null,
}: WorkspaceProjectsEntryPageProps) {
  const routeParams = useParams<{ workspace?: string; locale?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('projects');
  const tSettings = useTranslations('settings');
  const tWorkspace = useTranslations('workspace');
  const tErrors = useTranslations('errors');
  const { isAuthenticated, token } = useAuthStore();
  const hydrated = useAuthStoreHydration();
  const canWorkspaceRead = useHasWorkspacePermission('workspace:read');
  const canCreateProjectByWorkspacePermissions = useHasWorkspacePermission('workspace:project:create');
  const canManageWorkspaceGovernance = useHasWorkspacePermission('workspace:governance:update');
  const canDeleteProjectByWorkspacePermission = useHasWorkspacePermission('workspace:governance:update');

  const [searchQuery, setSearchQuery] = useState('');
  const [pinnedProjectIds, setPinnedProjectIds] = useState<Set<string>>(() => new Set());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogProject, setDeleteDialogProject] = useState<Project | null>(null);
  const [pendingJoinRequestIds, setPendingJoinRequestIds] = useState<Set<string>>(new Set());
  const [joiningProjectIds, setJoiningProjectIds] = useState<Set<string>>(new Set());
  const [joinDialogProject, setJoinDialogProject] = useState<Project | null>(null);

  useSyncAuthFromUrl();

  const workspaceId = workspaceIdOverride ?? validateWorkspaceParam(routeParams?.workspace);
  const locale = routeParams?.locale || 'en-US';
  const workspaceBasePath = workspaceId ? `/${locale}/workspaces/${workspaceId}` : `/${locale}/workspaces`;
  const createJoinRequest = useCreateJoinRequest(workspaceId ?? '');

  const {
    data: currentWorkspace,
    isFetched: isWorkspaceFetched,
  } = useWorkspace(workspaceId ?? '');
  const {
    data: workspaceMembersData,
    isFetched: isWorkspaceMembersFetched,
  } = useWorkspaceMembers(workspaceId ?? '');
  const {
    data: allProjectsData,
    isLoading: isProjectsLoading,
    isError: isProjectsError,
    error: projectsError,
    refetch: refetchProjects,
  } = useProjects(workspaceId ?? '');
  const workspaceMembers = workspaceMembersData ?? EMPTY_WORKSPACE_MEMBERS;
  const allProjects = allProjectsData ?? EMPTY_PROJECTS;
  const pinnedStorageKey = useMemo(
    () => (workspaceId ? `mbos:projects:pinned:${workspaceId}` : ''),
    [workspaceId]
  );

  useEffect(() => {
    if (!hydrated) return;
    let pinnedIds = new Set<string>();
    if (pinnedStorageKey) {
      try {
        const raw = window.localStorage.getItem(pinnedStorageKey);
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        if (Array.isArray(parsed)) {
          pinnedIds = new Set(parsed.filter((item): item is string => typeof item === 'string'));
        }
      } catch {
        pinnedIds = new Set();
      }
    }
    setPinnedProjectIds(pinnedIds);
  }, [hydrated, pinnedStorageKey]);

  const projects = useMemo(
    () => allProjects.map((project) => ({
      ...project,
      pinned: pinnedProjectIds.has(project.id),
    })) as Project[],
    [allProjects, pinnedProjectIds]
  );

  const handleProjectClick = (project: Project) => {
    if (requiresProjectJoinFlow(project) || pendingJoinRequestIds.has(project.id)) {
      setJoinDialogProject(project);
      return;
    }
    if (!workspaceId) {
      router.push(workspaceBasePath);
      return;
    }
    router.push(resolveWorkspaceProjectEntryPath(locale, workspaceId, project.id, project));
  };

  const handleSettingsClick = (project: Project) => {
    if (!workspaceId) return;
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${project.id}/settings`);
  };

  const togglePin = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPinnedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      if (pinnedStorageKey) {
        window.localStorage.setItem(pinnedStorageKey, JSON.stringify([...next]));
      }
      return next;
    });
  };

  const handleDeleteProject = async (wsId: string, projectId: string) => {
    const target = projects.find((project) => project.id === projectId);
    if (!target || !canDeleteProjectByWorkspacePermission) return;
    const projectAPI = new ProjectAPI(getApiClient());
    await projectAPI.delete(wsId, projectId);
  };

  const handleDeleteProjectSuccess = () => {
    if (!deleteDialogProject) return;
    queryClient.invalidateQueries({
      queryKey: ['workspaces', workspaceId, 'projects'],
    });
    setDeleteDialogProject(null);
    router.push(`/${locale}/workspaces/${workspaceId}/projects`);
  };

  const handleCreateJoinRequest = async (project: Project) => {
    if (!workspaceId) return;
    setJoiningProjectIds((current) => new Set(current).add(project.id));
    try {
      const result = await createJoinRequest.mutateAsync({ projectId: project.id });
      if (result.outcome === 'pending') {
        setPendingJoinRequestIds((current) => new Set(current).add(project.id));
      } else {
        setPendingJoinRequestIds((current) => {
          const next = new Set(current);
          next.delete(project.id);
          return next;
        });
        const refreshed = await refetchProjects();
        const nextProject = refreshed.data?.find((item) => item.id === project.id) ?? project;
        router.push(resolveWorkspaceProjectEntryPath(locale, workspaceId, project.id, nextProject));
      }
      setJoinDialogProject(null);
    } catch {
      setPendingJoinRequestIds((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
    } finally {
      setJoiningProjectIds((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
    }
  };

  const handleCreateProjectSuccess = async (projectId: string) => {
    if (!workspaceId) return;

    await queryClient.invalidateQueries({
      queryKey: ['workspaces', workspaceId, 'projects'],
    });

    const projectAPI = new ProjectAPI(getApiClient());
    const refreshed = await projectAPI.list(workspaceId);
    const items = (refreshed.items ?? []) as ProjectWithMembership[];
    const createdProject = items.find((project) => project.id === projectId);

    if (!createdProject) {
      toast.error(tErrors('permission_denied_hint'));
      return;
    }

    router.push(resolveWorkspaceProjectEntryPath(locale, workspaceId, projectId, createdProject));
  };

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of workspaceMembers) {
      map.set(member.user_id, member.name || member.email || member.user_id);
    }
    return map;
  }, [workspaceMembers]);

  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects;
    return projects.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [projects, searchQuery]);

  const pinnedProjects = filteredProjects.filter((p) => p.pinned);
  const unpinnedProjects = filteredProjects.filter((p) => !p.pinned);
  const isJoinDialogPending = joinDialogProject
    ? pendingJoinRequestIds.has(joinDialogProject.id) || isPendingProjectMembership(joinDialogProject)
    : false;
  const isJoinDialogBusy = joinDialogProject ? joiningProjectIds.has(joinDialogProject.id) : false;
  const joinDialogMode = joinDialogProject
    ? (canSelfJoinProject(joinDialogProject) ? 'open' : 'approval_required')
    : null;

  if (!hydrated) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  if (!workspaceId) {
    return (
      <PageState state="error">
        <PageLayout contentWidth="narrow">
          <div className="surface-soft px-6 py-8 text-center">
            <div className="space-y-2">
              <h2 className="type-title text-foreground">{tErrors('validation_error')}</h2>
              <p className="type-body-ui text-secondary">{tErrors('badRequest.description')}</p>
            </div>
            <div className="mt-5 flex justify-center">
              <Button asChild variant="outline">
                <Link href={`/${locale}/workspaces/overview`}>{tWorkspace('select')}</Link>
              </Button>
            </div>
          </div>
        </PageLayout>
      </PageState>
    );
  }

  const isWaitingForWorkspaceAccess =
    isAuthenticated && (!token || !isWorkspaceFetched || !isWorkspaceMembersFetched);

  if (isWaitingForWorkspaceAccess) {
    return (
      <PageState state="loading">
        <PageLoading />
      </PageState>
    );
  }

  const canReadProjects = canWorkspaceRead;
  const canCreateProject = canCreateProjectByWorkspacePermissions;
  const workspaceSelectionPath = `/${locale}/workspaces/overview`;
  const workspaceName = currentWorkspace?.name || workspaceId;

  if (!canReadProjects) {
    return (
      <PageState state="error">
        <PageLayout contentWidth="narrow">
          <div className="surface-soft px-6 py-8 text-center">
            <div className="space-y-2">
              <h2 className="type-title text-foreground">{tErrors('permission_denied_title')}</h2>
              <p className="type-body-ui text-secondary">{tErrors('permission_denied_hint')}</p>
            </div>
            <div className="mt-5 flex justify-center">
              <Button asChild variant="outline">
                <Link href={workspaceSelectionPath}>{tWorkspace('select')}</Link>
              </Button>
            </div>
          </div>
        </PageLayout>
      </PageState>
    );
  }

  if (isWorkspaceFetched && !currentWorkspace) {
    return (
      <PageState state="error">
        <PageLayout contentWidth="narrow">
          <div className="surface-soft px-6 py-8 text-center">
            <div className="space-y-2">
              <h2 className="type-title text-foreground">{t('workspace_unavailable_title')}</h2>
              <p className="type-body-ui text-secondary">{t('workspace_unavailable_description')}</p>
            </div>
            <div className="mt-5 flex justify-center">
              <Button asChild variant="outline">
                <Link href={workspaceSelectionPath}>{tWorkspace('select')}</Link>
              </Button>
            </div>
          </div>
        </PageLayout>
      </PageState>
    );
  }

  const isProjectsNotFound =
    isProjectsError && projectsError instanceof APIError && projectsError.isNotFoundError();

  if (isProjectsNotFound) {
    return (
      <PageState state="error">
        <PageLayout contentWidth="narrow">
          <div className="surface-soft px-6 py-8 text-center">
            <div className="space-y-2">
              <h2 className="type-title text-foreground">{t('workspace_unavailable_title')}</h2>
              <p className="type-body-ui text-secondary">{t('workspace_unavailable_description')}</p>
            </div>
            <div className="mt-5 flex justify-center">
              <Button asChild variant="outline">
                <Link href={workspaceSelectionPath}>{tWorkspace('select')}</Link>
              </Button>
            </div>
          </div>
        </PageLayout>
      </PageState>
    );
  }

  if (isProjectsError) {
    return (
      <PageState state="error">
        <PageLayout contentWidth="narrow">
          <div className="surface-soft px-6 py-8 text-center">
            <div className="space-y-2">
              <h2 className="type-title text-foreground">{t('load_failed_title')}</h2>
              <p className="type-body-ui text-secondary">{t('load_failed_description')}</p>
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button variant="primary" onClick={() => void refetchProjects()}>{t('retry')}</Button>
              <Button asChild variant="outline">
                <Link href={workspaceSelectionPath}>{tWorkspace('select')}</Link>
              </Button>
            </div>
          </div>
        </PageLayout>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout contentWidth="full">
        <div className="flex min-h-screen flex-col bg-background">
          <Topbar />

          <main
            className="mx-auto flex w-full max-w-[1640px] flex-1 flex-col px-4 py-6 md:px-6 md:py-8"
            data-testid="projects__page"
          >
            <div className="space-y-6">
              {showBackLink ? (
                <Button asChild variant="ghost" className="w-fit px-0 text-secondary hover:text-foreground" data-testid="projects__back-to-workspace">
                  <Link href={workspaceBasePath}>
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    {t('back_to_workspace')}
                  </Link>
                </Button>
              ) : null}

              <PageHeader
                title={t('title')}
                subtitle={`${t('workspace_label')} ${workspaceName}`}
                actions={(
                  <Button
                    variant="primary"
                    onClick={() => setCreateDialogOpen(true)}
                    disabled={!canCreateProject}
                    data-testid="projects__create-btn"
                  >
                    <Plus className="h-4 w-4" />
                    {t('new_project')}
                  </Button>
                )}
              />

              <section className="flex flex-col gap-3 border-t border-subtle pt-4 xl:flex-row xl:items-center xl:justify-between">
                <div className="space-y-1">
                  <p className="type-system-caption text-tertiary">
                    {workspaceName} · {filteredProjects.length} {t('summary.total_label')}
                    {pinnedProjects.length > 0 ? ` · ${pinnedProjects.length} ${t('summary.pinned_label')}` : ''}
                  </p>
                  <p className="text-sm text-secondary">
                    {canCreateProject ? t('summary.total_hint') : t('empty.read_only_description')}
                  </p>
                </div>

                <div className="flex w-full max-w-md flex-col gap-3 xl:items-end">
                  <label className="relative block w-full">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-icon-default" />
                    <Input
                      type="text"
                      placeholder={t('search_placeholder')}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      data-testid="projects__search"
                      className="pl-10"
                    />
                  </label>
                  {canManageWorkspaceGovernance ? (
                    <Button asChild variant="outline" data-testid="projects__workspace-settings-btn" className="w-full xl:w-auto">
                      <Link href={`${workspaceBasePath}/settings`}>
                        <SettingsIcon className="mr-2 h-4 w-4" />
                        {tSettings('workspace_title')}
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </section>

              {!isAuthenticated || (isProjectsLoading && projects.length === 0) ? (
                <div className="flex min-h-[320px] items-center justify-center">
                  <PageLoading />
                </div>
              ) : projects.length === 0 ? (
                <section className="border-t border-dashed border-subtle px-0 py-10 text-center">
                  <div className="mx-auto flex max-w-2xl flex-col items-center space-y-3">
                    <div className="flex h-12 w-12 items-center justify-center text-icon-default">
                      <FolderOpen className="h-8 w-8" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="type-section-heading text-foreground">{t('empty.title')}</h2>
                      <p className="type-body-ui text-secondary">
                        {canCreateProject ? t('empty.description') : t('empty.read_only_description')}
                      </p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-3">
                      {canCreateProject ? (
                        <Button
                          variant="primary"
                          onClick={() => setCreateDialogOpen(true)}
                        >
                          <Plus className="h-4 w-4" />
                          {t('empty.create_first')}
                        </Button>
                      ) : null}
                      <Button asChild variant="outline">
                        <Link href={workspaceSelectionPath}>{tWorkspace('select')}</Link>
                      </Button>
                    </div>
                  </div>
                </section>
              ) : (
                <div className="space-y-6">
                  {pinnedProjects.length > 0 ? (
                    <section className="space-y-3 border-t border-subtle pt-4">
                      <h2 className="type-system-caption flex items-center gap-2 text-tertiary">
                        <Pin className="h-4 w-4" />
                        {t('pinned.title')}
                      </h2>
                      <div className="space-y-2">
                        {pinnedProjects.map((project) => (
                          <div
                            key={project.id}
                            className="group flex items-start justify-between gap-4 rounded-sm border border-transparent px-0 py-1 text-left transition-colors hover:text-foreground"
                            data-testid={`projects__pinned-link--${project.id}`}
                          >
                            <button
                              type="button"
                              onClick={() => handleProjectClick(project)}
                              className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
                              data-testid={`projects__pinned-open-btn--${project.id}`}
                            >
                              <span className="inline-flex items-center gap-2 text-sm text-foreground">
                                <FolderOpen className="h-4 w-4 text-icon-default transition-colors group-hover:text-foreground" />
                                {project.name}
                              </span>
                              <span className="text-sm text-secondary">{buildProjectAdminSummary(project, memberNameById)}</span>
                            </button>
                            <div className="flex items-center gap-1">
                              <ProjectEntryActionCluster
                                project={project}
                                onProjectClick={handleProjectClick}
                                onSettingsClick={handleSettingsClick}
                                onDeleteClick={(targetProject) => setDeleteDialogProject(targetProject)}
                                onJoinRequest={(targetProject) => void handleCreateJoinRequest(targetProject)}
                                pendingJoinRequestIds={new Set([...pendingJoinRequestIds, ...joiningProjectIds])}
                                canDeleteProjectByWorkspacePermission={canDeleteProjectByWorkspacePermission}
                                t={t}
                                showOpenButton={false}
                                settingsButtonTestId={`projects__pinned-settings-btn--${project.id}`}
                                moreButtonTestId={`projects__pinned-more-btn--${project.id}`}
                                iconButtonClassName="h-8 w-8 rounded-sm hover:bg-surface-low"
                              />
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={(e) => togglePin(project.id, e)}
                                className="h-8 w-8 rounded-sm hover:bg-surface-low"
                                aria-label={t('actions.unpin')}
                                data-testid={`projects__unpin-btn--${project.id}`}
                              >
                                <Pin className="h-4 w-4 text-icon-default" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="space-y-4 border-t border-subtle pt-4">
                    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                      <h2 className="type-subheading text-foreground">{t('all.count', { count: unpinnedProjects.length })}</h2>
                      <div className="type-system-caption inline-flex items-center gap-2 self-start text-tertiary xl:self-auto">
                        <FolderKanban className="h-4 w-4 text-icon-default" />
                        {t('workspace_label')} {workspaceName}
                      </div>
                    </div>

                    <ProjectsTable
                      projects={unpinnedProjects}
                      onProjectClick={handleProjectClick}
                      onSettingsClick={handleSettingsClick}
                      onDeleteClick={(project) => setDeleteDialogProject(project)}
                      onTogglePin={togglePin}
                      onJoinRequest={(project) => void handleCreateJoinRequest(project)}
                      pendingJoinRequestIds={new Set([...pendingJoinRequestIds, ...joiningProjectIds])}
                      canDeleteProjectByWorkspacePermission={canDeleteProjectByWorkspacePermission}
                      memberNameById={memberNameById}
                      t={t}
                    />
                  </section>
                </div>
              )}
            </div>
          </main>

          <CreateProjectDialog
            open={canCreateProject && createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            workspaceId={workspaceId}
            onSuccess={handleCreateProjectSuccess}
          />

          <DeleteProjectDialog
            open={!!deleteDialogProject}
            onOpenChange={(open) => !open && setDeleteDialogProject(null)}
            project={deleteDialogProject}
            workspaceId={workspaceId}
            onDeleted={handleDeleteProjectSuccess}
            deleteProject={handleDeleteProject}
          />

          <AlertDialog open={!!joinDialogProject} onOpenChange={(open) => !open && setJoinDialogProject(null)}>
            <AlertDialogContent
              data-testid={
                joinDialogMode === 'open'
                  ? 'projects__join-now-dialog'
                  : 'projects__join-request-dialog'
              }
            >
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {joinDialogMode === 'open' ? t('join_request.join_now_title') : t('join_request.confirm_title')}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {isJoinDialogPending
                    ? t('join_request.pending_description', { project: joinDialogProject?.name ?? '' })
                    : joinDialogMode === 'open'
                      ? t('join_request.join_now_description', { project: joinDialogProject?.name ?? '' })
                      : t('join_request.confirm_description', { project: joinDialogProject?.name ?? '' })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="projects__join-dialog-cancel">{t('join_request.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  data-testid={
                    joinDialogMode === 'open'
                      ? 'projects__join-now-confirm'
                      : 'projects__join-request-confirm'
                  }
                  onClick={(event) => {
                    event.preventDefault();
                    if (!joinDialogProject || isJoinDialogPending || isJoinDialogBusy) return;
                    void handleCreateJoinRequest(joinDialogProject);
                  }}
                  disabled={!joinDialogProject || isJoinDialogPending || isJoinDialogBusy}
                >
                  {isJoinDialogPending
                    ? t('join_request.pending')
                    : joinDialogMode === 'open'
                      ? t('join_request.join_now')
                      : t('join_request.action')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </PageLayout>
    </PageState>
  );
}
