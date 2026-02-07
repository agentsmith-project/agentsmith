/**
 * Sources React Hooks
 *
 * Custom hooks for Sources API operations using React Query.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient, SourcesAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { SourcesListParams } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';
import { handleErrorForToast } from '@/lib/api/errors';

/**
 * Hook to query source files list
 */
export function useSources(
  workspaceId: string,
  projectId: string,
  params?: SourcesListParams,
) {
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.sources.list(workspaceId, projectId, params),
    queryFn: () => sourcesAPI.list(workspaceId, projectId, params),
    enabled: !!workspaceId && !!projectId,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to query a single source file
 */
export function useSourceFile(
  workspaceId: string,
  projectId: string,
  fileId: string,
) {
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.sources.detail(workspaceId, projectId, fileId),
    queryFn: () => sourcesAPI.get(workspaceId, projectId, fileId),
    enabled: !!workspaceId && !!projectId && !!fileId,
  });
}

/**
 * Hook to query quota summary
 */
export function useQuota(workspaceId: string, projectId: string) {
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.quota.detail(workspaceId, projectId),
    queryFn: () => sourcesAPI.getQuota(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 30000, // 30 seconds
  });
}

/**
 * Hook to upload a file
 */
export function useUploadFile() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());
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
    }) => sourcesAPI.upload(workspaceId, projectId, file, libraryId, onProgress),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota.detail(variables.workspaceId, variables.projectId),
      });
      toast.success(t('upload_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUploadFile');
    },
  });
}

export function useSourceLibraries(workspaceId: string, projectId: string) {
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.sourceLibraries.list(workspaceId, projectId),
    queryFn: () => sourcesAPI.listLibraries(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 10000,
  });
}

export function useCreateSourceLibrary() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());
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
      sourcesAPI.createLibrary(workspaceId, projectId, {
        name,
        description,
        visibility: 'shared',
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceLibraries.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('create_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateSourceLibrary');
    },
  });
}

export function useUpdateSourceLibrary() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());
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
      sourcesAPI.updateLibrary(workspaceId, projectId, libraryId, {
        name,
        description,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceLibraries.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUpdateSourceLibrary');
    },
  });
}

export function useDeleteSourceLibrary() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());
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
    }) => sourcesAPI.deleteLibrary(workspaceId, projectId, libraryId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceLibraries.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteSourceLibrary');
    },
  });
}

/**
 * Hook to delete a file
 */
export function useDeleteFile() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());
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
    }) => sourcesAPI.delete(workspaceId, projectId, fileId, deleteAIReady),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota.detail(variables.workspaceId, variables.projectId),
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
  const sourcesAPI = new SourcesAPI(getApiClient());
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
    }) => sourcesAPI.startAIReady(workspaceId, projectId, fileId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.detail(variables.workspaceId, variables.projectId, variables.fileId),
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
    }) => sourcesAPI.cancelAIReady(workspaceId, projectId, fileId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota.detail(variables.workspaceId, variables.projectId),
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
    }) => sourcesAPI.retryAIReady(workspaceId, projectId, fileId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
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
  const sourcesAPI = new SourcesAPI(getApiClient());
  const t = useTranslations('common.toast');

  const batchStart = useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      fileIds,
    }: {
      workspaceId: string;
      projectId: string;
      fileIds: string[];
    }) => sourcesAPI.batchStartAIReady(workspaceId, projectId, fileIds),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota.detail(variables.workspaceId, variables.projectId),
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
    onError: (error: Error) => {
      toast.error(t('ai_ready_batch_failed', { error: error.message }));
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
    }) => sourcesAPI.batchCancelAIReady(workspaceId, projectId, fileIds),
    onSuccess: (response, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(variables.workspaceId, variables.projectId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.quota.detail(variables.workspaceId, variables.projectId),
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
