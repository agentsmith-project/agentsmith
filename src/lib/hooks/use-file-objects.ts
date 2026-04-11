/**
 * File Objects Hooks (MinIO-like object browser)
 *
 * This is the current Files contract direction.
 */

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApiClient, FilesAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { FileObjectsListParams } from '@/lib/api/types';

type FileObjectsQueryOptions = {
  enabled?: boolean;
  refetchInterval?: number | false;
  refetchIntervalInBackground?: boolean;
  refetchOnWindowFocus?: boolean;
};

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
    queryFn: () => {
      if (!libraryId) throw new Error('libraryId is required');
      return filesAPI.listObjects(workspaceId, projectId, libraryId, params);
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
    queryFn: ({ pageParam }) => {
      if (!libraryId) throw new Error('libraryId is required');
      return filesAPI.listObjects(workspaceId, projectId, libraryId, {
        ...params,
        continuation_token: typeof pageParam === 'string' ? pageParam : undefined,
      });
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
      invalidateFileObjectCachesInBackground(queryClient, vars.workspaceId, vars.projectId);
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
  });
}
