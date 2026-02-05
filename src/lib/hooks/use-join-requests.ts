/**
 * Join Requests React Hooks
 *
 * Custom hooks for Join Requests API operations using React Query.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient, MemberAPI } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';
import type { JoinRequest } from '@/lib/api/endpoints/members';

const getMemberAPI = () => new MemberAPI(getApiClient());

/**
 * Hook to query join requests list
 */
export function useJoinRequests(workspaceId: string, projectId: string) {
  return useQuery<JoinRequest[]>({
    queryKey: queryKeys.joinRequests.list(workspaceId, projectId),
    queryFn: () => getMemberAPI().listJoinRequests(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to approve a join request
 */
export function useApproveJoinRequest(
  workspaceId: string,
  projectId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.join_requests');

  return useMutation({
    mutationFn: async (requestId: string) => {
      return getMemberAPI().approveJoinRequest(workspaceId, projectId, requestId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests.list(workspaceId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      toast.success(t('approve_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useApproveJoinRequest'),
  });
}

/**
 * Hook to reject a join request
 */
export function useRejectJoinRequest(
  workspaceId: string,
  projectId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.join_requests');

  return useMutation({
    mutationFn: async (payload: { requestId: string; reason?: string }) => {
      return getMemberAPI().rejectJoinRequest(workspaceId, projectId, payload.requestId, {
        reason: payload.reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests.list(workspaceId, projectId) });
      toast.success(t('reject_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useRejectJoinRequest'),
  });
}
