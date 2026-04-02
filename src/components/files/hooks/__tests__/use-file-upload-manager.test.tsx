import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APIError } from '@/lib/api/errors';
import { useFileUploadManager } from '../use-file-upload-manager';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: mockToast,
}));

describe('useFileUploadManager', () => {
  const t = (key: string) => key;
  const tErrors = (key: string) => key;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens upload conflict dialog for destination_exists', async () => {
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        prefix: '',
        uploadObject,
        t,
        tErrors,
      }),
    );

    const files = {
      0: new File(['hello'], 'integration-note.txt', { type: 'text/plain' }),
      length: 1,
      item: (index: number) => (index === 0 ? new File(['hello'], 'integration-note.txt', { type: 'text/plain' }) : null),
    } as unknown as FileList;

    await act(async () => {
      await result.current.handleFilesPicked(files);
    });

    expect(result.current.uploadConflictOpen).toBe(true);
    expect(result.current.uploadConflictFileName).toBe('integration-note.txt');
  });

  it('opens upload conflict dialog for legacy file_library_destination_exists shape', async () => {
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('RESOURCE_CONFLICT', 'file_library_destination_exists', 'req_2', 409));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        selectedLibraryId: 'lib_a',
        prefix: '',
        uploadObject,
        t,
        tErrors,
      }),
    );

    const files = {
      0: new File(['hello'], 'integration-note.txt', { type: 'text/plain' }),
      length: 1,
      item: (index: number) => (index === 0 ? new File(['hello'], 'integration-note.txt', { type: 'text/plain' }) : null),
    } as unknown as FileList;

    await act(async () => {
      await result.current.handleFilesPicked(files);
    });

    expect(result.current.uploadConflictOpen).toBe(true);
    expect(result.current.uploadConflictFileName).toBe('integration-note.txt');
  });
});
