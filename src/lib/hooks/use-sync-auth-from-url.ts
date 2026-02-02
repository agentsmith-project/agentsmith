/**
 * Hook to sync auth store state from URL parameters
 * 
 * This hook ensures that currentWorkspace and currentProject in the store
 * are always in sync with the URL parameters. This is important for:
 * - Direct URL navigation (deep links)
 * - Browser back/forward navigation
 * - Programmatic navigation
 */

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { useAuthStoreHydration } from '@/lib/stores/authStore';

export function useSyncAuthFromUrl() {
  const params = useParams();
  const hydrated = useAuthStoreHydration();
  const {
    workspaces,
    projects: allProjects,
    currentWorkspace,
    currentProject,
    setWorkspace,
    setProject,
  } = useAuthStore();

  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;

  // Sync workspace from URL
  useEffect(() => {
    if (!hydrated || !workspaceId || !workspaces) return;

    const workspaceFromUrl = workspaces.find((ws) => ws.id === workspaceId);
    
    if (workspaceFromUrl && currentWorkspace?.id !== workspaceFromUrl.id) {
      // Update workspace in store (this will clear currentProject)
      setWorkspace(workspaceFromUrl);
      // Note: We don't update projects here - projects should contain all projects
      // Components will filter by currentWorkspace.id when needed
    }
  }, [hydrated, workspaceId, workspaces, currentWorkspace, setWorkspace]);

  // Sync project from URL (only if we have a workspace)
  useEffect(() => {
    if (!hydrated || !projectId || !workspaceId || !currentWorkspace) return;
    if (currentWorkspace.id !== workspaceId) return; // Wait for workspace to sync first

    const projectFromUrl = allProjects.find(
      (p) => p.id === projectId && p.workspace_id === workspaceId
    );

    if (projectFromUrl && currentProject?.id !== projectFromUrl.id) {
      // Verify project belongs to current workspace
      if (projectFromUrl.workspace_id === currentWorkspace.id) {
        setProject(projectFromUrl);
      }
    } else if (!projectFromUrl && currentProject) {
      // If URL has no project but store has one, clear it (user navigated to project list)
      // Actually, we should only clear if we're on the projects page, not if we're on a project page
      // So we'll leave this for now - the project list page will handle clearing
    }
  }, [hydrated, projectId, workspaceId, currentWorkspace, allProjects, currentProject, setProject]);
}
