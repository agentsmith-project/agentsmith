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
import { useParams } from 'next/navigation';
import { useRouter } from '@/lib/i18n/routing';
import { useWorkspaces } from './use-workspaces';
import { useAuthStoreHydration } from '@/lib/stores/authStore';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

export function useSyncAuthFromUrl() {
  const params = useParams();
  const router = useRouter();
  const hydrated = useAuthStoreHydration();

  const {
    data: workspaces,
    isLoading: workspacesLoading,
    isError: workspacesError,
  } = useWorkspaces();
  const rawWorkspaceId = params?.workspace;
  const rawProjectId = params?.project;
  const workspaceId = validateWorkspaceParam(rawWorkspaceId);
  const projectId = validateProjectParam(rawProjectId);

  // Validate workspace from URL
  useEffect(() => {
    if (!hydrated || workspacesLoading || workspacesError || !workspaceId) return;
    if (!Array.isArray(workspaces)) return;

    const workspaceExists = workspaces?.find((ws) => ws.id === workspaceId);

    if (!workspaceExists) {
      // Workspace not found for user, redirect to workspace list
      router.replace('/workspaces');
    }
  }, [hydrated, workspaceId, workspaces, workspacesLoading, workspacesError, router]);

  return {
    workspaceId,
    projectId,
    isLoading: workspacesLoading,
  };
}
