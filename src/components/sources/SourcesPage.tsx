/**
 * Sources Page - Compound Component
 *
 * Root component that provides context to child components.
 */

'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SourcesProvider, useSourcesContext } from './SourcesContext';
import { useSourcesList } from '@/lib/hooks/use-sources-list';
import { QuotaSummaryCard } from './QuotaSummaryCard';
import { SourcesSearch } from './SourcesSearch';
import { SourcesFilters } from './SourcesFilters';
import { SourcesTable } from './SourcesTable';
import { SourcesSelectionBar } from './SourcesSelectionBar';
import { FileUploadDialog } from './FileUploadDialog';
import { FileDeleteDialog } from './FileDeleteDialog';

export interface SourcesPageProps {
  workspaceId: string;
  projectId: string;
}

function SourcesPageContent({ workspaceId, projectId }: SourcesPageProps) {
  const contextValue = useSourcesList({ workspaceId, projectId });

  return (
    <SourcesProvider value={contextValue}>
      <div className="h-full flex flex-col p-6">
        <SourcesPageHeader />
        <SourcesPageFilters />
        <SourcesPageTableSection />
        <SourcesPagePagination />
        <SourcesPageDialogs />
      </div>
    </SourcesProvider>
  );
}

/**
 * Header with Quota and Upload button
 */
function SourcesPageHeader() {
  const context = useSourcesContext();

  return (
    <div className="flex items-start justify-between mb-4">
      <div className="flex-1">
        <h1 className="text-2xl font-semibold text-foreground mb-3">Sources</h1>
        {context.quotaData && !context.quotaLoading && <QuotaSummaryCard quota={context.quotaData} />}
      </div>
      <Button
        onClick={() => context.setUploadDialogOpen(true)}
        className="flex items-center gap-2"
        data-testid="sources__upload-btn"
      >
        <Plus className="h-4 w-4" />
        Upload
      </Button>
    </div>
  );
}

/**
 * Search and Filters section
 */
function SourcesPageFilters() {
  const context = useSourcesContext();

  return (
    <div className="flex items-center gap-4 mb-3">
      <div className="flex-1 max-w-md">
        <SourcesSearch value={context.search} onChange={context.setSearch} />
      </div>
      <SourcesFilters
        status={context.status}
        onStatusChange={context.setStatus}
        aiReadyOnly={context.aiReadyOnly}
        onAIReadyOnlyChange={context.setAIReadyOnly}
        sortBy={context.sortBy}
        onSortByChange={context.setSortBy}
        sortOrder={context.sortOrder}
        onSortOrderChange={context.setSortOrder}
      />
    </div>
  );
}

/**
 * Table + selection bar section
 */
function SourcesPageTableSection() {
  const context = useSourcesContext();

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <div
        className={cn(
          'flex-1 min-h-0 overflow-auto transition-[padding] duration-200',
          context.selectedFileIds.length > 0 && 'pb-14',
        )}
      >
        <SourcesTableWithContext />
      </div>

      {/* Selection bar: fixed at bottom of table area, overlays content (no layout shift) */}
      {context.selectedFileIds.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-subtle bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
          <SourcesSelectionBarWithContext overlay />
        </div>
      )}
    </div>
  );
}

/**
 * Pagination section
 */
function SourcesPagePagination() {
  const context = useSourcesContext();

  if (context.total <= context.pageSize) {
    return null;
  }

  return (
    <div className="flex items-center justify-between mt-3 pt-3 border-t border-subtle">
      <span className="text-sm text-tertiary">
        {context.total} file(s) · page {context.page} of {context.totalPages}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => context.setPage((p: number) => Math.max(1, p - 1))}
          disabled={!context.hasPrev}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => context.setPage((p: number) => Math.min(context.totalPages, p + 1))}
          disabled={!context.hasNext}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * All dialogs with context
 */
function SourcesPageDialogs() {
  const context = useSourcesContext();

  return (
    <>
      <FileUploadDialogWithContext />
      {context.filesToDelete && <FileDeleteDialogWithContext />}
    </>
  );
}

/**
 * Internal component that uses context for SourcesTable
 */
function SourcesTableWithContext() {
  const context = useSourcesContext();

  return (
    <SourcesTable
      data={context.items}
      loading={context.sourcesLoading}
      compact
      selectedIds={context.selectedFileIds}
      onRowSelect={context.setSelectedFileIds}
      onUploadClick={() => context.setUploadDialogOpen(true)}
    />
  );
}

/**
 * Internal component that uses context for SourcesSelectionBar
 */
function SourcesSelectionBarWithContext({ overlay }: { overlay?: boolean }) {
  const context = useSourcesContext();

  return (
    <SourcesSelectionBar
      overlay={overlay}
      selectedIds={context.selectedFileIds}
      files={context.items}
      quotaExceeded={!context.quotaStatus.canStart}
      onDelete={context.handleDeleteClick}
      onStartAIReady={context.handleBatchStartAIReady}
      onCancelAIReady={context.handleBatchCancelAIReady}
      onDownload={context.handleDownload}
      onClearSelection={context.clearSelection}
      batchStartPending={context.batchStartPending}
      batchCancelPending={context.batchCancelPending}
    />
  );
}

/**
 * File upload dialog with context
 */
function FileUploadDialogWithContext() {
  const context = useSourcesContext();

  return (
    <FileUploadDialog
      open={context.uploadDialogOpen}
      onOpenChange={context.setUploadDialogOpen}
      onUpload={context.handleUpload}
      uploading={context.uploading}
      uploadProgress={context.uploadProgress}
      uploadErrors={context.uploadErrors}
    />
  );
}

/**
 * File delete dialog with context
 */
function FileDeleteDialogWithContext() {
  const context = useSourcesContext();
  const { filesToDelete, items, deleteDialogOpen, setDeleteDialogOpen, handleConfirmDelete, deleting } = context;

  if (!filesToDelete) return null;

  return (
    <FileDeleteDialog
      open={deleteDialogOpen}
      onOpenChange={setDeleteDialogOpen}
      onConfirm={handleConfirmDelete}
      filename={filesToDelete.ids.length === 1 ? items.find((f) => f.id === filesToDelete!.ids[0])?.filename : undefined}
      hasAIReady={filesToDelete.hasAIReady}
      fileCount={filesToDelete.ids.length}
      deleting={deleting}
    />
  );
}

export function SourcesPage(props: SourcesPageProps) {
  return <SourcesPageContent {...props} />;
}
