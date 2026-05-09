import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useInfiniteQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateFolder,
  mockListObjects,
  mockMoveObject,
  mockUploadObject,
  mockDeleteObjects,
} = vi.hoisted(() => ({
  mockCreateFolder: vi.fn().mockResolvedValue(undefined),
  mockListObjects: vi.fn().mockResolvedValue({
    prefix: '',
    items: [],
    next_continuation_token: null,
  }),
  mockMoveObject: vi.fn().mockResolvedValue(undefined),
  mockUploadObject: vi.fn().mockResolvedValue({
    kind: 'object',
    key: 'docs/uploaded.txt',
    name: 'uploaded.txt',
    size_bytes: 12,
    content_type: 'text/plain',
    last_modified: '2026-03-16T08:00:00.000Z',
  }),
  mockDeleteObjects: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function () {
    return {
      createFolder: mockCreateFolder,
      deleteObjects: mockDeleteObjects,
      listObjects: mockListObjects,
      moveObject: mockMoveObject,
      uploadObject: mockUploadObject,
    };
  }),
}));

vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    fileObjects: {
      _def: ['file-objects'],
      list: vi.fn((workspaceId: string, projectId: string, libraryId: string, params?: object) => [
        'file-objects',
        workspaceId,
        projectId,
        libraryId,
        params,
      ]),
    },
    fileLibraries: {
      list: vi.fn((workspaceId: string, projectId: string) => ['file-libraries', workspaceId, projectId]),
      detail: vi.fn((workspaceId: string, projectId: string, libraryId: string) => [
        'file-library',
        workspaceId,
        projectId,
        libraryId,
      ]),
    },
  },
}));

import {
  useCreateFileFolder,
  useDeleteFileObjects,
  useFileObjects,
  useFileObjectsInfinite,
  useMoveFileObject,
  useUploadFileObject,
} from '../use-file-objects';
import { APIError } from '@/lib/api/errors';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createQueryClientWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
}

function createWrapper() {
  return createQueryClientWrapper().Wrapper;
}

