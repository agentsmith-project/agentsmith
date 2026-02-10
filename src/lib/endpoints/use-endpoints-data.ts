'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getApiClient, EndpointAPI } from '@/lib/api';

interface UseEndpointsDataInput {
  workspaceId: string;
  projectId: string;
  canReadEndpoints: boolean;
}

export function useEndpointsData({ workspaceId, projectId, canReadEndpoints }: UseEndpointsDataInput) {
  const endpointAPI = useMemo(() => new EndpointAPI(getApiClient()), []);

  const { data, isLoading } = useQuery({
    queryKey: ['endpoints', workspaceId, projectId],
    queryFn: () => endpointAPI.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId && canReadEndpoints,
  });

  return {
    endpoints: data?.items ?? [],
    endpointsLoading: isLoading,
  };
}
