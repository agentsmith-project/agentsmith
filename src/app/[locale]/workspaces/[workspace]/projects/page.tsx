/**
 * Projects List Page
 *
 * Shows all projects in the current workspace with hybrid layout:
 * - Pinned projects displayed as cards
 * - All projects displayed in a TanStack Table
 */

'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  FolderOpen,
  Plus,
  Pin,
  PinOff,
  Search,
  MoreVertical,
  Globe,
  Lock,
  Eye,
  Settings,
  Trash2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { Topbar } from '@/components/app-shell/Topbar';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import type { ProjectWithMembership } from '@/lib/hooks/use-permissions';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { useSyncAuthFromUrl } from '@/lib/hooks/use-sync-auth-from-url';
import { Button } from '@/components/ui/button';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { DeleteProjectDialog } from '@/components/projects/DeleteProjectDialog';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageState } from '@/components/layout/PageState';
import { PageLoading } from '@/components/ui/loading';
import { ProjectAPI, getApiClient } from '@/lib/api';
import { useProjects } from '@/lib/hooks/use-projects-queries';
import { useWorkspace } from '@/lib/hooks/use-workspaces';
import { useWorkspaceMembers } from '@/lib/hooks/use-workspaces';
import { useQueryClient } from '@tanstack/react-query';
import { validateWorkspaceParam } from '@/lib/utils/validate-url-params';

type Project = ProjectWithMembership & { pinned: boolean };

