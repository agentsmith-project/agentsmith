/**
 * Sources React Hooks
 *
 * Custom hooks for Sources API operations using React Query.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient, SourcesAPI } from '@/lib/api';
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
    queryKey: ['sources', workspaceId, projectId, params],
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
    queryKey: ['source', workspaceId, projectId, fileId],
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
    queryKey: ['quota', workspaceId, projectId],
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

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      file,
      onProgress,
    }: {
      workspaceId: string;
      projectId: string;
      file: File;
      onProgress?: (progress: number) => void;
    }) => sourcesAPI.upload(workspaceId, projectId, file, onProgress),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['quota', variables.workspaceId, variables.projectId],
      });
      toast.success('File uploaded successfully');
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUploadFile');
    },
  });
}

/**
 * Hook to delete a file
 */
export function useDeleteFile() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());

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
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['quota', variables.workspaceId, variables.projectId],
      });
      toast.success('File deleted successfully');
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
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['source', variables.workspaceId, variables.projectId, variables.fileId],
      });
      toast.success('AIReady started');
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
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['quota', variables.workspaceId, variables.projectId],
      });
      toast.success('AIReady cancelled');
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
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      toast.success('AIReady retry started');
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
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['quota', variables.workspaceId, variables.projectId],
      });
      
      // Show detailed results if available
      const successCount = response.jobs?.filter((j) => j.status !== 'failed').length || variables.fileIds.length;
      const failedCount = response.jobs?.filter((j) => j.status === 'failed').length || 0;
      
      if (failedCount > 0) {
        toast.warning(
          `Started AIReady for ${successCount} file(s), ${failedCount} failed`,
        );
      } else {
        toast.success(`Started AIReady for ${successCount} file(s)`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to start batch AIReady: ${error.message}`);
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
        queryKey: ['sources', variables.workspaceId, variables.projectId],
      });
      queryClient.invalidateQueries({
        queryKey: ['quota', variables.workspaceId, variables.projectId],
      });
      
      // Show detailed results if available
      const successCount = response.jobs?.filter((j) => j.status === 'cancelled').length || variables.fileIds.length;
      const failedCount = response.jobs?.filter((j) => j.status === 'failed').length || 0;
      
      if (failedCount > 0) {
        toast.warning(
          `Cancelled AIReady for ${successCount} file(s), ${failedCount} failed`,
        );
      } else {
        toast.success(`Cancelled AIReady for ${successCount} file(s)`);
      }
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useBatchAIReady.cancel');
    },
  });

  return { batchStart, batchCancel };
}
