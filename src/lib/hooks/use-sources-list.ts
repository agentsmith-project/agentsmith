/**
 * Sources List Hook
 *
 * Business logic for sources page:
 * - Fetch sources and quota data
 * - Manage local state (selection, filters, pagination, dialogs)
 * - Handle file actions (upload, delete, download, AI ready batch operations)
 */

import { useCallback, useMemo, useEffect } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import {
  useSources,
  useQuota,
  useUploadFile,
  useDeleteFile,
  useBatchAIReadyActions,
  useSourceLibraries,
  useCreateSourceLibrary,
  useUpdateSourceLibrary,
  useDeleteSourceLibrary,
} from './use-sources';
import { useErrorHandler } from './use-error-handler';
import { toast } from '@/components/ui/toast';
import { MemberAPI, SourcesAPI, getApiClient } from '@/lib/api';
import { APIError, resolveApiErrorPresentation } from '@/lib/api/errors';
import { queryKeys } from '@/lib/query-keys';
import { getResourcePolicyStatus, type ResourcePolicyStatusMeta } from '@/lib/constants/resource-policy';
import { useSourcesQueryState } from './use-sources-query-state';

export interface UseSourcesListOptions {
  workspaceId: string;
  projectId: string;
}

export function useSourcesList({ workspaceId, projectId }: UseSourcesListOptions) {
  const queryClient = useQueryClient();
  const t = useTranslations('sources');
  const tErrors = useTranslations('errors');
  const { handleError } = useErrorHandler();
  const resolveErrorDetail = useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof APIError) {
        const resolved = resolveApiErrorPresentation({
          error,
          t: tErrors,
          fallbackMessage: fallback,
        });
        return resolved.description;
      }
      if (error instanceof Error) return error.message || fallback;
      return fallback;
    },
    [tErrors],
  );
  const {
    page,
    setPage,
    pageSize,
    search,
    setSearch,
    selectedLibraryId,
    setSelectedLibraryId,
    status,
    setStatus,
    aiReadyOnly,
    setAIReadyOnly,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    selectedFileIds,
    setSelectedFileIds,
    uploadDialogOpen,
    setUploadDialogOpen,
    deleteDialogOpen,
    setDeleteDialogOpen,
    filesToDelete,
    setFilesToDelete,
    uploadProgress,
    setUploadProgress,
    uploadErrors,
    setUploadErrors,
    uploadCloseTimerRef,
    handlePageChange,
  } = useSourcesQueryState();

  // Data fetching
  const { data: quotaData, isLoading: quotaLoading } = useQuota(
    workspaceId,
    projectId,
    selectedLibraryId === 'all' ? undefined : selectedLibraryId,
  );
  const { data: librariesData } = useSourceLibraries(workspaceId, projectId);
  const memberAPI = useMemo(() => new MemberAPI(getApiClient()), []);
  const { data: sourcesData, isLoading: sourcesLoading } = useSources(workspaceId, projectId, {
    search: search || undefined,
    library_id: selectedLibraryId === 'all' ? undefined : selectedLibraryId,
    status: status !== 'all' ? status : undefined,
    ai_ready_only: aiReadyOnly || undefined,
    sort_by: sortBy,
    sort_order: sortOrder,
    page,
    page_size: pageSize,
  });

  // Mutations
  const uploadMutation = useUploadFile();
  const deleteMutation = useDeleteFile();
  const batchActions = useBatchAIReadyActions();
  const createLibraryMutation = useCreateSourceLibrary();
  const updateLibraryMutation = useUpdateSourceLibrary();
  const deleteLibraryMutation = useDeleteSourceLibrary();

  // Check if there are any preparing files for polling
  const hasPreparingFiles = useMemo(() => {
    return sourcesData?.items.some(
      (file) => file.ai_ready?.status === 'preparing',
    ) || false;
  }, [sourcesData]);

  // Poll for preparing files
  useEffect(() => {
    if (!hasPreparingFiles) return;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.sources.list(workspaceId, projectId),
      });
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [hasPreparingFiles, queryClient, workspaceId, projectId]);

  // Handle file upload
  const handleUpload = useCallback(async (files: File[]) => {
    setUploadProgress({});
    setUploadErrors({});

    const uploadResults: Record<string, boolean> = {};

    const uploadPromises = files.map(async (file) => {
      try {
        await uploadMutation.mutateAsync({
          workspaceId,
          projectId,
          file,
          libraryId: selectedLibraryId === 'all' ? undefined : selectedLibraryId,
          onProgress: (progress) => {
            setUploadProgress((prev) => ({ ...prev, [file.name]: progress }));
          },
        });
        // Mark as complete
        setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }));
        uploadResults[file.name] = true;
      } catch (error) {
        handleError(error, { logContext: 'SourcesPage.upload', showToast: false });
        setUploadErrors((prev) => ({
          ...prev,
          [file.name]: resolveErrorDetail(error, t('file_manager.upload_failed')),
        }));
        uploadResults[file.name] = false;
      }
    });

    // Wait for all uploads to complete
    await Promise.allSettled(uploadPromises);

    // Check if all uploads succeeded
    const allSucceeded = Object.values(uploadResults).every((success) => success);

    // Close dialog only if all succeeded, or after showing errors for a bit
    if (allSucceeded) {
      uploadCloseTimerRef.current = setTimeout(() => {
        setUploadDialogOpen(false);
        setUploadProgress({});
        setUploadErrors({});
        uploadCloseTimerRef.current = null;
      }, 1500);
    }
  }, [
    uploadMutation,
    workspaceId,
    projectId,
    selectedLibraryId,
    handleError,
    setUploadDialogOpen,
    setUploadProgress,
    setUploadErrors,
    uploadCloseTimerRef,
  ]);

  // Handle delete (single or batch)
  const handleDeleteClick = useCallback(() => {
    if (selectedFileIds.length === 0) return;
    const files = sourcesData?.items.filter((f) => selectedFileIds.includes(f.id)) ?? [];
    const hasAIReady = files.some((f) => !!f.ai_ready);
    setFilesToDelete({ ids: selectedFileIds, hasAIReady });
    setDeleteDialogOpen(true);
  }, [selectedFileIds, sourcesData, setFilesToDelete, setDeleteDialogOpen]);

  const handleConfirmDelete = useCallback(async (deleteAIReady: boolean) => {
    if (!filesToDelete) return;
    let failed = 0;
    for (const fileId of filesToDelete.ids) {
      try {
        await deleteMutation.mutateAsync({
          workspaceId,
          projectId,
          fileId,
          deleteAIReady,
        });
      } catch {
        failed += 1;
      }
    }
    setDeleteDialogOpen(false);
    setFilesToDelete(null);
    setSelectedFileIds([]);
    if (failed > 0) {
      toast.error(t('file_manager.delete_partial_failed', { failed: String(failed) }));
    }
  }, [deleteMutation, filesToDelete, projectId, setDeleteDialogOpen, setFilesToDelete, setSelectedFileIds, t, workspaceId]);

  // Check quota before batch operations
  const quotaStatus = useMemo(() => {
    if (!quotaData) return { canStart: true, exceededTypes: [] };

    const exceededTypes: string[] = [];
    if (quotaData.storage.used >= quotaData.storage.limit) {
      exceededTypes.push('Storage');
    }
    if (quotaData.docdb.used >= quotaData.docdb.limit) {
      exceededTypes.push('DocDB');
    }
    if (quotaData.vectordb.used >= quotaData.vectordb.limit) {
      exceededTypes.push('VectorDB');
    }

    return {
      canStart: exceededTypes.length === 0,
      exceededTypes,
    };
  }, [quotaData]);

  const handleBatchStartAIReady = useCallback(() => {
    if (selectedFileIds.length > 0 && quotaStatus.canStart) {
      batchActions.batchStart.mutate({ workspaceId, projectId, fileIds: selectedFileIds });
      setSelectedFileIds([]);
    }
  }, [selectedFileIds, quotaStatus.canStart, batchActions.batchStart, workspaceId, projectId, setSelectedFileIds]);

  const handleBatchCancelAIReady = useCallback(() => {
    if (selectedFileIds.length > 0) {
      batchActions.batchCancel.mutate({ workspaceId, projectId, fileIds: selectedFileIds });
      setSelectedFileIds([]);
    }
  }, [selectedFileIds, batchActions.batchCancel, workspaceId, projectId, setSelectedFileIds]);

  // Handle download
  const handleDownload = useCallback(async (fileId: string) => {
    try {
      const sourcesAPI = new SourcesAPI(getApiClient());
      const blob = await sourcesAPI.download(workspaceId, projectId, fileId);

      // Create download link
      const file = sourcesData?.items.find((f) => f.id === fileId);
      const filename = file?.filename || 'download';
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success(t('file_manager.download_success'));
    } catch (error) {
      handleError(error, { logContext: 'SourcesPage.download' });
    }
  }, [workspaceId, projectId, sourcesData, handleError, t]);

  const handleToggleSelection = useCallback((fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId]
    );
  }, [setSelectedFileIds]);

  const handleToggleAll = useCallback(() => {
    const items = sourcesData?.items ?? [];
    setSelectedFileIds((prev) =>
      prev.length > 0 ? [] : items.map((f) => f.id)
    );
  }, [sourcesData, setSelectedFileIds]);

  const clearSelection = useCallback(() => {
    setSelectedFileIds([]);
  }, [setSelectedFileIds]);

  const handleCreateLibrary = useCallback(async (name: string, description?: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await createLibraryMutation.mutateAsync({
      workspaceId,
      projectId,
      name: trimmedName,
      description,
    });
  }, [createLibraryMutation, workspaceId, projectId]);

  const handleRenameLibrary = useCallback(async (libraryId: string, name: string, description?: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    await updateLibraryMutation.mutateAsync({
      workspaceId,
      projectId,
      libraryId,
      name: trimmedName,
      description,
    });
  }, [updateLibraryMutation, workspaceId, projectId]);

  const handleDeleteLibrary = useCallback(async (libraryId: string) => {
    await deleteLibraryMutation.mutateAsync({
      workspaceId,
      projectId,
      libraryId,
    });
    if (selectedLibraryId === libraryId) {
      setSelectedLibraryId('all');
    }
  }, [deleteLibraryMutation, workspaceId, projectId, selectedLibraryId, setSelectedLibraryId]);

  // Computed values
  const items = useMemo(() => sourcesData?.items ?? [], [sourcesData?.items]);
  const libraries = useMemo(() => librariesData?.items ?? [], [librariesData?.items]);
  const libraryPolicyQueries = useQueries({
    queries: libraries.map((library) => ({
      queryKey: ['resource-policy', 'source-library', workspaceId, projectId, library.id],
      queryFn: () => memberAPI.getResourcePolicy(workspaceId, projectId, 'source_library', library.id),
      enabled: !!workspaceId && !!projectId && !!library.id,
      staleTime: 30 * 1000,
    })),
  });
  const libraryPolicyStatusById = useMemo<Record<string, ResourcePolicyStatusMeta>>(() => {
    const map: Record<string, ResourcePolicyStatusMeta> = {};
    libraries.forEach((library, index) => {
      map[library.id] = getResourcePolicyStatus(libraryPolicyQueries[index]?.data);
    });
    return map;
  }, [libraries, libraryPolicyQueries]);
  const libraryPolicyLoadingById = useMemo<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    libraries.forEach((library, index) => {
      map[library.id] = !!libraryPolicyQueries[index]?.isLoading;
    });
    return map;
  }, [libraries, libraryPolicyQueries]);
  const total = sourcesData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  const allSelected = items.length > 0 && selectedFileIds.length === items.length;
  const someSelected = selectedFileIds.length > 0 && selectedFileIds.length < items.length;

  return {
    // Data
    quotaData,
    quotaLoading,
    items,
    total,
    sourcesLoading,

    // Pagination
    page,
    pageSize,
    totalPages,
    hasNext,
    hasPrev,
    handlePageChange,
    setPage,

    // Filters
    search,
    selectedLibraryId,
    status,
    aiReadyOnly,
    sortBy,
    sortOrder,
    setSearch,
    setSelectedLibraryId,
    setStatus,
    setAIReadyOnly,
    setSortBy,
    setSortOrder,

    // Selection
    selectedFileIds,
    allSelected,
    someSelected,
    setSelectedFileIds,
    handleToggleSelection,
    handleToggleAll,
    clearSelection,

    // Dialogs
    uploadDialogOpen,
    deleteDialogOpen,
    filesToDelete,
    setUploadDialogOpen,
    setDeleteDialogOpen,
    setFilesToDelete,

    // Upload state
    uploadProgress,
    uploadErrors,
    uploading: uploadMutation.isPending,

    // Mutation states
    deleting: deleteMutation.isPending,
    batchStartPending: batchActions.batchStart.isPending,
    batchCancelPending: batchActions.batchCancel.isPending,

    // Quota status
    quotaStatus,
    libraries,
    libraryPolicyStatusById,
    libraryPolicyLoadingById,
    creatingLibrary: createLibraryMutation.isPending,
    updatingLibrary: updateLibraryMutation.isPending,
    deletingLibrary: deleteLibraryMutation.isPending,

    // Actions
    handleUpload,
    handleDeleteClick,
    handleConfirmDelete,
    handleBatchStartAIReady,
    handleBatchCancelAIReady,
    handleDownload,
    handleCreateLibrary,
    handleRenameLibrary,
    handleDeleteLibrary,
  };
}

export type UseSourcesListReturn = ReturnType<typeof useSourcesList>;
