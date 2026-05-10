/**
 * File-library recovery hooks.
 *
 * Save points and restore operate on the selected file library as a whole.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toast } from '@/components/ui/toast';
import { FilesAPI, getApiClient } from '@/lib/api';
import { handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';

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
    staleTime: 10_000,
  });
}

export function useCreateFileLibrarySavePoint() {
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
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.fileLibraries.savePoints(
          variables.workspaceId,
          variables.projectId,
          variables.libraryId,
        ),
      });
      toast.success(t('create_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateFileLibrarySavePoint');
    },
  });
}

export function useCreateFileLibraryRestorePreview() {
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      savePointId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      savePointId: string;
    }) => filesAPI.createRestorePreview(workspaceId, projectId, libraryId, {
      save_point_id: savePointId,
    }),
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateFileLibraryRestorePreview');
    },
  });
}

export function useRunFileLibraryRestore() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      restorePreviewId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      restorePreviewId: string;
    }) => filesAPI.runRestore(workspaceId, projectId, libraryId, {
      restore_preview_id: restorePreviewId,
    }),
    onSuccess: async (_, variables) => {
      await Promise.all([
        invalidateFileObjectCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          variables.libraryId,
        ),
        queryClient.invalidateQueries({
          queryKey: queryKeys.fileLibraries.detail(
            variables.workspaceId,
            variables.projectId,
            variables.libraryId,
          ),
        }),
      ]);
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useRunFileLibraryRestore');
    },
  });
}

export function useCancelFileLibraryRestore() {
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      restorePreviewId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      restorePreviewId: string;
    }) => filesAPI.cancelRestore(workspaceId, projectId, libraryId, {
      restore_preview_id: restorePreviewId,
    }),
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCancelFileLibraryRestore');
    },
  });
}
