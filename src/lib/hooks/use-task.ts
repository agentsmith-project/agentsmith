/**
 * Task React Hooks
 *
 * Custom hooks for Task API operations using React Query.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type Query,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getApiClient, TaskAPI } from '@/lib/api';
import { APIError, handleErrorForToast, resolveApiErrorPresentation } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';
import type {
  Task,
  CreateTaskRequest,
  UpdateTaskRequest,
  StartTaskRunRequest,
  TaskListParams,
  TaskTraceListResponse,
  TaskAttachedInputDetail,
} from '@/lib/types/task';
import { toast } from '@/components/ui/toast';

const TASK_BINDING_RELATED_ERROR_CODES = new Set([
  'AGENT_TASK_FILE_LIBRARY_IN_USE',
  'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
  'FILE_LIBRARY_DELETING',
  'FILE_LIBRARY_NOT_READY',
  'FILE_LIBRARY_NOT_FOUND',
  'FILE_LIBRARY_FORBIDDEN',
]);

const TASK_DELETE_BLOCKED_ERROR_CODES = new Set([
  'AGENT_TASK_DELETE_BLOCKED',
  'AGENT_TASK_WORKSPACE_BINDING_CONFLICT',
]);

export interface UseDeleteTaskOptions {
  onDeleteBlocked?: (message: string, error: APIError) => void;
}

function isApiErrorWithCode(error: unknown, codes: ReadonlySet<string>): error is APIError {
  return error instanceof APIError && codes.has(error.errorCode);
}

function readErrorFileLibraryId(error: unknown) {
  if (!(error instanceof APIError)) return null;
  const value = error.details?.file_library_id;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function fileLibraryQueryMatches(
  queryKey: readonly unknown[],
  workspaceId: string,
  projectId: string,
  libraryId?: string | null,
) {
  const scopedKey = queryKey[0] === 'v2' ? queryKey.slice(1) : queryKey;
  if (
    scopedKey[0] === 'file-libraries'
    && scopedKey[1] === workspaceId
    && scopedKey[2] === projectId
  ) {
    return true;
  }
  if (
    scopedKey[0] === 'file-library'
    && scopedKey[1] === workspaceId
    && scopedKey[2] === projectId
  ) {
    return !libraryId || scopedKey[3] === libraryId;
  }
  return false;
}

async function invalidateTaskBindingCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  options?: { taskId?: string; libraryId?: string | null },
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.tasks.scope(workspaceId, projectId),
    }),
    options?.taskId
      ? queryClient.invalidateQueries({
          queryKey: queryKeys.tasks.detail(workspaceId, projectId, options.taskId),
        })
      : Promise.resolve(),
    queryClient.invalidateQueries({
      predicate: (query) => fileLibraryQueryMatches(
        query.queryKey,
        workspaceId,
        projectId,
        options?.libraryId,
      ),
    }),
  ]);
}

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
type TaskDetailQueryKey = ReturnType<typeof queryKeys.tasks.detail>;
type TaskDetailQuery = Query<Task, Error, Task, TaskDetailQueryKey>;

export interface UseTaskOptions {
  refetchInterval?:
    | number
    | false
    | ((query: TaskDetailQuery) => number | false | undefined);
  refetchIntervalInBackground?: UseQueryOptions<
    Task,
    Error,
    Task,
    TaskDetailQueryKey
  >['refetchIntervalInBackground'];
  refetchOnWindowFocus?:
    | boolean
    | 'always'
    | ((query: TaskDetailQuery) => boolean | 'always');
}

export function useTask(
  workspaceId: string,
  projectId: string,
  taskId: string,
  options?: UseTaskOptions,
): UseQueryResult<Task> {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery<Task, Error, Task, ReturnType<typeof queryKeys.tasks.detail>>({
    queryKey: queryKeys.tasks.detail(workspaceId, projectId, taskId),
    queryFn: () => taskAPI.get(workspaceId, projectId, taskId),
    enabled: !!workspaceId && !!projectId && !!taskId,
    retry: false, // Don't retry on 404
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
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
    onSuccess: async (task, variables) => {
      await invalidateTaskBindingCaches(queryClient, variables.workspaceId, variables.projectId, {
        taskId: task.id,
        libraryId: task.workspace_file_library_id ?? null,
      });
      toast.success(t('create_success'));
    },
    onError: (error: unknown, variables) => {
      if (isApiErrorWithCode(error, TASK_BINDING_RELATED_ERROR_CODES)) {
        void invalidateTaskBindingCaches(queryClient, variables.workspaceId, variables.projectId, {
          libraryId: readErrorFileLibraryId(error),
        });
        return;
      }
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
    onSuccess: async (task, variables) => {
      await invalidateTaskBindingCaches(queryClient, variables.workspaceId, variables.projectId, {
        taskId: variables.taskId,
        libraryId: task.workspace_file_library_id ?? null,
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown, variables) => {
      if (isApiErrorWithCode(error, TASK_BINDING_RELATED_ERROR_CODES)) {
        void invalidateTaskBindingCaches(queryClient, variables.workspaceId, variables.projectId, {
          taskId: variables.taskId,
          libraryId: readErrorFileLibraryId(error),
        });
        return;
      }
      handleErrorForToast(error, 'useUpdateTask');
    },
  });
}

/**
 * Hook to delete a task
 */
