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
  t: (key: string, values?: Record<string, string>) => string;
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
  const selectedLibrary = libraries.find((library) => library.id === selectedLibraryId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.04),_transparent_40%)]">
      <div className="grid gap-3 md:grid-cols-3">
        <FilesSummaryCard
          label={t('file_manager.libraries')}
          value={String(libraries.length)}
          helper={selectedLibrary ? selectedLibrary.name : t('file_manager.no_libraries')}
        />
        <FilesSummaryCard
          label={t('file_manager.location')}
          value={prefix || t('file_manager.root')}
          helper={selectedLibrary ? selectedLibrary.bucket || selectedLibrary.name : t('file_manager.loading')}
        />
        <FilesSummaryCard
          label={t('file_manager.selected_count', { count: String(selectedCount) })}
          value={String(filteredItems.length)}
          helper={hasSelection ? t('file_manager.multi_select_hint_esc') : t('file_manager.selection_shortcuts')}
        />
      </div>

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
    </div>
  );
}

function FilesSummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/6 bg-white/[0.03] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.12)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-tertiary">{label}</div>
      <div className="mt-2 truncate text-xl font-semibold tracking-tight text-foreground">{value}</div>
      <div className="mt-1 truncate text-sm text-secondary">{helper}</div>
    </div>
  );
}
