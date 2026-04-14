import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileLibrary } from '@/lib/api/types';
import { useFileLibraryManager } from '../use-file-library-manager';

const sampleLibrary: FileLibrary = {
  id: 'lib_a',
  workspace_id: 'ws_default',
  project_id: 'proj_001',
  name: 'Library A',
  description: 'desc',
  visibility: 'shared',
  provider: 's3',
  bucket: 'bucket',
  status: 'ready',
  filesystem_name: 'flib_ws_default_proj_001_lib_a',
  created_by_user_id: 'u_001',
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
};

describe('useFileLibraryManager', () => {
  const t = (key: string) => key;
  const tErrors = (key: string) => key;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates library and switches selection to new id', async () => {
    const setSelectedLibraryId = vi.fn();
    const navigateToPrefix = vi.fn();
    const createLibrary = vi.fn().mockResolvedValue({ id: 'lib_new' });

    const { result } = renderHook(() =>
      useFileLibraryManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        setSelectedLibraryId,
        navigateToPrefix,
        createLibrary,
        updateLibrary: vi.fn(),
        deleteLibrary: vi.fn(),
        t,
        tErrors,
      }),
    );

    act(() => {
      result.current.openCreateLibraryDialog();
      result.current.setLibraryName('New Library');
    });

    await act(async () => {
      await result.current.handleCreateLibrary();
    });

    expect(createLibrary).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      name: 'New Library',
      description: undefined,
    });
    expect(setSelectedLibraryId).toHaveBeenCalledWith('lib_new');
    expect(navigateToPrefix).toHaveBeenCalledWith('');
    expect(result.current.libraryCreateError).toBeNull();
  });

  it('captures create errors and clears them when the draft changes', async () => {
    const setSelectedLibraryId = vi.fn();
    const navigateToPrefix = vi.fn();
    const createLibrary = vi.fn().mockRejectedValue(new Error('permission_denied'));

    const { result } = renderHook(() =>
      useFileLibraryManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        setSelectedLibraryId,
        navigateToPrefix,
        createLibrary,
        updateLibrary: vi.fn(),
        deleteLibrary: vi.fn(),
        t,
        tErrors,
      }),
    );

    act(() => {
      result.current.openCreateLibraryDialog();
      result.current.setLibraryName('New Library');
      result.current.setLibraryDescription('Draft description');
    });

    await act(async () => {
      await result.current.handleCreateLibrary();
    });

    expect(createLibrary).toHaveBeenCalledTimes(1);
    expect(setSelectedLibraryId).not.toHaveBeenCalled();
    expect(navigateToPrefix).not.toHaveBeenCalled();
    expect(result.current.libraryCreateError).toBe('permission_denied');

    act(() => {
      result.current.setLibraryName('Newer Library');
    });

    expect(result.current.libraryCreateError).toBeNull();
  });

  it('deletes currently selected library and clears selection', async () => {
    const setSelectedLibraryId = vi.fn();
    const navigateToPrefix = vi.fn();
    const deleteLibrary = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileLibraryManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        setSelectedLibraryId,
        navigateToPrefix,
        createLibrary: vi.fn(),
        updateLibrary: vi.fn(),
        deleteLibrary,
        t,
        tErrors,
      }),
    );

    act(() => {
      result.current.openDeleteLibraryDialog(sampleLibrary);
    });

    await act(async () => {
      await result.current.handleDeleteLibrary();
    });

    expect(deleteLibrary).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_a',
    });
    expect(setSelectedLibraryId).toHaveBeenCalledWith(null);
    expect(navigateToPrefix).toHaveBeenCalledWith('');
  });
});
