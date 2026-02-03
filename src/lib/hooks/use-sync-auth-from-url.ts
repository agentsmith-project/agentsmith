/**
 * Hook to sync auth state from URL parameters
 *
 * After refactoring:
 * - Reads workspace/project from URL params
 * - Queries React Query for data
 * - No writing to Zustand for selection
 * - Handles deep links and redirects
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useWorkspaces } from './use-workspaces';
import { useProjects } from './use-projects-queries';
import { useAuthStoreHydration } from '@/lib/stores/authStore';

export function useSyncAuthFromUrl() {
  const params = useParams();
  const router = useRouter();
  const hydrated = useAuthStoreHydration();

  const { data: workspaces, isLoading: workspacesLoading } = useWorkspaces();
  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;

  // Get projects for current workspace (if workspace selected)
  const { data: projects, isLoading: projectsLoading } = useProjects(workspaceId || '');

  // Validate workspace from URL
  useEffect(() => {
    if (!hydrated || workspacesLoading || !workspaceId) return;

    const workspaceExists = workspaces?.find((ws) => ws.id === workspaceId);

    if (!workspaceExists) {
      // Workspace not found for user, redirect to workspace list
      router.replace('/workspaces');
    }
  }, [hydrated, workspaceId, workspaces, workspacesLoading, router]);

  // Validate project from URL
  useEffect(() => {
    if (!hydrated || !workspaceId || projectsLoading) return;

    // If no project in URL, we're on project list page - nothing to validate
    if (!projectId) return;

    const projectExists = projects?.find((p) => p.id === projectId);

    if (!projectExists) {
      // Project not found or not in this workspace, redirect to project list
      router.replace(`/workspaces/${workspaceId}/projects`);
    }
  }, [hydrated, workspaceId, projectId, projects, projectsLoading, router]);

  return {
    workspaceId,
    projectId,
    isLoading: workspacesLoading || projectsLoading,
  };
}
