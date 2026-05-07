'use client';

import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { EndpointAPI, getApiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

interface UseAgentTaskModelSettingInput {
  workspaceId: string;
  projectId: string;
  enabled?: boolean;
}

interface UpdateAgentTaskModelSettingInput {
  endpointId: string;
  expectedSettingRevision: string | null;
}

export function useAgentTaskModelSetting({
  workspaceId,
  projectId,
  enabled = true,
}: UseAgentTaskModelSettingInput) {
  const queryClient = useQueryClient();
  const endpointAPI = useMemo(() => new EndpointAPI(getApiClient()), []);
  const settingQueryKey = queryKeys.endpoints.agentTaskModelSetting(workspaceId, projectId);
  const endpointsQueryKey = queryKeys.endpoints.list(workspaceId, projectId);

  const settingQuery = useQuery({
    queryKey: settingQueryKey,
    queryFn: () => endpointAPI.getAgentTaskModelSetting(workspaceId, projectId),
    enabled: enabled && !!workspaceId && !!projectId,
    retry: false,
    staleTime: 10_000,
  });

  const updateSettingMutation = useMutation({
    mutationFn: ({ endpointId, expectedSettingRevision }: UpdateAgentTaskModelSettingInput) =>
      endpointAPI.updateAgentTaskModelSetting(workspaceId, projectId, {
        endpoint_id: endpointId,
        expected_setting_revision: expectedSettingRevision,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: settingQueryKey }),
        queryClient.invalidateQueries({ queryKey: endpointsQueryKey }),
      ]);
    },
  });

  return {
    settingQuery,
    updateSettingMutation,
  };
}
