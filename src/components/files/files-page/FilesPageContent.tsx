'use client';

import * as React from 'react';

import { FileObjectDetailsPanel } from '@/components/files/FileObjectDetailsPanel';
import { FilesBrowserPane } from '@/components/files/files-page/FilesBrowserPane';
import { FilesLibrariesPane } from '@/components/files/files-page/FilesLibrariesPane';
import type { FileObjectsListItem } from '@/lib/api/types';
import type { ProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { cn } from '@/lib/utils';

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
  selectedObjectsCount: React.ComponentProps<typeof FilesBrowserPane>['selectedObjectsCount'];
  selectionMode: React.ComponentProps<typeof FilesBrowserPane>['selectionMode'];
  setSearchInput: React.ComponentProps<typeof FilesBrowserPane>['setSearchInput'];
  sortBy: React.ComponentProps<typeof FilesBrowserPane>['sortBy'];
  sortOrder: React.ComponentProps<typeof FilesBrowserPane>['sortOrder'];
  t: (key: string) => string;
  uploadCurrentFileName: React.ComponentProps<typeof FilesBrowserPane>['uploadCurrentFileName'];
  uploadCurrentProgress: React.ComponentProps<typeof FilesBrowserPane>['uploadCurrentProgress'];
  uploadInProgress: React.ComponentProps<typeof FilesBrowserPane>['uploadInProgress'];
  uploadQueueCompleted: React.ComponentProps<typeof FilesBrowserPane>['uploadQueueCompleted'];
  uploadQueueTotal: React.ComponentProps<typeof FilesBrowserPane>['uploadQueueTotal'];
  workspaceId: string;
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
  selectedObjectsCount,
  selectionMode,
  setSearchInput,
  sortBy,
  sortOrder,
  t,
  uploadCurrentFileName,
  uploadCurrentProgress,
  uploadInProgress,
  uploadQueueCompleted,
  uploadQueueTotal,
  workspaceId,
}: FilesPageContentProps) {
  return (
    <div
      className={cn(
        'flex-1 min-h-0 grid gap-3',
        layoutMode === 'ultrawide'
          ? 'grid-cols-[300px_minmax(0,1fr)_520px]'
          : 'grid-cols-[260px_minmax(0,1fr)_360px]',
      )}
    >
      <FilesLibrariesPane
        t={t}
        canManage={canManage}
        libsLoading={libsLoading}
        libraries={libraries}
        selectedLibraryId={selectedLibraryId}
        onSelectLibrary={onSelectLibrary}
        onCreateLibrary={onCreateLibrary}
        onRenameLibrary={onRenameLibrary}
        onDeleteLibrary={onDeleteLibrary}
      />

      <FilesBrowserPane
        t={t}
        prefix={prefix}
        crumbs={crumbs}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        selectedLibraryId={selectedLibraryId}
        filteredItems={filteredItems}
        selectedIds={selectedIds}
        selectionMode={selectionMode}
        selectedCount={selectedCount}
        selectedObjectsCount={selectedObjectsCount}
        allSelected={allSelected}
        hasSelection={hasSelection}
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

      <FileObjectDetailsPanel
        workspaceId={workspaceId}
        projectId={projectId}
        selectedLibraryId={selectedLibraryId}
        selected={selected}
        onDownload={handleDownload}
      />
    </div>
  );
}
