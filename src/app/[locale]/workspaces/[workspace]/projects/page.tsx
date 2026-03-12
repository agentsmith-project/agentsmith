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
  FolderOpen,
  Plus,
  Pin,
  Search,
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
import { toast } from '@/components/ui/toast';
import { useProjects } from '@/lib/hooks/use-projects-queries';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { useQueryClient } from '@tanstack/react-query';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { buildProjectAdminSummary, type Project } from '@/lib/projects/project-view';

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

  // Sync auth store from URL parameters
  useSyncAuthFromUrl();

  const workspaceId = validateWorkspaceParam(routeParams?.workspace);
  const locale = routeParams?.locale || 'en-US';

  // Fetch workspace and projects
  const { data: currentWorkspace } = useWorkspace(workspaceId ?? '');
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId ?? '');
  const { data: allProjects = [] } = useProjects(workspaceId ?? '');
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

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 w-full max-w-[1600px] mx-auto px-4 py-4 md:px-5 md:py-5">
        {/* Header */}
        <div className="mb-6">
          <Link
            href={workspaceBasePath}
            className="mb-3 inline-flex items-center gap-2 text-sm text-tertiary transition-colors hover:text-foreground"
            data-testid="projects__back-to-workspace"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('back_to_workspace')}
          </Link>
          <h1 className="text-2xl font-semibold text-foreground mb-2">{t('title')}</h1>
          <p className="text-tertiary">
            {t('workspace_label')} {currentWorkspace?.name || workspaceId}
          </p>
        </div>

        {!isAuthenticated || projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="w-16 h-16 text-tertiary mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">{t('empty.title')}</h2>
            <p className="text-tertiary mb-6">
              {canCreateProject ? t('empty.description') : t('empty.read_only_description')}
            </p>
            {canCreateProject ? (
              <Button
                variant="action"
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
              <section>
                <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                  <Pin className="w-4 h-4" />
                  {t('pinned.title')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pinnedProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => handleProjectClick(project)}
                      onSettingsClick={() => handleSettingsClick(project)}
                      onTogglePin={(e) => togglePin(project.id, e)}
                      adminSummary={buildProjectAdminSummary(project, memberNameById)}
                      t={t}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All Projects Table Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-foreground">
                  {t('all.count', { count: unpinnedProjects.length })}
                </h2>
                <div className="flex items-center gap-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-icon-default" />
                    <input
                      type="text"
                      placeholder={t('search_placeholder')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      data-testid="projects__search"
                      className="pl-9 pr-4 py-2 w-64 bg-surface-high border border-subtle rounded-sm text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>

                  {/* New Project Button */}
                  <Button
                    variant="action"
                    onClick={() => setCreateDialogOpen(true)}
                    disabled={!canCreateProject}
                    data-testid="projects__create-btn"
                  >
                    <Plus className="w-4 h-4" />
                    {t('new_project')}
                  </Button>
                </div>
              </div>

              <ProjectsTable
                projects={unpinnedProjects}
                onProjectClick={handleProjectClick}
                onSettingsClick={handleSettingsClick}
                onDeleteClick={(project) => setDeleteDialogProject(project)}
                onTogglePin={togglePin}
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
