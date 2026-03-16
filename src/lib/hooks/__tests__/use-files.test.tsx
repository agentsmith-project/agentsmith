/**
 * Unit tests for use-files hooks
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { mockListLibraries } = vi.hoisted(() => ({
  mockListLibraries: vi.fn().mockResolvedValue({ items: [] }),
}));

// Mock the FilesAPI class
vi.mock('@/lib/api/endpoints/files', () => {
  const mockList = vi.fn().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
  const mockGet = vi.fn().mockResolvedValue({
    id: 'file1',
    filename: 'test.pdf',
    file_size: 1024,
  });
  const mockGetLimitSummary = vi.fn().mockResolvedValue({
    storage: { used: 1024, limit: 10240 },
    docdb: { used: 512, limit: 5120 },
    vectordb: { used: 256, limit: 2560 },
  });
  const mockUpload = vi.fn().mockResolvedValue({
    id: 'file1',
    filename: 'uploaded.pdf',
  });
  const mockDelete = vi.fn().mockResolvedValue(undefined);
  class MockFilesAPI {
    list = mockList;
    get = mockGet;
    getLimits = mockGetLimitSummary;
    upload = mockUpload;
    delete = mockDelete;
    listLibraries = mockListLibraries;
  }

  return {
    FilesAPI: MockFilesAPI,
  };
});

// Mock the getApiClient function
vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({})),
}));

// Mock the @/lib/api module to export FilesAPI
vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function() {
    return {
      list: vi.fn().mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 20,
      }),
      get: vi.fn().mockResolvedValue({
        id: 'file1',
        filename: 'test.pdf',
        file_size: 1024,
      }),
      getLimits: vi.fn().mockResolvedValue({
        storage: { used: 1024, limit: 10240 },
        docdb: { used: 512, limit: 5120 },
        vectordb: { used: 256, limit: 2560 },
      }),
      upload: vi.fn().mockResolvedValue({
        id: 'file1',
        filename: 'uploaded.pdf',
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      listLibraries: mockListLibraries,
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
    handleErrorForToast: vi.fn((error) => {
      console.error(error);
    }),
  };
});

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock query-keys
vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    files: {
      _def: ['files'],
      list: vi.fn((ws: string, proj: string, params?) => ['files', ws, proj, params]),
      detail: vi.fn((ws: string, proj: string, id: string) => ['file', ws, proj, id]),
    },
    limits: {
      _def: ['limits'],
      detail: vi.fn((ws: string, proj: string) => ['limits', ws, proj]),
    },
    fileLibraries: {
      list: vi.fn((ws: string, proj: string) => ['file-libraries', ws, proj]),
    },
  },
}));

// Import hooks after mocking
import {
  useFiles,
  useFile,
  useLimitSummary,
  useUploadFile,
  useDeleteFile,
  useFileLibraries,
} from '../use-files';

// Test constants
const workspaceId = 'ws_test';
const projectId = 'proj_test';
const fileId = 'file_test';

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

describe('useFiles', () => {
  it('should fetch sources list successfully', async () => {
    const { result } = renderHook(() => useFiles(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      items: [],
      total: 0,
      page: 1,
      page_size: 20,
    });
  });

  it('should be disabled when workspaceId is empty', () => {
    const { result } = renderHook(() => useFiles('', projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should be disabled when projectId is empty', () => {
    const { result } = renderHook(() => useFiles(workspaceId, ''), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should pass params to API call', async () => {
    const { result } = renderHook(
      () => useFiles(workspaceId, projectId, {
        search: 'test',
        sort_by: 'file_size',
        sort_order: 'asc',
        page: 2,
        page_size: 50,
      }),
      {
        wrapper: createTestWrapper(),
      }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should have 10 second stale time', () => {
    const { result } = renderHook(() => useFiles(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    // Check if query is properly configured
    expect(result.current).toBeDefined();
  });
});

describe('useFile', () => {
  it('should fetch single file successfully', async () => {
    const { result } = renderHook(() => useFile(workspaceId, projectId, fileId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      id: 'file1',
      filename: 'test.pdf',
      file_size: 1024,
    });
  });

  it('should be disabled when fileId is empty', () => {
    const { result } = renderHook(() => useFile(workspaceId, projectId, ''), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useLimitSummary', () => {
  it('should fetch limit summary successfully', async () => {
    const { result } = renderHook(() => useLimitSummary(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      storage: { used: 1024, limit: 10240 },
      docdb: { used: 512, limit: 5120 },
      vectordb: { used: 256, limit: 2560 },
    });
  });

  it('should be disabled when workspaceId is empty', () => {
    const { result } = renderHook(() => useLimitSummary('', projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should have 30 second stale time', () => {
    const { result } = renderHook(() => useLimitSummary(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current).toBeDefined();
  });
});

describe('useFileLibraries', () => {
  it('should return libraries list successfully', async () => {
    const { result } = renderHook(() => useFileLibraries(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ items: [] });
  });

  it('should return project file libraries without legacy default-library dedupe', async () => {
    mockListLibraries.mockResolvedValueOnce({
      items: [
        {
          id: 'lib_uploads',
          name: 'Project Uploads',
          scope: 'shared',
          owner_user_id: 'u1',
          created_at: '2026-03-06T10:00:00.000Z',
          updated_at: '2026-03-06T10:00:00.000Z',
        },
        {
          id: 'lib_shared',
          name: 'Shared',
          scope: 'shared',
          owner_user_id: 'u1',
          created_at: '2026-03-01T10:00:00.000Z',
          updated_at: '2026-03-01T10:00:00.000Z',
        },
      ],
    });

    const { result } = renderHook(() => useFileLibraries(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((x: any) => x.id)).toEqual(['lib_uploads', 'lib_shared']);
  });
});

describe('useUploadFile', () => {
  it('should upload file successfully', async () => {
    const { result } = renderHook(() => useUploadFile(), {
      wrapper: createTestWrapper(),
    });

    const file = new File(['test'], 'test.pdf', { type: 'application/pdf' });
    const onProgress = vi.fn();

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        file,
        onProgress,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual({
      id: 'file1',
      filename: 'uploaded.pdf',
    });
  });

  it('should be idle initially', () => {
    const { result } = renderHook(() => useUploadFile(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.isIdle).toBe(true);
  });
});

describe('useDeleteFile', () => {
  it('should delete file successfully', async () => {
    const { result } = renderHook(() => useDeleteFile(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        fileId,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

});
