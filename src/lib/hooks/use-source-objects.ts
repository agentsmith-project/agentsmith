/**
 * Source Objects Hooks (MinIO-like object browser)
 *
 * This is the new Sources contract direction. It intentionally does NOT include AIReady.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getApiClient, SourcesAPI } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import type { SourceObjectsListParams } from '@/lib/api/types';

export function useSourceObjects(
  workspaceId: string,
  projectId: string,
  libraryId: string | null,
  params: SourceObjectsListParams,
) {
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useQuery({
    queryKey: libraryId
      ? queryKeys.sourceObjects.list(workspaceId, projectId, libraryId, params)
      : ['source-objects', 'disabled', workspaceId, projectId, params],
    queryFn: () => {
      if (!libraryId) throw new Error('libraryId is required');
      return sourcesAPI.listObjects(workspaceId, projectId, libraryId, params);
    },
    enabled: !!workspaceId && !!projectId && !!libraryId,
    staleTime: 5_000,
  });
}

export function useCreateSourceFolder() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      prefix: string;
    }) => sourcesAPI.createFolder(vars.workspaceId, vars.projectId, vars.libraryId, vars.prefix),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sourceObjects._def,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sourceLibraries.list(vars.workspaceId, vars.projectId),
      });
    },
  });
}

export function useUploadSourceObject() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      file: File;
      prefix?: string;
      onProgress?: (progress: number) => void;
    }) =>
      sourcesAPI.uploadObject(vars.workspaceId, vars.projectId, vars.libraryId, vars.file, vars.prefix, vars.onProgress),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sourceObjects._def,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sourceLibraries.list(vars.workspaceId, vars.projectId),
      });
    },
  });
}

export function useDeleteSourceObjects() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: { workspaceId: string; projectId: string; libraryId: string; keys: string[] }) =>
      sourcesAPI.deleteObjects(vars.workspaceId, vars.projectId, vars.libraryId, vars.keys),
    onSuccess: async (_, vars) => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sourceObjects._def,
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sourceLibraries.list(vars.workspaceId, vars.projectId),
      });
    },
  });
}

export function useMoveSourceObject() {
  const queryClient = useQueryClient();
  const sourcesAPI = new SourcesAPI(getApiClient());

  return useMutation({
    mutationFn: async (vars: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      from_key: string;
      to_key: string;
      overwrite?: boolean;
    }) => sourcesAPI.moveObject(vars.workspaceId, vars.projectId, vars.libraryId, vars),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.sourceObjects._def,
      });
    },
  });
}
