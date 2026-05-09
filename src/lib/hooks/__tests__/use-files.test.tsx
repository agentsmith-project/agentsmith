import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const {
  mockListLibraries,
  mockCreateLibrary,
  mockUpdateLibrary,
  mockDeleteLibrary,
} = vi.hoisted(() => ({
  mockListLibraries: vi.fn().mockResolvedValue({ items: [] }),
  mockCreateLibrary: vi.fn().mockResolvedValue({ id: 'lib_new', name: 'New Library' }),
  mockUpdateLibrary: vi.fn().mockResolvedValue({ id: 'lib_1', name: 'Renamed Library' }),
  mockDeleteLibrary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api/endpoints/files', () => {
  class MockFilesAPI {
    listLibraries = mockListLibraries;
    createLibrary = mockCreateLibrary;
    updateLibrary = mockUpdateLibrary;
    deleteLibrary = mockDeleteLibrary;
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
import { APIError } from '@/lib/api/errors';

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
