import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockCreateSavePoint,
  mockGetActiveFileLibraryOperation,
  mockGetFileLibraryVersionOperation,
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
  mockGetFileLibraryVersionOperation: vi.fn().mockResolvedValue({
    id: 'flop_lookup_terminal',
    kind: 'restore',
    file_library_id: 'lib_1',
    source_save_point_id: 'sp_1',
    status: 'succeeded',
    created_at: '2026-05-09T12:01:00.000Z',
    updated_at: '2026-05-09T12:02:00.000Z',
  }),
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
      getFileLibraryVersionOperation: mockGetFileLibraryVersionOperation,
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
  useFileLibraryVersionOperationLookup,
  useReleaseFileLibraryRuntimeAccess,
  useRestoreFileLibrary,
} from '../use-file-library-recovery';
import { toast } from '@/components/ui/toast';
import { APIError, handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';

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
    mockGetFileLibraryVersionOperation.mockRejectedValueOnce(new Error('operation projection unavailable'));
    const { queryClient, Wrapper } = createTestHarness();
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    const templatesKey = ['task-file-templates', workspaceId, projectId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(savePointsKey, { items: [] });
    queryClient.setQueryData(templatesKey, { items: [] });
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
    expect(mockGetFileLibraryVersionOperation).toHaveBeenCalledWith(
      workspaceId,
      projectId,
      'flro_active_to_null',
    );
    await act(async () => {
      await vi.waitFor(() => {
        expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(true);
        expect(queryClient.getQueryCache().find({ queryKey: templatesKey })?.isStale()).toBe(true);
        expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(true);
      });
    });
  });

  it('looks up a missed terminal restore by operation id and refreshes dependent caches', async () => {
    vi.useFakeTimers();
    mockGetActiveFileLibraryOperation
      .mockResolvedValueOnce({
        operation: {
          id: 'flro_missed_terminal',
          kind: 'restore',
          file_library_id: libraryId,
          source_save_point_id: 'sp_1',
          status: 'running',
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      })
      .mockResolvedValueOnce({ operation: null });
    mockGetFileLibraryVersionOperation.mockResolvedValueOnce({
      id: 'flro_missed_terminal',
      kind: 'restore',
      file_library_id: libraryId,
      source_save_point_id: 'sp_1',
      status: 'succeeded',
      created_at: '2026-05-09T12:01:00.000Z',
      updated_at: '2026-05-09T12:02:00.000Z',
    });
    const { queryClient, Wrapper } = createTestHarness();
    const savePointsKey = ['file-library-save-points', workspaceId, projectId, libraryId];
    const templatesKey = ['task-file-templates', workspaceId, projectId];
    const objectsKey = [
      'file-objects',
      'infinite',
      workspaceId,
      projectId,
      libraryId,
      { prefix: '', delimiter: '/', page_size: 200 },
    ];
    queryClient.setQueryData(savePointsKey, { items: [] });
    queryClient.setQueryData(templatesKey, { items: [] });
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
      await vi.waitFor(() => expect(result.current.data?.operation?.status).toBe('succeeded'));
    });
    expect(mockGetFileLibraryVersionOperation).toHaveBeenCalledWith(
      workspaceId,
      projectId,
      'flro_missed_terminal',
    );
    await act(async () => {
      await vi.waitFor(() => {
        expect(queryClient.getQueryCache().find({ queryKey: savePointsKey })?.isStale()).toBe(true);
        expect(queryClient.getQueryCache().find({ queryKey: templatesKey })?.isStale()).toBe(true);
        expect(queryClient.getQueryCache().find({ queryKey: objectsKey })?.isStale()).toBe(true);
      });
    });
  });

  it('does not normalize fallback raw operation projections as restore operations', async () => {
    vi.useFakeTimers();
    mockGetActiveFileLibraryOperation
      .mockResolvedValueOnce({
        operation: {
          id: 'flro_active_raw_projection',
          kind: 'restore',
          file_library_id: libraryId,
          source_save_point_id: 'sp_1',
          status: 'running',
          created_at: '2026-05-09T12:01:00.000Z',
          updated_at: '2026-05-09T12:01:00.000Z',
        },
      })
      .mockResolvedValueOnce({ operation: null });
    mockGetFileLibraryVersionOperation.mockResolvedValueOnce({
      operation_id: 'op_afscp_raw_restore',
      operation_state: 'operator_intervention_required',
      operation_type: 'restore',
      resource: { type: 'repo' },
      error: { code: 'afscp_operator_recovery_required /home/task/.ssh/id_rsa' },
      updated_at: '2026-05-09T12:02:00.000Z',
    });
    const { Wrapper } = createTestHarness();
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
      await vi.waitFor(() => expect(mockGetFileLibraryVersionOperation).toHaveBeenCalledWith(
        workspaceId,
        projectId,
        'flro_active_raw_projection',
      ));
    });
    expect(result.current.data?.operation).toBeNull();
    expect(JSON.stringify(result.current.data)).not.toMatch(/op_afscp_raw_restore|operator_recovery|\.ssh|id_rsa/);
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

  it('tracks a submitted save-point operation by POST operation id until terminal result save point id', async () => {
    vi.useFakeTimers();
    mockGetFileLibraryVersionOperation
      .mockResolvedValueOnce({
        id: 'flop_post_save_point',
        kind: 'save_point_create',
        file_library_id: libraryId,
        status: 'running',
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:01.000Z',
      })
      .mockResolvedValueOnce({
        id: 'flop_post_save_point',
        kind: 'save_point_create',
        file_library_id: libraryId,
        status: 'succeeded',
        result_save_point_id: 'sp_created_from_operation',
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:02.000Z',
      } as never);

    const { queryClient, Wrapper } = createTestHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(queryKeys.fileLibraries.savePoints(workspaceId, projectId, libraryId), { items: [] });
    queryClient.setQueryData(queryKeys.fileLibraries.list(workspaceId, projectId), { items: [{ id: libraryId }] });
    queryClient.setQueryData(queryKeys.fileLibraries.detail(workspaceId, projectId, libraryId), { id: libraryId });
    queryClient.setQueryData(queryKeys.fileLibraries.activeOperation(workspaceId, projectId, libraryId), {
      operation: {
        id: 'flop_active_blocker',
        kind: 'save_point_create',
        file_library_id: libraryId,
        status: 'running',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:01.000Z',
      },
    });

    const { result } = renderHook(
      () => useFileLibraryVersionOperationLookup(
        workspaceId,
        projectId,
        libraryId,
        'flop_post_save_point',
      ),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await vi.waitFor(() => expect(result.current.data?.status).toBe('running'));
    });
    expect(mockGetFileLibraryVersionOperation).toHaveBeenCalledWith(
      workspaceId,
      projectId,
      'flop_post_save_point',
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.waitFor(() => expect(result.current.data?.status).toBe('succeeded'));
    });
    expect(result.current.data).toMatchObject({
      id: 'flop_post_save_point',
      kind: 'save_point_create',
      status: 'succeeded',
      result_save_point_id: 'sp_created_from_operation',
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.fileLibraries.savePoints(workspaceId, projectId, libraryId),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.fileLibraries.detail(workspaceId, projectId, libraryId),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.fileLibraries.activeOperation(workspaceId, projectId, libraryId),
    });
  });

  for (const terminalStatus of ['succeeded', 'failed'] as const) {
    it(`keeps operation-id lookup terminal ${terminalStatus} ahead of same-id stale active state`, async () => {
      const operationId = `flop_lookup_terminal_${terminalStatus}`;
      mockGetFileLibraryVersionOperation.mockResolvedValueOnce({
        id: operationId,
        kind: 'save_point_create',
        file_library_id: libraryId,
        status: terminalStatus,
        ...(terminalStatus === 'succeeded'
          ? { result_save_point_id: 'sp_created_from_operation' }
          : { failure_reason: 'safe failure' }),
        message: 'Before prompt edits',
        created_at: '2026-05-09T12:00:00.000Z',
        updated_at: '2026-05-09T12:00:02.000Z',
      });
      mockGetActiveFileLibraryOperation.mockResolvedValueOnce({
        operation: {
          id: operationId,
          kind: 'save_point_create',
          file_library_id: libraryId,
          status: 'running',
          message: 'Before prompt edits',
          created_at: '2026-05-09T12:00:00.000Z',
          updated_at: '2026-05-09T12:00:01.000Z',
        },
      });

      const { queryClient, Wrapper } = createTestHarness();
      const activeOperationKey = queryKeys.fileLibraries.activeOperation(workspaceId, projectId, libraryId);
      const lookup = renderHook(
        () => useFileLibraryVersionOperationLookup(
          workspaceId,
          projectId,
          libraryId,
          operationId,
        ),
        { wrapper: Wrapper },
      );

      await waitFor(() => expect(lookup.result.current.data?.status).toBe(terminalStatus));
      await waitFor(() => {
        expect(queryClient.getQueryData(activeOperationKey)).toEqual({
          operation: expect.objectContaining({
            id: operationId,
            status: terminalStatus,
          }),
        });
      });

      const active = renderHook(
        () => useFileLibraryActiveVersionOperation(workspaceId, projectId, libraryId),
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(mockGetActiveFileLibraryOperation).toHaveBeenCalledWith(workspaceId, projectId, libraryId);
      });
      await waitFor(() => {
        expect(active.result.current.data?.operation).toEqual(expect.objectContaining({
          id: operationId,
          status: terminalStatus,
        }));
        expect(queryClient.getQueryData(activeOperationKey)).toEqual({
          operation: expect.objectContaining({
            id: operationId,
            status: terminalStatus,
          }),
        });
      });
    });
  }

  it('does not treat terminal save-point success without result_save_point_id as a completed save point', async () => {
    mockGetFileLibraryVersionOperation.mockResolvedValueOnce({
      id: 'flop_missing_result',
      kind: 'save_point_create',
      file_library_id: libraryId,
      status: 'succeeded',
      message: 'Before prompt edits',
      created_at: '2026-05-09T12:00:00.000Z',
      updated_at: '2026-05-09T12:00:02.000Z',
    });

    const { queryClient, Wrapper } = createTestHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(
      () => useFileLibraryVersionOperationLookup(
        workspaceId,
        projectId,
        libraryId,
        'flop_missing_result',
      ),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.data?.status).toBe('succeeded'));
    expect(result.current.data).not.toHaveProperty('result_save_point_id');
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: queryKeys.fileLibraries.savePoints(workspaceId, projectId, libraryId),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.fileLibraries.activeOperation(workspaceId, projectId, libraryId),
    });
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
