'use client';

import { useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { getApiClient, EndpointAPI } from '@/lib/api';
import type { Endpoint } from '@/lib/api/types';

import type { ImportOpenAICompatiblePayload } from './types';

interface UseEndpointsMutationsInput {
  workspaceId: string;
  projectId: string;
  onImportSuccess?: () => void;
  onImportError?: (error: unknown) => void;
}

export function useEndpointsMutations({
  workspaceId,
  projectId,
  onImportSuccess,
  onImportError,
}: UseEndpointsMutationsInput) {
  const queryClient = useQueryClient();
  const endpointAPI = useMemo(() => new EndpointAPI(getApiClient()), []);

  const invalidateEndpoints = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['endpoints', workspaceId, projectId] });
  }, [projectId, queryClient, workspaceId]);

  const deleteEndpointMutation = useMutation({
    mutationFn: (endpointId: string) => endpointAPI.delete(workspaceId, projectId, endpointId),
    onSuccess: invalidateEndpoints,
  });

  const updateEndpointMutation = useMutation({
    mutationFn: (args: { endpointId: string; data: { status?: 'active' | 'disabled' } }) =>
      endpointAPI.update(workspaceId, projectId, args.endpointId, args.data),
    onSuccess: invalidateEndpoints,
  });

  const importOpenAICompatibleMutation = useMutation<{ items: Endpoint[] }, unknown, ImportOpenAICompatiblePayload>({
    mutationFn: (payload) => endpointAPI.importOpenAICompatible(workspaceId, projectId, payload),
    onSuccess: () => {
      invalidateEndpoints();
      onImportSuccess?.();
    },
    onError: (error) => {
      onImportError?.(error);
    },
  });

  return {
    invalidateEndpoints,
    deleteEndpointMutation,
    updateEndpointMutation,
    importOpenAICompatibleMutation,
  };
}
