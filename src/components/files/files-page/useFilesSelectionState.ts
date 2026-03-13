'use client';

import * as React from 'react';
import type { FileObjectsListItem } from '@/lib/api/types';
import type { FileSortBy, FileSortOrder } from '@/lib/hooks/use-files-url-state';
import {
  parseSelectedRowId,
  rowId,
  type FileSelectionMode,
  type LibraryViewSnapshot,
  type SelectedRowId,
} from './utils';

export function useFilesSelectionState(args: {
  filteredItems: FileObjectsListItem[];
  isFetching: boolean;
  libraries: Array<{ id: string }>;
  prefix: string;
  searchInput: string;
  selectedLibraryId: string | null;
  sortBy: FileSortBy;
  sortOrder: FileSortOrder;
  setPrefix: (value: string) => void;
  setSearchImmediately: (value: string) => void;
  setSelectedLibraryId: (value: string | null) => void;
  updateSort: (sortBy: FileSortBy, sortOrder: FileSortOrder) => void;
}) {
  const {
    filteredItems,
    isFetching,
    libraries,
    prefix,
    searchInput,
    selectedLibraryId,
    sortBy,
    sortOrder,
    setPrefix,
    setSearchImmediately,
    setSelectedLibraryId,
    updateSort,
  } = args;

  const [selectedIds, setSelectedIds] = React.useState<SelectedRowId[]>([]);
  const [selectionMode, setSelectionMode] = React.useState<FileSelectionMode>('single');
  const [multiSelectAnchorIndex, setMultiSelectAnchorIndex] = React.useState<number | null>(null);
  const librarySnapshotsRef = React.useRef<Record<string, LibraryViewSnapshot>>({});
  const sessionResetAppliedRef = React.useRef(false);

  const selected = React.useMemo(() => selectedIds.map(parseSelectedRowId), [selectedIds]);
  const selectedObjects = React.useMemo(
    () => selected.filter((item): item is { kind: 'object'; key: string } => item.kind === 'object'),
    [selected],
  );

  const clearSelection = React.useCallback(() => setSelectedIds([]), []);

  const navigateToPrefix = React.useCallback((nextPrefix: string) => {
    setPrefix(nextPrefix);
    setSearchImmediately('');
    clearSelection();
  }, [clearSelection, setPrefix, setSearchImmediately]);

  const snapshotCurrentLibraryView = React.useCallback(() => {
    if (!selectedLibraryId) return;
    librarySnapshotsRef.current[selectedLibraryId] = {
      prefix,
      searchInput,
      sortBy,
      sortOrder,
      selectedIds,
      selectionMode,
    };
  }, [prefix, searchInput, selectedIds, selectedLibraryId, selectionMode, sortBy, sortOrder]);

  const restoreLibraryView = React.useCallback((libraryId: string) => {
    const snapshot = librarySnapshotsRef.current[libraryId];
    if (!snapshot) {
      setPrefix('');
      setSearchImmediately('');
      updateSort('name', 'asc');
      setSelectionMode('single');
      setSelectedIds([]);
      setMultiSelectAnchorIndex(null);
      return;
    }
    setPrefix(snapshot.prefix);
    setSearchImmediately(snapshot.searchInput);
    updateSort(snapshot.sortBy, snapshot.sortOrder);
    setSelectionMode(snapshot.selectionMode);
    setSelectedIds(snapshot.selectedIds);
    setMultiSelectAnchorIndex(null);
  }, [setPrefix, setSearchImmediately, updateSort]);

  const selectLibrary = React.useCallback((libraryId: string) => {
    if (selectedLibraryId === libraryId) return;
    snapshotCurrentLibraryView();
    setSelectedLibraryId(libraryId);
    restoreLibraryView(libraryId);
  }, [restoreLibraryView, selectedLibraryId, setSelectedLibraryId, snapshotCurrentLibraryView]);

  const toggleRow = React.useCallback((id: SelectedRowId) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, []);

  const activateSingleObject = React.useCallback((id: SelectedRowId) => {
    setSelectedIds([id]);
  }, []);

  const enterMultiMode = React.useCallback(() => {
    setSelectionMode('multi');
  }, []);

  const exitMultiMode = React.useCallback(() => {
    setSelectionMode('single');
    setSelectedIds([]);
    setMultiSelectAnchorIndex(null);
  }, []);

  const visibleSelectedCount = React.useMemo(
    () => filteredItems.filter((item) => selectedIds.includes(rowId(item))).length,
    [filteredItems, selectedIds],
  );
  const isMultiMode = selectionMode === 'multi';
  const hasSelection = selected.length > 0;
  const allSelected = filteredItems.length > 0 && visibleSelectedCount === filteredItems.length;

  const toggleAll = React.useCallback(() => {
    if (selectionMode !== 'multi') return;
    setSelectedIds((prev) => (prev.length > 0 ? [] : filteredItems.map((item) => rowId(item))));
  }, [filteredItems, selectionMode]);

  const handleToggleRowCheckbox = React.useCallback((id: SelectedRowId, index: number) => {
    if (selectionMode !== 'multi') {
      enterMultiMode();
    }
    toggleRow(id);
    setMultiSelectAnchorIndex(index);
  }, [enterMultiMode, selectionMode, toggleRow]);

  const handleRowActivate = React.useCallback((
    event: React.MouseEvent<HTMLButtonElement>,
    id: SelectedRowId,
    index: number,
  ) => {
    const withCmdCtrl = event.metaKey || event.ctrlKey;
    const withShift = event.shiftKey;

    if (withCmdCtrl || withShift) {
      if (selectionMode !== 'multi') {
        enterMultiMode();
      }

      const anchorIndex = multiSelectAnchorIndex ?? index;
      if (withShift) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        const rangeIds = filteredItems.slice(start, end + 1).map((item) => rowId(item));
        setSelectedIds((prev) => {
          if (withCmdCtrl) {
            const merged = new Set(prev);
            rangeIds.forEach((rangeId) => merged.add(rangeId));
            return Array.from(merged);
          }
          return rangeIds;
        });
      } else {
        toggleRow(id);
      }

      setMultiSelectAnchorIndex(index);
      return;
    }

    if (selectionMode === 'multi') {
      toggleRow(id);
      setMultiSelectAnchorIndex(index);
      return;
    }

    activateSingleObject(id);
    setMultiSelectAnchorIndex(index);
  }, [activateSingleObject, enterMultiMode, filteredItems, multiSelectAnchorIndex, selectionMode, toggleRow]);

  React.useEffect(() => {
    if (sessionResetAppliedRef.current) return;
    sessionResetAppliedRef.current = true;
    setSelectionMode('single');
    setSelectedIds([]);
    setMultiSelectAnchorIndex(null);
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (selectionMode !== 'multi') return;
      event.preventDefault();
      exitMultiMode();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitMultiMode, selectionMode]);

  React.useEffect(() => {
    if (isFetching && filteredItems.length === 0) return;
    const available = new Set(filteredItems.map((item) => rowId(item)));
    setSelectedIds((prev) => {
      const next = prev.filter((id) => available.has(id));
      if (next.length === prev.length && next.every((id, index) => id === prev[index])) {
        return prev;
      }
      return next;
    });
  }, [filteredItems, isFetching]);

  React.useEffect(() => {
    const availableLibraryIds = new Set(libraries.map((library) => library.id));
    const next: Record<string, LibraryViewSnapshot> = {};
    for (const [libraryId, snapshot] of Object.entries(librarySnapshotsRef.current)) {
      if (availableLibraryIds.has(libraryId)) {
        next[libraryId] = snapshot;
      }
    }
    librarySnapshotsRef.current = next;
  }, [libraries]);

  return {
    allSelected,
    clearSelection,
    exitMultiMode,
    handleRowActivate,
    handleToggleRowCheckbox,
    hasSelection,
    isMultiMode,
    navigateToPrefix,
    selectLibrary,
    selected,
    selectedIds,
    selectedObjects,
    selectionMode,
    setSelectedIds,
    toggleAll,
    visibleSelectedCount,
  };
}
