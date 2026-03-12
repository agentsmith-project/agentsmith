import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiClient, ModelConfigAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { handleErrorForToast } from '@/lib/api/errors';
import type { ProjectPricingMap } from '@/lib/api';

const getModelConfigAPI = () => new ModelConfigAPI(getApiClient());

export function useProjectPricing(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectPricing.detail(workspaceId, projectId),
    queryFn: () => getModelConfigAPI().getProjectPricing(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function usePatchProjectPricing(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ProjectPricingMap) =>
      getModelConfigAPI().patchProjectPricing(workspaceId, projectId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectPricing.detail(workspaceId, projectId) });
    },
    onError: (error) => handleErrorForToast(error, 'usePatchProjectPricing'),
  });
}
