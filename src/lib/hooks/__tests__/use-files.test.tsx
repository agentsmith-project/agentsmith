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
    },
  },
}));

import {
  useFileLibraries,
  useCreateFileLibrary,
  useUpdateFileLibrary,
  useDeleteFileLibrary,
} from '../use-files';

const workspaceId = 'ws_test';
const projectId = 'proj_test';

function createTestWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useFileLibraries', () => {
  it('returns project file libraries', async () => {
    mockListLibraries.mockResolvedValueOnce({
      items: [
        { id: 'lib_uploads', name: 'Project Uploads' },
        { id: 'lib_shared', name: 'Shared Docs' },
      ],
    });

    const { result } = renderHook(() => useFileLibraries(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((item: any) => item.id)).toEqual(['lib_uploads', 'lib_shared']);
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
});
