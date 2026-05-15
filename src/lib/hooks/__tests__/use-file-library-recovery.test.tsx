import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockCreateSavePoint,
  mockGetActiveRestoreOperation,
  mockListSavePoints,
  mockReleaseRuntimeAccess,
  mockRestoreFileLibrary,
} = vi.hoisted(() => ({
  mockCreateSavePoint: vi.fn().mockResolvedValue({
    id: 'sp_new',
    file_library_id: 'lib_1',
    message: 'Before edits',
    created_at: '2026-05-09T12:00:00.000Z',
  }),
  mockGetActiveRestoreOperation: vi.fn().mockResolvedValue({ restore_operation: null }),
  mockListSavePoints: vi.fn().mockResolvedValue({ items: [] }),
  mockReleaseRuntimeAccess: vi.fn().mockResolvedValue({ file_library_id: 'lib_1', released: true }),
  mockRestoreFileLibrary: vi.fn().mockResolvedValue({
    id: 'flro_1',
    file_library_id: 'lib_1',
    source_save_point_id: 'sp_1',
    status: 'succeeded',
    created_at: '2026-05-09T12:02:00.000Z',
    updated_at: '2026-05-09T12:02:00.000Z',
  }),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function FilesAPIMock() {
    return {
      createSavePoint: mockCreateSavePoint,
      getActiveRestoreOperation: mockGetActiveRestoreOperation,
      listSavePoints: mockListSavePoints,
      releaseRuntimeAccess: mockReleaseRuntimeAccess,
      restoreFileLibrary: mockRestoreFileLibrary,
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@/lib/api/errors', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/errors')>('@/lib/api/errors');
  return {
    ...actual,
    handleErrorForToast: vi.fn(),
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import {
  useCreateFileLibrarySavePoint,
  useFileLibraryActiveRestoreOperation,
  useFileLibrarySavePoints,
  useReleaseFileLibraryRuntimeAccess,
  useRestoreFileLibrary,
} from '../use-file-library-recovery';
import { toast } from '@/components/ui/toast';
import { APIError, handleErrorForToast } from '@/lib/api/errors';

const workspaceId = 'ws_test';
const projectId = 'proj_test';
const libraryId = 'lib_1';

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

describe('file library recovery hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists save points for one file library', async () => {
    mockListSavePoints.mockResolvedValueOnce({
      items: [
        {
          id: 'sp_1',
          file_library_id: libraryId,
          message: 'Before edits',
          created_at: '2026-05-09T12:00:00.000Z',
        },
      ],
    });

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useFileLibrarySavePoints(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListSavePoints).toHaveBeenCalledWith(workspaceId, projectId, libraryId);
    expect(result.current.data?.items[0]).toMatchObject({
      id: 'sp_1',
      message: 'Before edits',
    });
  });

  it('automatically retries save-point lists while the file library operation is pending', async () => {
    vi.useFakeTimers();
    mockListSavePoints
      .mockRejectedValueOnce(new APIError(
        'FILE_LIBRARY_OPERATION_PENDING',
        'file_library_operation_pending',
      ))
      .mockResolvedValueOnce({
        items: [
          {
            id: 'sp_after_pending',
            file_library_id: libraryId,
            message: 'After pending operation',
            created_at: '2026-05-09T12:30:00.000Z',
          },
        ],
      });

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useFileLibrarySavePoints(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await vi.waitFor(() => expect(result.current.isError).toBe(true));
    });
    expect(mockListSavePoints).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
    expect(mockListSavePoints).toHaveBeenCalledTimes(2);
    expect(result.current.data?.items[0]).toMatchObject({
      id: 'sp_after_pending',
      message: 'After pending operation',
    });
  });

  it('loads active direct restore operation projection for one file library', async () => {
    mockGetActiveRestoreOperation.mockResolvedValueOnce({
      restore_operation: {
        id: 'flro_active',
        file_library_id: libraryId,
        source_save_point_id: 'sp_1',
        status: 'restoring',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:01:00.000Z',
      },
    });

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useFileLibraryActiveRestoreOperation(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetActiveRestoreOperation).toHaveBeenCalledWith(workspaceId, projectId, libraryId);
    expect(result.current.data?.restore_operation?.status).toBe('restoring');
  });

  it('creates a save point, shows it from cache immediately, and marks the save-point list stale', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    queryClient.setQueryData(savePointsKey, {
      items: [
        {
          id: 'sp_existing',
          file_library_id: libraryId,
          message: 'Earlier save',
          created_at: '2026-05-09T11:00:00.000Z',
        },
      ],
    });

    const { result } = renderHook(() => useCreateFileLibrarySavePoint(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        message: 'Before edits',
      });
    });

    expect(mockCreateSavePoint).toHaveBeenCalledWith(workspaceId, projectId, libraryId, {
      message: 'Before edits',
    });
    expect(queryClient.getQueryData(savePointsKey)).toEqual({
      items: [
        {
          id: 'sp_new',
          file_library_id: 'lib_1',
          message: 'Before edits',
          created_at: '2026-05-09T12:00:00.000Z',
        },
        {
          id: 'sp_existing',
          file_library_id: libraryId,
          message: 'Earlier save',
          created_at: '2026-05-09T11:00:00.000Z',
        },
      ],
    });
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(true);
    });
  });

  it('starts direct restore once with idempotency and invalidates file/save-point/operation caches', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const activeOperationKey = ['file-library-active-restore-operation', workspaceId, projectId, libraryId];
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(activeOperationKey, { restore_operation: null });
    queryClient.setQueryData(savePointsKey, { items: [] });
    queryClient.setQueryData(objectsKey, { pages: [{ items: [] }] });

    const { result } = renderHook(() => useRestoreFileLibrary(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        savePointId: 'sp_1',
        idempotencyKey: 'restore-key-1',
      });
    });

    expect(mockRestoreFileLibrary).toHaveBeenCalledTimes(1);
    expect(mockRestoreFileLibrary).toHaveBeenCalledWith(
      workspaceId,
      projectId,
      libraryId,
      {
        save_point_id: 'sp_1',
        discard_unsaved_changes_confirmed: true,
      },
      { idempotencyKey: 'restore-key-1' },
    );
    expect(queryClient.getQueryData(activeOperationKey)).toEqual({
      restore_operation: {
        id: 'flro_1',
        file_library_id: 'lib_1',
        source_save_point_id: 'sp_1',
        status: 'succeeded',
        created_at: '2026-05-09T12:02:00.000Z',
        updated_at: '2026-05-09T12:02:00.000Z',
      },
    });
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: activeOperationKey })?.isStale()).toBe(true);
    });
    expect(toast.success).toHaveBeenCalledWith('update_success');
  });

  it('keeps pending direct restore operations active without showing a success toast', async () => {
    mockRestoreFileLibrary.mockResolvedValueOnce({
      id: 'flro_pending',
      file_library_id: libraryId,
      source_save_point_id: 'sp_1',
      status: 'pending',
      created_at: '2026-05-09T12:02:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    });
    const { queryClient, Wrapper } = createTestHarness();
    const activeOperationKey = ['file-library-active-restore-operation', workspaceId, projectId, libraryId];

    const { result } = renderHook(() => useRestoreFileLibrary(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        savePointId: 'sp_1',
        idempotencyKey: 'restore-key-1',
      });
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(activeOperationKey)).toEqual({
      restore_operation: expect.objectContaining({
        id: 'flro_pending',
        status: 'pending',
      }),
    });
  });

  it('allows dialog-controlled direct restore errors to suppress the global error toast', async () => {
    mockRestoreFileLibrary.mockRejectedValueOnce(new Error('file_library_active_writer_blocked'));

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useRestoreFileLibrary({ suppressErrorToast: true }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await expect(result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        savePointId: 'sp_1',
        idempotencyKey: 'restore-key-1',
      })).rejects.toThrow('file_library_active_writer_blocked');
    });

    expect(handleErrorForToast).not.toHaveBeenCalled();
  });

  it('keeps the default direct restore global error toast for non-dialog callers', async () => {
    mockRestoreFileLibrary.mockRejectedValueOnce(new Error('restore failed'));

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(() => useRestoreFileLibrary(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        savePointId: 'sp_1',
        idempotencyKey: 'restore-key-1',
      })).rejects.toThrow('restore failed');
    });

    expect(handleErrorForToast).toHaveBeenCalledWith(expect.any(Error), 'useRestoreFileLibrary');
  });

  it('releases file-library runtime access and refreshes restore/file-library caches', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const activeOperationKey = ['file-library-active-restore-operation', workspaceId, projectId, libraryId];
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    const fileLibrariesKey = ['file-libraries', workspaceId, projectId];
    const fileLibraryDetailKey = ['file-library', workspaceId, projectId, libraryId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(activeOperationKey, { restore_operation: { id: 'flro_1' } });
    queryClient.setQueryData(savePointsKey, { items: [] });
    queryClient.setQueryData(fileLibrariesKey, { items: [{ id: libraryId }] });
    queryClient.setQueryData(fileLibraryDetailKey, { id: libraryId });
    queryClient.setQueryData(objectsKey, { pages: [{ items: [] }] });

    const { result } = renderHook(() => useReleaseFileLibraryRuntimeAccess({ suppressErrorToast: true }), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
      });
    });

    expect(mockReleaseRuntimeAccess).toHaveBeenCalledWith(workspaceId, projectId, libraryId);
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: activeOperationKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: fileLibraryDetailKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(true);
    });
    expect(handleErrorForToast).not.toHaveBeenCalled();
  });
});
