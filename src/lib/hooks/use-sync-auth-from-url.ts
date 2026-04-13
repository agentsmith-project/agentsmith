/**
 * Hook to sync auth state from URL parameters
 *
 * After refactoring:
 * - Reads workspace/project from URL params
 * - Queries React Query for data loading state
 * - No writing to Zustand for selection
 * - Preserves workspace-specific deep links so pages can render truthful
 *   empty/unavailable states instead of bouncing to generic workspace selection
 */

import { useParams } from 'next/navigation';
import { useWorkspaces } from './use-workspaces';
import { validateWorkspaceParam, validateProjectParam } from '@/lib/utils/validate-url-params';

export function useSyncAuthFromUrl() {
  const params = useParams();

  const { isLoading: workspacesLoading } = useWorkspaces();
  const rawWorkspaceId = params?.workspace;
  const rawProjectId = params?.project;
  const workspaceId = validateWorkspaceParam(rawWorkspaceId);
  const projectId = validateProjectParam(rawProjectId);

  return {
    workspaceId,
    projectId,
    isLoading: workspacesLoading,
  };
}
