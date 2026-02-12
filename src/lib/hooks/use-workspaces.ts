/**
 * Workspace React Query Hooks
 *
 * Server state management for workspaces using React Query.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { WorkspaceAPI } from '@/lib/api/endpoints/workspaces';
import { useAuthStore } from '@/lib/stores/authStore';

// Query keys factory
export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (id: string) => ['workspaces', id] as const,
  members: (id: string) => ['workspaces', id, 'members'] as const,
};

/**
 * Get all workspaces for current user
 */
export function useWorkspaces() {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: async () => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.list();
    },
    enabled: Boolean(token),
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Get a single workspace by ID
 */
export function useWorkspace(id: string) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: workspaceKeys.detail(id),
    queryFn: async () => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.get(id);
    },
    enabled: !!id && Boolean(token),
    staleTime: 60_000,
  });
}

/**
 * Get workspace members by workspace ID
 */
export function useWorkspaceMembers(id: string) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: workspaceKeys.members(id),
    queryFn: async () => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.listMembers(id);
    },
    enabled: !!id && Boolean(token),
    staleTime: 60_000,
  });
}

/**
 * Update governance group for a workspace member.
 * Uses optimistic cache update to keep UI stable.
 */
export function useUpdateWorkspaceMemberGovernanceGroup(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      memberId,
      governanceGroup,
    }: {
      memberId: string;
      governanceGroup: 'wheel' | 'user';
    }) => {
      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.updateMemberGovernanceGroup(workspaceId, memberId, governanceGroup);
    },
    onMutate: async ({ memberId, governanceGroup }) => {
      const key = workspaceKeys.members(workspaceId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Array<{ id: string; governance_group?: 'wheel' | 'user' }>>(key);
      if (previous) {
        queryClient.setQueryData(
          key,
          previous.map((member) =>
            member.id === memberId ? { ...member, governance_group: governanceGroup } : member
          )
        );
      }
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(workspaceKeys.members(workspaceId), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) });
    },
  });
}
