import { beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockListLibraries,
  mockCreateLibrary,
  mockUpdateLibrary,
  mockDeleteLibrary,
  mockGetFileLibraryOperationProjection,
} = vi.hoisted(() => ({
  mockListLibraries: vi.fn().mockResolvedValue({ items: [] }),
  mockCreateLibrary: vi.fn().mockResolvedValue({ id: 'lib_new', name: 'New Library' }),
  mockUpdateLibrary: vi.fn().mockResolvedValue({ id: 'lib_1', name: 'Renamed Library' }),
  mockDeleteLibrary: vi.fn().mockResolvedValue({ status: 'deleted' }),
  mockGetFileLibraryOperationProjection: vi.fn().mockResolvedValue({
    operation_id: 'op_delete',
    operation_state: 'succeeded',
    resource: { type: 'repo' },
    error: null,
  }),
}));

vi.mock('@/lib/api/endpoints/files', () => {
  class MockFilesAPI {
    listLibraries = mockListLibraries;
    createLibrary = mockCreateLibrary;
    updateLibrary = mockUpdateLibrary;
    deleteLibrary = mockDeleteLibrary;
    getFileLibraryOperationProjection = mockGetFileLibraryOperationProjection;
  }

  return {
    FilesAPI: MockFilesAPI,
  };
});

vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({})),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function () {
    return {
      listLibraries: mockListLibraries,
      createLibrary: mockCreateLibrary,
      updateLibrary: mockUpdateLibrary,
      deleteLibrary: mockDeleteLibrary,
      getFileLibraryOperationProjection: mockGetFileLibraryOperationProjection,
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

vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    fileLibraries: {
      list: vi.fn((ws: string, proj: string) => ['file-libraries', ws, proj]),
      detail: vi.fn((ws: string, proj: string, libraryId: string) => ['file-library', ws, proj, libraryId]),
    },
  },
}));

import {
  useFileLibraries,
  useCreateFileLibrary,
  useUpdateFileLibrary,
  useDeleteFileLibrary,
} from '../use-files';
import { toast } from '@/components/ui/toast';
import { APIError, handleErrorForToast } from '@/lib/api/errors';

const workspaceId = 'ws_test';
const projectId = 'proj_test';

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

function createTestWrapper() {
  return createTestHarness().Wrapper;
}

beforeEach(() => {
  mockListLibraries.mockReset();
  mockListLibraries.mockResolvedValue({ items: [] });
  mockCreateLibrary.mockReset();
  mockCreateLibrary.mockResolvedValue({ id: 'lib_new', name: 'New Library' });
  mockUpdateLibrary.mockReset();
  mockUpdateLibrary.mockResolvedValue({ id: 'lib_1', name: 'Renamed Library' });
  mockDeleteLibrary.mockReset();
  mockDeleteLibrary.mockResolvedValue({ status: 'deleted' });
  mockGetFileLibraryOperationProjection.mockReset();
  mockGetFileLibraryOperationProjection.mockResolvedValue({
    operation_id: 'op_delete',
    operation_state: 'succeeded',
    resource: { type: 'repo' },
    error: null,
  });
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  vi.mocked(handleErrorForToast).mockClear();
});

