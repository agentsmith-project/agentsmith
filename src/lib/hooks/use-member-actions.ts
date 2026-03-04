/**
 * Member Actions Hook
 *
 * Business logic for member operations.
 * Handles save permissions, remove, and batch operations.
 */

import { useCallback } from 'react';
import type {
  useUpdateMemberPermissions,
  useRemoveMember,
  useBatchApplyPermissionTemplate,
} from './use-members';
import type { Member } from '@/lib/api/endpoints/members';

export interface UseMemberActionsOptions {
  /** Update permissions mutation */
  updatePermissions: ReturnType<typeof useUpdateMemberPermissions>;
  /** Remove member mutation */
  removeMember: ReturnType<typeof useRemoveMember>;
  /** Batch apply permission template mutation */
  batchApplyPermission: ReturnType<typeof useBatchApplyPermissionTemplate>;
  /** Currently selected member */
  selectedMember: Member | null;
  /** Close drawer callback */
  closeDrawer: () => void;
  /** Clear member to remove callback */
  clearMemberToRemove: () => void;
  /** Clear selection callback */
  clearSelection: () => void;
  /** Selected member IDs for batch operations */
  selectedMemberIds: string[];
}

export interface UseMemberActionsReturn {
  /** Save member permissions */
  handleSavePermissions: (
    permissions: string[],
    mode: 'template' | 'custom',
    template?: string
  ) => Promise<void>;
  /** Confirm and remove member */
  handleConfirmRemove: (member: Member | null) => Promise<void>;
  /** Batch apply permission template */
  handleBatchApplyPermission: (
    templateId: string,
    permissions: string[],
    template?: string | null
  ) => Promise<void>;
}

/**
 * Hook for managing member action handlers
 *
 * @param options - Action options with mutations and callbacks
 * @returns Action handlers
 *
 * @example
 * ```tsx
 * const actions = useMemberActions({
 *   updatePermissions,
 *   removeMember,
 *   selectedMember,
 *   closeDrawer: () => setDrawerOpen(false),
 * });
 *
 * <button onClick={() => actions.handleConfirmRemove(member)}>Remove</button>
 * ```
 */
export function useMemberActions({
  updatePermissions,
  removeMember,
  batchApplyPermission,
  selectedMember,
  closeDrawer,
  clearMemberToRemove,
  clearSelection,
  selectedMemberIds,
}: UseMemberActionsOptions): UseMemberActionsReturn {
  const handleSavePermissions = useCallback(
    async (permissions: string[], mode: 'template' | 'custom', template?: string) => {
      if (!selectedMember) return;

      await updatePermissions.mutateAsync({
        permissions,
        mode,
        template,
      });
      closeDrawer();
    },
    [selectedMember, updatePermissions, closeDrawer]
  );

  const handleConfirmRemove = useCallback(
    async (memberToRemove: Member | null) => {
      if (!memberToRemove) return;

      await removeMember.mutateAsync(memberToRemove.id);
      clearMemberToRemove();
    },
    [removeMember, clearMemberToRemove]
  );

  const handleBatchApplyPermission = useCallback(
    async (templateId: string, permissions: string[], template?: string | null) => {
      await batchApplyPermission.mutateAsync({
        memberIds: selectedMemberIds,
        permissions,
        template: template ?? undefined,
      });
      clearSelection();
    },
    [selectedMemberIds, batchApplyPermission, clearSelection]
  );

  return {
    handleSavePermissions,
    handleConfirmRemove,
    handleBatchApplyPermission,
  };
}
