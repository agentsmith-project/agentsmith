/**
 * Files React Hooks
 *
 * Custom hooks for Files API operations using React Query.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient, FilesAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { toast } from '@/components/ui/toast';
import { APIError, handleErrorForToast } from '@/lib/api/errors';

const FILE_LIBRARY_CONFLICT_ERROR_CODES = new Set([
  'FILE_LIBRARY_TASK_IN_USE',
  'FILE_LIBRARY_DELETING',
  'FILE_LIBRARY_NOT_EMPTY',
  'FILE_LIBRARY_NOT_READY',
  'AGENT_TASK_FILE_LIBRARY_IN_USE',
]);

function readFileLibraryIdFromError(error: unknown) {
  if (!(error instanceof APIError)) return null;
  const value = error.details?.file_library_id;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function fileLibraryQueryMatches(
  queryKey: readonly unknown[],
  workspaceId: string,
  projectId: string,
  libraryId?: string | null,
) {
  if (
    queryKey[0] === 'file-libraries'
    && queryKey[1] === workspaceId
    && queryKey[2] === projectId
  ) {
    return true;
  }
  if (
    queryKey[0] === 'file-library'
    && queryKey[1] === workspaceId
    && queryKey[2] === projectId
  ) {
    return !libraryId || queryKey[3] === libraryId;
  }
  return false;
}

function invalidateFileLibraryCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId?: string | null,
) {
  return queryClient.invalidateQueries({
    predicate: (query) => fileLibraryQueryMatches(query.queryKey, workspaceId, projectId, libraryId),
  });
}

function isFileLibraryConflictError(error: unknown) {
  return error instanceof APIError && FILE_LIBRARY_CONFLICT_ERROR_CODES.has(error.errorCode);
}

export function useFileLibraries(
  workspaceId: string,
  projectId: string,
  options?: { enabled?: boolean },
) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
    queryFn: () => filesAPI.listLibraries(workspaceId, projectId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId,
    staleTime: 10000,
  });
}

export function useCreateFileLibrary() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      name,
      description,
    }: {
      workspaceId: string;
      projectId: string;
      name: string;
      description?: string;
    }) =>
      filesAPI.createLibrary(workspaceId, projectId, {
        name,
        description,
        visibility: 'shared',
      }),
    onSuccess: async (_, variables) => {
      await invalidateFileLibraryCaches(queryClient, variables.workspaceId, variables.projectId);
      toast.success(t('create_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateFileLibrary');
    },
  });
}

export function useUpdateFileLibrary() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      name,
      description,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      name?: string;
      description?: string;
    }) =>
      filesAPI.updateLibrary(workspaceId, projectId, libraryId, {
        name,
        description,
      }),
    onSuccess: async (_, variables) => {
      await invalidateFileLibraryCaches(queryClient, variables.workspaceId, variables.projectId, variables.libraryId);
      toast.success(t('update_success'));
    },
    onError: (error: unknown, variables) => {
      if (isFileLibraryConflictError(error)) {
        void invalidateFileLibraryCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useUpdateFileLibrary');
    },
  });
}

export function useDeleteFileLibrary() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
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
    }) => filesAPI.deleteLibrary(workspaceId, projectId, libraryId),
    onSuccess: async (_, variables) => {
      await invalidateFileLibraryCaches(queryClient, variables.workspaceId, variables.projectId, variables.libraryId);
      toast.success(t('delete_success'));
    },
    onError: (error: unknown, variables) => {
      if (isFileLibraryConflictError(error)) {
        void invalidateFileLibraryCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useDeleteFileLibrary');
    },
  });
}
