/**
 * Files React Hooks
 *
 * Custom hooks for Files API operations using React Query.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient, FilesAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { FilesListParams } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { APIError, handleErrorForToast, resolveApiErrorPresentation } from '@/lib/api/errors';

/**
 * Hook to query files list
 */
export function useFiles(
  workspaceId: string,
  projectId: string,
  params?: FilesListParams,
) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.files.list(workspaceId, projectId, params),
    queryFn: () => filesAPI.list(workspaceId, projectId, params),
    enabled: !!workspaceId && !!projectId,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to query a single file
 */
export function useFile(
  workspaceId: string,
  projectId: string,
  fileId: string,
) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.files.detail(workspaceId, projectId, fileId),
    queryFn: () => filesAPI.get(workspaceId, projectId, fileId),
    enabled: !!workspaceId && !!projectId && !!fileId,
  });
}

/**
 * Hook to query quota summary
 */
export function useQuota(workspaceId: string, projectId: string, libraryId?: string) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.quota.detail(workspaceId, projectId, libraryId),
    queryFn: () => filesAPI.getQuota(workspaceId, projectId, libraryId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to upload a file
 */
export function useUploadFile() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      file,
      libraryId,
      onProgress,
    }: {
      workspaceId: string;
      projectId: string;
      file: File;
      libraryId?: string;
      onProgress?: (progress: number) => void;
    }) => filesAPI.upload(workspaceId, projectId, file, libraryId, onProgress),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.files._def,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.quota._def,
      });
      toast.success(t('upload_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUploadFile');
    },
  });
}

export function useFileLibraries(workspaceId: string, projectId: string) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
    queryFn: () => filesAPI.listLibraries(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId),
      });
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteFileLibrary');
    },
  });
}

/**
 * Hook to delete a file
 */
export function useDeleteFile() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      fileId,
      deleteAIReady,
    }: {
      workspaceId: string;
      projectId: string;
      fileId: string;
      deleteAIReady?: boolean;
    }) => filesAPI.delete(workspaceId, projectId, fileId, deleteAIReady),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.files._def,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.quota._def,
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteFile');
    },
  });
}

/**
 * Hook for AIReady actions (start, cancel, retry)
 */
export function useAIReadyActions() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  const start = useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      fileId,
    }: {
      workspaceId: string;
      projectId: string;
      fileId: string;
    }) => filesAPI.startAIReady(workspaceId, projectId, fileId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.detail(variables.workspaceId, variables.projectId, variables.fileId),
      });
      toast.success(t('ai_ready_started'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useAIReadyActions.start');
    },
  });

  const cancel = useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      fileId,
    }: {
      workspaceId: string;
      projectId: string;
      fileId: string;
    }) => filesAPI.cancelAIReady(workspaceId, projectId, fileId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota._def,
      });
      toast.success(t('ai_ready_cancelled'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useAIReadyActions.cancel');
    },
  });

  const retry = useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      fileId,
    }: {
      workspaceId: string;
      projectId: string;
      fileId: string;
    }) => filesAPI.retryAIReady(workspaceId, projectId, fileId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('ai_ready_retry_started'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useAIReadyActions.retry');
    },
  });

  return { start, cancel, retry };
}

/**
 * Hook for batch AIReady actions
 */
export function useBatchAIReadyActions() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');
  const tErrors = useTranslations('errors');

  const batchStart = useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      fileIds,
    }: {
      workspaceId: string;
      projectId: string;
      fileIds: string[];
    }) => filesAPI.batchStartAIReady(workspaceId, projectId, fileIds),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota._def,
      });

      // Show detailed results if available
      const successCount = response.jobs?.filter((j) => j.status !== 'failed').length || variables.fileIds.length;
      const failedCount = response.jobs?.filter((j) => j.status === 'failed').length || 0;

      if (failedCount > 0) {
        toast.warning(
          t('ai_ready_batch_failed', { error: `${failedCount} failed` }),
        );
      } else {
        toast.success(t('ai_ready_batch_started', { count: successCount.toString() }));
      }
    },
    onError: (error: unknown) => {
      const detail = error instanceof APIError
        ? resolveApiErrorPresentation({
            error,
            t: tErrors,
            fallbackMessage: t('ai_ready_batch_failed', { error: 'unknown' }),
          }).description
        : error instanceof Error
          ? error.message
          : tErrors('unknown.description');
      toast.error(t('ai_ready_batch_failed', { error: detail }));
    },
  });

  const batchCancel = useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      fileIds,
    }: {
      workspaceId: string;
      projectId: string;
      fileIds: string[];
    }) => filesAPI.batchCancelAIReady(workspaceId, projectId, fileIds),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota._def,
      });

      // Show detailed results if available
      const successCount = response.jobs?.filter((j) => j.status === 'cancelled').length || variables.fileIds.length;
      const failedCount = response.jobs?.filter((j) => j.status === 'failed').length || 0;

      if (failedCount > 0) {
        toast.warning(
          t('ai_ready_batch_cancelled', { successCount: successCount.toString(), failedCount: failedCount.toString() }),
        );
      } else {
        toast.success(t('ai_ready_batch_cancelled_success', { count: successCount.toString() }));
      }
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useBatchAIReady.cancel');
    },
  });

  return { batchStart, batchCancel };
}
