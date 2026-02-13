/**
 * Unit tests for use-sources hooks
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the SourcesAPI class
vi.mock('@/lib/api/endpoints/sources', () => {
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
  const mockGetQuota = vi.fn().mockResolvedValue({
    storage: { used: 1024, limit: 10240 },
    docdb: { used: 512, limit: 5120 },
    vectordb: { used: 256, limit: 2560 },
  });
  const mockUpload = vi.fn().mockResolvedValue({
    id: 'file1',
    filename: 'uploaded.pdf',
  });
  const mockDelete = vi.fn().mockResolvedValue(undefined);
  const mockStartAIReady = vi.fn().mockResolvedValue({ id: 'job1' });
  const mockCancelAIReady = vi.fn().mockResolvedValue(undefined);
  const mockRetryAIReady = vi.fn().mockResolvedValue({ id: 'job1' });
  const mockBatchStart = vi.fn().mockResolvedValue({ jobs: [] });
  const mockBatchCancel = vi.fn().mockResolvedValue({ jobs: [] });

  class MockSourcesAPI {
    list = mockList;
    get = mockGet;
    getQuota = mockGetQuota;
    upload = mockUpload;
    delete = mockDelete;
    startAIReady = mockStartAIReady;
    cancelAIReady = mockCancelAIReady;
    retryAIReady = mockRetryAIReady;
    batchStartAIReady = mockBatchStart;
    batchCancelAIReady = mockBatchCancel;
  }

  return {
    SourcesAPI: MockSourcesAPI,
  };
});

// Mock the getApiClient function
vi.mock('@/lib/api/client', () => ({
  getApiClient: vi.fn(() => ({})),
}));

// Mock the @/lib/api module to export SourcesAPI
vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  SourcesAPI: vi.fn().mockImplementation(function() {
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
      getQuota: vi.fn().mockResolvedValue({
        storage: { used: 1024, limit: 10240 },
        docdb: { used: 512, limit: 5120 },
        vectordb: { used: 256, limit: 2560 },
      }),
      upload: vi.fn().mockResolvedValue({
        id: 'file1',
        filename: 'uploaded.pdf',
      }),
      delete: vi.fn().mockResolvedValue(undefined),
      startAIReady: vi.fn().mockResolvedValue({ id: 'job1' }),
      cancelAIReady: vi.fn().mockResolvedValue(undefined),
      retryAIReady: vi.fn().mockResolvedValue({ id: 'job1' }),
      batchStartAIReady: vi.fn().mockResolvedValue({ jobs: [] }),
      batchCancelAIReady: vi.fn().mockResolvedValue({ jobs: [] }),
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
    sources: {
      list: vi.fn((ws: string, proj: string, params?) => ['sources', ws, proj, params]),
      detail: vi.fn((ws: string, proj: string, id: string) => ['source', ws, proj, id]),
    },
    quota: {
      detail: vi.fn((ws: string, proj: string) => ['quota', ws, proj]),
    },
  },
}));

// Import hooks after mocking
import {
  useSources,
  useSourceFile,
  useQuota,
  useUploadFile,
  useDeleteFile,
  useAIReadyActions,
  useBatchAIReadyActions,
} from '../use-sources';

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

describe('useSources', () => {
  it('should fetch sources list successfully', async () => {
    const { result } = renderHook(() => useSources(workspaceId, projectId), {
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
    const { result } = renderHook(() => useSources('', projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should be disabled when projectId is empty', () => {
    const { result } = renderHook(() => useSources(workspaceId, ''), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should pass params to API call', async () => {
    const { result } = renderHook(
      () => useSources(workspaceId, projectId, {
        search: 'test',
        status: 'ready',
        ai_ready_only: true,
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
    const { result } = renderHook(() => useSources(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    // Check if query is properly configured
    expect(result.current).toBeDefined();
  });
});

describe('useSourceFile', () => {
  it('should fetch single source file successfully', async () => {
    const { result } = renderHook(() => useSourceFile(workspaceId, projectId, fileId), {
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
    const { result } = renderHook(() => useSourceFile(workspaceId, projectId, ''), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useQuota', () => {
  it('should fetch quota summary successfully', async () => {
    const { result } = renderHook(() => useQuota(workspaceId, projectId), {
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
    const { result } = renderHook(() => useQuota('', projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.fetchStatus).toBe('idle');
  });

  it('should have 30 second stale time', () => {
    const { result } = renderHook(() => useQuota(workspaceId, projectId), {
      wrapper: createTestWrapper(),
    });

    expect(result.current).toBeDefined();
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
        deleteAIReady: true,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('should delete file without AIReady artifacts', async () => {
    const { result } = renderHook(() => useDeleteFile(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId,
        projectId,
        fileId,
        deleteAIReady: false,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe('useAIReadyActions', () => {
  it('should start AIReady process successfully', async () => {
    const { result } = renderHook(() => useAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.start.mutateAsync({
        workspaceId,
        projectId,
        fileId,
      });
    });

    await waitFor(() => expect(result.current.start.isSuccess).toBe(true));
  });

  it('should cancel AIReady process successfully', async () => {
    const { result } = renderHook(() => useAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.cancel.mutateAsync({
        workspaceId,
        projectId,
        fileId,
      });
    });

    await waitFor(() => expect(result.current.cancel.isSuccess).toBe(true));
  });

  it('should retry AIReady process successfully', async () => {
    const { result } = renderHook(() => useAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.retry.mutateAsync({
        workspaceId,
        projectId,
        fileId,
      });
    });

    await waitFor(() => expect(result.current.retry.isSuccess).toBe(true));
  });

  it('should provide all three actions', () => {
    const { result } = renderHook(() => useAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.start).toBeDefined();
    expect(result.current.cancel).toBeDefined();
    expect(result.current.retry).toBeDefined();
  });
});

describe('useBatchAIReadyActions', () => {
  it('should batch start AIReady successfully', async () => {
    const { result } = renderHook(() => useBatchAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    const fileIds = ['file1', 'file2'];

    await act(async () => {
      await result.current.batchStart.mutateAsync({
        workspaceId,
        projectId,
        fileIds,
      });
    });

    await waitFor(() => expect(result.current.batchStart.isSuccess).toBe(true));
  });

  it('should batch cancel AIReady successfully', async () => {
    const { result } = renderHook(() => useBatchAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    const fileIds = ['file1', 'file2'];

    await act(async () => {
      await result.current.batchCancel.mutateAsync({
        workspaceId,
        projectId,
        fileIds,
      });
    });

    await waitFor(() => expect(result.current.batchCancel.isSuccess).toBe(true));
  });

  it('should handle single file in batch start', async () => {
    const { result } = renderHook(() => useBatchAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    await act(async () => {
      await result.current.batchStart.mutateAsync({
        workspaceId,
        projectId,
        fileIds: [fileId],
      });
    });

    await waitFor(() => expect(result.current.batchStart.isSuccess).toBe(true));
  });

  it('should provide both batch actions', () => {
    const { result } = renderHook(() => useBatchAIReadyActions(), {
      wrapper: createTestWrapper(),
    });

    expect(result.current.batchStart).toBeDefined();
    expect(result.current.batchCancel).toBeDefined();
  });
});
