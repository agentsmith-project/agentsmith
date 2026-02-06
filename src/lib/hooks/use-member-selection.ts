/**
 * Member Selection Hook
 *
 * Manages member selection state for the members page.
 * Provides toggle, select all, and clear functionality.
 */

import { useState, useCallback, useMemo } from 'react';
import type { Member } from '@/lib/api/endpoints/members';

export interface UseMemberSelectionOptions {
  /** Members list to select from */
  members: Member[];
}

export interface UseMemberSelectionReturn {
  /** Currently selected member IDs */
  selectedIds: string[];
  /** Whether all members are selected */
  allSelected: boolean;
  /** Whether some (but not all) members are selected */
  someSelected: boolean;
  /** Set selected member IDs */
  setSelectedIds: (ids: string[]) => void;
  /** Toggle selection for a single member */
  toggleSelection: (memberId: string) => void;
  /** Toggle selection for all members */
  toggleAll: () => void;
  /** Clear all selections */
  clearSelection: () => void;
}

/**
 * Hook for managing member selection state
 *
 * @param options - Selection options
 * @returns Selection state and actions
 *
 * @example
 * ```tsx
 * const { selectedIds, allSelected, someSelected, toggleSelection, toggleAll } = useMemberSelection({
 *   members: membersList,
 * });
 *
 * <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} />
 * {members.map(member => (
 *   <Checkbox
 *     checked={selectedIds.includes(member.id)}
 *     onChange={() => toggleSelection(member.id)}
 *   />
 * ))}
 * ```
 */
export function useMemberSelection({ members }: UseMemberSelectionOptions): UseMemberSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const membersList = useMemo(() => (Array.isArray(members) ? members : []), [members]);

  // Filter selectedIds to only include IDs that exist in current members
  const validSelectedIds = useMemo(() => {
    const memberIdSet = new Set(membersList.map((m) => m.id));
    return selectedIds.filter((id) => memberIdSet.has(id));
  }, [selectedIds, membersList]);

  const allSelected = useMemo(
    () => membersList.length > 0 && validSelectedIds.length === membersList.length,
    [membersList.length, validSelectedIds.length]
  );

  const someSelected = useMemo(
    () => validSelectedIds.length > 0 && validSelectedIds.length < membersList.length,
    [validSelectedIds.length, membersList.length]
  );

  const toggleSelection = useCallback((memberId: string) => {
    setSelectedIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.length > 0 ? [] : membersList.map((m) => m.id)));
  }, [membersList]);

  const clearSelection = useCallback(() => {
    setSelectedIds([]);
  }, []);

  return {
    selectedIds: validSelectedIds,
    allSelected,
    someSelected,
    setSelectedIds,
    toggleSelection,
    toggleAll,
    clearSelection,
  };
}
