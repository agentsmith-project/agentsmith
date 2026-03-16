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
 * Hook to query limit summary
 */
export function useLimitSummary(workspaceId: string, projectId: string, libraryId?: string) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.limits.detail(workspaceId, projectId, libraryId),
    queryFn: () => filesAPI.getLimits(workspaceId, projectId, libraryId),
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
        queryKey: queryKeys.limits._def,
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
    }: {
      workspaceId: string;
      projectId: string;
      fileId: string;
    }) => filesAPI.delete(workspaceId, projectId, fileId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.files._def,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.files.list(variables.workspaceId, variables.projectId),
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.limits._def,
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteFile');
    },
  });
}
