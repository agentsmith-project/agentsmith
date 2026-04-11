import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APIError } from '@/lib/api/errors';
import { useFileFolderMoveManager } from '../use-file-folder-move-manager';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/hooks/use-file-objects', () => ({
  useFileObjects: () => ({
    data: { items: [] },
    isLoading: false,
  }),
}));

describe('useFileFolderMoveManager', () => {
  const t = (key: string) => key;
  const tErrors = (key: string) => key;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates folder and navigates into it', async () => {
    const createFolder = vi.fn().mockResolvedValue(undefined);
    const refreshCurrentListing = vi.fn().mockResolvedValue(undefined);
    const navigateToPrefix = vi.fn();

    const { result } = renderHook(() =>
      useFileFolderMoveManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        prefix: 'docs/',
        selectedForMove: null,
        refreshCurrentListing,
        createFolder,
        moveObject: vi.fn(),
        clearSelection: vi.fn(),
        navigateToPrefix,
        t,
        tErrors,
      }),
    );

    act(() => {
      result.current.setFolderName('reports');
    });

    await act(async () => {
      await result.current.handleCreateFolder();
    });

    expect(createFolder).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_a',
      prefix: 'docs/reports/',
    });
    expect(refreshCurrentListing).toHaveBeenCalledTimes(1);
    expect(navigateToPrefix).toHaveBeenCalledWith('docs/reports/');
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('waits for the current listing to refresh before navigating into a new folder', async () => {
    const createFolder = vi.fn().mockResolvedValue(undefined);
    let refreshResolved = false;
    const refreshCurrentListing = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            refreshResolved = true;
            resolve();
          }, 0);
        }),
    );
    const navigateToPrefix = vi.fn(() => {
      expect(refreshResolved).toBe(true);
    });

    const { result } = renderHook(() =>
      useFileFolderMoveManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        prefix: '',
        selectedForMove: null,
        refreshCurrentListing,
        createFolder,
        moveObject: vi.fn(),
        clearSelection: vi.fn(),
        navigateToPrefix,
        t,
        tErrors,
      }),
    );

    act(() => {
      result.current.setFolderName('docs');
    });

    await act(async () => {
      await result.current.handleCreateFolder();
    });

    expect(createFolder).toHaveBeenCalledTimes(1);
    expect(refreshCurrentListing).toHaveBeenCalledTimes(1);
    expect(navigateToPrefix).toHaveBeenCalledWith('docs/');
  });

  it('opens move conflict dialog when destination exists', async () => {
    const moveObject = vi.fn().mockRejectedValue(new APIError('destination_exists', 'exists', 'req_1', 409));

    const { result } = renderHook(() =>
      useFileFolderMoveManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        prefix: '',
        selectedForMove: { kind: 'object', key: 'a.txt' },
        refreshCurrentListing: vi.fn(),
        createFolder: vi.fn(),
        moveObject,
        clearSelection: vi.fn(),
        navigateToPrefix: vi.fn(),
        t,
        tErrors,
      }),
    );

    act(() => {
      result.current.setMoveName('a-renamed.txt');
      result.current.setMoveDestPrefix('archive/');
    });

    await act(async () => {
      await result.current.handleMove();
    });

    expect(moveObject).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_a',
      from_key: 'a.txt',
      to_key: 'archive/a-renamed.txt',
      overwrite: false,
    });
    expect(result.current.moveConflictOpen).toBe(true);
  });
});