function isProjectAdminRole(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

interface ProjectsPageProps {
  params: Promise<{ workspace: string; locale: string }>;
}

const columnHelper = createColumnHelper<Project>();

export default function ProjectsPage({ params }: ProjectsPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('projects');
  const tErrors = useTranslations('errors');
  const [resolvedParams, setResolvedParams] = useState<{ workspace?: string; locale: string } | null>(null);
  const { isAuthenticated } = useAuthStore();
  const hydrated = useAuthStoreHydration();
  const canWorkspaceRead = useHasWorkspacePermission('workspace:read');
  const canProjectRead = useHasWorkspacePermission('project:read');
  const canCreateProjectByWorkspacePermissions = useHasWorkspacePermission('workspace:project:create');
  const canDeleteProjectByWorkspacePermission = useHasWorkspacePermission('project:delete');

  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogProject, setDeleteDialogProject] = useState<Project | null>(null);

  useEffect(() => {
    params.then((p) => {
      setResolvedParams({
        workspace: validateWorkspaceParam(p.workspace),
        locale: p.locale,
      });
    });
  }, [params]);

  // Sync auth store from URL parameters
  useSyncAuthFromUrl();

  const workspaceId = resolvedParams?.workspace || '';
  const locale = resolvedParams?.locale || 'en-US';

  // Fetch workspace and projects
  const { data: currentWorkspace } = useWorkspace(workspaceId);
  const { data: workspaceMembers = [] } = useWorkspaceMembers(workspaceId);
  const { data: allProjects = [] } = useProjects(workspaceId);
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
    if (!target || !isProjectAdminRole(target.role) || !canDeleteProjectByWorkspacePermission) return;
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

  const handleCreateProjectSuccess = (newProject: ProjectWithMembership) => {
    const projectWithPin: Project = { ...newProject, pinned: false };
    setProjects((prev) => [...prev, projectWithPin]);
    // Invalidate and refetch projects
    queryClient.invalidateQueries({
      queryKey: ['workspaces', workspaceId, 'projects'],
    });
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${newProject.id}/overview`);
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

  // Wait for params to resolve and auth to hydrate
  if (!resolvedParams || !hydrated) {
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

  const canReadProjects = canWorkspaceRead && canProjectRead;
  const canCreateProject = canCreateProjectByWorkspacePermissions;

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
          <h1 className="text-2xl font-semibold text-foreground mb-2">{t('title')}</h1>
          <p className="text-tertiary">
            {t('workspace_label')} {currentWorkspace?.name || resolvedParams.workspace}
          </p>
        </div>

        {!isAuthenticated || projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="w-16 h-16 text-tertiary mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">{t('empty.title')}</h2>
            <p className="text-tertiary mb-6">{t('empty.description')}</p>
            <Button
              variant="action"
              onClick={() => setCreateDialogOpen(true)}
              disabled={!canCreateProject}
            >
              <Plus className="w-4 h-4" />
              {t('empty.create_first')}
            </Button>
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

// Project Card Component for pinned projects
function ProjectCard({
  project,
  onClick,
  onSettingsClick,
  onTogglePin,
  adminSummary,
  t,
}: {
  project: Project;
  onClick: () => void;
  onSettingsClick: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  adminSummary: string;
  t: ReturnType<typeof useTranslations<'projects'>>;
}) {
  return (
    <div
      onClick={onClick}
      className="relative group bg-surface border border-border rounded-md p-5 transition-colors duration-200 hover:bg-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onSettingsClick();
          }}
          className="h-8 w-8 rounded-sm hover:bg-surface-high"
          aria-label={t('actions.settings')}
        >
          <Settings className="w-4 h-4 text-icon-default" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(e);
          }}
          className="h-8 w-8 rounded-sm hover:bg-surface-high"
          aria-label={t('actions.unpin')}
          data-testid="projects__pin-btn"
        >
          <Pin className="w-4 h-4 text-icon-default" />
        </Button>
      </div>

      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-sm bg-surface-high flex items-center justify-center">
          <FolderOpen className="w-5 h-5 text-icon-default" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground mb-1 truncate">
            {project.name}
          </h3>
          <div className="flex items-center gap-2 text-sm">
            {project.visibility === 'public' ? (
              <Globe className="w-3.5 h-3.5 text-icon-default" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-icon-default" />
            )}
            <span className="text-tertiary">
              {t(`visibility.${project.visibility}`)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-tertiary uppercase tracking-wide">
            {t('table.project_admin')}
          </p>
          <p className="text-xs text-primary truncate" title={adminSummary}>
            {adminSummary}
          </p>
        </div>
        <StatusBadge status={project.status === 'active' ? 'active' : 'paused'}>
          {project.status}
        </StatusBadge>
      </div>
    </div>
  );
}

// Projects Table Component
function ProjectsTable({
  projects,
  onProjectClick,
  onSettingsClick,
  onDeleteClick,
  onTogglePin,
  canDeleteProjectByWorkspacePermission,
  memberNameById,
  t,
}: {
  projects: Project[];
  onProjectClick: (project: Project) => void;
  onSettingsClick: (project: Project) => void;
  onDeleteClick: (project: Project) => void;
  onTogglePin: (projectId: string, e: React.MouseEvent) => void;
  canDeleteProjectByWorkspacePermission: boolean;
  memberNameById: Map<string, string>;
  t: ReturnType<typeof useTranslations<'projects'>>;
}) {
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'pin',
        header: '',
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(e) => onTogglePin(row.original.id, e)}
            className="h-8 w-8 rounded-sm hover:bg-surface-high"
            aria-label={t('actions.pin')}
            data-testid="projects__pin-btn"
          >
            <PinOff className="w-4 h-4 text-icon-default" />
          </Button>
        ),
      }),
      columnHelper.accessor('name', {
        header: t('table.name'),
        cell: (info) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onProjectClick(info.row.original);
            }}
            className="flex items-center gap-3 text-left hover:opacity-90"
          >
            <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-icon-default" />
            </div>
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </button>
        ),
      }),
      columnHelper.display({
        id: 'project_admin',
        header: t('table.project_admin'),
        cell: ({ row }) => {
          const summary = buildProjectAdminSummary(row.original, memberNameById);
          return (
            <span className="text-primary truncate block max-w-[260px]" title={summary}>
              {summary}
            </span>
          );
        },
      }),
      columnHelper.accessor('visibility', {
        header: t('table.visibility'),
        cell: (info) => (
          <div className="flex items-center gap-2">
            {info.getValue() === 'public' ? (
              <>
                <Globe className="w-4 h-4 text-icon-default" />
                <span className="text-primary">{t('visibility.public')}</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-icon-default" />
                <span className="text-primary">{t('visibility.private')}</span>
              </>
            )}
          </div>
        ),
      }),
      columnHelper.accessor('role', {
        header: t('table.role'),
        cell: (info) => (
          <span className="capitalize text-primary">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: t('table.status'),
        cell: (info) => (
          <StatusBadge status={info.getValue() === 'active' ? 'active' : 'paused'}>
            {info.getValue()}
          </StatusBadge>
        ),
      }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const canDeleteProject =
            isProjectAdminRole(row.original.role) && canDeleteProjectByWorkspacePermission;
          return (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onProjectClick(row.original)}
              className="h-8 w-8 rounded-sm hover:bg-surface-high"
              aria-label={t('actions.open')}
            >
              <Eye className="w-4 h-4 text-icon-default" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onSettingsClick(row.original);
              }}
              className="h-8 w-8 rounded-sm hover:bg-surface-high"
              aria-label={t('actions.settings')}
              data-testid="projects__settings-btn"
            >
              <Settings className="w-4 h-4 text-icon-default" />
            </Button>
            {canDeleteProject && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e) => e.stopPropagation()}
                    className="h-8 w-8 rounded-sm hover:bg-surface-high"
                    aria-label="More actions"
                  >
                    <MoreVertical className="w-4 h-4 text-icon-default" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      onDeleteClick(row.original);
                    }}
                    className="text-error focus:text-error"
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('actions.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          );
        },
      }),
    ],
    [onProjectClick, onSettingsClick, onDeleteClick, onTogglePin, canDeleteProjectByWorkspacePermission, memberNameById, t]
  );

  const table = useReactTable({
    data: projects,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (projects.length === 0) {
    return (
      <div className="text-center py-12 bg-surface border border-border rounded-md">
        <p className="text-tertiary">{t('no_results')}</p>
      </div>
    );
  }

  return (
    <DataTable
      table={table}
      testId="projects__table"
      onRowClick={onProjectClick}
    />
  );
}

function buildProjectAdminSummary(
  project: Project,
  memberNameById: Map<string, string>
): string {
  const rawAdmins = project.governance_json?.['project_admins'];
  const ids: string[] = [];
  const labels: string[] = [];

  if (Array.isArray(rawAdmins)) {
    for (const item of rawAdmins) {
      if (typeof item === 'string') {
        ids.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        const maybeId = (item as Record<string, unknown>).id;
        const maybeName = (item as Record<string, unknown>).name;
        if (typeof maybeId === 'string') ids.push(maybeId);
        if (typeof maybeName === 'string' && maybeName.trim()) labels.push(maybeName.trim());
      }
    }
  }

  ids.push(project.owner_id);
  const resolved = [...labels, ...ids.map((id) => memberNameById.get(id) || id)];
  const unique = Array.from(new Set(resolved.filter((name) => name.trim().length > 0)));
  if (unique.length === 0) return '-';
  if (unique.length <= 2) return unique.join(', ');
  return `${unique.slice(0, 2).join(', ')}...`;
}
