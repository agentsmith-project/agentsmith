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
} from 'lucide-react';
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { Topbar } from '@/components/app-shell/Topbar';
import { useAuthStore, useAuthStoreHydration, type Project as AuthProject } from '@/lib/stores/authStore';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';

type Project = AuthProject & { pinned: boolean };

interface ProjectsPageProps {
  params: Promise<{ workspace: string; locale: string }>;
}

const columnHelper = createColumnHelper<Project>();

export default function ProjectsPage({ params }: ProjectsPageProps) {
  const router = useRouter();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; locale: string } | null>(null);
  const allProjects = useAuthStore((state) => state.projects);
  const setProject = useAuthStore((state) => state.setProject);
  const currentWorkspace = useAuthStore((state) => state.currentWorkspace);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useAuthStoreHydration();

  const [searchQuery, setSearchQuery] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, locale: p.locale }));
  }, [params]);

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
    setProject(project);
    router.push(`/${resolvedParams?.locale || 'en-US'}/workspaces/${resolvedParams?.workspace || 'ws1'}/projects/${project.id}/overview`);
  };

  const togglePin = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, pinned: !p.pinned } : p))
    );
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
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-foreground-secondary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Topbar />

      <main className="flex-1 max-w-7xl mx-auto w-full p-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Projects</h1>
          <p className="text-foreground-secondary">
            Workspace: {currentWorkspace?.name || resolvedParams.workspace}
          </p>
        </div>

        {!isAuthenticated || projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="w-16 h-16 text-foreground-secondary mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">No projects yet</h2>
            <p className="text-foreground-secondary">Create your first project to get started</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Pinned Projects Section */}
            {pinnedProjects.length > 0 && (
              <section>
                <h2 className="text-lg font-medium text-foreground mb-4 flex items-center gap-2">
                  <Pin className="w-4 h-4" />
                  Pinned Projects
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {pinnedProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => handleProjectClick(project)}
                      onTogglePin={(e) => togglePin(project.id, e)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All Projects Table Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium text-foreground">
                  All Projects ({unpinnedProjects.length})
                </h2>
                <div className="flex items-center gap-3">
                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground-secondary" />
                    <input
                      type="text"
                      placeholder="Search projects..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 pr-4 py-2 w-64 bg-surface border border-border rounded-md text-sm text-foreground placeholder:text-foreground-secondary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>

                  {/* New Project Button */}
                  <button className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/90 text-white font-medium rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-accent/50">
                    <Plus className="w-4 h-4" />
                    New Project
                  </button>
                </div>
              </div>

              <ProjectsTable
                projects={unpinnedProjects}
                onProjectClick={handleProjectClick}
                onTogglePin={togglePin}
              />
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

// Project Card Component for pinned projects
function ProjectCard({
  project,
  onClick,
  onTogglePin,
}: {
  project: Project;
  onClick: () => void;
  onTogglePin: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onClick}
      className="relative group bg-surface border border-border rounded-md p-5 transition-all duration-200 hover:bg-surface-hover cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <button
        onClick={onTogglePin}
        className="absolute top-4 right-4 p-1.5 rounded hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
        aria-label="Unpin project"
      >
        <Pin className="w-4 h-4 text-foreground-secondary" />
      </button>

      <div className="flex items-start gap-4 mb-4">
        <div className="w-10 h-10 rounded-lg bg-surface-high flex items-center justify-center">
          <FolderOpen className="w-5 h-5 text-foreground-secondary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold text-foreground mb-1 truncate">
            {project.name}
          </h3>
          <div className="flex items-center gap-2 text-sm">
            {project.visibility === 'public' ? (
              <Globe className="w-3.5 h-3.5 text-foreground-secondary" />
            ) : (
              <Lock className="w-3.5 h-3.5 text-foreground-secondary" />
            )}
            <span className="capitalize text-foreground-secondary">
              {project.visibility}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <span className="text-xs font-medium text-foreground-secondary capitalize">
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
  onTogglePin,
}: {
  projects: Project[];
  onProjectClick: (project: Project) => void;
  onTogglePin: (projectId: string, e: React.MouseEvent) => void;
}) {
  const columns = useMemo<ColumnDef<Project>[]>(
    () => [
      columnHelper.display({
        id: 'pin',
        header: '',
        cell: ({ row }) => (
          <button
            onClick={(e) => onTogglePin(row.original.id, e)}
            className="p-1.5 rounded hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
            aria-label="Pin project"
          >
            <PinOff className="w-4 h-4 text-foreground-secondary" />
          </button>
        ),
      }),
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-surface-high flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-foreground-secondary" />
            </div>
            <span className="font-medium text-foreground">{info.getValue()}</span>
          </div>
        ),
      }),
      columnHelper.accessor('visibility', {
        header: 'Visibility',
        cell: (info) => (
          <div className="flex items-center gap-2">
            {info.getValue() === 'public' ? (
              <>
                <Globe className="w-4 h-4 text-foreground-secondary" />
                <span className="capitalize text-foreground">Public</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-foreground-secondary" />
                <span className="capitalize text-foreground">Private</span>
              </>
            )}
          </div>
        ),
      }),
      columnHelper.accessor('role', {
        header: 'Your Role',
        cell: (info) => (
          <span className="capitalize text-foreground">{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('status', {
        header: 'Status',
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
              className="p-1.5 rounded hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label="Open project"
            >
              <Eye className="w-4 h-4 text-foreground-secondary" />
            </button>
            <button
              className="p-1.5 rounded hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
              aria-label="Project settings"
            >
              <Settings className="w-4 h-4 text-foreground-secondary" />
            </button>
            <button className="p-1.5 rounded hover:bg-surface-high transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50">
              <MoreVertical className="w-4 h-4 text-foreground-secondary" />
            </button>
          </div>
        ),
      }),
    ],
    [onProjectClick, onTogglePin]
  );

  const table = useReactTable({
    data: projects,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (projects.length === 0) {
    return (
      <div className="text-center py-12 bg-surface border border-border rounded-md">
        <p className="text-foreground-secondary">No projects found</p>
      </div>
    );
  }

  return <DataTable table={table} />;
}
