'use client';

import * as React from 'react';
import { Plus } from 'lucide-react';

import { FileObjectDetailsPanel } from '@/components/files/FileObjectDetailsPanel';
import { FilesBrowserPane } from '@/components/files/files-page/FilesBrowserPane';
import { FilesLibrariesPane } from '@/components/files/files-page/FilesLibrariesPane';
import { Button } from '@/components/ui/button';
import type { FileObjectsListItem } from '@/lib/api/types';
import type { ProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { cn } from '@/lib/utils';

type FilesWorkspaceSurface = 'browser' | 'no_library';

interface FilesPageContentProps {
  allSelected: React.ComponentProps<typeof FilesBrowserPane>['allSelected'];
  canManage: boolean;
  crumbs: React.ComponentProps<typeof FilesBrowserPane>['crumbs'];
  fileInputRef: React.ComponentProps<typeof FilesBrowserPane>['fileInputRef'];
  filteredItems: React.ComponentProps<typeof FilesBrowserPane>['filteredItems'];
  handleCancelUpload: React.ComponentProps<typeof FilesBrowserPane>['onCancelUpload'];
  handleDelete: () => void;
  handleDownload: React.ComponentProps<typeof FilesBrowserPane>['onDownload'];
  handleDrop: React.ComponentProps<typeof FilesBrowserPane>['onDrop'];
  handleDropEnter: React.ComponentProps<typeof FilesBrowserPane>['onDropEnter'];
  handleDropLeave: React.ComponentProps<typeof FilesBrowserPane>['onDropLeave'];
  handleDropOver: React.ComponentProps<typeof FilesBrowserPane>['onDropOver'];
  handleLoadNextPage: React.ComponentProps<typeof FilesBrowserPane>['onLoadNextPage'];
  handleRefresh: React.ComponentProps<typeof FilesBrowserPane>['onRefresh'];
  handleRename: () => void;
  handleRowActivate: React.ComponentProps<typeof FilesBrowserPane>['onRowActivate'];
  handleRowOpen: (item: FileObjectsListItem) => void;
  handleSortHeaderClick: React.ComponentProps<typeof FilesBrowserPane>['onSortHeaderClick'];
  handleToggleRowCheckbox: React.ComponentProps<typeof FilesBrowserPane>['onToggleRowCheckbox'];
  handleUploadClick: React.ComponentProps<typeof FilesBrowserPane>['onUploadClick'];
  hasSelection: React.ComponentProps<typeof FilesBrowserPane>['hasSelection'];
  isDropActive: React.ComponentProps<typeof FilesBrowserPane>['isDropActive'];
  layoutMode: ProjectLayoutMode;
  libraries: React.ComponentProps<typeof FilesLibrariesPane>['libraries'];
  libsLoading: React.ComponentProps<typeof FilesLibrariesPane>['libsLoading'];
  moveNamePlaceholder: React.ComponentProps<typeof FilesBrowserPane>['moveNamePlaceholder'];
  objectsQuery: React.ComponentProps<typeof FilesBrowserPane>['objectsQuery'];
  onClearSelection: React.ComponentProps<typeof FilesBrowserPane>['onClearSelection'];
  onCreateFolder: React.ComponentProps<typeof FilesBrowserPane>['onCreateFolder'];
  onCreateLibrary: React.ComponentProps<typeof FilesLibrariesPane>['onCreateLibrary'];
  onDeleteLibrary: React.ComponentProps<typeof FilesLibrariesPane>['onDeleteLibrary'];
  onGoUp: React.ComponentProps<typeof FilesBrowserPane>['onGoUp'];
  onOpenTemplateManagement: React.ComponentProps<typeof FilesBrowserPane>['onOpenTemplateManagement'];
  onOpenVersionManagement: React.ComponentProps<typeof FilesBrowserPane>['onOpenVersionManagement'];
  onNavigateToPrefix: React.ComponentProps<typeof FilesBrowserPane>['onNavigateToPrefix'];
  onRenameLibrary: React.ComponentProps<typeof FilesLibrariesPane>['onRenameLibrary'];
  onSelectLibrary: React.ComponentProps<typeof FilesLibrariesPane>['onSelectLibrary'];
  onToggleAll: React.ComponentProps<typeof FilesBrowserPane>['onToggleAll'];
  prefix: React.ComponentProps<typeof FilesBrowserPane>['prefix'];
  projectId: string;
  searchInput: React.ComponentProps<typeof FilesBrowserPane>['searchInput'];
  selected: React.ComponentProps<typeof FileObjectDetailsPanel>['selected'];
  selectedCount: React.ComponentProps<typeof FilesBrowserPane>['selectedCount'];
  selectedForMove: React.ComponentProps<typeof FilesBrowserPane>['selectedForMove'];
  selectedIds: React.ComponentProps<typeof FilesBrowserPane>['selectedIds'];
  selectedLibraryId: string | null;
  selectedLibraryStatus: React.ComponentProps<typeof FilesBrowserPane>['selectedLibraryStatus'];
  selectedLibraryTaskHomeBinding: React.ComponentProps<typeof FilesBrowserPane>['selectedLibraryTaskHomeBinding'];
  selectedObjectsCount: React.ComponentProps<typeof FilesBrowserPane>['selectedObjectsCount'];
  selectionMode: React.ComponentProps<typeof FilesBrowserPane>['selectionMode'];
  setSearchInput: React.ComponentProps<typeof FilesBrowserPane>['setSearchInput'];
  sortBy: React.ComponentProps<typeof FilesBrowserPane>['sortBy'];
  sortOrder: React.ComponentProps<typeof FilesBrowserPane>['sortOrder'];
  t: (key: string, values?: Record<string, string>) => string;
  uploadCanCancel: React.ComponentProps<typeof FilesBrowserPane>['uploadCanCancel'];
  uploadCurrentFileName: React.ComponentProps<typeof FilesBrowserPane>['uploadCurrentFileName'];
  uploadCurrentProgress: React.ComponentProps<typeof FilesBrowserPane>['uploadCurrentProgress'];
  uploadInProgress: React.ComponentProps<typeof FilesBrowserPane>['uploadInProgress'];
  uploadQueueCompleted: React.ComponentProps<typeof FilesBrowserPane>['uploadQueueCompleted'];
  uploadQueueTotal: React.ComponentProps<typeof FilesBrowserPane>['uploadQueueTotal'];
  workspaceId: string;
  workspaceSurface: FilesWorkspaceSurface;
}

export function FilesPageContent({
  allSelected,
  canManage,
  crumbs,
  fileInputRef,
  filteredItems,
  handleCancelUpload,
  handleDelete,
  handleDownload,
  handleDrop,
  handleDropEnter,
  handleDropLeave,
  handleDropOver,
  handleLoadNextPage,
  handleRefresh,
  handleRename,
  handleRowActivate,
  handleRowOpen,
  handleSortHeaderClick,
  handleToggleRowCheckbox,
  handleUploadClick,
  hasSelection,
  isDropActive,
  layoutMode,
  libraries,
  libsLoading,
  moveNamePlaceholder,
  objectsQuery,
  onClearSelection,
  onCreateFolder,
  onCreateLibrary,
  onDeleteLibrary,
  onGoUp,
  onOpenTemplateManagement,
  onOpenVersionManagement,
  onNavigateToPrefix,
  onRenameLibrary,
  onSelectLibrary,
  onToggleAll,
  prefix,
  projectId,
  searchInput,
  selected,
  selectedCount,
  selectedForMove,
  selectedIds,
  selectedLibraryId,
  selectedLibraryStatus,
  selectedLibraryTaskHomeBinding,
  selectedObjectsCount,
  selectionMode,
  setSearchInput,
  sortBy,
  sortOrder,
  t,
  uploadCanCancel,
  uploadCurrentFileName,
  uploadCurrentProgress,
  uploadInProgress,
  uploadQueueCompleted,
  uploadQueueTotal,
  workspaceId,
  workspaceSurface,
}: FilesPageContentProps) {
  const showNoLibrarySurface = workspaceSurface === 'no_library';
  const showDetailsPanel = workspaceSurface === 'browser' && Boolean(selected && selectedLibraryId);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      data-testid="files__workspace-surface"
    >
      <div
        className={cn(
          'flex-1 min-h-0 grid gap-0',
          showDetailsPanel
            ? (layoutMode === 'ultrawide'
                ? 'grid-cols-[240px_minmax(0,1fr)_320px]'
                : 'grid-cols-[220px_minmax(0,1fr)_280px]')
            : (layoutMode === 'ultrawide'
                ? 'grid-cols-[240px_minmax(0,1fr)]'
                : 'grid-cols-[220px_minmax(0,1fr)]'),
        )}
        data-testid="files__workspace-grid"
      >
        <div
          className="min-h-0 border-r border-subtle/60 pr-3 [&>div]:h-full [&>div]:!rounded-none [&>div]:!border-0 [&>div]:!bg-transparent [&>div]:!shadow-none [&_[data-testid='files__library-list']>div]:!rounded-none [&_[data-testid='files__library-list']>div]:!border-0 [&_[data-testid='files__library-list']>div]:!bg-transparent [&_[data-testid='files__library-list']>div]:!shadow-none"
          data-testid="files__libraries-shell"
        >
          <FilesLibrariesPane
            t={t}
            canManage={canManage}
            libsLoading={libsLoading}
            libraries={libraries}
            showEmptyMessage={!showNoLibrarySurface}
            selectedLibraryId={selectedLibraryId}
            onSelectLibrary={onSelectLibrary}
            onCreateLibrary={onCreateLibrary}
            onRenameLibrary={onRenameLibrary}
            onDeleteLibrary={onDeleteLibrary}
          />
        </div>

        <div
          className="min-h-0 px-3 [&>div]:h-full [&>div]:!rounded-none [&>div]:!border-0 [&>div]:!bg-transparent [&>div]:!shadow-none [&_[data-testid='files__objects-table']_.sticky]:!bg-transparent [&_[data-testid='files__objects-table']_.sticky]:!border-0"
          data-testid="files__browser-shell"
        >
          {showNoLibrarySurface ? (
            <div
              className="flex h-full items-center justify-center px-4 py-8"
              data-testid="files__no-library-empty-state"
            >
              <div className="mx-auto flex w-full max-w-[520px] flex-col items-center gap-4 rounded-md border border-dashed border-subtle bg-surface-low px-6 py-8 text-center">
                <div>
                  <div className="text-sm font-medium text-primary">{t('file_manager.no_libraries')}</div>
                  <div className="mt-2 text-sm text-tertiary">
                    {canManage
                      ? t('file_manager.library_create_description')
                      : t('file_manager.library_empty_read_only_description')}
                  </div>
                </div>
                {canManage ? (
                  <Button type="button" onClick={onCreateLibrary} data-testid="files__empty-create-library">
                    <Plus className="mr-2 h-4 w-4" />
                    {t('file_manager.library_create')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <FilesBrowserPane
              t={t}
              canManage={canManage}
              prefix={prefix}
              crumbs={crumbs}
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              selectedLibraryId={selectedLibraryId}
              selectedLibraryStatus={selectedLibraryStatus}
              selectedLibraryTaskHomeBinding={selectedLibraryTaskHomeBinding}
              filteredItems={filteredItems}
              selectedIds={selectedIds}
              selectionMode={selectionMode}
              selectedCount={selectedCount}
              selectedObjectsCount={selectedObjectsCount}
              allSelected={allSelected}
              hasSelection={hasSelection}
              uploadCanCancel={uploadCanCancel}
              uploadInProgress={uploadInProgress}
              uploadCurrentFileName={uploadCurrentFileName}
              uploadQueueCompleted={uploadQueueCompleted}
              uploadQueueTotal={uploadQueueTotal}
              uploadCurrentProgress={uploadCurrentProgress}
              isDropActive={isDropActive}
              sortBy={sortBy}
              sortOrder={sortOrder}
              objectsQuery={objectsQuery}
              fileInputRef={fileInputRef}
              selectedForMove={selectedForMove}
              moveNamePlaceholder={moveNamePlaceholder}
              onNavigateToPrefix={onNavigateToPrefix}
              onGoUp={onGoUp}
              onRefresh={handleRefresh}
              onCreateFolder={onCreateFolder}
              onOpenTemplateManagement={onOpenTemplateManagement}
              onOpenVersionManagement={onOpenVersionManagement}
              onUploadClick={handleUploadClick}
              onCancelUpload={handleCancelUpload}
              onRename={handleRename}
              onDelete={handleDelete}
              onDownload={handleDownload}
              onClearSelection={onClearSelection}
              onToggleAll={onToggleAll}
              onSortHeaderClick={handleSortHeaderClick}
              onLoadNextPage={handleLoadNextPage}
              onDrop={handleDrop}
              onDropEnter={handleDropEnter}
              onDropOver={handleDropOver}
              onDropLeave={handleDropLeave}
              onRowActivate={handleRowActivate}
              onRowOpen={handleRowOpen}
              onToggleRowCheckbox={handleToggleRowCheckbox}
            />
          )}
        </div>

        {showDetailsPanel ? (
          <div
            className={cn(
              'min-h-0 pl-3',
              "[&_[data-testid='files__details-panel']]:h-full",
              "[&_[data-testid='files__details-panel']]:!border-0",
              "[&_[data-testid='files__details-panel']]:!bg-transparent",
              "[&_[data-testid='files__details-panel']]:!shadow-none",
              "[&_[data-testid='files__details-tabs']_[role='tablist']]:!rounded-none",
              "[&_[data-testid='files__details-tabs']_[role='tablist']]:!border-x-0",
              "[&_[data-testid='files__details-tabs']_[role='tablist']]:!border-t-0",
              "[&_[data-testid='files__details-tabs']_[role='tablist']]:!bg-transparent",
              "[&_[data-testid='files__details-preview']]:!rounded-none",
              "[&_[data-testid='files__details-preview']]:!bg-transparent",
              "[&_[data-testid='files__details-preview']]:!p-0",
              "[&_[data-testid='files__details-preview']_.h-40]:!rounded-none",
              "[&_[data-testid='files__details-preview']_.h-40]:!bg-transparent",
              "[&_[data-testid='files__details-preview']_.h-40]:!border-0",
            )}
            data-testid="files__details-shell"
          >
            <FileObjectDetailsPanel
              workspaceId={workspaceId}
              projectId={projectId}
              selectedLibraryId={selectedLibraryId}
              selected={selected}
              onDownload={handleDownload}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
