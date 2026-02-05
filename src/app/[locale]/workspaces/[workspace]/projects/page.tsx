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
import { useQueryClient } from '@tanstack/react-query';

type Project = ProjectWithMembership & { pinned: boolean };

interface ProjectsPageProps {
  params: Promise<{ workspace: string; locale: string }>;
}

const columnHelper = createColumnHelper<Project>();

export default function ProjectsPage({ params }: ProjectsPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('projects');
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; locale: string } | null>(null);
  const { isAuthenticated } = useAuthStore();
  const hydrated = useAuthStoreHydration();

  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialogProject, setDeleteDialogProject] = useState<Project | null>(null);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, locale: p.locale }));
  }, [params]);

  // Sync auth store from URL parameters
  useSyncAuthFromUrl();

  const workspaceId = resolvedParams?.workspace || '';
  const locale = resolvedParams?.locale || 'en-US';

  // Fetch workspace and projects
  const { data: currentWorkspace } = useWorkspace(workspaceId);
  const { data: allProjects = [] } = useProjects(workspaceId);

  // Initialize projects with pinned status
  useEffect(() => {
    if (hydrated && allProjects.length > 0) {
      const projectsWithPin = allProjects.map((p) => ({
        ...p,
        pinned: p.id === 'proj_001', // Pin first project by default for demo
      })) as Project[];
      setProjects(projectsWithPin);
    }
  }, [hydrated, allProjects]);

  const handleProjectClick = (project: Project) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${project.id}/overview`);
  };

  const handleSettingsClick = (project: Project) => {
    router.push(`/${locale}/workspaces/${workspaceId}/projects/${project.id}/settings`);
  };

  const togglePin = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, pinned: !p.pinned } : p))
    );
  };

  const handleDeleteProject = async (wsId: string, projectId: string) => {
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

  return (
    <PageState state="success">
      <PageLayout>
        <div className="min-h-screen bg-background flex flex-col">
          <Topbar />

          <main className="flex-1 max-w-7xl mx-auto w-full p-6">
        {/* Header */}
        <div className="mb-8">
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
            <Button variant="action" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="w-4 h-4" />
              {t('empty.create_first')}
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
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
                      className="pl-9 pr-4 py-2 w-64 bg-surface-high border border-subtle rounded-sm text-sm text-primary placeholder:text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>

                  {/* New Project Button */}
                  <Button variant="action" onClick={() => setCreateDialogOpen(true)}>
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
                t={t}
              />
            </section>
          </div>
        )}
      </main>

      <CreateProjectDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        workspaceId={workspaceId}
        onSuccess={handleCreateProjectSuccess}
      />

      <DeleteProjectDialog
        open={!!deleteDialogProject}
        onOpenChange={(open) => !open && setDeleteDialogProject(null)}
        project={deleteDialogProject}
        workspaceId={workspaceId}
        onConfirm={handleDeleteProjectSuccess}
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
  t,
}: {
  project: Project;
  onClick: () => void;
  onSettingsClick: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
  t: ReturnType<typeof useTranslations<'projects'>>;
}) {
  return (
    <div
      onClick={onClick}
      className="relative group bg-surface border border-border rounded-md p-5 transition-colors duration-200 hover:bg-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSettingsClick();
          }}
          className="p-1.5 rounded-sm hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
          aria-label={t('actions.settings')}
        >
          <Settings className="w-4 h-4 text-icon-default" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(e);
          }}
          className="p-1.5 rounded-sm hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
          aria-label={t('actions.unpin')}
        >
          <Pin className="w-4 h-4 text-icon-default" />
        </button>
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

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <span className="text-xs font-medium text-tertiary uppercase tracking-wide">
          {project.role}
        </span>
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
  t,
}: {
  projects: Project[];
  onProjectClick: (project: Project) => void;
  onSettingsClick: (project: Project) => void;
  onDeleteClick: (project: Project) => void;
  onTogglePin: (projectId: string, e: React.MouseEvent) => void;
  t: ReturnType<typeof useTranslations<'projects'>>;
}) {
  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'pin',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={(e) => onTogglePin(row.original.id, e)}
            className="p-1.5 rounded-sm hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
            aria-label={t('actions.pin')}
          >
            <PinOff className="w-4 h-4 text-icon-default" />
          </button>
        ),
      }),
      columnHelper.accessor('name', {
        header: t('table.name'),
        cell: (info) => (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-sm bg-surface-high flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-icon-default" />
            </div>
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </div>
        ),
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
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onProjectClick(row.original)}
              className="p-1.5 rounded-sm hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label={t('actions.open')}
            >
              <Eye className="w-4 h-4 text-icon-default" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSettingsClick(row.original);
              }}
              className="p-1.5 rounded-sm hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label={t('actions.settings')}
            >
              <Settings className="w-4 h-4 text-icon-default" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="p-1.5 rounded-sm hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
                  aria-label="More actions"
                >
                  <MoreVertical className="w-4 h-4 text-icon-default" />
                </button>
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
          </div>
        ),
      }),
    ],
    [onProjectClick, onSettingsClick, onDeleteClick, onTogglePin, t]
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

  return <DataTable table={table} />;
}
