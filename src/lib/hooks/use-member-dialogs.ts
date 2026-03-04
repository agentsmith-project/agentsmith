/**
 * Member Dialogs Hook
 *
 * Manages dialog state for the members page.
 * Provides handlers for opening/closing various dialogs and drawers.
 */

import { useState, useCallback } from 'react';
import type { Member } from '@/lib/api/endpoints/members';

export interface UseMemberDialogsReturn {
  /** Currently selected member (for detail operations) */
  selectedMember: Member | null;
  /** Whether the edit drawer is open */
  drawerOpen: boolean;
  /** Whether the history drawer is open */
  historyDrawerOpen: boolean;
  /** Whether the invite dialog is open */
  inviteDialogOpen: boolean;
  /** Whether the batch permission dialog is open */
  batchPermDialogOpen: boolean;
  /** Member to be removed */
  memberToRemove: Member | null;
  /** Set the selected member */
  setSelectedMember: (member: Member | null) => void;
  /** Open/close edit drawer */
  setDrawerOpen: (open: boolean) => void;
  /** Open/close history drawer */
  setHistoryDrawerOpen: (open: boolean) => void;
  /** Open/close invite dialog */
  setInviteDialogOpen: (open: boolean) => void;
  /** Open/close batch permission dialog */
  setBatchPermDialogOpen: (open: boolean) => void;
  /** Set member to remove */
  setMemberToRemove: (member: Member | null) => void;
  /** Open edit drawer for a member */
  openEditDrawer: (member: Member) => void;
  /** Close edit drawer */
  closeEditDrawer: () => void;
  /** Open history drawer for a member */
  openHistoryDrawer: (member: Member) => void;
}

/**
 * Hook for managing member-related dialogs and drawers
 *
 * @returns Dialog state and action handlers
 *
 * @example
 * ```tsx
 * const {
 *   drawerOpen,
 *   memberToRemove,
 *   openEditDrawer,
 *   closeEditDrawer,
 *   openHistoryDrawer,
 * } = useMemberDialogs();
 *
 * <button onClick={() => openEditDrawer(member)}>Edit</button>
 * <Drawer open={drawerOpen} onClose={closeEditDrawer}>
 *   ...
 * </Drawer>
 * ```
 */
export function useMemberDialogs(): UseMemberDialogsReturn {
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [batchPermDialogOpen, setBatchPermDialogOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);

  const openEditDrawer = useCallback((member: Member) => {
    setSelectedMember(member);
    setDrawerOpen(true);
  }, []);

  const closeEditDrawer = useCallback(() => {
    setDrawerOpen(false);
    setSelectedMember(null);
  }, []);

  const openHistoryDrawer = useCallback((member: Member) => {
    setSelectedMember(member);
    setHistoryDrawerOpen(true);
  }, []);

  return {
    selectedMember,
    drawerOpen,
    historyDrawerOpen,
    inviteDialogOpen,
    batchPermDialogOpen,
    memberToRemove,
    setSelectedMember,
    setDrawerOpen,
    setHistoryDrawerOpen,
    setInviteDialogOpen,
    setBatchPermDialogOpen,
    setMemberToRemove,
    openEditDrawer,
    closeEditDrawer,
    openHistoryDrawer,
  };
}
