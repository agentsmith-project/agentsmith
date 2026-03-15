/**
 * Projects List Page
 *
 * Shows all projects in the current workspace with hybrid layout:
 * - Pinned projects displayed as cards
 * - All projects displayed in a TanStack Table
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  FolderKanban,
  FolderOpen,
  Plus,
  Pin,
  Search,
  Sparkles,
} from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import type { ProjectWithMembership } from '@/lib/hooks/use-permissions';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { Button } from '@/components/ui/button';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectsTable } from '@/components/projects/ProjectsTable';
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
import { buildProjectAdminSummary, type Project } from '@/lib/projects/project-view';
import { useCreateJoinRequest } from '@/lib/hooks/use-join-requests';

export default function ProjectsPage() {
  const routeParams = useParams<{ workspace?: string; locale?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('projects');
  const tErrors = useTranslations('errors');
  const { isAuthenticated } = useAuthStore();
  const hydrated = useAuthStoreHydration();
  const canWorkspaceRead = useHasWorkspacePermission('workspace:read');
  const canCreateProjectByWorkspacePermissions = useHasWorkspacePermission('workspace:project:create');
  const canDeleteProjectByWorkspacePermission = useHasWorkspacePermission('workspace:governance:update');

  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogProject, setDeleteDialogProject] = useState<Project | null>(null);
  const [pendingJoinRequestIds, setPendingJoinRequestIds] = useState<Set<string>>(new Set());

  // Sync auth store from URL parameters
  useSyncAuthFromUrl();

  const workspaceId = validateWorkspaceParam(routeParams?.workspace);
  const locale = routeParams?.locale || 'en-US';
  const createJoinRequest = useCreateJoinRequest(workspaceId ?? '');

  // Fetch workspace and projects
  const {
    data: currentWorkspace,
    isFetched: isWorkspaceFetched,
  } = useWorkspace(workspaceId ?? '');
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId ?? '');
  const {
    data: allProjects = [],
    isLoading: isProjectsLoading,
    isError: isProjectsError,
    error: projectsError,
    refetch: refetchProjects,
  } = useProjects(workspaceId ?? '');
  const pinnedStorageKey = useMemo(
    () => (workspaceId ? `mbos:projects:pinned:${workspaceId}` : ''),
    [workspaceId]
  );

  // Initialize projects with pinned status
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
    const projectsWithPin = allProjects.map((p) => ({
      ...p,
      pinned: pinnedIds.has(p.id),
    })) as Project[];
    setProjects(projectsWithPin);
  }, [hydrated, allProjects, pinnedStorageKey]);

  const handleProjectClick = (project: Project) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${project.id}/overview`);
  };

  const handleSettingsClick = (project: Project) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${project.id}/settings`);
  };

  const togglePin = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === projectId ? { ...p, pinned: !p.pinned } : p));
      if (pinnedStorageKey) {
        const pinnedIds = next.filter((p) => p.pinned).map((p) => p.id);
        window.localStorage.setItem(pinnedStorageKey, JSON.stringify(pinnedIds));
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
    // Invalidate and refetch projects
    queryClient.invalidateQueries({
      queryKey: ['workspaces', workspaceId, 'projects'],
    });
    setDeleteDialogProject(null);
    router.push(`/${locale}/workspaces/${workspaceId}/projects`);
  };

  const handleCreateJoinRequest = async (project: Project) => {
    if (!workspaceId) return;
    setPendingJoinRequestIds((current) => new Set(current).add(project.id));
    try {
      await createJoinRequest.mutateAsync({ projectId: project.id });
    } catch {
      setPendingJoinRequestIds((current) => {
        const next = new Set(current);
        next.delete(project.id);
        return next;
      });
      return;
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

    setProjects((prev) => {
      const pinnedMap = new Map(prev.map((project) => [project.id, project.pinned]));
      return items.map((project) => ({
        ...project,
        pinned: pinnedMap.get(project.id) ?? false,
      }));
    });

    if (!createdProject) {
      toast.error(tErrors('permission_denied_hint'));
      return;
    }

    router.push(`/${locale}/workspaces/${workspaceId}/projects/${projectId}/overview`);
  };

  const memberNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of workspaceMembers) {
      map.set(member.user_id, member.name || member.email || member.user_id);
    }
    return map;
  }, [workspaceMembers]);

  // Filter projects based on search
  const filteredProjects = useMemo(() => {
    if (!searchQuery) return projects;
    return projects.filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [projects, searchQuery]);

  // Separate pinned and unpinned projects
  const pinnedProjects = filteredProjects.filter((p) => p.pinned);
  const unpinnedProjects = filteredProjects.filter((p) => !p.pinned);

  // Wait for auth to hydrate
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
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('validation_error')}</h2>
          <p className="text-sm text-tertiary">{tErrors('badRequest.description')}</p>
        </div>
      </PageState>
    );
  }

  const canReadProjects = canWorkspaceRead;
  const canCreateProject = canCreateProjectByWorkspacePermissions;
  const workspaceBasePath = `/${locale}/workspaces/${workspaceId}`;
  const workspaceName = currentWorkspace?.name || workspaceId;

  if (!canReadProjects) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{tErrors('permission_denied_title')}</h2>
          <p className="text-sm text-tertiary">{tErrors('permission_denied_hint')}</p>
        </div>
      </PageState>
    );
  }

  if (isWorkspaceFetched && !currentWorkspace) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('workspace_unavailable_title')}</h2>
          <p className="text-sm text-tertiary">{t('workspace_unavailable_description')}</p>
        </div>
      </PageState>
    );
  }

  const isProjectsNotFound =
    isProjectsError && projectsError instanceof APIError && projectsError.isNotFoundError();

  if (isProjectsNotFound) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-lg font-semibold">{t('workspace_unavailable_title')}</h2>
          <p className="text-sm text-tertiary">{t('workspace_unavailable_description')}</p>
        </div>
      </PageState>
    );
  }

  if (isProjectsError) {
    return (
      <PageState state="error">
        <div className="max-w-md text-center space-y-3">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">{t('load_failed_title')}</h2>
            <p className="text-sm text-tertiary">{t('load_failed_description')}</p>
          </div>
          <div className="flex justify-center">
            <Button variant="action" onClick={() => void refetchProjects()}>{t('retry')}</Button>
          </div>
        </div>
      </PageState>
    );
  }

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 w-full max-w-[1640px] mx-auto px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 space-y-4">
          <Link
            href={workspaceBasePath}
            className="inline-flex items-center gap-2 text-sm text-tertiary transition-colors hover:text-foreground"
            data-testid="projects__back-to-workspace"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('back_to_workspace')}
          </Link>

          <section className="rounded-[24px] border border-subtle bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))] p-6 shadow-[0_24px_60px_rgba(0,0,0,0.22)] md:p-7">
            <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('title')}
                </div>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">{t('title')}</h1>
                  <p className="max-w-2xl text-sm text-secondary md:text-[15px]">
                    {t('workspace_label')} {workspaceName}
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-tertiary">
                      {t('summary.total_label')}
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/12 text-accent">
                        <FolderKanban className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-2xl font-semibold text-foreground">{filteredProjects.length}</p>
                        <p className="text-sm text-secondary">{t('summary.total_hint')}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-tertiary">
                      {t('summary.pinned_label')}
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] text-foreground">
                        <Pin className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-2xl font-semibold text-foreground">{pinnedProjects.length}</p>
                        <p className="text-sm text-secondary">{t('summary.pinned_hint')}</p>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-tertiary">
                      {t('workspace_label')}
                    </p>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.06] text-foreground">
                        <ArrowUpRight className="h-5 w-5" />
                      </span>
                      <div>
                        <p className="text-base font-semibold text-foreground">{workspaceName}</p>
                        <p className="text-sm text-secondary">
                          {canCreateProject ? t('empty.description') : t('empty.read_only_description')}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-[20px] border border-white/8 bg-black/15 p-4 shadow-[0_14px_32px_rgba(0,0,0,0.14)]">
                <div className="space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-tertiary">
                      {t('search_placeholder')}
                    </p>
                    <p className="mt-1 text-sm text-secondary">{t('summary.table_hint')}</p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,320px)_auto]">
                    <label className="relative block">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-icon-default" />
                      <input
                        type="text"
                        placeholder={t('search_placeholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        data-testid="projects__search"
                        className="h-11 w-full rounded-xl border border-white/6 bg-white/5 pl-10 pr-4 text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                    </label>

                    <Button
                      variant="primary"
                      onClick={() => setCreateDialogOpen(true)}
                      disabled={!canCreateProject}
                      data-testid="projects__create-btn"
                      className="h-11 px-5"
                    >
                      <Plus className="h-4 w-4" />
                      {t('new_project')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        {!isAuthenticated || (isProjectsLoading && projects.length === 0) ? (
          <div className="flex min-h-[320px] items-center justify-center">
            <PageLoading />
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-[24px] border border-subtle bg-surface/90 px-6 py-20 text-center shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
            <div className="mx-auto mb-5 inline-flex h-16 w-16 items-center justify-center rounded-3xl border border-white/8 bg-white/[0.04]">
              <FolderOpen className="h-8 w-8 text-tertiary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground mb-2">{t('empty.title')}</h2>
            <p className="mx-auto mb-6 max-w-xl text-tertiary">
              {canCreateProject ? t('empty.description') : t('empty.read_only_description')}
            </p>
            {canCreateProject ? (
              <Button
                variant="primary"
                onClick={() => setCreateDialogOpen(true)}
              >
                <Plus className="w-4 h-4" />
                {t('empty.create_first')}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Pinned Projects Section */}
            {pinnedProjects.length > 0 && (
              <section className="space-y-4 rounded-[24px] border border-subtle bg-surface/88 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.16)] md:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-medium text-foreground flex items-center gap-2">
                      <Pin className="w-4 h-4" />
                      {t('pinned.title')}
                    </h2>
                    <p className="mt-1 text-sm text-secondary">{t('summary.pinned_section_hint')}</p>
                  </div>
                  <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-sm text-secondary">
                    {pinnedProjects.length}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pinnedProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => handleProjectClick(project)}
                      onSettingsClick={() => handleSettingsClick(project)}
                      onTogglePin={(e) => togglePin(project.id, e)}
                      onJoinRequest={() => void handleCreateJoinRequest(project)}
                      isJoinRequestPending={pendingJoinRequestIds.has(project.id)}
                      adminSummary={buildProjectAdminSummary(project, memberNameById)}
                      t={t}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All Projects Table Section */}
            <section className="rounded-[24px] border border-subtle bg-surface/92 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.18)] md:p-6">
              <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="text-lg font-medium text-foreground">
                    {t('all.count', { count: unpinnedProjects.length })}
                  </h2>
                  <p className="mt-1 text-sm text-secondary">{t('summary.table_hint')}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm text-secondary">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/6 bg-white/[0.03] px-3 py-2">
                    <ArrowUpRight className="h-4 w-4 text-accent" />
                    {t('workspace_label')} {currentWorkspace?.name || workspaceId}
                  </div>
                </div>
              </div>

              <ProjectsTable
                projects={unpinnedProjects}
                onProjectClick={handleProjectClick}
                onSettingsClick={handleSettingsClick}
                onDeleteClick={(project) => setDeleteDialogProject(project)}
                onTogglePin={togglePin}
                onJoinRequest={(project) => void handleCreateJoinRequest(project)}
                pendingJoinRequestIds={pendingJoinRequestIds}
                canDeleteProjectByWorkspacePermission={canDeleteProjectByWorkspacePermission}
                memberNameById={memberNameById}
                t={t}
              />
            </section>
          </div>
        )}
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
        </div>
      </PageLayout>
    </PageState>
  );
}
