/**
 * Projects React Hooks
 *
 * Custom hooks for Project API operations using React Query.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getApiClient, ProjectAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { Project } from '@/lib/api/types';

const getProjectAPI = () => new ProjectAPI(getApiClient());

/**
 * Hook to fetch a single project
 */
export function useProject(
  workspaceId: string,
  projectId: string
): UseQueryResult<Project> {
  return useQuery<Project>({
    queryKey: queryKeys.projects.detail(workspaceId, projectId),
    queryFn: () => getProjectAPI().get(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 60 * 1000,
  });
}
