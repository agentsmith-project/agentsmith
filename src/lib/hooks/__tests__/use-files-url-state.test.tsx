import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileLibrary } from '@/lib/api/types';

const { mockRouter, mockPathnameState, mockSearchState } = vi.hoisted(() => ({
  mockRouter: {
    replace: vi.fn(),
  },
  mockPathnameState: {
    value: '/en-US/workspaces/ws_default/projects/proj_001/files',
  },
  mockSearchState: {
    value: '',
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockPathnameState.value,
  useSearchParams: () => new URLSearchParams(mockSearchState.value),
}));

import { useFilesUrlState } from '../use-files-url-state';

const libraries: FileLibrary[] = [
  {
    id: 'lib_a',
    project_id: 'proj_001',
    workspace_id: 'ws_default',
    name: 'Library A',
    description: '',
    visibility: 'shared',
    provider: 's3',
    bucket: 'bucket',
    status: 'ready',
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
    filesystem_name: 'flib_ws_default_proj_001_lib_a',
    created_by_user_id: 'u_001',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
  {
    id: 'lib_b',
    project_id: 'proj_001',
    workspace_id: 'ws_default',
    name: 'Library B',
    description: '',
    visibility: 'shared',
    provider: 's3',
    bucket: 'bucket',
    status: 'ready',
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
    filesystem_name: 'flib_ws_default_proj_001_lib_b',
    created_by_user_id: 'u_001',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
];

describe('useFilesUrlState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchState.value = '';
    vi.useRealTimers();
  });

  it('restores search/prefix/sort from query and normalizes prefix', async () => {
    mockSearchState.value = 'library_id=lib_b&prefix=docs&search=report%20v1&sort_by=size_bytes&sort_order=desc';

    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_b');
    });
    expect(result.current.prefix).toBe('docs/');
    expect(result.current.searchInput).toBe('report v1');
    expect(result.current.search).toBe('report v1');
    expect(result.current.sortBy).toBe('size_bytes');
    expect(result.current.sortOrder).toBe('desc');
  });

  it('falls back to first library when query library_id is invalid', async () => {
    mockSearchState.value = 'library_id=lib_missing';

    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
  });

  it('defaults to the first library when no query selection is present', async () => {
    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
  });

  it('preserves an existing library_id while the initial library list is still unresolved', async () => {
    mockSearchState.value = 'library_id=lib_a';
    type RenderProps = { nextLibraries: FileLibrary[] };
    const initialProps: RenderProps = { nextLibraries: [] };

    const { result, rerender } = renderHook(
      ({ nextLibraries }: RenderProps) =>
        useFilesUrlState(nextLibraries, { resetBrowseStateOnMount: true }),
      { initialProps },
    );

    expect(result.current.selectedLibraryId).toBeNull();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    rerender({ nextLibraries: libraries });

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('clears selection when the library list is empty', async () => {
    const { result, rerender } = renderHook(
      ({ nextLibraries }: { nextLibraries: FileLibrary[] }) => useFilesUrlState(nextLibraries),
      { initialProps: { nextLibraries: libraries } },
    );

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });

    rerender({ nextLibraries: [] });

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBeNull();
    });
  });

  it('writes search to url with trim and debounce', async () => {
    vi.useFakeTimers();
    mockSearchState.value = 'library_id=lib_a';

    const { result } = renderHook(() => useFilesUrlState(libraries));

    act(() => {
      result.current.setSearchInput('  hello world  ');
    });
    await act(async () => {
      vi.advanceTimersByTime(320);
      await Promise.resolve();
    });

    expect(mockRouter.replace).toHaveBeenCalledWith(
      '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_a&search=hello+world',
      { scroll: false },
    );
  });

  it('updateSort writes canonical query params to url', async () => {
    mockSearchState.value = 'library_id=lib_a';
    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });

    act(() => {
      result.current.updateSort('last_modified', 'desc');
    });

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_a&sort_by=last_modified&sort_order=desc',
        { scroll: false },
      );
    });
  });

  it('setPrefix writes normalized prefix to url', async () => {
    mockSearchState.value = 'library_id=lib_a';
    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });

    act(() => {
      result.current.setPrefix('assets');
    });

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_a&prefix=assets%2F',
        { scroll: false },
      );
    });
  });
});
