/**
 * File Objects Hooks (MinIO-like object browser)
 *
 * This is the current Files contract direction.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApiClient, FilesAPI } from '@/lib/api';
import { APIError } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';
import type { FileObjectsListParams } from '@/lib/api/types';

type FileObjectsQueryOptions = {
  enabled?: boolean;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
  refetchOnWindowFocus?: boolean;
};

const FILE_WRITE_CONFLICT_ERROR_CODES = new Set([
  'FILE_LIBRARY_DELETING',
  'FILE_LIBRARY_NOT_READY',
  'FILE_LIBRARY_NOT_EMPTY',
  'FILE_LIBRARY_TASK_IN_USE',
  'FILE_LIBRARY_FORBIDDEN',
]);

function isFileWriteConflictError(error: unknown) {
  return error instanceof APIError && FILE_WRITE_CONFLICT_ERROR_CODES.has(error.errorCode);
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

function invalidateWriteConflictCachesInBackground(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId?: string | null,
) {
  void Promise.allSettled([
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileObjects._def,
    }),
    queryClient.invalidateQueries({
      predicate: (query) => fileLibraryQueryMatches(query.queryKey, workspaceId, projectId, libraryId),
    }),
  ]);
}

function invalidateFileObjectCachesInBackground(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
) {
  void Promise.allSettled([
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileObjects._def,
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
    }),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeFileObjectPrefix(prefix: unknown) {
  return typeof prefix === 'string' ? prefix : '';
}

function fileObjectQueryKeyMatchesTargetPrefix(
  queryKey: readonly unknown[],
  workspaceId: string,
  projectId: string,
  libraryId: string,
  prefix: string,
) {
  if (queryKey[0] !== 'file-objects') return false;

  const keyShape = queryKey[1] === 'infinite'
    ? {
        workspaceId: queryKey[2],
        projectId: queryKey[3],
        libraryId: queryKey[4],
        params: queryKey[5],
      }
    : {
        workspaceId: queryKey[1],
        projectId: queryKey[2],
        libraryId: queryKey[3],
        params: queryKey[4],
      };

  if (
    keyShape.workspaceId !== workspaceId
    || keyShape.projectId !== projectId
    || keyShape.libraryId !== libraryId
  ) {
    return false;
  }

  if (!isRecord(keyShape.params)) {
    return prefix === '';
  }
  return normalizeFileObjectPrefix(keyShape.params.prefix) === prefix;
}

function invalidateUploadTargetFileObjectCachesInBackground(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  projectId: string,
  libraryId: string,
  prefix?: string,
) {
  const normalizedPrefix = prefix ?? '';
  void Promise.allSettled([
    queryClient.invalidateQueries({
      predicate: (query) => fileObjectQueryKeyMatchesTargetPrefix(
        query.queryKey,
        workspaceId,
        projectId,
        libraryId,
        normalizedPrefix,
      ),
      refetchType: 'active',
    }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.fileLibraries.list(workspaceId, projectId),
    }),
  ]);
}

function invalidateFileObjectsOnlyInBackground(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.fileObjects._def,
  });
}

export function useFileObjects(
  workspaceId: string,
  projectId: string,
  libraryId: string | null,
  params: FileObjectsListParams,
  options?: FileObjectsQueryOptions,
) {
  const filesAPI = new FilesAPI(getApiClient());

  return useQuery({
    queryKey: libraryId
      ? queryKeys.fileObjects.list(workspaceId, projectId, libraryId, params)
      : ['file-objects', 'disabled', workspaceId, projectId, params],
    queryFn: ({ signal }) => {
      if (!libraryId) throw new Error('libraryId is required');
      return filesAPI.listObjects(workspaceId, projectId, libraryId, params, { signal });
    },
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!libraryId,
    staleTime: 5_000,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
  });
}

export function useFileObjectsInfinite(
  workspaceId: string,
  projectId: string,
  libraryId: string | null,
  params: Omit<FileObjectsListParams, 'continuation_token'>,
  options?: FileObjectsQueryOptions,
) {
  const filesAPI = new FilesAPI(getApiClient());

  return useInfiniteQuery({
    queryKey: libraryId
      ? ['file-objects', 'infinite', workspaceId, projectId, libraryId, params]
      : ['file-objects', 'infinite', 'disabled', workspaceId, projectId, params],
    queryFn: ({ pageParam, signal }) => {
      if (!libraryId) throw new Error('libraryId is required');
      return filesAPI.listObjects(workspaceId, projectId, libraryId, {
        ...params,
        continuation_token: typeof pageParam === 'string' ? pageParam : undefined,
      }, { signal });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_continuation_token ?? undefined,
    enabled: (options?.enabled ?? true) && !!workspaceId && !!projectId && !!libraryId,
    staleTime: 5_000,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
  });
}

export function useCreateFileFolder() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      prefix: string;
    }) => filesAPI.createFolder(vars.workspaceId, vars.projectId, vars.libraryId, vars.prefix),
    onSuccess: (_, vars) => {
      invalidateFileObjectCachesInBackground(queryClient, vars.workspaceId, vars.projectId);
    },
    onError: (error, vars) => {
      if (isFileWriteConflictError(error)) {
        invalidateWriteConflictCachesInBackground(queryClient, vars.workspaceId, vars.projectId, vars.libraryId);
      }
    },
  });
}

export function useUploadFileObject() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      file: File;
      prefix?: string;
      overwrite?: boolean;
      signal?: AbortSignal;
      onProgress?: (progress: number) => void;
    }) =>
      filesAPI.uploadObject(
        vars.workspaceId,
        vars.projectId,
        vars.libraryId,
        vars.file,
        vars.prefix,
        vars.overwrite,
        vars.signal,
        vars.onProgress,
      ),
    onSuccess: (_, vars) => {
      invalidateUploadTargetFileObjectCachesInBackground(
        queryClient,
        vars.workspaceId,
        vars.projectId,
        vars.libraryId,
        vars.prefix,
      );
    },
    onError: (error, vars) => {
      if (isFileWriteConflictError(error)) {
        invalidateWriteConflictCachesInBackground(queryClient, vars.workspaceId, vars.projectId, vars.libraryId);
      }
    },
  });
}

export function useDeleteFileObjects() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: { workspaceId: string; projectId: string; libraryId: string; keys: string[] }) =>
      filesAPI.deleteObjects(vars.workspaceId, vars.projectId, vars.libraryId, vars.keys),
    onSuccess: (_, vars) => {
      invalidateFileObjectCachesInBackground(queryClient, vars.workspaceId, vars.projectId);
    },
    onError: (error, vars) => {
      if (isFileWriteConflictError(error)) {
        invalidateWriteConflictCachesInBackground(queryClient, vars.workspaceId, vars.projectId, vars.libraryId);
      }
    },
  });
}

export function useMoveFileObject() {
  const queryClient = useQueryClient();
  const filesAPI = new FilesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      from_key: string;
      to_key: string;
      overwrite?: boolean;
    }) => filesAPI.moveObject(vars.workspaceId, vars.projectId, vars.libraryId, vars),
    onSuccess: () => {
      invalidateFileObjectsOnlyInBackground(queryClient);
    },
    onError: (error, vars) => {
      if (isFileWriteConflictError(error)) {
        invalidateWriteConflictCachesInBackground(queryClient, vars.workspaceId, vars.projectId, vars.libraryId);
      }
    },
  });
}
