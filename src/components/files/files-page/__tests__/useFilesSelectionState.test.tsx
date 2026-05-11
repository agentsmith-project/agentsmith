import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FileObjectsListItem } from '@/lib/api/types';
import { useFilesSelectionState } from '../useFilesSelectionState';
import type { SelectedRowId } from '../utils';

function createObjectItem(key: string): FileObjectsListItem {
  return {
    kind: 'object',
    key,
    name: key.split('/').at(-1) ?? key,
    size_bytes: 10,
    content_type: 'text/plain',
    last_modified: '2026-02-01T00:00:00Z',
  };
}

const libraries = [{ id: 'lib_a' }, { id: 'lib_b' }];

type SelectionHookProps = {
  prefix?: string;
  searchInput?: string;
  selectedLibraryId: string | null;
};

function renderSelectionHook(initialProps: SelectionHookProps) {
  return renderHook(
    ({
      prefix = '',
      searchInput = '',
      selectedLibraryId,
    }: SelectionHookProps) =>
      useFilesSelectionState({
        filteredItems: [createObjectItem('README.txt'), createObjectItem('notes.txt')],
        isFetching: false,
        libraries,
        prefix,
        searchInput,
        selectedLibraryId,
        sortBy: 'name',
        sortOrder: 'asc',
        setPrefix: vi.fn(),
        setSearchImmediately: vi.fn(),
        setSelectedLibraryId: vi.fn(),
        updateSort: vi.fn(),
      }),
    { initialProps },
  );
}

describe('useFilesSelectionState', () => {
  it('does not carry selected rows across URL-driven library changes', () => {
    const { result, rerender } = renderSelectionHook({ selectedLibraryId: 'lib_a' });

    act(() => {
      result.current.setSelectedIds(['o:README.txt']);
    });
    expect(result.current.selectedIds).toEqual(['o:README.txt']);

    rerender({ selectedLibraryId: 'lib_b' });

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedObjects).toEqual([]);
    expect(result.current.hasSelection).toBe(false);
  });

  it('restores selection by library when URL navigation returns to a previous library', () => {
    const { result, rerender } = renderSelectionHook({ selectedLibraryId: 'lib_a' });

    act(() => {
      result.current.setSelectedIds(['o:README.txt']);
    });

    rerender({ selectedLibraryId: 'lib_b' });
    act(() => {
      result.current.setSelectedIds(['o:notes.txt' as SelectedRowId]);
    });

    rerender({ selectedLibraryId: 'lib_a' });

    expect(result.current.selectedIds).toEqual(['o:README.txt']);
    expect(result.current.selectedObjects).toEqual([{ kind: 'object', key: 'README.txt' }]);
  });

  it('does not carry selected rows across URL-driven root scope changes in the same library', () => {
    const { result, rerender } = renderSelectionHook({
      prefix: 'workspace/.artifacts/',
      selectedLibraryId: 'lib_a',
    });

    act(() => {
      result.current.setSelectedIds(['o:README.txt']);
    });
    expect(result.current.selectedIds).toEqual(['o:README.txt']);

    rerender({ prefix: '', selectedLibraryId: 'lib_a' });

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.selectedObjects).toEqual([]);
    expect(result.current.hasSelection).toBe(false);

    rerender({ prefix: 'workspace/.artifacts/', selectedLibraryId: 'lib_a' });

    expect(result.current.selectedIds).toEqual(['o:README.txt']);
  });
});
