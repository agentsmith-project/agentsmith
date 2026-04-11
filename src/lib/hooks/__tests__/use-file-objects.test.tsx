import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateFolder,
  mockMoveObject,
} = vi.hoisted(() => ({
  mockCreateFolder: vi.fn().mockResolvedValue(undefined),
  mockMoveObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FilesAPI: vi.fn().mockImplementation(function () {
    return {
      createFolder: mockCreateFolder,
      moveObject: mockMoveObject,
    };
  }),
}));

vi.mock('@/lib/query-keys', () => ({
  queryKeys: {
    fileObjects: {
      _def: ['file-objects'],
    },
    fileLibraries: {
      list: vi.fn((workspaceId: string, projectId: string) => ['file-libraries', workspaceId, projectId]),
    },
  },
}));

import { useCreateFileFolder, useMoveFileObject } from '../use-file-objects';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
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
});
