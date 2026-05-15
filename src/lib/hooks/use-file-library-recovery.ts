/**
 * File-library recovery hooks.
 *
 * Save points and restore operate on the selected file library as a whole.
 */

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toast } from '@/components/ui/toast';
import { FilesAPI, getApiClient } from '@/lib/api';
import type {
  FileLibraryRestoreOperation,
  GetFileLibraryRestoreOperationResponse,
  ListFileLibrarySavePointsResponse,
} from '@/lib/api/types';
import { APIError, handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';

const ACTIVE_RESTORE_OPERATION_REFETCH_INTERVAL_MS = 2_000;
const SAVE_POINTS_OPERATION_PENDING_REFETCH_INTERVAL_MS = 2_000;

type FileLibraryRecoveryMutationOptions = {
  suppressErrorToast?: boolean;
};

function isRestoreOperationActive(operation: FileLibraryRestoreOperation | null | undefined) {
  return operation?.status === 'pending' || operation?.status === 'restoring';
}

function isRestoreOperationTerminal(operation: FileLibraryRestoreOperation | null | undefined) {
  return operation?.status === 'succeeded' || operation?.status === 'failed';
}

function hasApiErrorCode(error: unknown, codes: string[], rawTokens: string[]): boolean {
  const rawValues = error instanceof APIError
    ? [error.errorCode, error.message]
    : error instanceof Error
      ? [error.message]
      : [];
  const normalizedCodes = new Set(codes.map((code) => code.trim().toLowerCase()));
  return rawValues.some((value) => {
    const normalized = value.trim().toLowerCase();
    return normalizedCodes.has(normalized)
      || rawTokens.some((token) => normalized === token || normalized.includes(token));
  });
}

export function isFileLibraryOperationPendingError(error: unknown): boolean {
  return hasApiErrorCode(
    error,
    ['FILE_LIBRARY_OPERATION_PENDING', 'FILE_LIBRARY_RESTORE_OPERATION_PENDING'],
    ['file_library_operation_pending', 'file_library_restore_operation_pending'],
  );
}

function activeRestoreOperationResponse(
  operation: FileLibraryRestoreOperation | null,
): GetFileLibraryRestoreOperationResponse {
  return { restore_operation: operation };
}

function fileObjectQueryMatches(
  queryKey: readonly unknown[],
  workspaceId: string,
  projectId: string,
  libraryId: string,
) {
  if (queryKey[0] !== 'file-objects') return false;
  if (queryKey[1] === 'infinite') {
    return queryKey[2] === workspaceId
      && queryKey[3] === projectId
      && queryKey[4] === libraryId;
  }
  return queryKey[1] === workspaceId
    && queryKey[2] === projectId
    && queryKey[3] === libraryId;
}

function invalidateFileObjectCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId: string,
) {
  return queryClient.invalidateQueries({
    predicate: (query) => fileObjectQueryMatches(
      query.queryKey,
      workspaceId,
      projectId,
      libraryId,
    ),
  });
}

async function invalidateRestoreRelatedCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId: string,
) {
  await Promise.all([
    invalidateFileObjectCaches(queryClient, workspaceId, projectId, libraryId),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.savePoints(workspaceId, projectId, libraryId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.activeRestoreOperation(workspaceId, projectId, libraryId),
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.detail(workspaceId, projectId, libraryId),
    }),
  ]);
}

