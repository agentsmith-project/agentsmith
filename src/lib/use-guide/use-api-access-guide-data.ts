'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getApiClient, UserAPIKeyService } from '@/lib/api';
import type { Endpoint } from '@/lib/api/types';
import { useEndpointsData } from '@/lib/endpoints/use-endpoints-data';

interface UseApiAccessGuideDataInput {
  workspaceId: string;
  projectId: string;
  canUseProject: boolean;
  canReadEndpoints: boolean;
}

function endpointSupportsGuideAccess(endpoint: Endpoint): boolean {
  if (endpoint.status !== 'active') {
    return false;
  }

  if (endpoint.protocol !== 'openai_compatible' && endpoint.protocol !== 'anthropic_compatible') {
    return false;
  }

  if (!endpoint.capabilities || endpoint.capabilities.length === 0) {
    return true;
  }

  return endpoint.capabilities.some((capability) =>
    capability.enabled && (capability.type === 'chat_completion' || capability.type === 'multimodal_completion'),
  );
}

export function useApiAccessGuideData({
  workspaceId,
  projectId,
  canUseProject,
  canReadEndpoints,
}: UseApiAccessGuideDataInput) {
  const { endpoints, endpointsLoading } = useEndpointsData({
    workspaceId,
    projectId,
    canReadEndpoints,
  });

  const userApiKeyService = useMemo(() => new UserAPIKeyService(getApiClient()), []);
  const apiKeysQuery = useQuery({
    queryKey: ['user-api-keys', 'use-guide'],
    queryFn: () => userApiKeyService.list(),
    enabled: canUseProject,
  });

  const usableEndpoints = useMemo(
    () => endpoints.filter(endpointSupportsGuideAccess),
    [endpoints],
  );

  const activeApiKeyCount = useMemo(
    () => (apiKeysQuery.data ?? []).filter((item) => item.status === 'active').length,
    [apiKeysQuery.data],
  );

  return {
    apiKeysLoading: apiKeysQuery.isLoading,
    activeApiKeyCount,
    hasActiveApiKey: activeApiKeyCount > 0,
    endpointsLoading,
    usableEndpoints,
  };
}