describe('useFileObjects mutations', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('does not block create folder completion on cache invalidation', async () => {
    const deferred = createDeferred<unknown>();
    const invalidateSpy = vi
      .spyOn(QueryClient.prototype, 'invalidateQueries')
      .mockImplementation(() => deferred.promise as ReturnType<QueryClient['invalidateQueries']>);

    const { result } = renderHook(() => useCreateFileFolder(), {
      wrapper: createWrapper(),
    });

    let mutationResolved = false;
    let mutationPromise!: Promise<void>;

    act(() => {
      mutationPromise = result.current.mutateAsync({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        libraryId: 'lib_a',
        prefix: 'docs/reports/',
      });
      void mutationPromise.then(() => {
        mutationResolved = true;
      });
    });

    await waitFor(() => expect(mockCreateFolder).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mutationResolved).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    deferred.resolve(undefined);
    await act(async () => {
      await mutationPromise;
    });
  });

  it('does not block move completion on file object refetch', async () => {
    const deferred = createDeferred<unknown>();
    const invalidateSpy = vi
      .spyOn(QueryClient.prototype, 'invalidateQueries')
      .mockImplementation(() => deferred.promise as ReturnType<QueryClient['invalidateQueries']>);

    const { result } = renderHook(() => useMoveFileObject(), {
      wrapper: createWrapper(),
    });

    let mutationResolved = false;
    let mutationPromise!: Promise<void>;

    act(() => {
      mutationPromise = result.current.mutateAsync({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        libraryId: 'lib_a',
        from_key: 'docs/source.txt',
        to_key: 'docs/archive/source.txt',
      });
      void mutationPromise.then(() => {
        mutationResolved = true;
      });
    });

    await waitFor(() => expect(mockMoveObject).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mutationResolved).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    deferred.resolve(undefined);
    await act(async () => {
      await mutationPromise;
    });
  });

  it('scopes upload invalidation to the target library and prefix without refetching unrelated active views', async () => {
    const targetQueryFn = vi.fn().mockResolvedValue({
      prefix: 'docs/',
      items: [],
      next_continuation_token: null,
    });
    const unrelatedQueryFn = vi.fn().mockResolvedValue({
      prefix: 'other/',
      items: [],
      next_continuation_token: null,
    });
    const { queryClient, Wrapper } = createQueryClientWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => {
      const target = useInfiniteQuery({
        queryKey: [
          'file-objects',
          'infinite',
          'ws_default',
          'proj_001',
          'lib_a',
          { prefix: 'docs/', delimiter: '/', page_size: 200 },
        ],
        queryFn: targetQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
      });
      const unrelated = useInfiniteQuery({
        queryKey: [
          'file-objects',
          'infinite',
          'ws_default',
          'proj_001',
          'lib_b',
          { prefix: 'other/', delimiter: '/', page_size: 200 },
        ],
        queryFn: unrelatedQueryFn,
        initialPageParam: undefined as string | undefined,
        getNextPageParam: () => undefined,
      });
      const upload = useUploadFileObject();
      return { target, unrelated, upload };
    }, {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(targetQueryFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(unrelatedQueryFn).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.upload.mutateAsync({
        workspaceId: 'ws_default',
        projectId: 'proj_001',
        libraryId: 'lib_a',
        file: new File(['hello'], 'uploaded.txt', { type: 'text/plain' }),
        prefix: 'docs/',
      });
    });

    await waitFor(() => expect(targetQueryFn).toHaveBeenCalledTimes(2));
    expect(unrelatedQueryFn).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ['file-objects'],
    }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({
      predicate: expect.any(Function),
      refetchType: 'active',
    }));
  });

  it('refreshes object and file-library caches after typed file write conflicts', async () => {
    const { queryClient, Wrapper } = createQueryClientWrapper();
    const listKey = ['file-libraries', 'ws_default', 'proj_001'];
    const detailKey = ['file-library', 'ws_default', 'proj_001', 'lib_a'];
    queryClient.setQueryData(listKey, { items: [{ id: 'lib_a', status: 'ready' }] });
    queryClient.setQueryData(detailKey, { id: 'lib_a', status: 'ready' });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    mockUploadObject.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_DELETING',
      'file_library_deleting',
      undefined,
      409,
      { file_library_id: 'lib_a', file_library_status: 'deleting' },
    ));

    const { result } = renderHook(() => ({
      upload: useUploadFileObject(),
      move: useMoveFileObject(),
      deleteObjects: useDeleteFileObjects(),
      createFolder: useCreateFileFolder(),
    }), {
      wrapper: Wrapper,
    });

    await expect(result.current.upload.mutateAsync({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_a',
      file: new File(['hello'], 'uploaded.txt', { type: 'text/plain' }),
      prefix: 'docs/',
    })).rejects.toBeInstanceOf(APIError);

    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: listKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: detailKey })?.isStale()).toBe(true);
      expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({
        queryKey: ['file-objects'],
      }));
    });
  });

  it('refreshes object and file-library caches after typed object delete conflicts', async () => {
    const { queryClient, Wrapper } = createQueryClientWrapper();
    const objectKey = ['file-objects', 'ws_default', 'proj_001', 'lib_a', { prefix: '', delimiter: '/' }];
    const listKey = ['file-libraries', 'ws_default', 'proj_001'];
    const detailKey = ['file-library', 'ws_default', 'proj_001', 'lib_a'];
    queryClient.setQueryData(objectKey, { items: [{ key: 'README.txt' }] });
    queryClient.setQueryData(listKey, { items: [{ id: 'lib_a', status: 'ready' }] });
    queryClient.setQueryData(detailKey, { id: 'lib_a', status: 'ready' });
    mockDeleteObjects.mockRejectedValueOnce(new APIError(
      'FILE_LIBRARY_DELETING',
      'file_library_deleting',
      undefined,
      409,
      { file_library_id: 'lib_a', file_library_status: 'deleting' },
    ));

    const { result } = renderHook(() => useDeleteFileObjects(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync({
      workspaceId: 'ws_default',
      projectId: 'proj_001',
      libraryId: 'lib_a',
      keys: ['README.txt'],
    })).rejects.toBeInstanceOf(APIError);

    await waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: objectKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: listKey })?.isStale()).toBe(true);
      expect(queryClient.getQueryCache().find({ queryKey: detailKey })?.isStale()).toBe(true);
    });
  });
});

describe('useFileObjects queries', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('passes the React Query abort signal to object listing requests', async () => {
    let listingSignal: AbortSignal | undefined;
    mockListObjects.mockImplementation((
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      _params: object,
      options?: { signal?: AbortSignal },
    ) => {
      listingSignal = options?.signal;
      return new Promise(() => undefined);
    });

    const { unmount } = renderHook(
      () => useFileObjects('ws_default', 'proj_001', 'lib_a', { prefix: '', delimiter: '/', page_size: 200 }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockListObjects).toHaveBeenCalledTimes(1));
    expect(listingSignal).toBeDefined();

    unmount();

    expect(listingSignal?.aborted).toBe(true);
  });

  it('passes the React Query abort signal to infinite object listing requests', async () => {
    let listingSignal: AbortSignal | undefined;
    mockListObjects.mockImplementation((
      _workspaceId: string,
      _projectId: string,
      _libraryId: string,
      _params: object,
      options?: { signal?: AbortSignal },
    ) => {
      listingSignal = options?.signal;
      return new Promise(() => undefined);
    });

    const { unmount } = renderHook(
      () => useFileObjectsInfinite('ws_default', 'proj_001', 'lib_a', {
        prefix: '',
        delimiter: '/',
        page_size: 200,
      }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(mockListObjects).toHaveBeenCalledTimes(1));
    expect(listingSignal).toBeDefined();

    unmount();

    expect(listingSignal?.aborted).toBe(true);
  });
});
