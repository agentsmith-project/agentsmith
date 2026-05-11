import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockListSavePoints,
  mockGetActiveRestorePreview,
  mockCreateSavePoint,
  mockCreateRestorePreview,
  mockRunRestore,
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
  useRunFileLibraryRestore,
} from '../use-file-library-recovery';

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
