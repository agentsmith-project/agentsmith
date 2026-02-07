/**
 * Sources Page - Compound Component
 *
 * Root component that provides context to child components.
 */

'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { SourcesProvider, useSourcesContext } from './SourcesContext';
import { useSourcesList } from '@/lib/hooks/use-sources-list';
import { QuotaSummaryCard } from './QuotaSummaryCard';
import { SourcesSearch } from './SourcesSearch';
import { SourcesFilters } from './SourcesFilters';
import { SourcesTable } from './SourcesTable';
import { SourcesSelectionBar } from './SourcesSelectionBar';
import { FileUploadDialog } from './FileUploadDialog';
import { FileDeleteDialog } from './FileDeleteDialog';
import { SourceLibrariesDialog } from './SourceLibrariesDialog';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface SourcesPageProps {
  workspaceId: string;
  projectId: string;
}

function SourcesPageContent({ workspaceId, projectId }: SourcesPageProps) {
  const contextValue = useSourcesList({ workspaceId, projectId });
  const canSourceUpload = useHasPermission('project:source:manage');
  const canSourceDelete = useHasPermission('project:source:manage');
  const canSourceDownload = useHasPermission('project:source:use');
  const canSourceLibraryCreate = useHasPermission('project:source:manage');
  const canSourceLibraryUpdate = useHasPermission('project:source:manage');
  const canSourceLibraryDelete = useHasPermission('project:source:manage');
  const canManageLibraries = canSourceLibraryCreate || canSourceLibraryUpdate || canSourceLibraryDelete;
  const canControlAIReady = canSourceUpload || canSourceDelete;
  const [librariesDialogOpen, setLibrariesDialogOpen] = React.useState(false);

  return (
    <SourcesProvider value={contextValue}>
      <PageLayout
        header={<SourcesPageHeader canSourceUpload={canSourceUpload} />}
        toolbar={(
          <SourcesPageToolbar
            canManageLibraries={canManageLibraries}
            onManageLibraries={() => setLibrariesDialogOpen(true)}
          />
        )}
      >
        <SourcesPageQuotaSummary />
        <SourcesPageTableSection
          canSourceUpload={canSourceUpload}
          canSourceDelete={canSourceDelete}
          canSourceDownload={canSourceDownload}
          canControlAIReady={canControlAIReady}
        />
        <SourcesPagePagination />
        <SourcesPageDialogs
          canSourceUpload={canSourceUpload}
          canSourceDelete={canSourceDelete}
          librariesDialogOpen={librariesDialogOpen}
          onLibrariesDialogOpenChange={setLibrariesDialogOpen}
        />
      </PageLayout>
    </SourcesProvider>
  );
}

/**
 * Header with Quota and Upload button
 */
function SourcesPageHeader({ canSourceUpload }: { canSourceUpload: boolean }) {
  const t = useTranslations('sources');
  const context = useSourcesContext();

  return (
    <PageHeader
      title={t('title')}
      actions={(
        canSourceUpload ? (
        <Button
          onClick={() => context.setUploadDialogOpen(true)}
          className="flex items-center gap-2"
          data-testid="sources__upload-btn"
        >
          <Plus className="h-4 w-4" />
          {t('upload')}
        </Button>
        ) : undefined
      )}
    />
  );
}

/**
 * Search and Filters toolbar
 */