describe('useFileLibraries', () => {
  it('returns project file libraries', async () => {
    mockListLibraries.mockResolvedValueOnce({
      items: [
        {
          id: 'lib_uploads',
          name: 'Project Uploads',
          task_home_binding_status: 'unbound',
          bound_task_visible: false,
        },
        {
          id: 'lib_shared',
          name: 'Shared Docs',
          task_home_binding_status: 'bound',
          bound_task_id: 'task_archived',
          bound_task_title: 'Archived analysis',
          bound_task_status: 'archived',
          bound_task_visible: true,
        },
      ],
    });

    const { result } = renderHook(() => useFileLibraries(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((item: any) => item.id)).toEqual(['lib_uploads', 'lib_shared']);
    expect(result.current.data?.items[0]).toMatchObject({
      task_home_binding_status: 'unbound',
      bound_task_visible: false,
    });
    expect(result.current.data?.items[1]).toMatchObject({
      task_home_binding_status: 'bound',
      bound_task_id: 'task_archived',
      bound_task_title: 'Archived analysis',
      bound_task_status: 'archived',
      bound_task_visible: true,
    });
  });
});

describe('file library mutations', () => {
  it('creates a file library', async () => {
    const { result } = renderHook(() => useCreateFileLibrary(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        name: 'Docs',
        description: 'Shared docs',
      });
    });

    expect(mockCreateLibrary).toHaveBeenCalledWith(workspaceId, projectId, {
      name: 'Docs',
      description: 'Shared docs',
      visibility: 'shared',
    });
  });

  it('updates a file library', async () => {
    const { result } = renderHook(() => useUpdateFileLibrary(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId: 'lib_1',
        name: 'Renamed',
      });
    });

    expect(mockUpdateLibrary).toHaveBeenCalledWith(workspaceId, projectId, 'lib_1', {
      name: 'Renamed',
      description: undefined,
    });
  });

  it('deletes a file library', async () => {
    const { result } = renderHook(() => useDeleteFileLibrary(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId: 'lib_1',
      });
    });

    expect(mockDeleteLibrary).toHaveBeenCalledWith(workspaceId, projectId, 'lib_1');
  });

  it('surfaces invalid accepted deletes without an operation handle as errors', async () => {
    const { Wrapper } = createTestHarness();
    mockDeleteLibrary.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_DELETE_ACCEPTED_RESPONSE_INVALID',
      'file_library_delete_accepted_response_invalid',
      undefined,
      202,
      { file_library_id: 'lib_1' },
    ));

    const { result } = renderHook(() => useDeleteFileLibrary(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      libraryId: 'lib_1',
    })).rejects.toMatchObject({
      errorCode: 'FILE_LIBRARY_DELETE_ACCEPTED_RESPONSE_INVALID',
    });

    expect(mockGetFileLibraryOperationProjection).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(handleErrorForToast).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'FILE_LIBRARY_DELETE_ACCEPTED_RESPONSE_INVALID' }),
      'useDeleteFileLibrary',
    );
  });

  it('polls accepted deletes, retries cleanup, and only succeeds after final delete', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const listKey = ['file-libraries', workspaceId, projectId];
    const detailKey = ['file-library', workspaceId, projectId, 'lib_1'];
    queryClient.setQueryData(listKey, { items: [{ id: 'lib_1', status: 'ready' }] });
    queryClient.setQueryData(detailKey, { id: 'lib_1', status: 'deleting' });
    mockDeleteLibrary
      .mockResolvedValueOnce({
        status: 'accepted',
        file_library_id: 'lib_1',
        file_library_status: 'deleting',
        operation_id: 'op_delete',
        operation_status: 'pending',
      })
      .mockResolvedValueOnce({ status: 'deleted' });
    mockGetFileLibraryOperationProjection.mockResolvedValueOnce({
      operation_id: 'op_delete',
      operation_state: 'succeeded',
      operation_type: 'repo_delete',
      resource: { type: 'repo' },
      error: null,
      updated_at: '2026-05-09T00:00:01.000Z',
    });

    const { result } = renderHook(() => useDeleteFileLibrary(), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        libraryId: 'lib_1',
      });
    });

    expect(mockDeleteLibrary).toHaveBeenNthCalledWith(1, workspaceId, projectId, 'lib_1');
    expect(mockGetFileLibraryOperationProjection).toHaveBeenCalledWith(workspaceId, projectId, 'op_delete');
    expect(mockDeleteLibrary).toHaveBeenNthCalledWith(2, workspaceId, projectId, 'lib_1');
    expect(toast.success).toHaveBeenCalledWith('delete_success');
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: listKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: detailKey })?.isStale()).toBe(true);
    });
  });

  it('stops accepted delete polling on operator intervention and reports an error', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const listKey = ['file-libraries', workspaceId, projectId];
    const detailKey = ['file-library', workspaceId, projectId, 'lib_1'];
    queryClient.setQueryData(listKey, { items: [{ id: 'lib_1', status: 'deleting' }] });
    queryClient.setQueryData(detailKey, { id: 'lib_1', status: 'deleting' });
    mockDeleteLibrary.mockResolvedValueOnce({
      status: 'accepted',
      file_library_id: 'lib_1',
      file_library_status: 'deleting',
      operation_id: 'op_delete_control',
      operation_status: 'pending',
    });
    mockGetFileLibraryOperationProjection.mockResolvedValueOnce({
      operation_id: 'op_delete_control',
      operation_state: 'operator_intervention_required',
      operation_type: 'repo_delete',
      resource: { type: 'repo' },
      error: { code: 'operator_intervention_required', retryable: false },
      updated_at: '2026-05-09T00:00:01.000Z',
    });

    const { result } = renderHook(() => useDeleteFileLibrary(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      libraryId: 'lib_1',
    })).rejects.toMatchObject({
      errorCode: 'FILE_LIBRARY_OPERATION_FAILED',
    });

    expect(mockDeleteLibrary).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(handleErrorForToast).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'FILE_LIBRARY_OPERATION_FAILED' }),
      'useDeleteFileLibrary',
    );
    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: listKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: detailKey })?.isStale()).toBe(true);
    });
  });

  it('refreshes file library caches after typed delete conflicts', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const listKey = ['file-libraries', workspaceId, projectId];
    const detailKey = ['file-library', workspaceId, projectId, 'lib_1'];
    queryClient.setQueryData(listKey, { items: [{ id: 'lib_1' }] });
    queryClient.setQueryData(detailKey, { id: 'lib_1', task_home_binding_status: 'unbound' });
    mockDeleteLibrary.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_TASK_IN_USE',
      'file_library_task_in_use',
      undefined,
      409,
      { file_library_id: 'lib_1', bound_task_visible: false },
    ));

    const { result } = renderHook(() => useDeleteFileLibrary(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      libraryId: 'lib_1',
    })).rejects.toBeInstanceOf(APIError);

    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: listKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: detailKey })?.isStale()).toBe(true);
    });
  });

  it('refreshes file library caches after typed update conflicts', async () => {
    const { queryClient, Wrapper } = createTestHarness();
    const listKey = ['file-libraries', workspaceId, projectId];
    const detailKey = ['file-library', workspaceId, projectId, 'lib_1'];
    queryClient.setQueryData(listKey, { items: [{ id: 'lib_1' }] });
    queryClient.setQueryData(detailKey, { id: 'lib_1', status: 'ready' });
    mockUpdateLibrary.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_NOT_READY',
      'file_library_not_ready',
      undefined,
      409,
      { file_library_id: 'lib_1', file_library_status: 'creating' },
    ));

    const { result } = renderHook(() => useUpdateFileLibrary(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      libraryId: 'lib_1',
      name: 'Renamed',
    })).rejects.toBeInstanceOf(APIError);

    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: listKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: detailKey })?.isStale()).toBe(true);
    });
  });
});
