'use client';
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Play, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { QuotaSummaryCard } from './QuotaSummaryCard';
import { SourcesSearch } from './SourcesSearch';
import { SourcesFilters } from './SourcesFilters';
import { SourcesTable } from './SourcesTable';
import { FileUploadDialog } from './FileUploadDialog';
import { FileDeleteDialog } from './FileDeleteDialog';
import { BatchActionBar } from './BatchActionBar';
import {
  useSources,
  useQuota,
  useUploadFile,
  useDeleteFile,
  useAIReadyActions,
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
  const [fileToDelete, setFileToDelete] = React.useState<{ id: string; filename: string; hasAIReady: boolean } | null>(null);
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
    page_size: 50,
  });

  // Mutations
  const uploadMutation = useUploadFile();
  const deleteMutation = useDeleteFile();
  const aiReadyActions = useAIReadyActions();
  const batchActions = useBatchAIReadyActions();

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

  // Handle file delete
  const handleDelete = (fileId: string) => {
    const file = sourcesData?.items.find((f) => f.id === fileId);
    if (file) {
      setFileToDelete({
        id: file.id,
        filename: file.filename,
        hasAIReady: !!file.ai_ready,
      });
      setDeleteDialogOpen(true);
    }
  };

  const handleConfirmDelete = (deleteAIReady: boolean) => {
    if (fileToDelete) {
      deleteMutation.mutate(
        {
          workspaceId,
          projectId,
          fileId: fileToDelete.id,
          deleteAIReady,
        },
        {
          onSuccess: () => {
            setDeleteDialogOpen(false);
            setFileToDelete(null);
          },
        },
      );
    }
  };

  // Handle AIReady actions
  const handleStartAIReady = (fileId: string) => {
    aiReadyActions.start.mutate({ workspaceId, projectId, fileId });
  };

  const handleCancelAIReady = (fileId: string) => {
    aiReadyActions.cancel.mutate({ workspaceId, projectId, fileId });
  };

  const handleRetryAIReady = (fileId: string) => {
    aiReadyActions.retry.mutate({ workspaceId, projectId, fileId });
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

  // Handle batch actions
  const handleBatchStartAIReady = () => {
    if (selectedFileIds.length > 0) {
      if (!canStartAIReady) {
        // Show error toast
        return;
      }
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

  return (
    <div className="h-full flex flex-col p-6">
      {/* Header with Quota and Actions */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-foreground mb-4">Sources</h1>
          {quotaData && !quotaLoading && <QuotaSummaryCard quota={quotaData} />}
        </div>
        <TooltipProvider>
          <div className="flex items-center gap-2">
            {selectedFileIds.length > 0 && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="outline"
                        onClick={handleBatchStartAIReady}
                        disabled={!quotaStatus.canStart || batchActions.batchStart.isPending}
                        className="flex items-center gap-2"
                      >
                        {batchActions.batchStart.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Start AIReady ({selectedFileIds.length})
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {!quotaStatus.canStart && quotaStatus.exceededTypes.length > 0 && (
                    <TooltipContent>
                      <p>
                        Quota exceeded: {quotaStatus.exceededTypes.join(', ')}. Cannot start AIReady.
                      </p>
                    </TooltipContent>
                  )}
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="outline"
                        onClick={handleBatchCancelAIReady}
                        disabled={batchActions.batchCancel.isPending}
                        className="flex items-center gap-2"
                      >
                        <X className="h-4 w-4" />
                        Cancel AIReady ({selectedFileIds.length})
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {batchActions.batchCancel.isPending && (
                    <TooltipContent>
                      <p>Cancelling AIReady...</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </>
            )}
            <Button
              onClick={() => setUploadDialogOpen(true)}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Upload
            </Button>
          </div>
        </TooltipProvider>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center gap-4 mb-4">
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

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <SourcesTable
          data={sourcesData?.items || []}
          loading={sourcesLoading}
          onRowSelect={setSelectedFileIds}
          onStartAIReady={handleStartAIReady}
          onCancelAIReady={handleCancelAIReady}
          onRetryAIReady={handleRetryAIReady}
          onDelete={handleDelete}
          onDownload={handleDownload}
          onUploadClick={() => setUploadDialogOpen(true)}
        />
      </div>

      {/* Dialogs */}
      <FileUploadDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        onUpload={handleUpload}
        uploading={uploadMutation.isPending}
        uploadProgress={uploadProgress}
        uploadErrors={uploadErrors}
      />

      {fileToDelete && (
        <FileDeleteDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          filename={fileToDelete.filename}
          hasAIReady={fileToDelete.hasAIReady}
          deleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
