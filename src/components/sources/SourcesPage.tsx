'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { QuotaSummaryCard } from './QuotaSummaryCard';
import { SourcesSearch } from './SourcesSearch';
import { SourcesFilters } from './SourcesFilters';
import { SourcesTable } from './SourcesTable';
import { SourcesSelectionBar } from './SourcesSelectionBar';
import { FileUploadDialog } from './FileUploadDialog';
import { FileDeleteDialog } from './FileDeleteDialog';
import {
  useSources,
  useQuota,
  useUploadFile,
  useDeleteFile,
  useBatchAIReadyActions,
} from '@/lib/hooks/use-sources';
import { useErrorHandler } from '@/lib/hooks/use-error-handler';
import { toast } from '@/components/ui/toast';
import type { AIReadyStatus } from '@/lib/api/types';

export interface SourcesPageProps {
  workspaceId: string;
  projectId: string;
}

export function SourcesPage({ workspaceId, projectId }: SourcesPageProps) {
  const queryClient = useQueryClient();
  const { handleError } = useErrorHandler();

  // State
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<AIReadyStatus | 'all'>('all');
  const [aiReadyOnly, setAIReadyOnly] = React.useState(false);
  const [sortBy, setSortBy] = React.useState<'updated_at' | 'file_size' | 'status'>('updated_at');
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('desc');
  const [selectedFileIds, setSelectedFileIds] = React.useState<string[]>([]);
  const [uploadDialogOpen, setUploadDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [filesToDelete, setFilesToDelete] = React.useState<{ ids: string[]; hasAIReady: boolean } | null>(null);
  const [page, setPage] = React.useState(1);
  const pageSize = 20;
  const [uploadProgress, setUploadProgress] = React.useState<Record<string, number>>({});
  const [uploadErrors, setUploadErrors] = React.useState<Record<string, string>>({});

  // Queries
  const { data: quotaData, isLoading: quotaLoading } = useQuota(workspaceId, projectId);
  const { data: sourcesData, isLoading: sourcesLoading } = useSources(workspaceId, projectId, {
    search: search || undefined,
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

  // Clear selection when page changes
  React.useEffect(() => {
    setSelectedFileIds([]);
  }, [page]);

  // Check if there are any preparing files for polling
  const hasPreparingFiles = React.useMemo(() => {
    return sourcesData?.items.some(
      (file) => file.ai_ready?.status === 'preparing',
    ) || false;
  }, [sourcesData]);

  // Poll for preparing files
  React.useEffect(() => {
    if (!hasPreparingFiles) return;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: ['sources', workspaceId, projectId],
      });
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(interval);
  }, [hasPreparingFiles, queryClient, workspaceId, projectId]);

  // Handle file upload
  const handleUpload = async (files: File[]) => {
    setUploadProgress({});
    setUploadErrors({});

    const uploadResults: Record<string, boolean> = {};

    const uploadPromises = files.map(async (file) => {
      try {
        await uploadMutation.mutateAsync({
          workspaceId,
          projectId,
          file,
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
      setTimeout(() => {
        setUploadDialogOpen(false);
        setUploadProgress({});
        setUploadErrors({});
      }, 1500);
    }
  };

  // Handle delete (single or batch)
  const handleDeleteClick = () => {
    if (selectedFileIds.length === 0) return;
    const files = sourcesData?.items.filter((f) => selectedFileIds.includes(f.id)) ?? [];
    const hasAIReady = files.some((f) => !!f.ai_ready);
    setFilesToDelete({ ids: selectedFileIds, hasAIReady });
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async (deleteAIReady: boolean) => {
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
  };

  // Check quota before batch operations
  const quotaStatus = React.useMemo(() => {
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

  const handleBatchStartAIReady = () => {
    if (selectedFileIds.length > 0 && quotaStatus.canStart) {
      batchActions.batchStart.mutate({ workspaceId, projectId, fileIds: selectedFileIds });
      setSelectedFileIds([]);
    }
  };

  const handleBatchCancelAIReady = () => {
    if (selectedFileIds.length > 0) {
      batchActions.batchCancel.mutate({ workspaceId, projectId, fileIds: selectedFileIds });
      setSelectedFileIds([]);
    }
  };

  // Handle download
  const handleDownload = async (fileId: string) => {
    try {
      const sourcesAPI = new (await import('@/lib/api')).SourcesAPI(
        (await import('@/lib/api')).getApiClient(),
      );
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
  };

  const items = sourcesData?.items ?? [];
  const total = sourcesData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasNext = page < totalPages;
  const hasPrev = page > 1;

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header with Quota and Upload */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-foreground mb-3">Sources</h1>
          {quotaData && !quotaLoading && <QuotaSummaryCard quota={quotaData} />}
        </div>
        <Button
          onClick={() => setUploadDialogOpen(true)}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Upload
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex-1 max-w-md">
          <SourcesSearch value={search} onChange={setSearch} />
        </div>
        <SourcesFilters
          status={status}
          onStatusChange={setStatus}
          aiReadyOnly={aiReadyOnly}
          onAIReadyOnlyChange={setAIReadyOnly}
          sortBy={sortBy}
          onSortByChange={setSortBy}
          sortOrder={sortOrder}
          onSortOrderChange={setSortOrder}
        />
      </div>

      {/* Table + selection bar (bar overlays bottom, no layout shift) */}
      <div className="flex-1 min-h-0 flex flex-col relative">
        <div
          className={cn(
            'flex-1 min-h-0 overflow-auto transition-[padding] duration-200',
            selectedFileIds.length > 0 && 'pb-14',
          )}
        >
          <SourcesTable
            data={items}
            loading={sourcesLoading}
            compact
            selectedIds={selectedFileIds}
            onRowSelect={setSelectedFileIds}
            onUploadClick={() => setUploadDialogOpen(true)}
          />
        </div>

        {/* Selection bar: fixed at bottom of table area, overlays content (no layout shift) */}
        {selectedFileIds.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-subtle bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
            <SourcesSelectionBar
                overlay
                selectedIds={selectedFileIds}
                files={items}
                quotaExceeded={!quotaStatus.canStart}
                onDelete={handleDeleteClick}
                onStartAIReady={handleBatchStartAIReady}
                onCancelAIReady={handleBatchCancelAIReady}
                onDownload={handleDownload}
                onClearSelection={() => setSelectedFileIds([])}
                batchStartPending={batchActions.batchStart.isPending}
                batchCancelPending={batchActions.batchCancel.isPending}
              />
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-subtle">
          <span className="text-sm text-tertiary">
            {total} file(s) · page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!hasPrev}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={!hasNext}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Dialogs */}
      <FileUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={handleUpload}
        uploading={uploadMutation.isPending}
        uploadProgress={uploadProgress}
        uploadErrors={uploadErrors}
      />

      {filesToDelete && (
        <FileDeleteDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          filename={filesToDelete.ids.length === 1 ? sourcesData?.items.find((f) => f.id === filesToDelete!.ids[0])?.filename : undefined}
          hasAIReady={filesToDelete.hasAIReady}
          fileCount={filesToDelete.ids.length}
          deleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
