import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { FileLibrariesAPI, getApiClient } from '@/lib/api';
import type {
  CreateFileLibraryRequest,
  FileLibraryEntriesListParams,
  MoveFileLibraryEntryRequest,
  UpdateFileLibraryRequest,
} from '@/lib/api/types';
import { queryKeys } from '@/lib/query-keys';
import { APIError, handleErrorForToast } from '@/lib/api/errors';
import { toast } from '@/components/ui/toast';

const FILE_LIBRARY_TYPED_CONFLICT_CODES = new Set([
  'FILE_LIBRARY_DELETING',
  'FILE_LIBRARY_NOT_READY',
  'FILE_LIBRARY_FORBIDDEN',
  'FILE_LIBRARY_NOT_FOUND',
  'FILE_LIBRARY_TASK_IN_USE',
  'FILE_LIBRARY_NOT_EMPTY',
]);

function readFileLibraryIdFromError(error: unknown) {
  if (!(error instanceof APIError)) return null;
  const value = error.details?.file_library_id;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isFileLibraryMountAccessConflict(error: unknown) {
  return error instanceof APIError && FILE_LIBRARY_TYPED_CONFLICT_CODES.has(error.errorCode);
}

function fileLibraryQueryMatches(
  queryKey: readonly unknown[],
  workspaceId: string,
  projectId: string,
  libraryId?: string | null,
) {
  const scopedKey = queryKey[0] === 'v2' ? queryKey.slice(1) : queryKey;
  if (
    scopedKey[0] === 'file-libraries'
    && scopedKey[1] === workspaceId
    && scopedKey[2] === projectId
  ) {
    return true;
  }
  if (
    scopedKey[0] === 'file-library'
    && scopedKey[1] === workspaceId
    && scopedKey[2] === projectId
  ) {
    return !libraryId || scopedKey[3] === libraryId;
  }
  return false;
}

function invalidateFileLibraryCachesInBackground(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId?: string | null,
) {
  void queryClient.invalidateQueries({
    predicate: (query) => fileLibraryQueryMatches(query.queryKey, workspaceId, projectId, libraryId),
  });
}

export function useV2FileLibraries(workspaceId: string, projectId: string) {
  const api = new FileLibrariesAPI(getApiClient());

  return useQuery({
    queryKey: ['v2', ...queryKeys.fileLibraries.list(workspaceId, projectId)],
    queryFn: () => api.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 10000,
  });
}

export function useCreateV2FileLibrary() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      body,
    }: {
      workspaceId: string;
      projectId: string;
      body: CreateFileLibraryRequest;
    }) => api.create(workspaceId, projectId, body),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2', ...queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId)],
      });
      toast.success(t('create_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateV2FileLibrary');
    },
  });
}

export function useUpdateV2FileLibrary() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      body,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      body: UpdateFileLibraryRequest;
    }) => api.update(workspaceId, projectId, libraryId, body),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2', ...queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId)],
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown, variables) => {
      if (isFileLibraryMountAccessConflict(error)) {
        invalidateFileLibraryCachesInBackground(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useUpdateV2FileLibrary');
    },
  });
}

export function useDeleteV2FileLibrary() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
    }) => api.delete(workspaceId, projectId, libraryId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2', ...queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId)],
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown, variables) => {
      if (isFileLibraryMountAccessConflict(error)) {
        invalidateFileLibraryCachesInBackground(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useDeleteV2FileLibrary');
    },
  });
}

export function useV2FileLibraryEntries(
  workspaceId: string,
  projectId: string,
  libraryId: string | null,
  params?: FileLibraryEntriesListParams,
) {
  const api = new FileLibrariesAPI(getApiClient());

  return useQuery({
    queryKey: ['v2-file-entries', workspaceId, projectId, libraryId, params] as const,
    queryFn: () => api.listEntries(workspaceId, projectId, libraryId!, params),
    enabled: !!workspaceId && !!projectId && !!libraryId,
    staleTime: 5000,
  });
}

export function useMoveV2FileLibraryEntry() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      body,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      body: MoveFileLibraryEntryRequest;
    }) => api.moveEntry(workspaceId, projectId, libraryId, body),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2-file-entries', variables.workspaceId, variables.projectId, variables.libraryId],
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown, variables) => {
      if (isFileLibraryMountAccessConflict(error)) {
        invalidateFileLibraryCachesInBackground(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useMoveV2FileLibraryEntry');
    },
  });
}

export function useFileLibraryStorageCredentialExchange() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
    }) => api.exchangeStorageCredentials(workspaceId, projectId, libraryId),
    onError: (error: unknown, variables) => {
      if (isFileLibraryMountAccessConflict(error)) {
        invalidateFileLibraryCachesInBackground(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useFileLibraryStorageCredentialExchange');
    },
  });
}

export function useFileLibraryDesktopMountAccess() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
    }) => api.exchangeDesktopMountAccess(workspaceId, projectId, libraryId),
    onError: (error: unknown, variables) => {
      if (isFileLibraryMountAccessConflict(error)) {
        invalidateFileLibraryCachesInBackground(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useFileLibraryDesktopMountAccess');
    },
  });
}