export function useFileLibrarySavePoints(
  workspaceId: string,
  projectId: string,
  libraryId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const filesAPI = new FilesAPI(getApiClient());
  const safeLibraryId = libraryId ?? '';

  return useQuery({
    queryKey: queryKeys.fileLibraries.savePoints(workspaceId, projectId, safeLibraryId),
    queryFn: () => filesAPI.listSavePoints(workspaceId, projectId, safeLibraryId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!safeLibraryId,
    refetchInterval: (query) => (
      isFileLibraryOperationPendingError(query.state.error)
        ? SAVE_POINTS_OPERATION_PENDING_REFETCH_INTERVAL_MS
        : false
    ),
    refetchIntervalInBackground: true,
    retry: (failureCount, error) => (
      isFileLibraryOperationPendingError(error) ? false : failureCount < 1
    ),
    staleTime: 10_000,
  });
}

export function useFileLibraryActiveRestoreOperation(
  workspaceId: string,
  projectId: string,
  libraryId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const safeLibraryId = libraryId ?? '';
  const query = useQuery({
    queryKey: queryKeys.fileLibraries.activeRestoreOperation(workspaceId, projectId, safeLibraryId),
    queryFn: () => filesAPI.getActiveRestoreOperation(workspaceId, projectId, safeLibraryId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!safeLibraryId,
    refetchInterval: (activeQuery) => (
      isRestoreOperationActive(activeQuery.state.data?.restore_operation)
        ? ACTIVE_RESTORE_OPERATION_REFETCH_INTERVAL_MS
        : false
    ),
    staleTime: 0,
  });

  const operation = query.data?.restore_operation;
  React.useEffect(() => {
    if (!safeLibraryId || !isRestoreOperationTerminal(operation)) return;
    void invalidateRestoreRelatedCaches(queryClient, workspaceId, projectId, safeLibraryId);
  }, [operation, operation?.id, operation?.status, projectId, queryClient, safeLibraryId, workspaceId]);

  return query;
}

export function useCreateFileLibrarySavePoint(options: FileLibraryRecoveryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      message,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      message?: string;
    }) => filesAPI.createSavePoint(workspaceId, projectId, libraryId, { message }),
    onSuccess: async (savePoint, variables) => {
      const savePointsKey = queryKeys.fileLibraries.savePoints(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      queryClient.setQueryData<ListFileLibrarySavePointsResponse>(savePointsKey, (current) => ({
        items: [
          savePoint,
          ...(current?.items ?? []).filter((item) => item.id !== savePoint.id),
        ],
      }));
      await queryClient.invalidateQueries({
        queryKey: savePointsKey,
      });
      toast.success(t('create_success'));
    },
    onError: async (error: unknown, variables) => {
      if (isFileLibraryOperationPendingError(error)) {
        await queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.savePoints(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        });
      }
      if (options.suppressErrorToast) return;
      handleErrorForToast(error, 'useCreateFileLibrarySavePoint');
    },
  });
}

export function useRestoreFileLibrary(options: FileLibraryRecoveryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      savePointId,
      idempotencyKey,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      savePointId: string;
      idempotencyKey: string;
    }) => filesAPI.restoreFileLibrary(
      workspaceId,
      projectId,
      libraryId,
      {
        save_point_id: savePointId,
        discard_unsaved_changes_confirmed: true,
      },
      { idempotencyKey },
    ),
    onSuccess: async (operation, variables) => {
      const activeOperationKey = queryKeys.fileLibraries.activeRestoreOperation(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      queryClient.setQueryData<GetFileLibraryRestoreOperationResponse>(
        activeOperationKey,
        activeRestoreOperationResponse(operation),
      );
      await invalidateRestoreRelatedCaches(
        queryClient,
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      if (operation.status === 'succeeded') {
        toast.success(t('update_success'));
      }
    },
    onError: (error: unknown) => {
      if (options.suppressErrorToast) return;
      handleErrorForToast(error, 'useRestoreFileLibrary');
    },
  });
}

export function useReleaseFileLibraryRuntimeAccess(options: FileLibraryRecoveryMutationOptions = {}) {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
    }) => filesAPI.releaseRuntimeAccess(workspaceId, projectId, libraryId),
    onSuccess: async (_release, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.activeRestoreOperation(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.savePoints(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.list(
            variables.workspaceId,
            variables.projectId,
          ),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.detail(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        }),
        invalidateFileObjectCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          variables.libraryId,
        ),
        queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.scope(variables.workspaceId, variables.projectId),
        }),
      ]);
    },
    onError: (error: unknown) => {
      if (options.suppressErrorToast) return;
      handleErrorForToast(error, 'useReleaseFileLibraryRuntimeAccess');
    },
  });
}
