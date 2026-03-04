/**
 * Members List Hook
 *
 * Orchestrates member data, selection, dialogs, and actions.
 * This is a composition hook that combines smaller, focused hooks.
 */

import { useMemo } from 'react';
import { useProject } from './use-projects';
import {
  useMembers,
  useMemberPermissions,
  useMemberChangeHistory,
  useUpdateMemberPermissions,
  useRemoveMember,
  usePermissionTemplates,
  useBatchApplyPermissionTemplate,
} from './use-members';
import {
  useAuthorizationCheck,
  useEffectiveAccessSnapshot,
} from './use-governance-explainability';
import { useMemberSelection } from './use-member-selection';
import { useMemberDialogs } from './use-member-dialogs';
import { useMemberActions } from './use-member-actions';
import type { Member } from '@/lib/api/endpoints/members';

export interface UseMembersListOptions {
  workspaceId: string;
  projectId: string;
}

/**
 * Main hook for members page functionality
 *
 * Composes data fetching, selection, dialog, and action logic.
 *
 * @param options - Workspace and project IDs
 * @returns Members page state and actions
 *
 * @example
 * ```tsx
 * const {
 *   members,
 *   selectedIds,
 *   allSelected,
 *   drawerOpen,
 *   openEditDrawer,
 *   handleSavePermissions,
 * } = useMembersList({
 *   workspaceId: 'ws-123',
 *   projectId: 'proj-456',
 * });
 * ```
 */
export function useMembersList({ workspaceId, projectId }: UseMembersListOptions) {
  // Data fetching
  const { data: project } = useProject(workspaceId, projectId);
  const { data: members, isLoading } = useMembers(workspaceId, projectId);
  const { data: permissionTemplates = [] } = usePermissionTemplates(workspaceId, projectId);

  const membersList = useMemo(() => (Array.isArray(members) ? members : []), [members]);

  // Selection state
  const selection = useMemberSelection({ members: membersList });

  // Dialog state
  const dialogs = useMemberDialogs();

  // Mutations for selected member
  const updatePermissions = useUpdateMemberPermissions(
    workspaceId,
    projectId,
    dialogs.selectedMember?.id || ''
  );
  const removeMember = useRemoveMember(workspaceId, projectId);
  const batchApplyPermission = useBatchApplyPermissionTemplate(workspaceId, projectId);
  const authorizationCheck = useAuthorizationCheck(workspaceId, projectId);

  // Selected member data queries
  const { data: permissions } = useMemberPermissions(
    workspaceId,
    projectId,
    dialogs.selectedMember?.id || ''
  );
  const { data: effectiveAccessSnapshot } = useEffectiveAccessSnapshot(
    workspaceId,
    projectId,
    dialogs.selectedMember?.id || ''
  );
  const { data: changeHistory } = useMemberChangeHistory(
    workspaceId,
    projectId,
    dialogs.selectedMember?.id || ''
  );

  // Actions
  const actions = useMemberActions({
    updatePermissions,
    removeMember,
    batchApplyPermission,
    selectedMember: dialogs.selectedMember,
    closeDrawer: dialogs.closeEditDrawer,
    clearMemberToRemove: () => dialogs.setMemberToRemove(null),
    clearSelection: selection.clearSelection,
    selectedMemberIds: selection.selectedIds,
  });

  return {
    // Data
    project,
    members: membersList,
    permissionTemplates,
    isLoading,

    // Selected member data
    selectedMember: dialogs.selectedMember,
    permissions,
    effectiveAccessSnapshot,
    changeHistory,

    // Selection state
    selectedMemberIds: selection.selectedIds,
    allSelected: selection.allSelected,
    someSelected: selection.someSelected,
    setSelectedMemberIds: selection.setSelectedIds,

    // Dialog states
    drawerOpen: dialogs.drawerOpen,
    historyDrawerOpen: dialogs.historyDrawerOpen,
    inviteDialogOpen: dialogs.inviteDialogOpen,
    batchPermDialogOpen: dialogs.batchPermDialogOpen,
    memberToRemove: dialogs.memberToRemove,

    // Mutation states
    isUpdatingPermissions: updatePermissions.isPending,
    isRemovingMember: removeMember.isPending,
    isCheckingAuthorization: authorizationCheck.isPending,
    authorizationCheckResult: authorizationCheck.data ?? null,

    // Dialog setters
    setSelectedMember: dialogs.setSelectedMember,
    setDrawerOpen: dialogs.setDrawerOpen,
    setHistoryDrawerOpen: dialogs.setHistoryDrawerOpen,
    setInviteDialogOpen: dialogs.setInviteDialogOpen,
    setBatchPermDialogOpen: dialogs.setBatchPermDialogOpen,
    setMemberToRemove: dialogs.setMemberToRemove,

    // Actions
    handleEditPermissions: dialogs.openEditDrawer,
    handleCloseDrawer: dialogs.closeEditDrawer,
    handleViewHistory: dialogs.openHistoryDrawer,
    handleSavePermissions: actions.handleSavePermissions,
    handleRemove: (member: Member) => dialogs.setMemberToRemove(member),
    handleConfirmRemove: () => actions.handleConfirmRemove(dialogs.memberToRemove),
    handleToggleSelection: selection.toggleSelection,
    handleToggleAll: selection.toggleAll,
    clearSelection: selection.clearSelection,
    handleBatchApplyPermission: actions.handleBatchApplyPermission,
    handleAuthorizationCheck: authorizationCheck.mutateAsync,
  };
}

export type UseMembersListReturn = ReturnType<typeof useMembersList>;
