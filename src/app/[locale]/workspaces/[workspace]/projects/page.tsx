/**
 * Projects List Page
 *
 * Shows all projects in the current workspace.
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderOpen, Plus } from 'lucide-react';
import { Topbar } from '@/components/app-shell/Topbar';
import { useAuthStore, useAuthStoreHydration } from '@/lib/stores/authStore';
import type { Project } from '@/lib/stores/authStore';

interface ProjectsPageProps {
  params: Promise<{ workspace: string; locale: string }>;
}

export default function ProjectsPage({ params }: ProjectsPageProps) {
  const router = useRouter();
  const [resolvedParams, setResolvedParams] = useState<{ workspace: string; locale: string } | null>(null);
  const projects = useAuthStore((state) => state.projects);
  const setProject = useAuthStore((state) => state.setProject);
  const currentWorkspace = useAuthStore((state) => state.currentWorkspace);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const hydrated = useAuthStoreHydration();

  useEffect(() => {
    params.then((p) => setResolvedParams({ workspace: p.workspace, locale: p.locale }));
  }, [params]);

  const handleProjectClick = (project: Project) => {
    setProject(project);
    router.push(`/${resolvedParams?.locale || 'en-US'}/workspaces/${resolvedParams?.workspace || 'ws1'}/projects/${project.id}/overview`);
  };

  // Wait for params to resolve and auth to hydrate
  if (!resolvedParams || !hydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-tertiary">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Topbar />

      <main className="flex-1 max-w-6xl mx-auto w-full p-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Projects</h1>
            <p className="text-secondary">
              Workspace: {currentWorkspace?.name || resolvedParams.workspace}
            </p>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-medium rounded-lg transition-all duration-200">
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        {!isAuthenticated || projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FolderOpen className="w-16 h-16 text-tertiary mb-4" />
            <h2 className="text-xl font-semibold text-primary mb-2">No projects yet</h2>
            <p className="text-secondary">Create your first project to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleProjectClick(project)}
                className="p-6 bg-surface border border-subtle rounded-lg text-left hover:bg-hover transition-all duration-200 group"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-panel rounded-lg group-hover:bg-hover transition-colors">
                    <FolderOpen className="w-6 h-6 text-accent" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">{project.name}</h3>
                    <div className="flex items-center gap-2 text-sm text-secondary">
                      <span className="capitalize">{project.visibility}</span>
                      <span>•</span>
                      <span className="capitalize">{project.role}</span>
                      <span>•</span>
                      <span className="capitalize">{project.status}</span>
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
