/**
 * Table Selection Hook
 *
 * Manages row selection state for tables with:
 * - Single item selection toggle
 * - Select all / deselect all
 * - Selected count
 * - Selection state queries
 */

import { useState, useCallback, useMemo } from 'react';

export interface UseTableSelectionOptions<T> {
  items: T[];
  getId: (item: T) => string;
  initialSelected?: Set<string>;
}

export function useTableSelection<T>({
  items,
  getId,
  initialSelected = new Set(),
}: UseTableSelectionOptions<T>) {
  const [selected, setSelected] = useState<Set<string>>(initialSelected);

  const selectedCount = selected.size;
  const allSelected = items.length > 0 && selected.size === items.length;
  const someSelected = selected.size > 0 && selected.size < items.length;

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === items.length) {
        // Deselect all
        return new Set();
      }
      // Select all
      return new Set(items.map(getId));
    });
  }, [items, getId]);

  const clear = useCallback(() => {
    setSelected(new Set());
  }, []);

  const isSelected = useCallback(
    (item: T) => selected.has(getId(item)),
    [selected, getId]
  );

  const getSelectedItems = useCallback(
    () => items.filter((item) => selected.has(getId(item))),
    [items, selected, getId]
  );

  return {
    selected,
    selectedCount,
    allSelected,
    someSelected,
    toggleOne,
    toggleAll,
    clear,
    isSelected,
    getSelectedItems,
  };
}
