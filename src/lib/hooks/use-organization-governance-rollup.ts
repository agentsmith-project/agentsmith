import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getApiClient } from '@/lib/api/client';
import { ProjectAPI } from '@/lib/api/endpoints/projects';
import { WorkspaceAPI } from '@/lib/api/endpoints/workspaces';
import type { Project, Workspace, WorkspaceMember } from '@/lib/api/types';
import { buildOrganizationGovernanceRollup } from '@/lib/organization-governance-rollup';
import { projectKeys } from '@/lib/hooks/use-projects-queries';
import { workspaceKeys } from '@/lib/hooks/use-workspaces';
import { useAuthStore } from '@/lib/stores/authStore';

export function useOrganizationGovernanceRollup(workspaces: Workspace[] | undefined) {
  const token = useAuthStore((state) => state.token);
  const workspaceList = useMemo(() => workspaces ?? [], [workspaces]);
  const workspaceIds = workspaceList.map((workspace) => workspace.id);

  const projectQueries = useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: projectKeys.all(workspaceId),
      queryFn: async () => {
        const api = new ProjectAPI(getApiClient());
        const response = await api.list(workspaceId);
        return response.items as Project[];
      },
      enabled: Boolean(token) && workspaceId.length > 0,
      staleTime: 60_000,
    })),
  });

  const memberQueries = useQueries({
    queries: workspaceIds.map((workspaceId) => ({
      queryKey: workspaceKeys.members(workspaceId),
      queryFn: async () => {
        const api = new WorkspaceAPI(getApiClient());
        return api.listMembers(workspaceId);
      },
      enabled: Boolean(token) && workspaceId.length > 0,
      staleTime: 60_000,
    })),
  });

  const hasQueryError = projectQueries.some((query) => query.isError) || memberQueries.some((query) => query.isError);
  const isLoading =
    workspaceList.length > 0
    && (projectQueries.some((query) => query.isPending) || memberQueries.some((query) => query.isPending));

  const readyWorkspaceIds = workspaceIds.filter((_, index) => {
    const projects = projectQueries[index]?.data;
    const members = memberQueries[index]?.data;
    return Array.isArray(projects) && Array.isArray(members);
  });

  const membersByWorkspaceId = useMemo(() => {
    const byWorkspace: Record<string, WorkspaceMember[]> = {};
    for (const workspaceId of readyWorkspaceIds) {
      const index = workspaceIds.indexOf(workspaceId);
      byWorkspace[workspaceId] = memberQueries[index]?.data ?? [];
    }
    return byWorkspace;
  }, [memberQueries, readyWorkspaceIds, workspaceIds]);

  const projectsByWorkspaceId = useMemo(() => {
    const byWorkspace: Record<string, Project[]> = {};
    for (const workspaceId of readyWorkspaceIds) {
      const index = workspaceIds.indexOf(workspaceId);
      byWorkspace[workspaceId] = projectQueries[index]?.data ?? [];
    }
    return byWorkspace;
  }, [projectQueries, readyWorkspaceIds, workspaceIds]);

  const readyWorkspaces = useMemo(
    () => workspaceList.filter((workspace) => readyWorkspaceIds.includes(workspace.id)),
    [readyWorkspaceIds, workspaceList],
  );

  const rollup = useMemo(() => {
    if (readyWorkspaces.length === 0) {
      return null;
    }
    return buildOrganizationGovernanceRollup({
      workspaces: readyWorkspaces,
      membersByWorkspaceId,
      projectsByWorkspaceId,
    });
  }, [membersByWorkspaceId, projectsByWorkspaceId, readyWorkspaces]);

  const refetch = async () => {
    await Promise.all([
      ...projectQueries.map((query) => query.refetch()),
      ...memberQueries.map((query) => query.refetch()),
    ]);
  };

  return {
    isLoading,
    isError: hasQueryError,
    rollup,
    refetch,
  };
}
