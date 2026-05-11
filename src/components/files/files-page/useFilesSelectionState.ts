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

type LibrarySelectionSnapshot = Pick<LibraryViewSnapshot, 'selectedIds' | 'selectionMode'>;

const EMPTY_SELECTED_IDS: SelectedRowId[] = [];
const SELECTION_SCOPE_SEPARATOR = '\u001F';

function selectionScopeKey(libraryId: string, prefix: string, searchInput: string) {
  return [libraryId, prefix, searchInput.trim()].join(SELECTION_SCOPE_SEPARATOR);
}

function selectionScopeLibraryId(scopeKey: string) {
  return scopeKey.split(SELECTION_SCOPE_SEPARATOR)[0] ?? '';
}

function selectedIdsEqual(a: SelectedRowId[], b: SelectedRowId[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function isDefaultSelectionSnapshot(snapshot: LibrarySelectionSnapshot) {
  return snapshot.selectionMode === 'single' && snapshot.selectedIds.length === 0;
}

export function useFilesSelectionState(args: {
  defaultPrefix?: string;
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
    defaultPrefix = '',
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

  const [selectionByScope, setSelectionByScope] = React.useState<Record<string, LibrarySelectionSnapshot>>({});
  const [multiSelectAnchorIndex, setMultiSelectAnchorIndex] = React.useState<number | null>(null);
  const librarySnapshotsRef = React.useRef<Record<string, LibraryViewSnapshot>>({});
  const activeSelectionScopeKey = selectedLibraryId
    ? selectionScopeKey(selectedLibraryId, prefix, searchInput)
    : null;
  const activeSelection = activeSelectionScopeKey ? selectionByScope[activeSelectionScopeKey] : null;
  const selectedIds = activeSelection?.selectedIds ?? EMPTY_SELECTED_IDS;
  const selectionMode = activeSelection?.selectionMode ?? 'single';

  const updateScopeSelection = React.useCallback((
    scopeKey: string,
    updater: (current: LibrarySelectionSnapshot) => LibrarySelectionSnapshot,
  ) => {
    setSelectionByScope((prev) => {
      const current = prev[scopeKey] ?? { selectedIds: EMPTY_SELECTED_IDS, selectionMode: 'single' };
      const next = updater(current);
      const currentIsDefault = !prev[scopeKey] && isDefaultSelectionSnapshot(current);
      if (
        selectedIdsEqual(current.selectedIds, next.selectedIds)
        && current.selectionMode === next.selectionMode
      ) {
        return prev;
      }
      if (isDefaultSelectionSnapshot(next)) {
        if (currentIsDefault) return prev;
        const nextByScope = { ...prev };
        delete nextByScope[scopeKey];
        return nextByScope;
      }
      return {
        ...prev,
        [scopeKey]: next,
      };
    });
  }, []);

  const updateActiveSelection = React.useCallback((
    updater: (current: LibrarySelectionSnapshot) => LibrarySelectionSnapshot,
  ) => {
    if (!activeSelectionScopeKey) return;
    updateScopeSelection(activeSelectionScopeKey, updater);
  }, [activeSelectionScopeKey, updateScopeSelection]);

  const setSelectedIds = React.useCallback<React.Dispatch<React.SetStateAction<SelectedRowId[]>>>((nextValue) => {
    updateActiveSelection((current) => {
      const nextSelectedIds = typeof nextValue === 'function' ? nextValue(current.selectedIds) : nextValue;
      if (selectedIdsEqual(current.selectedIds, nextSelectedIds)) {
        return current;
      }
      return {
        ...current,
        selectedIds: nextSelectedIds,
      };
    });
  }, [updateActiveSelection]);

  const setSelectionMode = React.useCallback((nextSelectionMode: FileSelectionMode) => {
    updateActiveSelection((current) => {
      if (current.selectionMode === nextSelectionMode) return current;
      return {
        ...current,
        selectionMode: nextSelectionMode,
      };
    });
  }, [updateActiveSelection]);

  const replaceScopeSelection = React.useCallback((
    scopeKey: string,
    nextSelection: LibrarySelectionSnapshot,
  ) => {
    updateScopeSelection(scopeKey, () => nextSelection);
  }, [updateScopeSelection]);

  const selected = React.useMemo(() => selectedIds.map(parseSelectedRowId), [selectedIds]);
  const selectedObjects = React.useMemo(
    () => selected.filter((item): item is { kind: 'object'; key: string } => item.kind === 'object'),
    [selected],
  );

  const clearSelection = React.useCallback(() => setSelectedIds([]), [setSelectedIds]);

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
      setPrefix(defaultPrefix);
      setSearchImmediately('');
      updateSort('name', 'asc');
      replaceScopeSelection(
        selectionScopeKey(libraryId, defaultPrefix, ''),
        { selectedIds: [], selectionMode: 'single' },
      );
      setMultiSelectAnchorIndex(null);
      return;
    }
    setPrefix(snapshot.prefix);
    setSearchImmediately(snapshot.searchInput);
    updateSort(snapshot.sortBy, snapshot.sortOrder);
    replaceScopeSelection(
      selectionScopeKey(libraryId, snapshot.prefix, snapshot.searchInput),
      {
        selectedIds: snapshot.selectedIds,
        selectionMode: snapshot.selectionMode,
      },
    );
    setMultiSelectAnchorIndex(null);
  }, [defaultPrefix, replaceScopeSelection, setPrefix, setSearchImmediately, updateSort]);

  const selectLibrary = React.useCallback((libraryId: string) => {
    if (selectedLibraryId === libraryId) return;
    snapshotCurrentLibraryView();
    setSelectedLibraryId(libraryId);
    restoreLibraryView(libraryId);
  }, [restoreLibraryView, selectedLibraryId, setSelectedLibraryId, snapshotCurrentLibraryView]);

  const toggleRow = React.useCallback((id: SelectedRowId) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }, [setSelectedIds]);

  const activateSingleObject = React.useCallback((id: SelectedRowId) => {
    setSelectedIds([id]);
  }, [setSelectedIds]);

  const enterMultiMode = React.useCallback(() => {
    setSelectionMode('multi');
  }, [setSelectionMode]);

  const exitMultiMode = React.useCallback(() => {
    setSelectionMode('single');
    setSelectedIds([]);
    setMultiSelectAnchorIndex(null);
  }, [setSelectedIds, setSelectionMode]);

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
  }, [filteredItems, selectionMode, setSelectedIds]);

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
  }, [
    activateSingleObject,
    enterMultiMode,
    filteredItems,
    multiSelectAnchorIndex,
    selectionMode,
    setSelectedIds,
    toggleRow,
  ]);

  React.useEffect(() => {
    setMultiSelectAnchorIndex(null);
  }, [activeSelectionScopeKey]);

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
  }, [filteredItems, isFetching, setSelectedIds]);

  React.useEffect(() => {
    const availableLibraryIds = new Set(libraries.map((library) => library.id));
    const next: Record<string, LibraryViewSnapshot> = {};
    for (const [libraryId, snapshot] of Object.entries(librarySnapshotsRef.current)) {
      if (availableLibraryIds.has(libraryId)) {
        next[libraryId] = snapshot;
      }
    }
    librarySnapshotsRef.current = next;
    setSelectionByScope((prev) => {
      let changed = false;
      const nextSelectionByScope: Record<string, LibrarySelectionSnapshot> = {};
      for (const [scopeKey, snapshot] of Object.entries(prev)) {
        if (availableLibraryIds.has(selectionScopeLibraryId(scopeKey))) {
          nextSelectionByScope[scopeKey] = snapshot;
        } else {
          changed = true;
        }
      }
      return changed ? nextSelectionByScope : prev;
    });
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
