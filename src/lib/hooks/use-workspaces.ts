/**
 * Workspace React Query Hooks
 *
 * Server state management for workspaces using React Query.
 */

import { useQuery } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { WorkspaceAPI } from '@/lib/api/endpoints/workspaces';

// Query keys factory
export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (id: string) => ['workspaces', id] as const,
};

/**
 * Get all workspaces for current user
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: async () => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.list();
    },
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Get a single workspace by ID
 */
export function useWorkspace(id: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(id),
    queryFn: async () => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.get(id);
    },
    enabled: !!id,
    staleTime: 60_000,
  });
}
