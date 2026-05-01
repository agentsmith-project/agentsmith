import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APIError } from '@/lib/api/errors';
import {
  useFileUploadManager,
  type FileUploadTargetContext,
} from '../use-file-upload-manager';

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: mockToast,
}));

function createFileList(...files: File[]): FileList {
  return {
    ...Object.fromEntries(files.map((file, index) => [index, file])),
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as unknown as FileList;
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('useFileUploadManager', () => {
  const t = (key: string) => key;
  const tErrors = (key: string) => key;
  const uploadTarget: FileUploadTargetContext = {
    libraryId: 'lib_a',
    prefix: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['APIError REQUEST_ABORTED', new APIError('REQUEST_ABORTED', 'request aborted', 'req_abort', 499)],
    ['DOMException AbortError', new DOMException('The operation was aborted.', 'AbortError')],
    ['legacy XHR message', new Error('Upload was aborted')],
  ])('treats %s as upload cancellation', async (_label, abortError) => {
    const uploadObject = vi.fn().mockRejectedValueOnce(abortError);
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(new File(['hello'], 'cancel-me.txt', { type: 'text/plain' })),
      );
    });

    expect(result.current.uploadInProgress).toBe(false);
    expect(syncUploadedObjects).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_canceled');
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('syncs completed uploads before reporting cancellation for the remaining queue', async () => {
    const syncDeferred = createDeferred();
    const syncUploadedObjects = vi.fn().mockReturnValue(syncDeferred.promise);
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-cancel.txt', name: 'done-before-cancel.txt' })
      .mockRejectedValueOnce(new DOMException('The operation was aborted.', 'AbortError'));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    let uploadPromise!: Promise<void>;
    await act(async () => {
      uploadPromise = result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-cancel.txt', { type: 'text/plain' }),
          new File(['bye'], 'cancel-me.txt', { type: 'text/plain' }),
        ),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-cancel.txt', name: 'done-before-cancel.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(result.current.uploadInProgress).toBe(true);
    expect(result.current.uploadCanCancel).toBe(false);
    expect(mockToast.success).not.toHaveBeenCalledWith('file_manager.upload_canceled');

    await act(async () => {
      syncDeferred.resolve();
      await uploadPromise;
    });

    expect(result.current.uploadInProgress).toBe(false);
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_canceled');
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('syncs completed uploads before reporting a later queue failure', async () => {
    const syncDeferred = createDeferred();
    const syncUploadedObjects = vi.fn().mockReturnValue(syncDeferred.promise);
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-failure.txt', name: 'done-before-failure.txt' })
      .mockRejectedValueOnce(new Error('network down'));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    let uploadPromise!: Promise<void>;
    await act(async () => {
      uploadPromise = result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-failure.txt', { type: 'text/plain' }),
          new File(['bye'], 'fails.txt', { type: 'text/plain' }),
        ),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-failure.txt', name: 'done-before-failure.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(result.current.uploadInProgress).toBe(true);
    expect(result.current.uploadCanCancel).toBe(false);
    expect(mockToast.error).not.toHaveBeenCalled();

    await act(async () => {
      syncDeferred.resolve();
      await uploadPromise;
    });

    expect(result.current.uploadInProgress).toBe(false);
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('file_manager.upload_failed'));
  });

  it('syncs completed uploads before dismissing a later upload conflict', async () => {
    const syncDeferred = createDeferred();
    const syncUploadedObjects = vi.fn().mockReturnValue(syncDeferred.promise);
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-conflict.txt', name: 'done-before-conflict.txt' })
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-conflict.txt', { type: 'text/plain' }),
          new File(['bye'], 'conflict.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);
    expect(syncUploadedObjects).not.toHaveBeenCalled();

    let dismissPromise!: Promise<void>;
    await act(async () => {
      dismissPromise = Promise.resolve(result.current.dismissUploadConflict());
      await Promise.resolve();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-conflict.txt', name: 'done-before-conflict.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(result.current.uploadConflictOpen).toBe(false);
    expect(result.current.uploadInProgress).toBe(true);

    await act(async () => {
      syncDeferred.resolve();
      await dismissPromise;
    });

    expect(result.current.uploadInProgress).toBe(false);
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('opens upload conflict dialog for destination_exists', async () => {
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409));
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    const files = createFileList(new File(['hello'], 'integration-note.txt', { type: 'text/plain' }));

    await act(async () => {
      await result.current.handleFilesPicked(files);
    });

    expect(result.current.uploadConflictOpen).toBe(true);
    expect(result.current.uploadConflictFileName).toBe('integration-note.txt');
    expect(syncUploadedObjects).not.toHaveBeenCalled();
  });

  it('opens upload conflict dialog for legacy file_library_destination_exists shape', async () => {
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('RESOURCE_CONFLICT', 'file_library_destination_exists', 'req_2', 409));
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    const files = createFileList(new File(['hello'], 'integration-note.txt', { type: 'text/plain' }));

    await act(async () => {
      await result.current.handleFilesPicked(files);
    });

    expect(result.current.uploadConflictOpen).toBe(true);
    expect(result.current.uploadConflictFileName).toBe('integration-note.txt');
    expect(syncUploadedObjects).not.toHaveBeenCalled();
  });

  it('passes uploaded object identity to listing sync before clearing upload progress and showing success', async () => {
    const syncDeferred = createDeferred();
    const syncUploadedObjects = vi.fn().mockReturnValue(syncDeferred.promise);
    const uploadObject = vi.fn().mockImplementation(async (input: { onProgress?: (progress: number) => void }) => {
      input.onProgress?.(100);
      return { key: 'sync-note.txt', name: 'sync-note.txt' };
    });

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    let uploadPromise!: Promise<void>;
    await act(async () => {
      uploadPromise = result.current.handleFilesPicked(
        createFileList(new File(['hello'], 'sync-note.txt', { type: 'text/plain' })),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'sync-note.txt', name: 'sync-note.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(uploadObject.mock.invocationCallOrder[0]).toBeLessThan(syncUploadedObjects.mock.invocationCallOrder[0]);
    expect(result.current.uploadInProgress).toBe(true);
    expect(result.current.uploadCurrentFileName).toBe('sync-note.txt');
    expect(result.current.uploadCurrentProgress).toBe(100);
    expect(mockToast.success).not.toHaveBeenCalled();

    await act(async () => {
      syncDeferred.resolve();
      await uploadPromise;
    });

    expect(result.current.uploadInProgress).toBe(false);
    expect(result.current.uploadCurrentFileName).toBe('');
    expect(result.current.uploadCurrentProgress).toBe(0);
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_success');
  });

  it('keeps syncing state non-cancelable after upload body has completed', async () => {
    const syncDeferred = createDeferred();
    const syncUploadedObjects = vi.fn().mockReturnValue(syncDeferred.promise);
    const uploadSignals: AbortSignal[] = [];
    const uploadObject = vi.fn().mockImplementation(async (input: {
      signal?: AbortSignal;
      onProgress?: (progress: number) => void;
    }) => {
      if (input.signal) uploadSignals.push(input.signal);
      input.onProgress?.(100);
      return { key: 'sync-note.txt', name: 'sync-note.txt' };
    });

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    let uploadPromise!: Promise<void>;
    await act(async () => {
      uploadPromise = result.current.handleFilesPicked(
        createFileList(new File(['hello'], 'sync-note.txt', { type: 'text/plain' })),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    expect(result.current.uploadInProgress).toBe(true);
    expect(result.current.uploadCanCancel).toBe(false);

    act(() => {
      result.current.handleCancelUpload();
    });

    expect(uploadSignals[0]?.aborted).toBe(false);

    await act(async () => {
      syncDeferred.resolve();
      await uploadPromise;
    });
  });

  it('aborts listing sync on unmount and does not show success after the owner is gone', async () => {
    const syncDeferred = createDeferred();
    let syncSignal: AbortSignal | undefined;
    const syncUploadedObjects = vi.fn().mockImplementation((
      _target: FileUploadTargetContext,
      _uploadedObjects: unknown[],
      options?: { signal?: AbortSignal },
    ) => {
      syncSignal = options?.signal;
      return syncDeferred.promise;
    });
    const uploadObject = vi.fn().mockImplementation(async (input: { onProgress?: (progress: number) => void }) => {
      input.onProgress?.(100);
      return { key: 'sync-note.txt', name: 'sync-note.txt' };
    });

    const { result, unmount } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    let uploadPromise!: Promise<void>;
    await act(async () => {
      uploadPromise = result.current.handleFilesPicked(
        createFileList(new File(['hello'], 'sync-note.txt', { type: 'text/plain' })),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    unmount();

    expect(syncSignal?.aborted).toBe(true);

    await act(async () => {
      syncDeferred.resolve();
      await uploadPromise;
    });

    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('cancels an in-flight overwrite conflict resolution without continuing the stale queue', async () => {
    const overwriteDeferred = createDeferred<{ key: string; name: string }>();
    const overwriteSignals: AbortSignal[] = [];
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockImplementationOnce((input: { signal?: AbortSignal }) => {
        if (input.signal) overwriteSignals.push(input.signal);
        return overwriteDeferred.promise;
      })
      .mockResolvedValueOnce({ key: 'after-overwrite.txt', name: 'after-overwrite.txt' });
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'conflict.txt', { type: 'text/plain' }),
          new File(['bye'], 'after-overwrite.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    let resolvePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      resolvePromise = result.current.resolveUploadConflictOverwrite();
      await Promise.resolve();
    });

    await waitFor(() => expect(uploadObject).toHaveBeenCalledTimes(2));
    expect(overwriteSignals[0]?.aborted).toBe(false);

    await act(async () => {
      await result.current.dismissUploadConflict();
    });

    expect(overwriteSignals[0]?.aborted).toBe(true);
    expect(result.current.uploadConflictOpen).toBe(false);
    expect(result.current.uploadInProgress).toBe(false);

    await act(async () => {
      overwriteDeferred.resolve({ key: 'conflict.txt', name: 'conflict.txt' });
      await resolvePromise;
    });

    expect(uploadObject).toHaveBeenCalledTimes(2);
    expect(syncUploadedObjects).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('syncs pending partial uploads once when progress cancel interrupts overwrite resolution', async () => {
    const overwriteDeferred = createDeferred<{ key: string; name: string }>();
    const overwriteSignals: AbortSignal[] = [];
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-overwrite-cancel.txt', name: 'done-before-overwrite-cancel.txt' })
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockImplementationOnce((input: { signal?: AbortSignal }) => {
        if (input.signal) overwriteSignals.push(input.signal);
        return overwriteDeferred.promise;
      })
      .mockResolvedValueOnce({ key: 'after-overwrite-cancel.txt', name: 'after-overwrite-cancel.txt' });
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-overwrite-cancel.txt', { type: 'text/plain' }),
          new File(['bye'], 'conflict.txt', { type: 'text/plain' }),
          new File(['later'], 'after-overwrite-cancel.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    let resolvePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      resolvePromise = result.current.resolveUploadConflictOverwrite();
      await Promise.resolve();
    });

    await waitFor(() => expect(uploadObject).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.uploadCanCancel).toBe(true));

    act(() => {
      result.current.handleCancelUpload();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    expect(overwriteSignals[0]?.aborted).toBe(true);
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-overwrite-cancel.txt', name: 'done-before-overwrite-cancel.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );

    await act(async () => {
      overwriteDeferred.resolve({ key: 'conflict.txt', name: 'conflict.txt' });
      await resolvePromise;
    });

    expect(uploadObject).toHaveBeenCalledTimes(3);
    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_canceled');
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('cancels an in-flight rename conflict resolution without continuing the stale queue', async () => {
    const renameDeferred = createDeferred<{ key: string; name: string }>();
    const renameSignals: AbortSignal[] = [];
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockImplementationOnce((input: { file: File; signal?: AbortSignal }) => {
        expect(input.file.name).toBe('conflict (1).txt');
        if (input.signal) renameSignals.push(input.signal);
        return renameDeferred.promise;
      })
      .mockResolvedValueOnce({ key: 'after-rename.txt', name: 'after-rename.txt' });
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'conflict.txt', { type: 'text/plain' }),
          new File(['bye'], 'after-rename.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    let resolvePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      resolvePromise = result.current.resolveUploadConflictRename();
      await Promise.resolve();
    });

    await waitFor(() => expect(uploadObject).toHaveBeenCalledTimes(2));
    expect(renameSignals[0]?.aborted).toBe(false);

    await act(async () => {
      await result.current.dismissUploadConflict();
    });

    expect(renameSignals[0]?.aborted).toBe(true);
    expect(result.current.uploadConflictOpen).toBe(false);
    expect(result.current.uploadInProgress).toBe(false);

    await act(async () => {
      renameDeferred.resolve({ key: 'conflict (1).txt', name: 'conflict (1).txt' });
      await resolvePromise;
    });

    expect(uploadObject).toHaveBeenCalledTimes(2);
    expect(syncUploadedObjects).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('syncs pending partial uploads once when progress cancel interrupts rename resolution', async () => {
    const renameDeferred = createDeferred<{ key: string; name: string }>();
    const renameSignals: AbortSignal[] = [];
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-rename-cancel.txt', name: 'done-before-rename-cancel.txt' })
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockImplementationOnce((input: { file: File; signal?: AbortSignal }) => {
        expect(input.file.name).toBe('conflict (1).txt');
        if (input.signal) renameSignals.push(input.signal);
        return renameDeferred.promise;
      })
      .mockResolvedValueOnce({ key: 'after-rename-cancel.txt', name: 'after-rename-cancel.txt' });
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-rename-cancel.txt', { type: 'text/plain' }),
          new File(['bye'], 'conflict.txt', { type: 'text/plain' }),
          new File(['later'], 'after-rename-cancel.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    let resolvePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      resolvePromise = result.current.resolveUploadConflictRename();
      await Promise.resolve();
    });

    await waitFor(() => expect(uploadObject).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.uploadCanCancel).toBe(true));

    act(() => {
      result.current.handleCancelUpload();
    });

    await waitFor(() => expect(syncUploadedObjects).toHaveBeenCalledTimes(1));
    expect(renameSignals[0]?.aborted).toBe(true);
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-rename-cancel.txt', name: 'done-before-rename-cancel.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );

    await act(async () => {
      renameDeferred.resolve({ key: 'conflict (1).txt', name: 'conflict (1).txt' });
      await resolvePromise;
    });

    expect(uploadObject).toHaveBeenCalledTimes(3);
    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledTimes(1);
    expect(mockToast.success).toHaveBeenCalledWith('file_manager.upload_canceled');
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('resets progress when overwrite conflict resolution upload fails', async () => {
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockRejectedValueOnce(new Error('network down'));
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(new File(['hello'], 'integration-note.txt', { type: 'text/plain' })),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    await act(async () => {
      await result.current.resolveUploadConflictOverwrite();
    });

    expect(result.current.uploadInProgress).toBe(false);
    expect(result.current.uploadCanCancel).toBe(false);
    expect(result.current.uploadCurrentFileName).toBe('');
    expect(result.current.uploadCurrentProgress).toBe(0);
    expect(result.current.uploadConflictOpen).toBe(true);
    expect(syncUploadedObjects).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('file_manager.upload_failed'));
  });

  it('resets progress when rename conflict resolution upload fails', async () => {
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockRejectedValueOnce(new Error('network down'));
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(new File(['hello'], 'integration-note.txt', { type: 'text/plain' })),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    await act(async () => {
      await result.current.resolveUploadConflictRename();
    });

    expect(uploadObject).toHaveBeenLastCalledWith(expect.objectContaining({
      file: expect.objectContaining({ name: 'integration-note (1).txt' }),
      overwrite: false,
    }));
    expect(result.current.uploadInProgress).toBe(false);
    expect(result.current.uploadCanCancel).toBe(false);
    expect(result.current.uploadCurrentFileName).toBe('');
    expect(result.current.uploadCurrentProgress).toBe(0);
    expect(result.current.uploadConflictOpen).toBe(true);
    expect(syncUploadedObjects).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('file_manager.upload_failed'));
  });

  it('syncs partial uploads only once after overwrite resolution fails and consumes them before dismiss', async () => {
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-overwrite.txt', name: 'done-before-overwrite.txt' })
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockRejectedValueOnce(new Error('overwrite upload failed'));
    const syncUploadedObjects = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('partial sync repeated'));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-overwrite.txt', { type: 'text/plain' }),
          new File(['bye'], 'conflict.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    await act(async () => {
      await result.current.resolveUploadConflictOverwrite();
    });

    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-overwrite.txt', name: 'done-before-overwrite.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(result.current.uploadConflictOpen).toBe(true);
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('file_manager.upload_failed'));

    await act(async () => {
      await result.current.dismissUploadConflict();
    });

    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(result.current.uploadConflictOpen).toBe(false);
  });

  it('syncs partial uploads only once after rename resolution fails and consumes them before dismiss', async () => {
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-rename.txt', name: 'done-before-rename.txt' })
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockRejectedValueOnce(new Error('rename upload failed'));
    const syncUploadedObjects = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('partial sync repeated'));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-rename.txt', { type: 'text/plain' }),
          new File(['bye'], 'conflict.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    await act(async () => {
      await result.current.resolveUploadConflictRename();
    });

    expect(uploadObject).toHaveBeenLastCalledWith(expect.objectContaining({
      file: expect.objectContaining({ name: 'conflict (1).txt' }),
      overwrite: false,
    }));
    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-rename.txt', name: 'done-before-rename.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(result.current.uploadConflictOpen).toBe(true);
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('file_manager.upload_failed'));

    await act(async () => {
      await result.current.dismissUploadConflict();
    });

    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(result.current.uploadConflictOpen).toBe(false);
  });

  it('syncs partial uploads only once when rename options are exhausted and dismiss does not repeat the warning', async () => {
    const uploadObject = vi
      .fn()
      .mockResolvedValueOnce({ key: 'done-before-exhaustion.txt', name: 'done-before-exhaustion.txt' })
      .mockRejectedValue(new APIError('destination_exists', 'destination_exists', 'req_1', 409));
    const syncUploadedObjects = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('partial sync repeated'));

    const { result } = renderHook(() =>
      useFileUploadManager({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        uploadTarget,
        uploadObject,
        syncUploadedObjects,
        t,
        tErrors,
      }),
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(
          new File(['hello'], 'done-before-exhaustion.txt', { type: 'text/plain' }),
          new File(['bye'], 'conflict.txt', { type: 'text/plain' }),
        ),
      );
    });

    expect(result.current.uploadConflictOpen).toBe(true);

    await act(async () => {
      await result.current.resolveUploadConflictRename();
    });

    expect(uploadObject).toHaveBeenCalledTimes(22);
    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'done-before-exhaustion.txt', name: 'done-before-exhaustion.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledWith('file_manager.upload_rename_exhausted');

    await act(async () => {
      await result.current.dismissUploadConflict();
    });

    expect(syncUploadedObjects).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(result.current.uploadConflictOpen).toBe(false);
  });

  it('keeps conflict resolution bound to the original upload target after view changes', async () => {
    const nextUploadTarget = {
      libraryId: 'lib_b',
      prefix: 'other/',
    };
    const uploadObject = vi
      .fn()
      .mockRejectedValueOnce(new APIError('destination_exists', 'destination_exists', 'req_1', 409))
      .mockResolvedValueOnce({ key: 'docs/integration-note.txt', name: 'integration-note.txt' });
    const syncUploadedObjects = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(
      ({ target }) =>
        useFileUploadManager({
          workspaceId: 'ws_default',
          projectId: 'proj_001',
          uploadTarget: target,
          uploadObject,
          syncUploadedObjects,
          t,
          tErrors,
        }),
      { initialProps: { target: uploadTarget } },
    );

    await act(async () => {
      await result.current.handleFilesPicked(
        createFileList(new File(['hello'], 'integration-note.txt', { type: 'text/plain' })),
      );
    });

    rerender({ target: nextUploadTarget });

    await act(async () => {
      await result.current.resolveUploadConflictOverwrite();
    });

    expect(uploadObject).toHaveBeenNthCalledWith(2, expect.objectContaining({
      libraryId: 'lib_a',
      prefix: undefined,
      overwrite: true,
    }));
    expect(syncUploadedObjects).toHaveBeenCalledWith(
      uploadTarget,
      [{ key: 'docs/integration-note.txt', name: 'integration-note.txt' }],
      expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) }),
    );
  });
});
