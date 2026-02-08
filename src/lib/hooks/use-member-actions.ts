/**
 * Member Actions Hook
 *
 * Business logic for member operations.
 * Handles save permissions, save quota, remove, and batch operations.
 */

import { useCallback } from 'react';
import type { QuotaOverride } from '@/lib/api/types';
import type {
  useUpdateMemberPermissions,
  useUpdateMemberQuotaOverrides,
  useRemoveMember,
  useBatchApplyPermissionTemplate,
  useBatchApplyQuotaTemplate,
} from './use-members';
import type { Member } from '@/lib/api/endpoints/members';

export interface UseMemberActionsOptions {
  /** Update permissions mutation */
  updatePermissions: ReturnType<typeof useUpdateMemberPermissions>;
  /** Update quota overrides mutation */
  updateQuotaOverrides: ReturnType<typeof useUpdateMemberQuotaOverrides>;
  /** Remove member mutation */
  removeMember: ReturnType<typeof useRemoveMember>;
  /** Batch apply permission template mutation */
  batchApplyPermission: ReturnType<typeof useBatchApplyPermissionTemplate>;
  /** Batch apply quota template mutation */
  batchApplyQuota: ReturnType<typeof useBatchApplyQuotaTemplate>;
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
  /** Save member quota overrides */
  handleSaveQuota: (quota: QuotaOverride) => Promise<void>;
  /** Confirm and remove member */
  handleConfirmRemove: (member: Member | null) => Promise<void>;
  /** Batch apply permission template */
  handleBatchApplyPermission: (
    templateId: string,
    permissions: string[],
    template?: string | null
  ) => Promise<void>;
  /** Batch apply quota template */
  handleBatchApplyQuota: (templateId: string) => Promise<void>;
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
 *   updateQuotaOverrides,
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
  updateQuotaOverrides,
  removeMember,
  batchApplyPermission,
  batchApplyQuota,
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

  const handleSaveQuota = useCallback(
    async (quota: QuotaOverride) => {
      if (!selectedMember) return;

      await updateQuotaOverrides.mutateAsync(quota);
      closeDrawer();
    },
    [selectedMember, updateQuotaOverrides, closeDrawer]
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

  const handleBatchApplyQuota = useCallback(
    async (templateId: string) => {
      await batchApplyQuota.mutateAsync({
        templateId,
        memberIds: selectedMemberIds,
      });
      clearSelection();
    },
    [selectedMemberIds, batchApplyQuota, clearSelection]
  );

  return {
    handleSavePermissions,
    handleSaveQuota,
    handleConfirmRemove,
    handleBatchApplyPermission,
    handleBatchApplyQuota,
  };
}
