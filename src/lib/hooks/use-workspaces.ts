/**
 * Workspace React Query Hooks
 *
 * Server state management for workspaces using React Query.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { WorkspaceAPI } from '@/lib/api/endpoints/workspaces';
import type { PublicWorkspaceSummary, Workspace } from '@/lib/api/types';
import { useAuthStore } from '@/lib/stores/authStore';

// Query keys factory
export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (id: string) => ['workspaces', id] as const,
  members: (id: string) => ['workspaces', id, 'members'] as const,
};

type WorkspaceQueryOptions = { public?: false } | { public: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPublicWorkspaceSummary(value: unknown, index: number): PublicWorkspaceSummary {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    throw new Error(`workspace_directory_invalid_item_${index}`);
  }

  const id = value.id.trim();
  const name = value.name.trim();
  if (!id || !name) {
    throw new Error(`workspace_directory_invalid_item_${index}`);
  }

  return { id, name };
}

function parsePublicWorkspaceListResponse(payload: unknown): PublicWorkspaceSummary[] {
  if (!isRecord(payload)) {
    throw new Error('workspace_directory_invalid_response');
  }

  if (payload.items === undefined) {
    return [];
  }

  if (!Array.isArray(payload.items)) {
    throw new Error('workspace_directory_invalid_items');
  }

  return payload.items.map((item, index) => readPublicWorkspaceSummary(item, index));
}

async function fetchPublicWorkspaces(): Promise<PublicWorkspaceSummary[]> {
  const response = await fetch('/api/public/workspaces', { cache: 'no-store' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as unknown;
    const message = isRecord(body) && typeof body.error_message === 'string'
      ? body.error_message
      : 'workspace_directory_unavailable';
    throw new Error(message);
  }

  return parsePublicWorkspaceListResponse(await response.json() as unknown);
}

export function usePublicWorkspaces(): UseQueryResult<PublicWorkspaceSummary[], Error> {
  return useQuery<PublicWorkspaceSummary[], Error>({
    queryKey: [...workspaceKeys.all, 'public'],
    queryFn: fetchPublicWorkspaces,
    enabled: true,
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Get all workspaces for current user
 */
export function useWorkspaces(options: { public: true }): UseQueryResult<PublicWorkspaceSummary[], Error>;
export function useWorkspaces(options?: { public?: false }): UseQueryResult<Workspace[], Error>;
export function useWorkspaces(options?: WorkspaceQueryOptions): UseQueryResult<Workspace[] | PublicWorkspaceSummary[], Error> {
  const token = useAuthStore((state) => state.token);
  const isPublic = options?.public === true;
  return useQuery<Workspace[] | PublicWorkspaceSummary[], Error>({
    queryKey: [...workspaceKeys.all, isPublic ? 'public' : 'private'],
    queryFn: async () => {
      if (isPublic) {
        return fetchPublicWorkspaces();
      }

      const client = getApiClient();
      const api = new WorkspaceAPI(client);
      return api.list();
    },
    enabled: isPublic ? true : Boolean(token),
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
