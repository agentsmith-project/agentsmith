/**
 * Project React Query Hooks
 *
 * Server state management for projects using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { ProjectAPI } from '@/lib/api/endpoints/projects';
import { APIError } from '@/lib/api/errors';

// Query keys factory
export const projectKeys = {
  all: (workspaceId: string) => ['workspaces', workspaceId, 'projects'] as const,
  detail: (workspaceId: string, projectId: string) =>
    ['workspaces', workspaceId, 'projects', projectId] as const,
};

/**
 * Get all projects in a workspace
 */
export function useProjects(workspaceId: string) {
  return useQuery({
    queryKey: projectKeys.all(workspaceId),
    queryFn: async () => {
      const client = getApiClient();
      const api = new ProjectAPI(client);
      const response = await api.list(workspaceId);
      return response.items;
    },
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

/**
 * Get a single project by ID
 */
export function useProject(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: projectKeys.detail(workspaceId, projectId),
    queryFn: async () => {
      const client = getApiClient();
      const api = new ProjectAPI(client);
      return api.get(workspaceId, projectId);
    },
    enabled: !!workspaceId && !!projectId,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof APIError && error.isNotFoundError()) return false;
      return failureCount < 2;
    },
  });
}
