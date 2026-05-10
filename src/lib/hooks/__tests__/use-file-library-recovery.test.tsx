import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockListSavePoints,
  mockCreateSavePoint,
  mockCreateRestorePreview,
  mockRunRestore,
  mockCancelRestore,
} = vi.hoisted(() => ({
  mockListSavePoints: vi.fn().mockResolvedValue({ items: [] }),
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

  it('creates a save point and marks the save-point list stale', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    queryClient.setQueryData(savePointsKey, { items: [] });

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
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(true);
    });
  });

  it('runs restore through preview and invalidates file listings for the library', async () => {
    const { queryClient, Wrapper } = createTestHarness();
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
  });

  it('cancels restore preview without invalidating object listings', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(objectsKey, { pages: [{ items: [] }] });

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
    expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(false);
  });
});
