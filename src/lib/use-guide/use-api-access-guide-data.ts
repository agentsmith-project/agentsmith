'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ContextAPI, getApiClient, UserAPIKeyService } from '@/lib/api';
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

  if (
    endpoint.upstream_protocol !== 'openai_chat_completions'
    && endpoint.upstream_protocol !== 'openai_responses'
    && endpoint.upstream_protocol !== 'anthropic_messages'
  ) {
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
  const contextApi = useMemo(() => new ContextAPI(getApiClient()), []);
  const apiKeysQuery = useQuery({
    queryKey: ['user-api-keys', 'use-guide'],
    queryFn: () => userApiKeyService.list(),
    enabled: canUseProject,
  });
  const workspacePersonalContextQuery = useQuery({
    queryKey: ['context-store', 'member', 'use-guide', workspaceId],
    queryFn: () => contextApi.list({
      scope: 'member',
      workspace_id: workspaceId,
    }),
    enabled: canUseProject && workspaceId.trim().length > 0,
  });
  const projectPersonalContextQuery = useQuery({
    queryKey: ['context-store', 'project_member', 'use-guide', workspaceId, projectId],
    queryFn: () => contextApi.list({
      scope: 'project_member',
      workspace_id: workspaceId,
      project_id: projectId,
    }),
    enabled: canUseProject && workspaceId.trim().length > 0 && projectId.trim().length > 0,
  });

  const usableEndpoints = useMemo(
    () => endpoints.filter(endpointSupportsGuideAccess),
    [endpoints],
  );

  const activeApiKeyCount = useMemo(
    () => (apiKeysQuery.data ?? []).filter((item) => item.status === 'active').length,
    [apiKeysQuery.data],
  );

  const workspacePersonalContextCount = workspacePersonalContextQuery.data?.length ?? 0;
  const projectPersonalContextCount = projectPersonalContextQuery.data?.length ?? 0;

  return {
    apiKeysLoading: apiKeysQuery.isLoading,
    activeApiKeyCount,
    hasActiveApiKey: activeApiKeyCount > 0,
    endpointsLoading,
    usableEndpoints,
    personalContextLoading: workspacePersonalContextQuery.isLoading || projectPersonalContextQuery.isLoading,
    workspacePersonalContextCount,
    projectPersonalContextCount,
    hasAnyPersonalContext: workspacePersonalContextCount > 0 || projectPersonalContextCount > 0,
  };
}
