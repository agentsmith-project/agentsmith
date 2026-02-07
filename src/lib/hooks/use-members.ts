/**
 * Members React Hooks
 *
 * Custom hooks for Members API operations using React Query.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient, MemberAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toast } from '@/components/ui/toast';
import { handleErrorForToast } from '@/lib/api/errors';
import type {
  QuotaOverride,
  QuotaOverrideHistoryItem,
  QuotaTemplate,
  MemberPermissions,
  ResourcePolicy,
  ResourcePolicyUpdateRequest,
  PermissionTemplate,
  ChangeHistoryEntry,
} from '@/lib/api/types';
import type { CreateInviteRequest, InviteResponse, ProjectGroup } from '@/lib/api/endpoints/members';

const getMemberAPI = () => new MemberAPI(getApiClient());

/**
 * Hook to create an invite
 */
export function useCreateInvite(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.invite');

  return useMutation({
    mutationFn: async (data: CreateInviteRequest): Promise<InviteResponse> => {
      return getMemberAPI().createInvite(workspaceId, projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.joinRequests.list(workspaceId, projectId) });
      toast.success(t('create_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useCreateInvite'),
  });
}

/**
 * Hook to query members list
 */
export function useMembers(workspaceId: string, projectId: string) {
  return useQuery({
    queryKey: queryKeys.members.list(workspaceId, projectId),
    queryFn: () => getMemberAPI().list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to remove a member from project
 */
export function useRemoveMember(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members');

  return useMutation({
    mutationFn: async (memberId: string) => {
      return getMemberAPI().remove(workspaceId, projectId, memberId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      toast.success(t('remove_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useRemoveMember'),
  });
}

/**
 * Hook to query member permissions
 */
export function useMemberPermissions(
  workspaceId: string,
  projectId: string,
  memberId: string
): UseQueryResult<MemberPermissions> {
  return useQuery<MemberPermissions>({
    queryKey: queryKeys.members.permissions(workspaceId, projectId, memberId),
    queryFn: () => getMemberAPI().getPermissions(workspaceId, projectId, memberId),
    enabled: !!workspaceId && !!projectId && !!memberId,
    staleTime: 30 * 1000,
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
      return getMemberAPI().updatePermissions(workspaceId, projectId, memberId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.members.permissions(workspaceId, projectId, memberId) });
      toast.success(t('update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateMemberPermissions'),
  });
}

/**
 * Hook to update any member's permissions (for Apply Template flow)
 */
export function useApplyTemplateToMember(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async ({
      memberId,
      permissions,
      template,
    }: {
      memberId: string;
      permissions: string[];
      template?: 'admin' | 'developer' | 'user' | null;
    }) => {
      const mode = template ? 'template' : 'custom';
      return getMemberAPI().updatePermissions(workspaceId, projectId, memberId, {
        permissions,
        mode,
        template: template ?? undefined,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.members.permissions(workspaceId, projectId, variables.memberId),
      });
      toast.success(t('apply_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useApplyTemplateToMember'),
  });
}

/**
 * Hook to batch apply permission template to multiple members
 */
export function useBatchApplyPermissionTemplate(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async ({
      memberIds,
      permissions,
      template,
    }: {
      memberIds: string[];
      permissions: string[];
      template?: 'admin' | 'developer' | 'user' | null;
    }) => {
      const mode = template ? 'template' : 'custom';
      const appliedMemberIds: string[] = [];
      const failedMemberIds: string[] = [];
      for (const memberId of memberIds) {
        try {
          await getMemberAPI().updatePermissions(workspaceId, projectId, memberId, {
            permissions,
            mode,
            template: template ?? undefined,
          });
          appliedMemberIds.push(memberId);
        } catch {
          failedMemberIds.push(memberId);
        }
      }

      if (appliedMemberIds.length === 0) {
        throw new Error(t('apply_all_failed'));
      }

      return { appliedMemberIds, failedMemberIds };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      for (const memberId of data.appliedMemberIds) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.members.permissions(workspaceId, projectId, memberId),
        });
      }
      const appliedCount = data.appliedMemberIds.length;
      const failedCount = data.failedMemberIds.length;
      if (failedCount > 0) {
        toast.warning(t('apply_partial_success'));
        return;
      }
      toast.success(
        appliedCount === 1
          ? t('apply_success')
          : t('apply_batch_success', { count: appliedCount.toString() })
      );
    },
    onError: (error) => handleErrorForToast(error, 'useBatchApplyPermissionTemplate'),
  });
}

/**
 * Hook to query member quota overrides
 */
export function useMemberQuotaOverrides(
  workspaceId: string,
  projectId: string,
  memberId: string
): UseQueryResult<QuotaOverride> {
  return useQuery<QuotaOverride>({
    queryKey: queryKeys.members.quotaOverrides(workspaceId, projectId, memberId),
    queryFn: () => getMemberAPI().getQuotaOverrides(workspaceId, projectId, memberId),
    enabled: !!workspaceId && !!projectId && !!memberId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to query member quota overrides history
 */
export function useMemberQuotaOverridesHistory(
  workspaceId: string,
  projectId: string,
  memberId: string,
  params?: { page?: number; page_size?: number },
  options?: { enabled?: boolean }
): UseQueryResult<{ items: QuotaOverrideHistoryItem[]; total: number; page: number; page_size: number }> {
  const enabled = options?.enabled !== false && !!workspaceId && !!projectId && !!memberId;
  return useQuery({
    queryKey: queryKeys.members.quotaOverridesHistory(workspaceId, projectId, memberId, params?.page ?? 1, params?.page_size ?? 20),
    queryFn: () => getMemberAPI().getQuotaOverridesHistory(workspaceId, projectId, memberId, params),
    enabled,
    staleTime: 30 * 1000,
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
      return getMemberAPI().updateQuotaOverrides(workspaceId, projectId, memberId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.quotaOverrides(workspaceId, projectId, memberId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.members.quotaOverridesHistory(workspaceId, projectId, memberId, 1, 20) });
      toast.success(t('update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateMemberQuotaOverrides'),
  });
}

/**
 * Hook to query resource policy
 */
export function useResourcePolicy(
  workspaceId: string,
  projectId: string,
  resourceType: 'endpoint' | 'source_library' | 'agent',
  resourceId: string
): UseQueryResult<ResourcePolicy> {
  return useQuery<ResourcePolicy>({
    queryKey: queryKeys.resourcePolicy.detail(workspaceId, projectId, resourceType, resourceId),
    queryFn: () =>
      getMemberAPI().getResourcePolicy(workspaceId, projectId, resourceType, resourceId),
    enabled: !!workspaceId && !!projectId && !!resourceId,
    staleTime: 30 * 1000,
  });
}

/**
 * Hook to update resource policy
 */
export function useUpdateResourcePolicy(
  workspaceId: string,
  projectId: string,
  resourceType: 'endpoint' | 'source_library' | 'agent',
  resourceId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.acl');

  return useMutation({
    mutationFn: async (data: ResourcePolicyUpdateRequest) => {
      return getMemberAPI().updateResourcePolicy(workspaceId, projectId, resourceType, resourceId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.resourcePolicy.detail(workspaceId, projectId, resourceType, resourceId) });
      toast.success(t('update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateResourcePolicy'),
  });
}

/**
 * Hook to query permission templates
 */
export function usePermissionTemplates(
  workspaceId: string,
  projectId: string
): UseQueryResult<PermissionTemplate[]> {
  return useQuery<PermissionTemplate[]>({
    queryKey: queryKeys.permissionTemplates.list(workspaceId, projectId),
    queryFn: () => getMemberAPI().listPermissionTemplates(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to create a permission template
 */
export function useCreatePermissionTemplate(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (data: { name: string; description?: string; permissions: string[] }) => {
      return getMemberAPI().createPermissionTemplate(workspaceId, projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permissionTemplates.list(workspaceId, projectId) });
      toast.success(t('create_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useCreatePermissionTemplate'),
  });
}

/**
 * Hook to update a permission template
 */
export function useUpdatePermissionTemplate(
  workspaceId: string,
  projectId: string,
  templateId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (data: { name?: string; description?: string; permissions?: string[] }) => {
      return getMemberAPI().updatePermissionTemplate(workspaceId, projectId, templateId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permissionTemplates.list(workspaceId, projectId) });
      toast.success(t('update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdatePermissionTemplate'),
  });
}

/**
 * Hook to delete a permission template
 */
export function useDeletePermissionTemplate(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (templateId: string) => {
      return getMemberAPI().deletePermissionTemplate(workspaceId, projectId, templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.permissionTemplates.list(workspaceId, projectId) });
      toast.success(t('delete_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useDeletePermissionTemplate'),
  });
}

/**
 * Hook to query quota templates
 */
export function useQuotaTemplates(
  workspaceId: string,
  projectId: string
): UseQueryResult<QuotaTemplate[]> {
  return useQuery<QuotaTemplate[]>({
    queryKey: queryKeys.quotaTemplates.list(workspaceId, projectId),
    queryFn: () => getMemberAPI().listQuotaTemplates(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to create a quota template
 */
export function useCreateQuotaTemplate(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      overrides_json: QuotaOverride;
    }) => {
      return getMemberAPI().createQuotaTemplate(workspaceId, projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.quotaTemplates.list(workspaceId, projectId) });
      toast.success(t('quota_create_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useCreateQuotaTemplate'),
  });
}

/**
 * Hook to update a quota template
 */
export function useUpdateQuotaTemplate(
  workspaceId: string,
  projectId: string,
  templateId: string
) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (data: {
      name?: string;
      description?: string;
      overrides_json?: QuotaOverride;
    }) => {
      return getMemberAPI().updateQuotaTemplate(
        workspaceId,
        projectId,
        templateId,
        data
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.quotaTemplates.list(workspaceId, projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.quotaTemplates.detail(workspaceId, projectId, templateId) });
      toast.success(t('quota_update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateQuotaTemplate'),
  });
}

/**
 * Hook to delete a quota template
 */
export function useDeleteQuotaTemplate(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (templateId: string) => {
      return getMemberAPI().deleteQuotaTemplate(workspaceId, projectId, templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.quotaTemplates.list(workspaceId, projectId) });
      toast.success(t('quota_delete_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useDeleteQuotaTemplate'),
  });
}

/**
 * Hook to batch apply quota template to members
 */
export function useBatchApplyQuotaTemplate(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async ({
      templateId,
      memberIds,
    }: {
      templateId: string;
      memberIds: string[];
    }) => {
      const res = await getMemberAPI().applyQuotaTemplate(
        workspaceId,
        projectId,
        templateId,
        memberIds
      );
      const failedCount = Math.max(0, memberIds.length - res.applied_count);
      return { memberIds, appliedCount: res.applied_count, failedCount };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      for (const memberId of data.memberIds) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.members.quotaOverrides(workspaceId, projectId, memberId),
        });
      }
      const appliedCount = data.appliedCount;
      const failedCount = data.failedCount;

      if (failedCount > 0) {
        toast.warning(t('quota_apply_partial_success'));
        return;
      }

      toast.success(
        appliedCount === 1
          ? t('quota_apply_success')
          : t('quota_apply_batch_success', { count: appliedCount.toString() })
      );
    },
    onError: (error) => handleErrorForToast(error, 'useBatchApplyQuotaTemplate'),
  });
}

/**
 * Hook to query member change history
 */
export function useMemberChangeHistory(
  workspaceId: string,
  projectId: string,
  memberId: string
): UseQueryResult<ChangeHistoryEntry[]> {
  return useQuery<ChangeHistoryEntry[]>({
    queryKey: queryKeys.members.changeHistory(workspaceId, projectId, memberId),
    queryFn: () => getMemberAPI().getChangeHistory(workspaceId, projectId, memberId),
    enabled: !!workspaceId && !!projectId && !!memberId,
    staleTime: 30 * 1000,
  });
}

export function useProjectGroups(
  workspaceId: string,
  projectId: string
): UseQueryResult<ProjectGroup[]> {
  return useQuery<ProjectGroup[]>({
    queryKey: queryKeys.projectGroups.list(workspaceId, projectId),
    queryFn: () => getMemberAPI().listGroups(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30 * 1000,
  });
}

export function useCreateProjectGroup(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      permission_template_id: string;
      member_ids?: string[];
    }) => getMemberAPI().createGroup(workspaceId, projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectGroups.list(workspaceId, projectId) });
      toast.success(t('group_create_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useCreateProjectGroup'),
  });
}