export function useDeleteTask(options?: UseDeleteTaskOptions) {
  const queryClient = useQueryClient();
  const taskAPI = new TaskAPI(getApiClient());
  const t = useTranslations('common.toast');
  const errorT = useTranslations('errors');

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
    onSuccess: async (_, variables) => {
      await invalidateTaskBindingCaches(queryClient, variables.workspaceId, variables.projectId, {
        taskId: variables.taskId,
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown, variables) => {
      if (isApiErrorWithCode(error, TASK_DELETE_BLOCKED_ERROR_CODES)) {
        void invalidateTaskBindingCaches(queryClient, variables.workspaceId, variables.projectId, {
          taskId: variables.taskId,
          libraryId: readErrorFileLibraryId(error),
        });
        const presentation = resolveApiErrorPresentation({
          error,
          t: errorT,
          fallbackMessage: errorT('agent_task_delete_blocked.description'),
        });
        if (options?.onDeleteBlocked) {
          options.onDeleteBlocked(presentation.description, error);
        } else {
          toast.error(`${presentation.title}: ${presentation.description}`);
        }
        return;
      }
      if (isApiErrorWithCode(error, TASK_BINDING_RELATED_ERROR_CODES)) {
        void invalidateTaskBindingCaches(queryClient, variables.workspaceId, variables.projectId, {
          taskId: variables.taskId,
          libraryId: readErrorFileLibraryId(error),
        });
        return;
      }
      handleErrorForToast(error, 'useDeleteTask');
    },
  });
}

/**
 * Hook to query activity in a task
 */
export function useTaskActivity(
  workspaceId: string,
  projectId: string,
  taskId: string,
) {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.tasks.activity(workspaceId, projectId, taskId),
    queryFn: () => taskAPI.listActivity(workspaceId, projectId, taskId),
    enabled: !!workspaceId && !!projectId && !!taskId,
    staleTime: 5000, // 5 seconds
  });
}

/**
 * Hook to start a task run
 */
export function useStartTaskRun() {
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
      data: StartTaskRunRequest;
    }) => taskAPI.startRun(workspaceId, projectId, taskId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.activity(variables.workspaceId, variables.projectId, variables.taskId),
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
  options?: {
    refetchInterval?: number | false;
    refetchIntervalInBackground?: boolean;
    refetchOnWindowFocus?: boolean;
  },
) {
  const taskAPI = new TaskAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.tasks.artifacts(workspaceId, projectId, taskId),
    queryFn: () => taskAPI.listArtifacts(workspaceId, projectId, taskId),
    enabled: !!workspaceId && !!projectId && !!taskId,
    staleTime: 5000, // 5 seconds
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
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
