/**
 * Sources List Hook
 *
 * Business logic for sources page:
 * - Fetch sources and quota data
 * - Manage local state (selection, filters, pagination, dialogs)
 * - Handle file actions (upload, delete, download, AI ready batch operations)
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
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
import { queryKeys } from '@/lib/query-keys';
import type { AIReadyStatus } from '@/lib/api/types';
import { getResourcePolicyStatus, type ResourcePolicyStatusMeta } from '@/lib/constants/resource-policy';

export interface UseSourcesListOptions {
  workspaceId: string;
  projectId: string;
}

export function useSourcesList({ workspaceId, projectId }: UseSourcesListOptions) {
  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 20;

  // Filters
  const [search, setSearch] = useState('');
  const [selectedLibraryId, setSelectedLibraryId] = useState('all');
  const [status, setStatus] = useState<AIReadyStatus | 'all'>('all');
  const [aiReadyOnly, setAIReadyOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'updated_at' | 'file_size' | 'status'>('updated_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Selection
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  // Dialogs
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [filesToDelete, setFilesToDelete] = useState<{ ids: string[]; hasAIReady: boolean } | null>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = useState<Record<string, string>>({});
  const uploadCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (uploadCloseTimerRef.current) clearTimeout(uploadCloseTimerRef.current);
    };
  }, []);

  // Data fetching
  const { data: quotaData, isLoading: quotaLoading } = useQuota(workspaceId, projectId);
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

  // Clear selection when page changes
  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
    setSelectedFileIds([]);
  }, []);

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
          [file.name]: error instanceof Error ? error.message : 'Upload failed',
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
  }, [uploadMutation, workspaceId, projectId, selectedLibraryId, handleError]);

  // Handle delete (single or batch)
  const handleDeleteClick = useCallback(() => {
    if (selectedFileIds.length === 0) return;
    const files = sourcesData?.items.filter((f) => selectedFileIds.includes(f.id)) ?? [];
    const hasAIReady = files.some((f) => !!f.ai_ready);
    setFilesToDelete({ ids: selectedFileIds, hasAIReady });
    setDeleteDialogOpen(true);
  }, [selectedFileIds, sourcesData]);

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
      toast.error(`Failed to delete ${failed} file(s)`);
    }
  }, [filesToDelete, deleteMutation, workspaceId, projectId]);

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
  }, [selectedFileIds, quotaStatus.canStart, batchActions.batchStart, workspaceId, projectId]);

  const handleBatchCancelAIReady = useCallback(() => {
    if (selectedFileIds.length > 0) {
      batchActions.batchCancel.mutate({ workspaceId, projectId, fileIds: selectedFileIds });
      setSelectedFileIds([]);
    }
  }, [selectedFileIds, batchActions.batchCancel, workspaceId, projectId]);

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

      toast.success('File downloaded successfully');
    } catch (error) {
      handleError(error, { logContext: 'SourcesPage.download' });
    }
  }, [workspaceId, projectId, sourcesData, handleError]);

  const handleToggleSelection = useCallback((fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId]
    );
  }, []);

  const handleToggleAll = useCallback(() => {
    const items = sourcesData?.items ?? [];
    setSelectedFileIds((prev) =>
      prev.length > 0 ? [] : items.map((f) => f.id)
    );
  }, [sourcesData]);

  const clearSelection = useCallback(() => {
    setSelectedFileIds([]);
  }, []);

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
  }, [deleteLibraryMutation, workspaceId, projectId, selectedLibraryId]);

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
