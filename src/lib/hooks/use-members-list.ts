/**
 * Members List Hook
 *
 * Business logic for members page:
 * - Fetch members and related data
 * - Manage local state (selection, filters, dialogs)
 * - Handle member actions (remove, edit permissions)
 */

import { useState, useCallback } from 'react';
import { useProject } from './use-projects';
import {
  useMembers,
  useMemberPermissions,
  useMemberQuotaOverrides,
  useMemberChangeHistory,
  useMemberQuotaOverridesHistory,
  useUpdateMemberPermissions,
  useUpdateMemberQuotaOverrides,
  useRemoveMember,
  usePermissionTemplates,
  useQuotaTemplates,
  useBatchApplyPermissionTemplate,
  useBatchApplyQuotaTemplate,
} from './use-members';
import type { Member } from '@/lib/api/endpoints/members';
import type { QuotaOverride } from '@/lib/api/types';

export interface UseMembersListOptions {
  workspaceId: string;
  projectId: string;
}

export function useMembersList({ workspaceId, projectId }: UseMembersListOptions) {
  // Data fetching
  const { data: project } = useProject(workspaceId, projectId);
  const { data: members, isLoading } = useMembers(workspaceId, projectId);
  const { data: permissionTemplates = [] } = usePermissionTemplates(workspaceId, projectId);
  const { data: quotaTemplates = [] } = useQuotaTemplates(workspaceId, projectId);

  // Local state
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Detail drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [quotaHistoryDrawerOpen, setQuotaHistoryDrawerOpen] = useState(false);
  const [quotaHistoryPage, setQuotaHistoryPage] = useState(1);

  // Dialogs
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [batchPermDialogOpen, setBatchPermDialogOpen] = useState(false);
  const [batchQuotaDialogOpen, setBatchQuotaDialogOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);

  // Mutations for selected member
  const updatePermissions = useUpdateMemberPermissions(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const updateQuotaOverrides = useUpdateMemberQuotaOverrides(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const removeMember = useRemoveMember(workspaceId, projectId);
  const batchApplyPermission = useBatchApplyPermissionTemplate(workspaceId, projectId);
  const batchApplyQuota = useBatchApplyQuotaTemplate(workspaceId, projectId);

  // Selected member data queries
  const { data: permissions } = useMemberPermissions(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const { data: quotaOverrides } = useMemberQuotaOverrides(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const { data: changeHistory } = useMemberChangeHistory(
    workspaceId,
    projectId,
    selectedMember?.id || ''
  );
  const { data: quotaHistoryData, isLoading: quotaHistoryLoading } = useMemberQuotaOverridesHistory(
    workspaceId,
    projectId,
    selectedMember?.id || '',
    { page: quotaHistoryPage, page_size: 20 },
    { enabled: quotaHistoryDrawerOpen }
  );

  // Actions
  const handleEditPermissions = useCallback((member: Member) => {
    setSelectedMember(member);
    setDrawerOpen(true);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedMember(null);
  }, []);

  const handleViewHistory = useCallback((member: Member) => {
    setSelectedMember(member);
    setHistoryDrawerOpen(true);
  }, []);

  const handleViewQuotaHistory = useCallback(() => {
    setDrawerOpen(false);
    setQuotaHistoryPage(1);
    setQuotaHistoryDrawerOpen(true);
  }, []);

  const handleSavePermissions = useCallback(
    async (permissions: string[], mode: 'template' | 'custom', template?: string) => {
      if (!selectedMember) return;

      try {
        await updatePermissions.mutateAsync({
          permissions,
          mode,
          template: template as 'admin' | 'developer' | 'user' | null | undefined,
        });
        setDrawerOpen(false);
      } catch {
        // Error handled by hook
      }
    },
    [selectedMember, updatePermissions]
  );

  const handleSaveQuota = useCallback(
    async (quota: QuotaOverride) => {
      if (!selectedMember) return;

      try {
        await updateQuotaOverrides.mutateAsync(quota);
        setDrawerOpen(false);
      } catch {
        // Error handled by hook
      }
    },
    [selectedMember, updateQuotaOverrides]
  );

  const handleRemove = useCallback((member: Member) => {
    setMemberToRemove(member);
  }, []);

  const handleConfirmRemove = useCallback(async () => {
    if (!memberToRemove) return;
    try {
      await removeMember.mutateAsync(memberToRemove.id);
      setMemberToRemove(null);
    } catch {
      // Error handled by hook
    }
  }, [memberToRemove, removeMember]);

  const handleToggleSelection = useCallback((memberId: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  }, []);

  const handleToggleAll = useCallback(() => {
    const membersList = Array.isArray(members) ? members : [];
    setSelectedMemberIds((prev) =>
      prev.length > 0 ? [] : membersList.map((m) => m.id)
    );
  }, [members]);

  const clearSelection = useCallback(() => {
    setSelectedMemberIds([]);
  }, []);

  const handleBatchApplyPermission = useCallback(
    async (templateId: string, permissions: string[], template?: 'admin' | 'developer' | 'user' | null) => {
      await batchApplyPermission.mutateAsync({
        memberIds: selectedMemberIds,
        permissions,
        template: template ?? undefined,
      });
      setSelectedMemberIds([]);
    },
    [selectedMemberIds, batchApplyPermission]
  );

  const handleBatchApplyQuota = useCallback(
    async (templateId: string) => {
      await batchApplyQuota.mutateAsync({
        templateId,
        memberIds: selectedMemberIds,
      });
      setSelectedMemberIds([]);
    },
    [selectedMemberIds, batchApplyQuota]
  );

  const membersList = Array.isArray(members) ? members : [];
  const allSelected = membersList.length > 0 && selectedMemberIds.length === membersList.length;
  const someSelected = selectedMemberIds.length > 0 && selectedMemberIds.length < membersList.length;

  return {
    // Data
    project,
    members: membersList,
    permissionTemplates,
    quotaTemplates,
    isLoading,

    // Selected member
    selectedMember,
    permissions,
    quotaOverrides,
    changeHistory,
    quotaHistoryData,
    quotaHistoryLoading,
    quotaHistoryPage,
    setQuotaHistoryPage,

    // Selection state
    selectedMemberIds,
    allSelected,
    someSelected,

    // Dialog states
    drawerOpen,
    historyDrawerOpen,
    quotaHistoryDrawerOpen,
    inviteDialogOpen,
    batchPermDialogOpen,
    batchQuotaDialogOpen,
    memberToRemove,

    // Mutation states
    isUpdatingPermissions: updatePermissions.isPending,
    isUpdatingQuota: updateQuotaOverrides.isPending,
    isRemovingMember: removeMember.isPending,

    // Actions
    setSelectedMember,
    setDrawerOpen,
    setHistoryDrawerOpen,
    setQuotaHistoryDrawerOpen,
    setInviteDialogOpen,
    setBatchPermDialogOpen,
    setBatchQuotaDialogOpen,
    setMemberToRemove,
    handleEditPermissions,
    handleCloseDrawer,
    handleViewHistory,
    handleViewQuotaHistory,
    handleSavePermissions,
    handleSaveQuota,
    handleRemove,
    handleConfirmRemove,
    handleToggleSelection,
    handleToggleAll,
    clearSelection,
    handleBatchApplyPermission,
    handleBatchApplyQuota,
  };
}

export type UseMembersListReturn = ReturnType<typeof useMembersList>;