export function useUpdateProjectGroup(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async ({
      groupId,
      data,
    }: {
      groupId: string;
      data: {
        name?: string;
        description?: string;
        permission_template_id?: string;
        member_ids?: string[];
      };
    }) => getMemberAPI().updateGroup(workspaceId, projectId, groupId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectGroups.list(workspaceId, projectId) });
      toast.success(t('group_update_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useUpdateProjectGroup'),
  });
}

export function useDeleteProjectGroup(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async (groupId: string) => getMemberAPI().deleteGroup(workspaceId, projectId, groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projectGroups.list(workspaceId, projectId) });
      toast.success(t('group_delete_success'));
    },
    onError: (error) => handleErrorForToast(error, 'useDeleteProjectGroup'),
  });
}

export function useApplyProjectGroupTemplate(workspaceId: string, projectId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations('members.templates');

  return useMutation({
    mutationFn: async ({
      groupId,
      memberIds,
    }: {
      groupId: string;
      memberIds?: string[];
    }) => getMemberAPI().applyGroupTemplate(workspaceId, projectId, groupId, memberIds),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members.list(workspaceId, projectId) });
      const failedCount = result.results?.filter((item) => item.status === 'failed').length ?? 0;
      if (failedCount > 0) {
        toast.warning(t('group_apply_partial_success', { count: failedCount.toString() }));
        return;
      }
      toast.success(t('group_apply_success', { count: result.applied_count.toString() }));
    },
    onError: (error) => handleErrorForToast(error, 'useApplyProjectGroupTemplate'),
  });
}
