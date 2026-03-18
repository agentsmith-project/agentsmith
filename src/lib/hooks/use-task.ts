/**
 * Task React Hooks
 *
 * Custom hooks for Task API operations using React Query.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient, TaskAPI } from '@/lib/api';
import { handleErrorForToast } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';
import type {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  SendMessageRequest,
  TaskListParams,
  TaskTraceListResponse,
  TaskAttachedInputDetail,
} from '@/lib/types/task';
import { toast } from '@/components/ui/toast';

/**
 * Hook to query tasks list
 */
export function useTasks(
  workspaceId: string,
  projectId: string,
  params?: TaskListParams,
) {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.tasks.list(workspaceId, projectId, params),
    queryFn: () => taskAPI.list(workspaceId, projectId, params),
    enabled: !!workspaceId && !!projectId,
    staleTime: 10000, // 10 seconds
  });
}

/**
 * Hook to query a single task
 */
export function useTask(
  workspaceId: string,
  projectId: string,
  taskId: string,
): UseQueryResult<Task> {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery<Task>({
    queryKey: queryKeys.tasks.detail(workspaceId, projectId, taskId),
    queryFn: () => taskAPI.get(workspaceId, projectId, taskId),
    enabled: !!workspaceId && !!projectId && !!taskId,
    retry: false, // Don't retry on 404
  });
}

/**
 * Hook to create a task
 */
export function useCreateTask() {
  const queryClient = useQueryClient();
  const taskAPI = new TaskAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      data,
    }: {
      workspaceId: string;
      projectId: string;
      data: CreateTaskRequest;
    }) => taskAPI.create(workspaceId, projectId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('create_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateTask');
    },
  });
}

/**
 * Hook to update a task
 */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  const taskAPI = new TaskAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      taskId,
      data,
    }: {
      workspaceId: string;
      projectId: string;
      taskId: string;
      data: UpdateTaskRequest;
    }) => taskAPI.update(workspaceId, projectId, taskId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(variables.workspaceId, variables.projectId, variables.taskId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUpdateTask');
    },
  });
}

/**
 * Hook to delete a task
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();
  const taskAPI = new TaskAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      taskId,
    }: {
      workspaceId: string;
      projectId: string;
      taskId: string;
    }) => taskAPI.delete(workspaceId, projectId, taskId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.list(variables.workspaceId, variables.projectId),
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteTask');
    },
  });
}

/**
 * Hook to query messages in a task
 */
export function useTaskMessages(
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.tasks.messages(workspaceId, projectId, taskId),
    queryFn: () => taskAPI.listMessages(workspaceId, projectId, taskId),
    enabled: !!workspaceId && !!projectId && !!taskId,
    staleTime: 5000, // 5 seconds
  });
}

/**
 * Hook to send a message
 */
export function useSendMessage() {
  const queryClient = useQueryClient();
  const taskAPI = new TaskAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      taskId,
      data,
    }: {
      workspaceId: string;
      projectId: string;
      taskId: string;
      data: SendMessageRequest;
    }) => taskAPI.sendMessage(workspaceId, projectId, taskId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.messages(variables.workspaceId, variables.projectId, variables.taskId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(variables.workspaceId, variables.projectId, variables.taskId),
      });
    },
  });
}

/**
 * Hook to query artifacts in a task
 */
export function useTaskArtifacts(
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.tasks.artifacts(workspaceId, projectId, taskId),
    queryFn: () => taskAPI.listArtifacts(workspaceId, projectId, taskId),
    enabled: !!workspaceId && !!projectId && !!taskId,
    staleTime: 5000, // 5 seconds
  });
}

/**
 * Hook to query attached source file details for a task.
 */
export function useTaskAttachedFiles(
  workspaceId: string,
  projectId: string,
  taskId: string,
): UseQueryResult<TaskAttachedInputDetail[]> {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery<TaskAttachedInputDetail[]>({
    queryKey: queryKeys.tasks.attachedFiles(workspaceId, projectId, taskId),
    queryFn: () => taskAPI.listAttachedInputs(workspaceId, projectId, taskId),
    enabled: !!workspaceId && !!projectId && !!taskId,
    staleTime: 5000,
  });
}

/**
 * Hook to query execution trace events in a task
 */
export function useTaskTraces(
  workspaceId: string,
  projectId: string,
  taskId: string,
): UseQueryResult<TaskTraceListResponse> {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.tasks.traces(workspaceId, projectId, taskId, { page_size: 500 }),
    queryFn: () => taskAPI.listTraces(workspaceId, projectId, taskId, { page_size: 500 }),
    enabled: !!workspaceId && !!projectId && !!taskId,
    staleTime: 5000,
  });
}

/**
 * Hook to add files to a task
 */
export function useAddFiles() {
  const queryClient = useQueryClient();
  const taskAPI = new TaskAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      taskId,
      inputs,
    }: {
      workspaceId: string;
      projectId: string;
      taskId: string;
      inputs: Array<
        | { kind: 'library_object'; library_id: string; key: string; name?: string; content_type?: string; size_bytes?: number }
        | { kind: 'artifact'; task_id: string; artifact_id: string; task_relative_path?: string; name?: string; content_type?: string; size_bytes?: number }
        | { kind: 'url'; url: string; name?: string; imported_library_id?: string; imported_key?: string; content_type?: string; size_bytes?: number }
      >;
    }) => taskAPI.addInputs(workspaceId, projectId, taskId, inputs),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(variables.workspaceId, variables.projectId, variables.taskId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.attachedFiles(variables.workspaceId, variables.projectId, variables.taskId),
      });
      toast.success(t('files_added_to_task', { count: variables.inputs.length }));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useAddFiles');
    },
  });
}

/**
 * Hook to remove a source from a task
 */
export function useRemoveFile() {
  const queryClient = useQueryClient();
  const taskAPI = new TaskAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      taskId,
      inputId,
    }: {
      workspaceId: string;
      projectId: string;
      taskId: string;
      inputId: string;
    }) => taskAPI.removeInput(workspaceId, projectId, taskId, inputId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(variables.workspaceId, variables.projectId, variables.taskId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.attachedFiles(variables.workspaceId, variables.projectId, variables.taskId),
      });
      toast.success(t('file_removed_from_task'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useRemoveFile');
    },
  });
}
