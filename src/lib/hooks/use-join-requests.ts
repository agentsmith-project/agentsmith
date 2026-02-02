/**
 * Join Requests React Hooks
 *
 * Custom hooks for Join Requests API operations using React Query.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { handleErrorForToast } from '@/lib/api/errors';
import type { JoinRequest } from '@/lib/api/endpoints/members';

/**
 * Hook to query join requests list
 */
export function useJoinRequests(workspaceId: string, projectId: string) {
  const api = getApiClient();
  
  return useQuery<JoinRequest[]>({
    queryKey: ['join-requests', workspaceId, projectId],
    queryFn: () => {
      const api = getApiClient();
      return api.members.listJoinRequests(workspaceId, projectId);
    },
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
    onError: (error) => handleErrorForToast(error, 'useJoinRequests'),
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
      const api = getApiClient();
      return api.members.approveJoinRequest(workspaceId, projectId, requestId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['join-requests', workspaceId, projectId] });
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId, projectId] });
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
    mutationFn: async (requestId: string) => {
      const api = getApiClient();
      return api.members.rejectJoinRequest(workspaceId, projectId, requestId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['join-requests', workspaceId, projectId] });
      toast.success(t('reject_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useRejectJoinRequest'),
  });
}
