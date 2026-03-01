import { useMutation, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getApiClient, GovernanceExplainabilityAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type {
  GovernanceAuthorizationRequest,
  GovernanceAuthorizationResponse,
  GovernanceEffectiveAccessSnapshot,
  GovernanceQuotaCheckRequest,
  GovernanceQuotaCheckResponse,
} from '@/lib/api/endpoints/governance-explainability';

const getGovernanceExplainabilityAPI = () => new GovernanceExplainabilityAPI(getApiClient());

export function useEffectiveAccessSnapshot(
  workspaceId: string,
  projectId: string,
  memberId: string,
): UseQueryResult<GovernanceEffectiveAccessSnapshot> {
  return useQuery({
    queryKey: queryKeys.governanceExplainability.effectiveAccess(workspaceId, projectId, memberId),
    queryFn: () => getGovernanceExplainabilityAPI().getEffectiveAccessSnapshot(workspaceId, projectId, memberId),
    enabled: !!workspaceId && !!projectId && !!memberId,
    staleTime: 30 * 1000,
  });
}

export function useAuthorizationCheck(workspaceId: string, projectId: string) {
  return useMutation<GovernanceAuthorizationResponse, Error, GovernanceAuthorizationRequest>({
    mutationFn: (payload) => getGovernanceExplainabilityAPI().authorize(workspaceId, projectId, payload),
  });
}

export function useQuotaCheck(workspaceId: string, projectId: string) {
  return useMutation<GovernanceQuotaCheckResponse, Error, GovernanceQuotaCheckRequest>({
    mutationFn: (payload) => getGovernanceExplainabilityAPI().checkQuota(workspaceId, projectId, payload),
  });
}
