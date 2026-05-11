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

import { DEFAULT_FILES_BROWSE_PREFIX, useFilesUrlState } from '../use-files-url-state';

const libraries: FileLibrary[] = [
  {
    id: 'lib_a',
    project_id: 'proj_001',
    workspace_id: 'ws_default',
    name: 'Library A',
    description: '',
    visibility: 'shared',
    source: 'agent_task_files',
    file_library_home_segment: 'task-home-lib-a',
    status: 'ready',
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
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
    source: 'agent_task_files',
    file_library_home_segment: 'task-home-lib-b',
    status: 'ready',
    task_home_binding_status: 'unbound',
    bound_task_visible: false,
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

  it('uses a valid query library_id over the existing selected library', async () => {
    mockSearchState.value = 'library_id=lib_a';
    const { result, rerender } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });

    mockSearchState.value = 'library_id=lib_b';
    rerender();

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_b');
    });
  });

  it('does not rewrite an already valid query library_id during initial selection sync', async () => {
    mockSearchState.value = 'library_id=lib_b';
    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_b');
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('defaults to the first library when no query selection is present', async () => {
    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
  });

  it('defaults ordinary Files browsing to the file library HOME root when prefix is absent from the URL', async () => {
    expect(DEFAULT_FILES_BROWSE_PREFIX).toBe('');

    const { result } = renderHook(() => useFilesUrlState(libraries, { defaultPrefix: DEFAULT_FILES_BROWSE_PREFIX }));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
    expect(result.current.prefix).toBe('');
  });

  it('keeps explicit URL root reachable when a default browse prefix is configured', async () => {
    mockSearchState.value = 'prefix=%2F';

    const { result } = renderHook(() => useFilesUrlState(libraries, { defaultPrefix: 'workspace/' }));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
    expect(result.current.prefix).toBe('');
  });

  it('treats an external /files navigation as the source of truth and does not restore a stale prefix', async () => {
    mockSearchState.value = 'library_id=lib_b&prefix=workspace%2F.artifacts%2F';

    const { result, rerender } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_b');
    });
    expect(result.current.prefix).toBe('workspace/.artifacts/');

    mockRouter.replace.mockClear();
    mockSearchState.value = '';
    rerender();

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
      expect(result.current.prefix).toBe('');
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('derives queryless /files browse and list params during the navigation render', async () => {
    mockSearchState.value = 'library_id=lib_b&prefix=workspace%2F.artifacts%2F&search=report&sort_by=size_bytes&sort_order=desc';
    const renderSnapshots: Array<{
      prefix: string;
      search: string;
      searchInput: string;
      selectedLibraryId: string | null;
      sortBy: string;
      sortOrder: string;
      listParams: {
        prefix: string;
        search: string | undefined;
        sort_by: string;
        sort_order: string;
      };
    }> = [];

    const { result, rerender } = renderHook(() => {
      const state = useFilesUrlState(libraries);
      renderSnapshots.push({
        prefix: state.prefix,
        search: state.search,
        searchInput: state.searchInput,
        selectedLibraryId: state.selectedLibraryId,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        listParams: {
          prefix: state.prefix,
          search: state.search || undefined,
          sort_by: state.sortBy,
          sort_order: state.sortOrder,
        },
      });
      return state;
    });

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_b');
    });

    renderSnapshots.length = 0;
    mockRouter.replace.mockClear();
    mockSearchState.value = '';
    rerender();

    expect(renderSnapshots[0]).toEqual({
      prefix: '',
      search: '',
      searchInput: '',
      selectedLibraryId: 'lib_a',
      sortBy: 'name',
      sortOrder: 'asc',
      listParams: {
        prefix: '',
        search: undefined,
        sort_by: 'name',
        sort_order: 'asc',
      },
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('accepts an external prefix URL change without deleting it from stale local state', async () => {
    const { result, rerender } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
    expect(result.current.prefix).toBe('');

    mockRouter.replace.mockClear();
    mockSearchState.value = 'prefix=workspace%2F.artifacts%2F';
    rerender();

    await waitFor(() => {
      expect(result.current.prefix).toBe('workspace/.artifacts/');
    });
    expect(mockRouter.replace).not.toHaveBeenCalled();
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

  it('writes user-selected libraries back to the URL', async () => {
    mockSearchState.value = 'library_id=lib_a';
    const { result } = renderHook(() => useFilesUrlState(libraries));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });

    act(() => {
      result.current.setSelectedLibraryId('lib_b');
    });

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_b',
        { scroll: false },
      );
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

  it('setPrefix writes an explicit root marker so the task-file root stays reachable with a default browse prefix', async () => {
    mockSearchState.value = 'library_id=lib_a';
    const { result } = renderHook(() => useFilesUrlState(libraries, { defaultPrefix: 'workspace/' }));

    await waitFor(() => {
      expect(result.current.selectedLibraryId).toBe('lib_a');
    });
    expect(result.current.prefix).toBe('workspace/');

    act(() => {
      result.current.setPrefix('');
    });

    await waitFor(() => {
      expect(mockRouter.replace).toHaveBeenCalledWith(
        '/en-US/workspaces/ws_default/projects/proj_001/files?library_id=lib_a&prefix=%2F',
        { scroll: false },
      );
    });
  });
});
