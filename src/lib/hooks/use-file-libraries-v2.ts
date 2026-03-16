import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { FileLibrariesAPI, getApiClient } from '@/lib/api';
import type {
  CreateFileLibraryRequest,
  FileLibraryEntriesListParams,
  MoveFileLibraryEntryRequest,
  UpdateFileLibraryRequest,
} from '@/lib/api/types';
import { queryKeys } from '@/lib/query-keys';
import { handleErrorForToast } from '@/lib/api/errors';
import { toast } from '@/components/ui/toast';

export function useV2FileLibraries(workspaceId: string, projectId: string) {
  const api = new FileLibrariesAPI(getApiClient());

  return useQuery({
    queryKey: ['v2', ...queryKeys.fileLibraries.list(workspaceId, projectId)],
    queryFn: () => api.list(workspaceId, projectId),
    enabled: !!workspaceId && !!projectId,
    staleTime: 10000,
  });
}

export function useCreateV2FileLibrary() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      body,
    }: {
      workspaceId: string;
      projectId: string;
      body: CreateFileLibraryRequest;
    }) => api.create(workspaceId, projectId, body),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2', ...queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId)],
      });
      toast.success(t('create_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useCreateV2FileLibrary');
    },
  });
}

export function useUpdateV2FileLibrary() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      body,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      body: UpdateFileLibraryRequest;
    }) => api.update(workspaceId, projectId, libraryId, body),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2', ...queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId)],
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useUpdateV2FileLibrary');
    },
  });
}

export function useDeleteV2FileLibrary() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
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
    }) => api.delete(workspaceId, projectId, libraryId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2', ...queryKeys.fileLibraries.list(variables.workspaceId, variables.projectId)],
      });
      toast.success(t('delete_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useDeleteV2FileLibrary');
    },
  });
}

export function useV2FileLibraryEntries(
  workspaceId: string,
  projectId: string,
  libraryId: string | null,
  params?: FileLibraryEntriesListParams,
) {
  const api = new FileLibrariesAPI(getApiClient());

  return useQuery({
    queryKey: ['v2-file-entries', workspaceId, projectId, libraryId, params] as const,
    queryFn: () => api.listEntries(workspaceId, projectId, libraryId!, params),
    enabled: !!workspaceId && !!projectId && !!libraryId,
    staleTime: 5000,
  });
}

export function useMoveV2FileLibraryEntry() {
  const api = new FileLibrariesAPI(getApiClient());
  const queryClient = useQueryClient();
  const t = useTranslations('common.toast');

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
      body,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
      body: MoveFileLibraryEntryRequest;
    }) => api.moveEntry(workspaceId, projectId, libraryId, body),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: ['v2-file-entries', variables.workspaceId, variables.projectId, variables.libraryId],
      });
      toast.success(t('update_success'));
    },
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useMoveV2FileLibraryEntry');
    },
  });
}

export function useFileLibraryStorageCredentialExchange() {
  const api = new FileLibrariesAPI(getApiClient());

  return useMutation({
    mutationFn: ({
      workspaceId,
      projectId,
      libraryId,
    }: {
      workspaceId: string;
      projectId: string;
      libraryId: string;
    }) => api.exchangeStorageCredentials(workspaceId, projectId, libraryId),
    onError: (error: unknown) => {
      handleErrorForToast(error, 'useFileLibraryStorageCredentialExchange');
    },
  });
}
