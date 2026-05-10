/**
 * Project task file template hooks.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toast } from '@/components/ui/toast';
import { FilesAPI, getApiClient } from '@/lib/api';
import { handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';

export function useTaskFileTemplates(
  workspaceId: string,
  projectId: string,
  options?: { enabled?: boolean },
) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.taskFileTemplates.list(workspaceId, projectId),
    queryFn: () => filesAPI.listTaskFileTemplates(workspaceId, projectId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId,
    staleTime: 10_000,
  });
}

export function useCreateTaskFileTemplate() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      sourceLibraryId,
      name,
      description,
    }: {
      workspaceId: string;
      projectId: string;
      sourceLibraryId: string;
      name: string;
      description?: string;
    }) => filesAPI.createTaskFileTemplate(workspaceId, projectId, {
      source_library_id: sourceLibraryId,
      name,
      description,
    }),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.taskFileTemplates.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('create_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateTaskFileTemplate');
    },
  });
}

export function usePublishTaskFileTemplate() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      templateId,
    }: {
      workspaceId: string;
      projectId: string;
      templateId: string;
    }) => filesAPI.publishTaskFileTemplate(workspaceId, projectId, templateId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.taskFileTemplates.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'usePublishTaskFileTemplate');
    },
  });
}

export function useUnpublishTaskFileTemplate() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      templateId,
    }: {
      workspaceId: string;
      projectId: string;
      templateId: string;
    }) => filesAPI.unpublishTaskFileTemplate(workspaceId, projectId, templateId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.taskFileTemplates.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUnpublishTaskFileTemplate');
    },
  });
}

export function useDeleteTaskFileTemplate() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      templateId,
    }: {
      workspaceId: string;
      projectId: string;
      templateId: string;
    }) => filesAPI.deleteTaskFileTemplate(workspaceId, projectId, templateId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.taskFileTemplates.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteTaskFileTemplate');
    },
  });
}
