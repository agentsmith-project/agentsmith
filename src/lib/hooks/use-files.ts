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
import { APIError, handleErrorForToast } from '@/lib/api/errors';
import type {
  DeleteFileLibraryResult,
  FileLibraryOperationLookup,
  FileLibraryOperationProjection,
} from '@/lib/api/types';

const FILE_LIBRARY_CONFLICT_ERROR_CODES = new Set([
  'FILE_LIBRARY_TASK_IN_USE',
  'FILE_LIBRARY_DELETING',
  'FILE_LIBRARY_NOT_EMPTY',
  'FILE_LIBRARY_NOT_READY',
  'AGENT_TASK_FILE_LIBRARY_IN_USE',
]);
const FILE_LIBRARY_DELETE_LIFECYCLE_ERROR_CODES = new Set([
  'FILE_LIBRARY_OPERATION_FAILED',
  'FILE_LIBRARY_OPERATION_PENDING_TIMEOUT',
]);
const FILE_LIBRARY_DELETE_POLL_INTERVAL_MS = 1500;
const FILE_LIBRARY_DELETE_MAX_POLL_ATTEMPTS = 40;
const FILE_LIBRARY_DELETE_SUCCESS_STATES = new Set(['succeeded', 'success', 'completed', 'ready']);
const FILE_LIBRARY_DELETE_FAILED_STATES = new Set([
  'failed',
  'failure',
  'error',
  'errored',
  'cancelled',
  'canceled',
  'operator_intervention_required',
]);

function readFileLibraryIdFromError(error: unknown) {
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
  if (
    queryKey[0] === 'file-libraries'
    && queryKey[1] === workspaceId
    && queryKey[2] === projectId
  ) {
    return true;
  }
  if (
    queryKey[0] === 'file-library'
    && queryKey[1] === workspaceId
    && queryKey[2] === projectId
  ) {
    return !libraryId || queryKey[3] === libraryId;
  }
  return false;
}

function invalidateFileLibraryCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId?: string | null,
) {
  return queryClient.invalidateQueries({
    predicate: (query) => fileLibraryQueryMatches(query.queryKey, workspaceId, projectId, libraryId),
  });
}

function isFileLibraryConflictError(error: unknown) {
  return error instanceof APIError && FILE_LIBRARY_CONFLICT_ERROR_CODES.has(error.errorCode);
}

function isFileLibraryDeleteLifecycleError(error: unknown) {
  return error instanceof APIError && FILE_LIBRARY_DELETE_LIFECYCLE_ERROR_CODES.has(error.errorCode);
}

function isFileLibraryOperationProjection(
  operation: FileLibraryOperationLookup,
): operation is FileLibraryOperationProjection {
  return 'operation_id' in operation && 'operation_state' in operation;
}

function normalizeOperationState(projection: FileLibraryOperationProjection): string {
  return projection.operation_state.trim().toLowerCase();
}

function isDeleteOperationSucceeded(projection: FileLibraryOperationProjection): boolean {
  return FILE_LIBRARY_DELETE_SUCCESS_STATES.has(normalizeOperationState(projection));
}