function SourcesPageToolbar({
  canManageLibraries,
  onManageLibraries,
}: {
  canManageLibraries: boolean;
  onManageLibraries: () => void;
}) {
  const t = useTranslations('sources');
  const context = useSourcesContext();

  return (
    <PageToolbar>
      <div className="w-56">
        <Select
          value={context.selectedLibraryId}
          onValueChange={(value) => context.setSelectedLibraryId(value)}
        >
          <SelectTrigger data-testid="sources__library-select">
            <SelectValue placeholder={t('libraries.all')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('libraries.all')}</SelectItem>
            {context.libraries.map((library) => (
              <SelectItem key={library.id} value={library.id}>
                {library.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 min-w-[280px] max-w-lg">
        <SourcesSearch value={context.search} onChange={context.setSearch} />
      </div>
      <SourcesFilters
        className="ml-auto"
        status={context.status}
        onStatusChange={context.setStatus}
        aiReadyOnly={context.aiReadyOnly}
        onAIReadyOnlyChange={context.setAIReadyOnly}
        sortBy={context.sortBy}
        onSortByChange={context.setSortBy}
        sortOrder={context.sortOrder}
        onSortOrderChange={context.setSortOrder}
      />
      {canManageLibraries && (
        <Button
          type="button"
          variant="outline"
          onClick={onManageLibraries}
          data-testid="sources__manage-libraries-btn"
        >
          {t('libraries.manage')}
        </Button>
      )}
    </PageToolbar>
  );
}

/**
 * Quota summary section
 */
function SourcesPageQuotaSummary() {
  const context = useSourcesContext();

  if (!context.quotaData || context.quotaLoading) {
    return null;
  }

  return <QuotaSummaryCard quota={context.quotaData} />;
}

/**
 * Table + selection bar section
 */
function SourcesPageTableSection({
  canSourceUpload,
  canSourceDelete,
  canSourceDownload,
  canControlAIReady,
}: {
  canSourceUpload: boolean;
  canSourceDelete: boolean;
  canSourceDownload: boolean;
  canControlAIReady: boolean;
}) {
  const context = useSourcesContext();

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <div
        className={cn(
          'flex-1 min-h-0 overflow-auto transition-[padding] duration-200',
          context.selectedFileIds.length > 0 && 'pb-14',
        )}
      >
        <SourcesTableWithContext canSourceUpload={canSourceUpload} />
      </div>

      {/* Selection bar: fixed at bottom of table area, overlays content (no layout shift) */}
      {context.selectedFileIds.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-subtle bg-surface shadow-[0_-4px_12px_rgba(0,0,0,0.15)]">
          <SourcesSelectionBarWithContext
            overlay
            canSourceDelete={canSourceDelete}
            canSourceDownload={canSourceDownload}
            canControlAIReady={canControlAIReady}
          />
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
function SourcesPageDialogs({
  canSourceUpload,
  canSourceDelete,
  librariesDialogOpen,
  onLibrariesDialogOpenChange,
}: {
  canSourceUpload: boolean;
  canSourceDelete: boolean;
  librariesDialogOpen: boolean;
  onLibrariesDialogOpenChange: (open: boolean) => void;
}) {
  const context = useSourcesContext();

  return (
    <>
      {canSourceUpload && <FileUploadDialogWithContext />}
      {canSourceDelete && context.filesToDelete && <FileDeleteDialogWithContext />}
      <SourceLibrariesDialog
        open={librariesDialogOpen}
        onOpenChange={onLibrariesDialogOpenChange}
        libraries={context.libraries}
        libraryPolicyStatusById={context.libraryPolicyStatusById}
        libraryPolicyLoadingById={context.libraryPolicyLoadingById}
        selectedLibraryId={context.selectedLibraryId}
        onSelectLibrary={context.setSelectedLibraryId}
        onCreateLibrary={context.handleCreateLibrary}
        onRenameLibrary={context.handleRenameLibrary}
        onDeleteLibrary={context.handleDeleteLibrary}
        creating={context.creatingLibrary}
        updating={context.updatingLibrary}
        deleting={context.deletingLibrary}
      />
    </>
  );
}

/**
 * Internal component that uses context for SourcesTable
 */
function SourcesTableWithContext({ canSourceUpload }: { canSourceUpload: boolean }) {
  const context = useSourcesContext();

  return (
    <SourcesTable
      data={context.items}
      loading={context.sourcesLoading}
      compact
      selectedIds={context.selectedFileIds}
      onRowSelect={context.setSelectedFileIds}
      onUploadClick={canSourceUpload ? () => context.setUploadDialogOpen(true) : undefined}
    />
  );
}

/**
 * Internal component that uses context for SourcesSelectionBar
 */
function SourcesSelectionBarWithContext({
  overlay,
  canSourceDelete,
  canSourceDownload,
  canControlAIReady,
}: {
  overlay?: boolean;
  canSourceDelete: boolean;
  canSourceDownload: boolean;
  canControlAIReady: boolean;
}) {
  const context = useSourcesContext();

  return (
    <SourcesSelectionBar
      overlay={overlay}
      selectedIds={context.selectedFileIds}
      files={context.items}
      quotaExceeded={!context.quotaStatus.canStart}
      canSourceDelete={canSourceDelete}
      canSourceDownload={canSourceDownload}
      canControlAIReady={canControlAIReady}
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
