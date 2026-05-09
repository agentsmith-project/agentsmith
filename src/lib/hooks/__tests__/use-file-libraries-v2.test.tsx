import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const {
  mockExchangeDesktopMountAccess,
  mockExchangeStorageCredentials,
} = vi.hoisted(() => ({
  mockExchangeDesktopMountAccess: vi.fn(),
  mockExchangeStorageCredentials: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  FileLibrariesAPI: vi.fn().mockImplementation(function MockFileLibrariesAPI() {
    return {
      exchangeDesktopMountAccess: mockExchangeDesktopMountAccess,
      exchangeStorageCredentials: mockExchangeStorageCredentials,
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
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
      list: (workspaceId: string, projectId: string) => ['file-libraries', workspaceId, projectId],
      detail: (workspaceId: string, projectId: string, libraryId: string) => [
        'file-library',
        workspaceId,
        projectId,
        libraryId,
      ],
    },
  },
}));

import {
  useFileLibraryDesktopMountAccess,
  useFileLibraryStorageCredentialExchange,
} from '../use-file-libraries-v2';
import { APIError } from '@/lib/api/errors';

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

const workspaceId = 'ws_default';
const projectId = 'proj_001';
const libraryId = 'lib_a';

type MountAccessMutationInput = {
  workspaceId: string;
  projectId: string;
  libraryId: string;
};

type MountAccessMutation = {
  mutateAsync: (input: MountAccessMutationInput) => Promise<unknown>;
};

function rejectNextDeletingLibrary(mockMutation: {
  mockRejectedValueOnce: (error: APIError) => unknown;
}) {
  mockMutation.mockRejectedValueOnce(new APIError(
    'FILE_LIBRARY_DELETING',
    'file_library_deleting',
    undefined,
    409,
    { file_library_id: libraryId, file_library_status: 'deleting' },
  ));
}

async function expectTypedConflictInvalidatesFileLibraryCaches(
  useMutationHook: () => MountAccessMutation,
  rejectNextConflict: () => void,
) {
  const { queryClient, Wrapper } = createQueryClientWrapper();
  const listKey = ['file-libraries', workspaceId, projectId];
  const detailKey = ['file-library', workspaceId, projectId, libraryId];
  const v2ListKey = ['v2', ...listKey];
  const v2DetailKey = ['v2', ...detailKey];
  for (const key of [listKey, detailKey, v2ListKey, v2DetailKey]) {
    queryClient.setQueryData(key, { id: libraryId, status: 'ready' });
  }
  rejectNextConflict();

  const { result } = renderHook(useMutationHook, { wrapper: Wrapper });

  await act(async () => {
    await expect(result.current.mutateAsync({
      workspaceId,
      projectId,
      libraryId,
    })).rejects.toBeInstanceOf(APIError);
  });

  await waitFor(() => {
    for (const key of [listKey, detailKey, v2ListKey, v2DetailKey]) {
      expect(queryClient.getQueryCache().find({ queryKey: key })?.isStale()).toBe(true);
    }
  });
}

describe('use-file-libraries-v2 mount access mutations', () => {
  it('refreshes list and detail caches after manual mount credential typed 409 conflicts', async () => {
    await expectTypedConflictInvalidatesFileLibraryCaches(
      () => useFileLibraryStorageCredentialExchange(),
      () => rejectNextDeletingLibrary(mockExchangeStorageCredentials),
    );
  });

  it('refreshes list and detail caches after desktop mount access typed 409 conflicts', async () => {
    await expectTypedConflictInvalidatesFileLibraryCaches(
      () => useFileLibraryDesktopMountAccess(),
      () => rejectNextDeletingLibrary(mockExchangeDesktopMountAccess),
    );
  });
});
