/**
 * Project React Query Hooks
 *
 * Server state management for projects using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { ProjectAPI } from '@/lib/api/endpoints/projects';
import { APIError } from '@/lib/api/errors';
import { useAuthStore } from '@/lib/stores/authStore';

// Query keys factory
export const projectKeys = {
  all: (workspaceId: string) =>
    ['workspaces', workspaceId, 'projects', 'discoverable'] as const,
  governable: (workspaceId: string) =>
    ['workspaces', workspaceId, 'projects', 'governable'] as const,
  detail: (workspaceId: string, projectId: string) =>
    ['workspaces', workspaceId, 'projects', projectId] as const,
};

/**
 * Get all projects in a workspace
 */
export function useProjects(
  workspaceId: string,
  options?: { enabled?: boolean },
) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: projectKeys.all(workspaceId),
    queryFn: async () => {
      const client = getApiClient();
      const api = new ProjectAPI(client);
      const response = await api.list(workspaceId);
      return response.items;
    },
    enabled: (options?.enabled ?? true) && !!workspaceId && Boolean(token),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof APIError && error.isNotFoundError()) return false;
      return failureCount < 2;
    },
  });
}

export function useGovernableProjects(
  workspaceId: string,
  options?: { enabled?: boolean },
) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: projectKeys.governable(workspaceId),
    queryFn: async () => {
      const client = getApiClient();
      const api = new ProjectAPI(client);
      const response = await api.listGovernable(workspaceId);
      return response.items;
    },
    enabled: (options?.enabled ?? true) && !!workspaceId && Boolean(token),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof APIError && error.isNotFoundError()) return false;
      return failureCount < 2;
    },
  });
}

/**
 * Get a single project by ID
 */
export function useProject(workspaceId: string, projectId: string) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: projectKeys.detail(workspaceId, projectId),
    queryFn: async () => {
      const client = getApiClient();
      const api = new ProjectAPI(client);
      return api.get(workspaceId, projectId);
    },
    enabled: !!workspaceId && !!projectId && Boolean(token),
    staleTime: 60_000,
    retry: (failureCount, error) => {
      if (error instanceof APIError && error.isNotFoundError()) return false;
      return failureCount < 2;
    },
  });
}
