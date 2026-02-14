import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileBatchOperations } from '../use-file-batch-operations';

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
  const tErrors = (key: string) => key;

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
      await result.current.handleDelete();
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
      await result.current.handleDelete();
    });

    expect(onDeletePartialFailure).toHaveBeenCalledWith(['failed.txt']);
    expect(result.current.batchResultOpen).toBe(true);
    expect(result.current.batchResultType).toBe('delete');
    expect(result.current.batchFailedKeys).toEqual(['failed.txt']);
    expect(mockToast.error).toHaveBeenCalled();
  });
});
