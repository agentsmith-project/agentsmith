/**
 * Members React Hooks
 *
 * Custom hooks for Members API operations using React Query.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { handleErrorForToast } from '@/lib/api/errors';
import type { MemberPermissions, QuotaOverride } from '@/lib/api/types';

/**
 * Hook to query members list
 */
export function useMembers(workspaceId: string, projectId: string) {
  const api = getApiClient();
  
  return useQuery({
    queryKey: ['members', workspaceId, projectId],
    queryFn: () => api.members.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
    onError: (error) => handleErrorForToast(error, 'useMembers'),
  });
}

/**
 * Hook to query member permissions
 */
export function useMemberPermissions(
  workspaceId: string,
  projectId: string,
  memberId: string
) {
  const api = getApiClient();

  return useQuery({
    queryKey: ['member-permissions', workspaceId, projectId, memberId],
    queryFn: () => api.members.getPermissions(workspaceId, projectId, memberId),
    enabled: !!workspaceId && !!projectId && !!memberId,
    staleTime: 30 * 1000,
    onError: (error) => handleErrorForToast(error, 'useMemberPermissions'),
  });
}

/**
 * Hook to update member permissions
 */
export function useUpdateMemberPermissions(
  workspaceId: string,
  projectId: string,
  memberId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.permissions');

  return useMutation({
    mutationFn: async (data: {
      template?: 'admin' | 'developer' | 'user' | null;
      permissions?: string[];
      mode: 'template' | 'custom';
    }) => {
      const api = getApiClient();
      return api.members.updatePermissions(workspaceId, projectId, memberId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', workspaceId, projectId] });
      queryClient.invalidateQueries({ queryKey: ['member-permissions', workspaceId, projectId, memberId] });
      toast.success(t('update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateMemberPermissions'),
  });
}

/**
 * Hook to query member quota overrides
 */
export function useMemberQuotaOverrides(
  workspaceId: string,
  projectId: string,
  memberId: string
) {
  const api = getApiClient();

  return useQuery({
    queryKey: ['member-quota-overrides', workspaceId, projectId, memberId],
    queryFn: () => api.members.getQuotaOverrides(workspaceId, projectId, memberId),
    enabled: !!workspaceId && !!projectId && !!memberId,
    staleTime: 30 * 1000,
    onError: (error) => handleErrorForToast(error, 'useMemberQuotaOverrides'),
  });
}

/**
 * Hook to update member quota overrides
 */
export function useUpdateMemberQuotaOverrides(
  workspaceId: string,
  projectId: string,
  memberId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.quota');

  return useMutation({
    mutationFn: async (data: QuotaOverride) => {
      const api = getApiClient();
      return api.members.updateQuotaOverrides(workspaceId, projectId, memberId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-quota-overrides', workspaceId, projectId, memberId] });
      toast.success(t('update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateMemberQuotaOverrides'),
  });
}

/**
 * Hook to query resource ACL
 */
export function useResourceACL(
  workspaceId: string,
  projectId: string,
  resourceType: 'kb' | 'endpoint',
  resourceId: string
) {
  const api = getApiClient();

  return useQuery({
    queryKey: ['resource-acl', workspaceId, projectId, resourceType, resourceId],
    queryFn: () => api.members.getResourceACL(workspaceId, projectId, resourceType, resourceId),
    enabled: !!workspaceId && !!projectId && !!resourceId,
    staleTime: 30 * 1000,
    onError: (error) => handleErrorForToast(error, 'useResourceACL'),
  });
}

/**
 * Hook to update resource ACL
 */
export function useUpdateResourceACL(
  workspaceId: string,
  projectId: string,
  resourceType: 'kb' | 'endpoint',
  resourceId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.acl');

  return useMutation({
    mutationFn: async (data: {
      ops: Array<{
        op: 'allow' | 'deny' | 'remove_deny';
        subject_type: 'user';
        subject_id: string;
        permissions: string[];
        reason?: string;
      }>;
    }) => {
      const api = getApiClient();
      return api.members.updateResourceACL(workspaceId, projectId, resourceType, resourceId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resource-acl', workspaceId, projectId, resourceType, resourceId] });
      toast.success(t('update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateResourceACL'),
  });
}

/**
 * Hook to query permission templates
 */
export function usePermissionTemplates(workspaceId: string, projectId: string) {
  const api = getApiClient();

  return useQuery({
    queryKey: ['permission-templates', workspaceId, projectId],
    queryFn: () => api.members.listPermissionTemplates(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
    onError: (error) => handleErrorForToast(error, 'usePermissionTemplates'),
  });
}

/**
 * Hook to query member change history
 */
export function useMemberChangeHistory(
  workspaceId: string,
  projectId: string,
  memberId: string
) {
  const api = getApiClient();

  return useQuery({
    queryKey: ['member-change-history', workspaceId, projectId, memberId],
    queryFn: () => api.members.getChangeHistory(workspaceId, projectId, memberId),
    enabled: !!workspaceId && !!projectId && !!memberId,
    staleTime: 30 * 1000,
    onError: (error) => handleErrorForToast(error, 'useMemberChangeHistory'),
  });
}
