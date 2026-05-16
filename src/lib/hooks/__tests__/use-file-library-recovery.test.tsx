import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockCreateSavePoint,
  mockGetActiveFileLibraryOperation,
  mockListSavePoints,
  mockReleaseRuntimeAccess,
  mockRestoreFileLibrary,
} = vi.hoisted(() => ({
  mockCreateSavePoint: vi.fn().mockResolvedValue({
    id: 'flop_save_point_new',
    kind: 'save_point_create',
    status: 'accepted',
    file_library_id: 'lib_1',
    message: 'Before edits',
    created_at: '2026-05-09T12:00:00.000Z',
    updated_at: '2026-05-09T12:00:00.000Z',
  }),
  mockGetActiveFileLibraryOperation: vi.fn().mockResolvedValue({ operation: null }),
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
      getActiveFileLibraryOperation: mockGetActiveFileLibraryOperation,
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
  useFileLibraryActiveVersionOperation,
  useFileLibrarySavePoints,
  useReleaseFileLibraryRuntimeAccess,
  useRestoreFileLibrary,
} from '../use-file-library-recovery';
import { toast } from '@/components/ui/toast';
import { APIError, handleErrorForToast } from '@/lib/api/errors';

const workspaceId = 'ws_test';
const projectId = 'proj_test';
const libraryId = 'lib_1';

function createTestHarness(options: { mutationRetry?: boolean | number } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: options.mutationRetry ?? false },
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

  it('loads active file-library version operation projection for one file library', async () => {
    mockGetActiveFileLibraryOperation.mockResolvedValueOnce({
      operation: {
        id: 'flro_active',
        kind: 'restore',
        file_library_id: libraryId,
        source_save_point_id: 'sp_1',
        status: 'running',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:01:00.000Z',
      },
    });

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useFileLibraryActiveVersionOperation(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetActiveFileLibraryOperation).toHaveBeenCalledWith(workspaceId, projectId, libraryId);
    expect(result.current.data?.operation?.status).toBe('running');
  });

  it('does not treat null active operation projection as terminal restore success', async () => {
    vi.useFakeTimers();
    mockGetActiveFileLibraryOperation
      .mockResolvedValueOnce({
        operation: {
          id: 'flro_active_to_null',
          kind: 'restore',
          file_library_id: libraryId,
          source_save_point_id: 'sp_1',
          status: 'running',
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      })
      .mockResolvedValueOnce({ operation: null });
    const { queryClient, Wrapper } = createTestHarness();
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(savePointsKey, { items: [] });
    queryClient.setQueryData(objectsKey, { pages: [{ items: [] }] });

    const { result } = renderHook(
      () => useFileLibraryActiveVersionOperation(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await vi.waitFor(() => expect(result.current.data?.operation?.status).toBe('running'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.waitFor(() => expect(result.current.data?.operation).toBeNull());
    });
    expect(mockGetActiveFileLibraryOperation.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(false);
    expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(false);
  });

  it('creates a save point through fast admission and stores the active save operation projection', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const activeOperationKey = ['file-library-active-operation', workspaceId, projectId, libraryId];
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

    expect(mockCreateSavePoint).toHaveBeenCalledTimes(1);
    expect(mockCreateSavePoint).toHaveBeenCalledWith(
      workspaceId,
      projectId,
      libraryId,
      { message: 'Before edits' },
      { idempotencyKey: expect.stringMatching(/^save_point_/) },
    );
    expect(queryClient.getQueryData(activeOperationKey)).toEqual({
      operation: {
        id: 'flop_save_point_new',
        kind: 'save_point_create',
        status: 'accepted',
        file_library_id: 'lib_1',
        message: 'Before edits',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:00.000Z',
      },
    });
    expect(queryClient.getQueryData(savePointsKey)).toEqual({
      items: [
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
      expect(queryClient.getQueryCache().find({ queryKey: activeOperationKey })?.isStale()).toBe(true);
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps one save-point idempotency key across mutation retry attempts', async () => {
    mockCreateSavePoint
      .mockRejectedValueOnce(new Error('transient save admission failure'))
      .mockResolvedValueOnce({
        id: 'flop_save_point_retry',
        kind: 'save_point_create',
        status: 'accepted',
        file_library_id: libraryId,
        message: 'Before retry',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:00.000Z',
      });
    const { Wrapper } = createTestHarness({ mutationRetry: 1 });
    const { result } = renderHook(() => useCreateFileLibrarySavePoint(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        message: 'Before retry',
      });
    });

    expect(mockCreateSavePoint).toHaveBeenCalledTimes(2);
    const firstOptions = mockCreateSavePoint.mock.calls[0]?.[4];
    const secondOptions = mockCreateSavePoint.mock.calls[1]?.[4];
    expect(firstOptions).toMatchObject({ idempotencyKey: expect.stringMatching(/^save_point_/) });
    expect(secondOptions).toEqual(firstOptions);
  });

  it('starts direct restore once with idempotency and invalidates file/save-point/operation caches', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const activeOperationKey = ['file-library-active-operation', workspaceId, projectId, libraryId];
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(activeOperationKey, { operation: null });
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
      { save_point_id: 'sp_1' },
      { idempotencyKey: 'restore-key-1' },
    );
    expect(queryClient.getQueryData(activeOperationKey)).toEqual({
      operation: {
        id: 'flro_1',
        kind: 'restore',
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
    const activeOperationKey = ['file-library-active-operation', workspaceId, projectId, libraryId];

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
      operation: expect.objectContaining({
        id: 'flro_pending',
        kind: 'restore',
        status: 'accepted',
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
    const activeOperationKey = ['file-library-active-operation', workspaceId, projectId, libraryId];
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
    queryClient.setQueryData(activeOperationKey, { operation: { id: 'flro_1' } });
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
