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
import { handleErrorForToast } from '@/lib/api/errors';

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
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteFileLibrary');
    },
  });
}
