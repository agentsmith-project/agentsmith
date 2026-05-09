import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileBatchOperations } from '../use-file-batch-operations';
import { APIError } from '@/lib/api/errors';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: mockToast,
}));

describe('useFileBatchOperations', () => {
  const t = (key: string, values?: Record<string, string>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  const tErrors = (key: string) => ({
    'conflict.title': 'Conflict',
    'conflict.description': 'Conflict',
    'file_library_deleting.description': 'This library is being deleted. Refresh the library status before trying again.',
  }[key] ?? key);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles delete success and clears selection', async () => {
    const clearSelection = vi.fn();
    const onDeletePartialFailure = vi.fn();
    const deleteObjects = vi.fn().mockResolvedValue({
      results: [{ key: 'a.txt', status: 'deleted' }],
    });

    const { result } = renderHook(() =>
      useFileBatchOperations({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        selected: [{ kind: 'object', key: 'a.txt' }],
        selectedObjects: [{ kind: 'object', key: 'a.txt' }],
        clearSelection,
        deleteObjects,
        onDeletePartialFailure,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await expect(result.current.handleDelete()).resolves.toBe(true);
    });

    expect(deleteObjects).toHaveBeenCalledWith({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_a',
      keys: ['a.txt'],
    });
    expect(clearSelection).toHaveBeenCalledTimes(1);
    expect(onDeletePartialFailure).not.toHaveBeenCalled();
    expect(result.current.batchResultOpen).toBe(false);
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('opens batch result when delete partially fails', async () => {
    const clearSelection = vi.fn();
    const onDeletePartialFailure = vi.fn();
    const deleteObjects = vi.fn().mockResolvedValue({
      results: [
        { key: 'ok.txt', status: 'deleted' },
        { key: 'failed.txt', status: 'failed' },
      ],
    });

    const { result } = renderHook(() =>
      useFileBatchOperations({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        selected: [
          { kind: 'object', key: 'ok.txt' },
          { kind: 'object', key: 'failed.txt' },
        ],
        selectedObjects: [
          { kind: 'object', key: 'ok.txt' },
          { kind: 'object', key: 'failed.txt' },
        ],
        clearSelection,
        deleteObjects,
        onDeletePartialFailure,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await expect(result.current.handleDelete()).resolves.toBe(false);
    });

    expect(onDeletePartialFailure).toHaveBeenCalledWith(['failed.txt']);
    expect(result.current.batchResultOpen).toBe(true);
    expect(result.current.batchResultType).toBe('delete');
    expect(result.current.batchFailedKeys).toEqual(['failed.txt']);
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('keeps object delete conflicts inline with translated copy instead of a raw toast key', async () => {
    const clearSelection = vi.fn();
    const onDeletePartialFailure = vi.fn();
    const deleteObjects = vi.fn().mockRejectedValue(new APIError(
      'FILE_LIBRARY_DELETING',
      'file_library_deleting',
      undefined,
      409,
      { file_library_id: 'lib_a', file_library_status: 'deleting' },
    ));

    const { result } = renderHook(() =>
      useFileBatchOperations({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        selected: [{ kind: 'object', key: 'a.txt' }],
        selectedObjects: [{ kind: 'object', key: 'a.txt' }],
        clearSelection,
        deleteObjects,
        onDeletePartialFailure,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await expect(result.current.handleDelete()).resolves.toBe(false);
    });

    expect(result.current.deleteInlineError).toBe(
      'This library is being deleted. Refresh the library status before trying again.',
    );
    expect(mockToast.error).not.toHaveBeenCalledWith(expect.stringContaining('file_library_deleting'));
    expect(clearSelection).not.toHaveBeenCalled();
    expect(onDeletePartialFailure).not.toHaveBeenCalled();
  });

  it('keeps retry API rejections visible inline while preserving failed object context', async () => {
    const clearSelection = vi.fn();
    const onDeletePartialFailure = vi.fn();
    const deleteObjects = vi.fn()
      .mockResolvedValueOnce({
        results: [{ key: 'failed.txt', status: 'failed' }],
      })
      .mockRejectedValueOnce(new APIError(
        'FILE_LIBRARY_DELETING',
        'file_library_deleting',
        undefined,
        409,
        { file_library_id: 'lib_a', file_library_status: 'deleting' },
      ));

    const { result } = renderHook(() =>
      useFileBatchOperations({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        selected: [{ kind: 'object', key: 'failed.txt' }],
        selectedObjects: [{ kind: 'object', key: 'failed.txt' }],
        clearSelection,
        deleteObjects,
        onDeletePartialFailure,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await expect(result.current.handleDelete()).resolves.toBe(false);
    });
    expect(result.current.batchResultOpen).toBe(true);
    expect(result.current.batchFailedKeys).toEqual(['failed.txt']);

    await act(async () => {
      await expect(result.current.handleRetryBatchFailures()).resolves.toBeUndefined();
    });

    expect(result.current.deleteInlineError).toBe(
      'This library is being deleted. Refresh the library status before trying again.',
    );
    expect(result.current.batchResultOpen).toBe(true);
    expect(result.current.batchFailedKeys).toEqual(['failed.txt']);
    expect(result.current.batchRetryPending).toBe(false);
    expect(clearSelection).not.toHaveBeenCalled();
  });
});