function isDeleteOperationFailed(projection: FileLibraryOperationProjection): boolean {
  return FILE_LIBRARY_DELETE_FAILED_STATES.has(normalizeOperationState(projection));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function createDeleteOperationError(
  libraryId: string,
  projection: FileLibraryOperationProjection,
): APIError {
  const operationState = normalizeOperationState(projection);
  const operationCode = projection.error?.code ?? (
    operationState === 'operator_intervention_required'
      ? 'operator_intervention_required'
      : 'file_library_delete_failed'
  );
  return new APIError(
    'FILE_LIBRARY_OPERATION_FAILED',
    operationCode,
    undefined,
    409,
    {
      file_library_id: libraryId,
      operation_id: projection.operation_id,
      operation_state: projection.operation_state,
      operation_error_code: projection.error?.code,
    },
  );
}

function createDeleteOperationProjectionError(
  libraryId: string,
  operationId: string,
  operation: FileLibraryOperationLookup,
): APIError {
  return new APIError(
    'FILE_LIBRARY_OPERATION_PROJECTION_INVALID',
    'file_library_delete_operation_projection_invalid',
    undefined,
    409,
    {
      file_library_id: libraryId,
      operation_id: operationId,
      operation_shape: 'kind' in operation ? operation.kind : 'restore',
    },
  );
}

async function resolveAcceptedDelete(input: {
  filesAPI: FilesAPI;
  workspaceId: string;
  projectId: string;
  libraryId: string;
  operationId: string;
}): Promise<DeleteFileLibraryResult> {
  for (let attempt = 0; attempt < FILE_LIBRARY_DELETE_MAX_POLL_ATTEMPTS; attempt += 1) {
    const operation = await input.filesAPI.getFileLibraryOperationProjection(
      input.workspaceId,
      input.projectId,
      input.operationId,
    );
    if (!isFileLibraryOperationProjection(operation)) {
      throw createDeleteOperationProjectionError(input.libraryId, input.operationId, operation);
    }
    const projection = operation;
    if (isDeleteOperationSucceeded(projection)) {
      return input.filesAPI.deleteLibrary(input.workspaceId, input.projectId, input.libraryId);
    }
    if (isDeleteOperationFailed(projection)) {
      throw createDeleteOperationError(input.libraryId, projection);
    }
    if (attempt < FILE_LIBRARY_DELETE_MAX_POLL_ATTEMPTS - 1) {
      await sleep(FILE_LIBRARY_DELETE_POLL_INTERVAL_MS);
    }
  }

  throw new APIError(
    'FILE_LIBRARY_OPERATION_PENDING_TIMEOUT',
    'file_library_delete_pending_timeout',
    undefined,
    409,
    {
      file_library_id: input.libraryId,
      operation_id: input.operationId,
    },
  );
}

export function useFileLibraries(
  workspaceId: string,
  projectId: string,
  options?: { enabled?: boolean },
) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
    queryFn: () => filesAPI.listLibraries(workspaceId, projectId),
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId,
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
    onSuccess: async (_, variables) => {
      await invalidateFileLibraryCaches(queryClient, variables.workspaceId, variables.projectId);
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
    onSuccess: async (_, variables) => {
      await invalidateFileLibraryCaches(queryClient, variables.workspaceId, variables.projectId, variables.libraryId);
      toast.success(t('update_success'));
    },
    onError: (error: unknown, variables) => {
      if (isFileLibraryConflictError(error)) {
        void invalidateFileLibraryCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      handleErrorForToast(error, 'useUpdateFileLibrary');
    },
  });
}

export function useDeleteFileLibrary() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());
  const t = useTranslations('common.toast');

  return useMutation({
    async mutationFn({
      workspaceId,
      projectId,
      libraryId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
    }) {
      const result = await filesAPI.deleteLibrary(workspaceId, projectId, libraryId);
      if (result.status === 'accepted') {
        return resolveAcceptedDelete({
          filesAPI,
          workspaceId,
          projectId,
          libraryId,
          operationId: result.operation_id,
        });
      }
      return result;
    },
    onSuccess: async (result, variables) => {
      await invalidateFileLibraryCaches(queryClient, variables.workspaceId, variables.projectId, variables.libraryId);
      if (result.status === 'deleted') {
        toast.success(t('delete_success'));
      }
    },
    onError: (error: unknown, variables) => {
      if (isFileLibraryConflictError(error)) {
        void invalidateFileLibraryCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        return;
      }
      if (isFileLibraryDeleteLifecycleError(error)) {
        void invalidateFileLibraryCaches(
          queryClient,
          variables.workspaceId,
          variables.projectId,
          readFileLibraryIdFromError(error) ?? variables.libraryId,
        );
        handleErrorForToast(error, 'useDeleteFileLibrary');
        return;
      }
      handleErrorForToast(error, 'useDeleteFileLibrary');
    },
  });
}
