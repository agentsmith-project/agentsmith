/**
 * File-library recovery hooks.
 *
 * Save points and restore operate on the selected file library as a whole.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toast } from '@/components/ui/toast';
import { FilesAPI, getApiClient } from '@/lib/api';
import type {
  FileLibraryRestorePreview,
  GetFileLibraryRestorePreviewResponse,
  ListFileLibrarySavePointsResponse,
} from '@/lib/api/types';
import { handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';

const ACTIVE_RESTORE_PREVIEW_REFETCH_INTERVAL_MS = 2_000;

type CreateFileLibrarySavePointOptions = {
  suppressErrorToast?: boolean;
};

function isRestorePreviewReconciling(preview: FileLibraryRestorePreview | null | undefined) {
  return preview?.status === 'previewing'
    || preview?.status === 'canceling'
    || preview?.status === 'restoring';
}

function activeRestorePreviewResponse(
  preview: FileLibraryRestorePreview | null,
): GetFileLibraryRestorePreviewResponse {
  if (preview?.status === 'canceled' || preview?.status === 'restored') {
    return { restore_preview: null };
  }
  return { restore_preview: preview };
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

export function useFileLibraryActiveRestorePreview(
  workspaceId: string,
  projectId: string,
  libraryId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const filesAPI = new FilesAPI(getApiClient());
  const safeLibraryId = libraryId ?? '';

  return useQuery({
    queryKey: queryKeys.fileLibraries.activeRestorePreview(workspaceId, projectId, safeLibraryId),
    queryFn: async () => activeRestorePreviewResponse(
      (await filesAPI.getActiveRestorePreview(workspaceId, projectId, safeLibraryId)).restore_preview,
    ),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!safeLibraryId,
    refetchInterval: (query) => (
      isRestorePreviewReconciling(query.state.data?.restore_preview)
        ? ACTIVE_RESTORE_PREVIEW_REFETCH_INTERVAL_MS
        : false
    ),
    staleTime: 0,
  });
}

export function useCreateFileLibrarySavePoint(options: CreateFileLibrarySavePointOptions = {}) {
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
    onError: (error: unknown) => {
      if (options.suppressErrorToast) return;
      handleErrorForToast(error, 'useCreateFileLibrarySavePoint');
    },
  });
}

export function useCreateFileLibraryRestorePreview() {
  const queryClient = useQueryClient();
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
    onSuccess: async (preview, variables) => {
      const activePreviewKey = queryKeys.fileLibraries.activeRestorePreview(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      queryClient.setQueryData<GetFileLibraryRestorePreviewResponse>(
        activePreviewKey,
        activeRestorePreviewResponse(preview),
      );
      await queryClient.invalidateQueries({ queryKey: activePreviewKey });
    },
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
    onSuccess: async (run, variables) => {
      const activePreviewKey = queryKeys.fileLibraries.activeRestorePreview(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      if (run.status === 'succeeded') {
        queryClient.setQueryData<GetFileLibraryRestorePreviewResponse>(
          activePreviewKey,
          { restore_preview: null },
        );
      } else if (run.status === 'pending') {
        queryClient.setQueryData<GetFileLibraryRestorePreviewResponse>(
          activePreviewKey,
          (current) => {
            const currentPreview = current?.restore_preview;
            if (!currentPreview || currentPreview.id !== run.restore_preview_id) return current;
            return {
              restore_preview: {
                ...currentPreview,
                status: 'restoring',
                updated_at: run.updated_at,
              },
            };
          },
        );
      }
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
        queryClient.invalidateQueries({ queryKey: activePreviewKey }),
      ]);
      if (run.status === 'succeeded') {
        toast.success(t('update_success'));
      }
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useRunFileLibraryRestore');
    },
  });
}

export function useCancelFileLibraryRestore() {
  const queryClient = useQueryClient();
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
    onSuccess: async (preview, variables) => {
      const activePreviewKey = queryKeys.fileLibraries.activeRestorePreview(
        variables.workspaceId,
        variables.projectId,
        variables.libraryId,
      );
      queryClient.setQueryData<GetFileLibraryRestorePreviewResponse>(
        activePreviewKey,
        activeRestorePreviewResponse(preview),
      );
      await queryClient.invalidateQueries({ queryKey: activePreviewKey });
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCancelFileLibraryRestore');
    },
  });
}
