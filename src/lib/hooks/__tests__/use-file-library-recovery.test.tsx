import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockListSavePoints,
  mockGetActiveRestorePreview,
  mockCreateSavePoint,
  mockCreateRestorePreview,
  mockRunRestore,
  mockReleaseRuntimeAccess,
  mockCancelRestore,
} = vi.hoisted(() => ({
  mockListSavePoints: vi.fn().mockResolvedValue({ items: [] }),
  mockGetActiveRestorePreview: vi.fn().mockResolvedValue({ restore_preview: null }),
  mockCreateSavePoint: vi.fn().mockResolvedValue({
    id: 'sp_new',
    file_library_id: 'lib_1',
    message: 'Before edits',
    created_at: '2026-05-09T12:00:00.000Z',
  }),
  mockCreateRestorePreview: vi.fn().mockResolvedValue({
    id: 'rp_1',
    file_library_id: 'lib_1',
    source_save_point_id: 'sp_1',
    status: 'ready',
    created_at: '2026-05-09T12:01:00.000Z',
    updated_at: '2026-05-09T12:01:00.000Z',
  }),
  mockRunRestore: vi.fn().mockResolvedValue({
    id: 'rr_1',
    file_library_id: 'lib_1',
    restore_preview_id: 'rp_1',
    status: 'succeeded',
    created_at: '2026-05-09T12:02:00.000Z',
    updated_at: '2026-05-09T12:02:00.000Z',
  }),
  mockReleaseRuntimeAccess: vi.fn().mockResolvedValue({ file_library_id: 'lib_1', released: true }),
  mockCancelRestore: vi.fn().mockResolvedValue({
    id: 'rp_1',
    file_library_id: 'lib_1',
    source_save_point_id: 'sp_1',
    status: 'canceled',
    created_at: '2026-05-09T12:01:00.000Z',
    updated_at: '2026-05-09T12:03:00.000Z',
  }),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function FilesAPIMock() {
    return {
      listSavePoints: mockListSavePoints,
      getActiveRestorePreview: mockGetActiveRestorePreview,
      createSavePoint: mockCreateSavePoint,
      createRestorePreview: mockCreateRestorePreview,
      runRestore: mockRunRestore,
      releaseRuntimeAccess: mockReleaseRuntimeAccess,
      cancelRestore: mockCancelRestore,
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
  useCancelFileLibraryRestore,
  useCreateFileLibraryRestorePreview,
  useCreateFileLibrarySavePoint,
  useFileLibraryActiveRestorePreview,
  useFileLibrarySavePoints,
  useReleaseFileLibraryRuntimeAccess,
  useRunFileLibraryRestore,
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

  it('keeps cached save points visible when a later refresh reports operation pending', async () => {
    mockListSavePoints
      .mockResolvedValueOnce({
        items: [
          {
            id: 'sp_cached',
            file_library_id: libraryId,
            message: 'Before delete',
            created_at: '2026-05-09T12:00:00.000Z',
          },
        ],
      })
      .mockRejectedValueOnce(new APIError(
        'FILE_LIBRARY_OPERATION_PENDING',
        'file_library_operation_pending',
      ));

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useFileLibrarySavePoints(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]).toMatchObject({
      id: 'sp_cached',
      message: 'Before delete',
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(mockListSavePoints).toHaveBeenCalledTimes(2);
    expect(result.current.data?.items[0]).toMatchObject({
      id: 'sp_cached',
      message: 'Before delete',
    });
    expect(result.current.isError).toBe(false);
  });

  it('loads active restore preview projection for one file library', async () => {
    mockGetActiveRestorePreview.mockResolvedValueOnce({
      restore_preview: {
        id: 'rp_active',
        file_library_id: libraryId,
        source_save_point_id: 'sp_1',
        status: 'previewing',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:01:00.000Z',
      },
    });

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useFileLibraryActiveRestorePreview(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetActiveRestorePreview).toHaveBeenCalledWith(workspaceId, projectId, libraryId);
    expect(result.current.data?.restore_preview?.status).toBe('previewing');
  });

  it('treats terminal restore preview projections as inactive', async () => {
    mockGetActiveRestorePreview.mockResolvedValueOnce({
      restore_preview: {
        id: 'rp_restored',
        file_library_id: libraryId,
        source_save_point_id: 'sp_1',
        status: 'restored',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:05:00.000Z',
      },
    });

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useFileLibraryActiveRestorePreview(workspaceId, projectId, libraryId),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ restore_preview: null });
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

  it('allows dialog-controlled save point errors to suppress the global error toast', async () => {
    mockCreateSavePoint.mockRejectedValueOnce(new Error('file_library_active_writer_blocked'));

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useCreateFileLibrarySavePoint({ suppressErrorToast: true }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await expect(result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        message: 'Before edits',
      })).rejects.toThrow('file_library_active_writer_blocked');
    });

    expect(handleErrorForToast).not.toHaveBeenCalled();
  });

  it('keeps the default save point global error toast for non-dialog callers', async () => {
    mockCreateSavePoint.mockRejectedValueOnce(new Error('save point failed'));

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(() => useCreateFileLibrarySavePoint(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        message: 'Before edits',
      })).rejects.toThrow('save point failed');
    });

    expect(handleErrorForToast).toHaveBeenCalledWith(expect.any(Error), 'useCreateFileLibrarySavePoint');
  });

  it('runs restore through preview, updates active preview cache, and invalidates file listings for the library', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const activePreviewKey = ['file-library-active-restore-preview', workspaceId, projectId, libraryId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(objectsKey, { pages: [{ items: [] }] });

    const { result: previewResult } = renderHook(() => useCreateFileLibraryRestorePreview(), {
      wrapper: Wrapper,
    });
    const { result: runResult } = renderHook(() => useRunFileLibraryRestore(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await previewResult.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        savePointId: 'sp_1',
      });
      expect(queryClient.getQueryData(activePreviewKey)).toEqual({
        restore_preview: {
          id: 'rp_1',
          file_library_id: 'lib_1',
          source_save_point_id: 'sp_1',
          status: 'ready',
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      });
      await runResult.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        restorePreviewId: 'rp_1',
      });
    });

    expect(mockCreateRestorePreview).toHaveBeenCalledWith(workspaceId, projectId, libraryId, {
      save_point_id: 'sp_1',
    });
    expect(mockRunRestore).toHaveBeenCalledWith(workspaceId, projectId, libraryId, {
      restore_preview_id: 'rp_1',
    });
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(true);
    });
    expect(queryClient.getQueryData(activePreviewKey)).toEqual({ restore_preview: null });
  });

  it('keeps pending restore runs active without showing a success toast', async () => {
    mockRunRestore.mockResolvedValueOnce({
      id: 'rr_pending',
      file_library_id: libraryId,
      restore_preview_id: 'rp_1',
      status: 'pending',
      created_at: '2026-05-09T12:02:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    });
    const { queryClient, Wrapper } = createTestHarness();
    const activePreviewKey = ['file-library-active-restore-preview', workspaceId, projectId, libraryId];
    queryClient.setQueryData(activePreviewKey, {
      restore_preview: {
        id: 'rp_1',
        file_library_id: libraryId,
        source_save_point_id: 'sp_1',
        status: 'ready',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:01:00.000Z',
      },
    });

    const { result } = renderHook(() => useRunFileLibraryRestore(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        restorePreviewId: 'rp_1',
      });
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(activePreviewKey)).toEqual({
      restore_preview: expect.objectContaining({
        id: 'rp_1',
        status: 'restoring',
      }),
    });
  });

  it('allows dialog-controlled restore run errors to suppress the global error toast', async () => {
    mockRunRestore.mockRejectedValueOnce(new Error('file_library_active_writer_blocked'));

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(
      () => useRunFileLibraryRestore({ suppressErrorToast: true }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await expect(result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        restorePreviewId: 'rp_1',
      })).rejects.toThrow('file_library_active_writer_blocked');
    });

    expect(handleErrorForToast).not.toHaveBeenCalled();
  });

  it('keeps the default restore run global error toast for non-dialog callers', async () => {
    mockRunRestore.mockRejectedValueOnce(new Error('restore run failed'));

    const { Wrapper } = createTestHarness();
    const { result } = renderHook(() => useRunFileLibraryRestore(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await expect(result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        restorePreviewId: 'rp_1',
      })).rejects.toThrow('restore run failed');
    });

    expect(handleErrorForToast).toHaveBeenCalledWith(expect.any(Error), 'useRunFileLibraryRestore');
  });

  it('releases file-library runtime access and refreshes restore/file-library caches', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const activePreviewKey = ['file-library-active-restore-preview', workspaceId, projectId, libraryId];
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
    queryClient.setQueryData(activePreviewKey, { restore_preview: { id: 'rp_1' } });
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
      expect(queryClient.getQueryCache().find({ queryKey: activePreviewKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: fileLibrariesKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: fileLibraryDetailKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(true);
    });
    expect(handleErrorForToast).not.toHaveBeenCalled();
  });

  it('cancels restore preview, clears active preview cache, and does not invalidate object listings', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const activePreviewKey = ['file-library-active-restore-preview', workspaceId, projectId, libraryId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(objectsKey, { pages: [{ items: [] }] });
    queryClient.setQueryData(activePreviewKey, {
      restore_preview: {
        id: 'rp_1',
        file_library_id: libraryId,
        source_save_point_id: 'sp_1',
        status: 'ready',
        created_at: '2026-05-09T12:01:00.000Z',
        updated_at: '2026-05-09T12:01:00.000Z',
      },
    });

    const { result } = renderHook(() => useCancelFileLibraryRestore(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId,
        restorePreviewId: 'rp_1',
      });
    });

    expect(mockCancelRestore).toHaveBeenCalledWith(workspaceId, projectId, libraryId, {
      restore_preview_id: 'rp_1',
    });
    expect(queryClient.getQueryData(activePreviewKey)).toEqual({ restore_preview: null });
    expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(false);
  });
});
