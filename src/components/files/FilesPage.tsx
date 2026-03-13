/**
 * Files Page - Object Browser (MinIO-like)
 *
 * This page intentionally focuses on the file manager UX:
 * libraries (bucket-like) + folders (prefixes) + objects (keys).
 *
 * AIReady / plugin processing is out of scope for this phase.
 */

'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Folder,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button, buttonVariants } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { FileObjectDetailsPanel } from '@/components/files/FileObjectDetailsPanel';
import { FilesLibrariesPane } from '@/components/files/files-page/FilesLibrariesPane';
import { FilesBrowserPane } from '@/components/files/files-page/FilesBrowserPane';

import type { FileObjectsListItem } from '@/lib/api/types';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import {
  useCreateFileLibrary,
  useDeleteFileLibrary,
  useFileLibraries,
  useUpdateFileLibrary,
} from '@/lib/hooks/use-files';
import {
  useCreateFileFolder,
  useDeleteFileObjects,
  useMoveFileObject,
  useFileObjectsInfinite,
  useUploadFileObject,
} from '@/lib/hooks/use-file-objects';
import { FileSortBy, FileSortOrder, useFilesUrlState } from '@/lib/hooks/use-files-url-state';
import { useProjectLayoutMode } from '@/lib/hooks/use-project-layout-mode';
import { useFileUploadManager } from '@/components/files/hooks/use-file-upload-manager';
import { useFileBatchOperations } from '@/components/files/hooks/use-file-batch-operations';
import { useFileLibraryManager } from '@/components/files/hooks/use-file-library-manager';
import { useFileFolderMoveManager } from '@/components/files/hooks/use-file-folder-move-manager';
import { useFilesSelectionState } from '@/components/files/files-page/useFilesSelectionState';
import {
  basename,
  buildCrumbs,
  parentPrefixForKey,
  parentPrefixForPrefix,
  type SelectedRowId,
} from '@/components/files/files-page/utils';

export interface FilesPageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
}

export function FilesPage({ workspaceId, projectId, locale = 'en-US' }: FilesPageProps) {
  const t = useTranslations('files');
  const tErrors = useTranslations('errors');
  const canManage = useHasPermission('project:files:update');
  const { layoutMode } = useProjectLayoutMode();
  const basePath = `/${locale}/workspaces/${workspaceId}/projects/${projectId}`;

  const { data: librariesData, isLoading: libsLoading } = useFileLibraries(workspaceId, projectId);
  const libraries = React.useMemo(() => librariesData?.items ?? [], [librariesData?.items]);
  const {
    prefix,
    search,
    searchInput,
    selectedLibraryId,
    setPrefix,
    setSearchImmediately,
    setSearchInput,
    setSelectedLibraryId,
    sortBy,
    sortOrder,
    updateSort,
  } = useFilesUrlState(libraries, { resetBrowseStateOnMount: true });

  const listParams = React.useMemo(
    () => ({
      prefix,
      delimiter: '/' as const,
      page_size: 200,
      search: search || undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
    }),
    [prefix, search, sortBy, sortOrder],
  );
  const objectsQuery = useFileObjectsInfinite(workspaceId, projectId, selectedLibraryId, listParams);
  const items = React.useMemo(
    () => objectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [objectsQuery.data?.pages],
  );
  const filteredItems = items;

  const createLibrary = useCreateFileLibrary();
  const updateLibrary = useUpdateFileLibrary();
  const deleteLibrary = useDeleteFileLibrary();

  const createFolder = useCreateFileFolder();
  const uploadObject = useUploadFileObject();
  const deleteObjects = useDeleteFileObjects();
  const moveObject = useMoveFileObject();

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const crumbs = React.useMemo(() => buildCrumbs(prefix), [prefix]);
  const {
    allSelected,
    clearSelection,
    exitMultiMode,
    handleRowActivate,
    handleToggleRowCheckbox,
    hasSelection,
    isMultiMode,
    navigateToPrefix,
    selectLibrary,
    selected,
    selectedIds,
    selectedObjects,
    selectionMode,
    setSelectedIds,
    toggleAll,
    visibleSelectedCount,
  } = useFilesSelectionState({
    filteredItems,
    isFetching: objectsQuery.isFetching,
    libraries,
    prefix,
    searchInput,
    selectedLibraryId,
    sortBy,
    sortOrder,
    setPrefix,
    setSearchImmediately,
    setSelectedLibraryId,
    updateSort,
  });

  const handleRowOpen = React.useCallback(
    (item: FileObjectsListItem) => {
      if (selectionMode !== 'single') return;
      if (item.kind === 'prefix') {
        navigateToPrefix(item.prefix);
      }
    },
    [navigateToPrefix, selectionMode],
  );

  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);

  const selectedForMove = selected.length === 1 ? selected[0] : null;
  const moveNamePlaceholder = selectedForMove
    ? (selectedForMove.kind === 'object' ? basename(selectedForMove.key) : basename(selectedForMove.prefix))
    : '';

  const handleUploadClick = () => fileInputRef.current?.click();
  const {
    dismissUploadConflict,
    handleCancelUpload,
    handleUploadConflictOpenChange,
    handleDrop,
    handleDropEnter,
    handleDropLeave,
    handleDropOver,
    handleFilesPicked,
    isDropActive,
    resolveUploadConflictOverwrite,
    resolveUploadConflictRename,
    uploadConflictFileName,
    uploadConflictOpen,
    uploadCurrentFileName,
    uploadCurrentProgress,
    uploadInProgress,
    uploadQueueCompleted,
    uploadQueueTotal,
  } = useFileUploadManager({
    workspaceId,
    projectId,
    selectedLibraryId,
    prefix,
    uploadObject: uploadObject.mutateAsync,
    t,
    tErrors,
  });

  const handleDeletePartialFailureSelection = React.useCallback(
    (failedKeys: string[]) => {
      const failedSet = new Set(failedKeys);
      setSelectedIds(
        selected
          .filter((item) => failedSet.has(item.kind === 'object' ? item.key : item.prefix))
          .map((item) => (item.kind === 'object' ? (`o:${item.key}` as const) : (`p:${item.prefix}` as const))),
      );
    },
    [selected],
  );

  const {
    batchFailedKeys,
    batchResultOpen,
    batchResultType,
    batchRetryPending,
    closeBatchResult,
    handleDelete,
    handleBatchResultOpenChange,
    handleDownload,
    handleRetryBatchFailures,
  } = useFileBatchOperations({
    workspaceId,
    projectId,
    selectedLibraryId,
    selected,
    selectedObjects,
    clearSelection,
    deleteObjects: deleteObjects.mutateAsync,
    onDeletePartialFailure: handleDeletePartialFailureSelection,
    t,
    tErrors,
  });

  const {
    closeDeleteLibraryDialog,
    closeRenameLibraryDialog,
    handleCreateLibrary,
    handleDeleteLibrary,
    handleRenameLibrary,
    libraryCreateOpen,
    libraryDeleteConfirm,
    libraryDeleteOpen,
    libraryDeleteTarget,
    libraryDescription,
    libraryName,
    libraryRenameDescription,
    libraryRenameName,
    libraryRenameOpen,
    libraryRenameTarget,
    openCreateLibraryDialog,
    openDeleteLibraryDialog,
    openRenameLibraryDialog,
    setLibraryCreateOpen,
    setLibraryDeleteConfirm,
    setLibraryDeleteOpen,
    setLibraryDescription,
    setLibraryName,
    setLibraryRenameDescription,
    setLibraryRenameName,
    setLibraryRenameOpen,
  } = useFileLibraryManager({
    workspaceId,
    projectId,
    selectedLibraryId,
    setSelectedLibraryId,
    navigateToPrefix,
    createLibrary: createLibrary.mutateAsync,
    updateLibrary: updateLibrary.mutateAsync,
    deleteLibrary: deleteLibrary.mutateAsync,
    t,
    tErrors,
  });

  const {
    confirmMoveOverwrite,
    createFolderOpen,
    destPickerCrumbs,
    destPickerItems,
    destPickerOpen,
    destPickerPrefix,
    destPickerQuery,
    folderName,
    handleCreateFolder,
    handleMove,
    moveConflictOpen,
    moveDestPrefix,
    moveName,
    moveOpen,
    moveOverwrite,
    normalizeFolderPrefixInput,
    setCreateFolderOpen,
    setDestPickerOpen,
    setDestPickerPrefix,
    setFolderName,
    setMoveConflictOpen,
    setMoveDestPrefix,
    setMoveName,
    setMoveOpen,
    setMoveOverwrite,
  } = useFileFolderMoveManager({
    workspaceId,
    projectId,
    selectedLibraryId,
    prefix,
    selectedForMove,
    createFolder: createFolder.mutateAsync,
    moveObject: moveObject.mutateAsync,
    clearSelection,
    navigateToPrefix,
    t,
    tErrors,
  });

  const handleSortHeaderClick = React.useCallback(
    (nextSortBy: FileSortBy) => {
      if (sortBy === nextSortBy) {
        const nextOrder: FileSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
        updateSort(nextSortBy, nextOrder);
        return;
      }
      updateSort(nextSortBy, 'asc');
    },
    [sortBy, sortOrder, updateSort],
  );

  const loadNextObjectsPage = React.useCallback(() => {
    if (objectsQuery.hasNextPage && !objectsQuery.isFetchingNextPage) {
      void objectsQuery.fetchNextPage();
    }
  }, [objectsQuery]);

  return (
    <PageLayout
      density="immersive"
      contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}
      header={(
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`${basePath}/chat`}
                className={cn(buttonVariants({ variant: 'action', size: 'sm' }))}
                data-testid="files__open-chat"
              >
                {t('open_chat')}
              </Link>
              <Link
                href={`${basePath}/notebook`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="files__open-notebook"
              >
                {t('open_notebook')}
              </Link>
              <Link
                href={`${basePath}/endpoints`}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                data-testid="files__open-endpoints"
              >
                {t('open_endpoints')}
              </Link>
            </div>
          )}
        />
      )}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFilesPicked(e.target.files);
          e.currentTarget.value = '';
        }}
      />
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
          onSelectLibrary={selectLibrary}
          onCreateLibrary={openCreateLibraryDialog}
          onRenameLibrary={openRenameLibraryDialog}
          onDeleteLibrary={openDeleteLibraryDialog}
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
          selectedCount={selected.length}
          selectedObjectsCount={selectedObjects.length}
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
          onNavigateToPrefix={navigateToPrefix}
          onGoUp={() => navigateToPrefix(parentPrefixForPrefix(prefix))}
          onRefresh={() => {
            void objectsQuery.refetch();
          }}
          onCreateFolder={() => setCreateFolderOpen(true)}
          onUploadClick={handleUploadClick}
          onCancelUpload={handleCancelUpload}
          onRename={() => {
            if (selected.length !== 1) return;
            const target = selectedForMove;
            if (!target) return;
            const parent = target.kind === 'object'
              ? parentPrefixForKey(target.key)
              : parentPrefixForPrefix(target.prefix);
            setMoveDestPrefix(parent);
            setMoveName(moveNamePlaceholder);
            setMoveOverwrite(false);
            setMoveOpen(true);
          }}
          onDelete={() => setDeleteConfirmOpen(true)}
          onDownload={handleDownload}
          onClearSelection={clearSelection}
          onToggleAll={toggleAll}
          onSortHeaderClick={handleSortHeaderClick}
          onLoadNextPage={loadNextObjectsPage}
          onDrop={handleDrop}
          onDropEnter={handleDropEnter}
          onDropOver={handleDropOver}
          onDropLeave={handleDropLeave}
          onRowActivate={(event, _item, id, index) => handleRowActivate(event, id, index)}
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

      <Dialog open={libraryCreateOpen} onOpenChange={setLibraryCreateOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__library-create">
          <DialogHeader>
            <DialogTitle>{t('file_manager.library_create')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-name">{t('file_manager.library_name')}</Label>
              <Input
                id="sources-library-name"
                value={libraryName}
                onChange={(e) => setLibraryName(e.target.value)}
                placeholder={t('file_manager.library_name_placeholder')}
                data-testid="files__library-create__name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-desc">{t('file_manager.library_description')}</Label>
              <Textarea
                id="sources-library-desc"
                value={libraryDescription}
                onChange={(e) => setLibraryDescription(e.target.value)}
                placeholder={t('file_manager.library_description_placeholder')}
                className="min-h-[90px]"
                data-testid="files__library-create__description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setLibraryCreateOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleCreateLibrary}
              disabled={!libraryName.trim() || createLibrary.isPending}
              data-testid="files__library-create__submit"
            >
              {t('file_manager.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryRenameOpen} onOpenChange={setLibraryRenameOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__library-rename">
          <DialogHeader>
            <DialogTitle>{t('file_manager.library_rename')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-rename-name">{t('file_manager.library_name')}</Label>
              <Input
                id="sources-library-rename-name"
                value={libraryRenameName}
                onChange={(e) => setLibraryRenameName(e.target.value)}
                placeholder={t('file_manager.library_name_placeholder')}
                data-testid="files__library-rename__name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-rename-desc">{t('file_manager.library_description')}</Label>
              <Textarea
                id="sources-library-rename-desc"
                value={libraryRenameDescription}
                onChange={(e) => setLibraryRenameDescription(e.target.value)}
                placeholder={t('file_manager.library_description_placeholder')}
                className="min-h-[90px]"
                data-testid="files__library-rename__description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
                onClick={() => {
                  closeRenameLibraryDialog();
                }}
            >
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleRenameLibrary}
              disabled={!libraryRenameTarget || !libraryRenameName.trim() || updateLibrary.isPending}
              data-testid="files__library-rename__submit"
            >
              {t('file_manager.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryDeleteOpen} onOpenChange={setLibraryDeleteOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__library-delete">
          <DialogHeader>
            <DialogTitle>{t('file_manager.library_delete')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-tertiary">
              {libraryDeleteTarget
                ? t('file_manager.library_delete_confirm', { name: libraryDeleteTarget.name })
                : t('file_manager.library_delete_confirm_empty')}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-delete-confirm">{t('file_manager.confirm_name')}</Label>
              <Input
                id="sources-library-delete-confirm"
                value={libraryDeleteConfirm}
                onChange={(e) => setLibraryDeleteConfirm(e.target.value)}
                placeholder={libraryDeleteTarget?.name ?? ''}
                data-testid="files__library-delete__confirm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
                onClick={() => {
                  closeDeleteLibraryDialog();
                }}
            >
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteLibrary}
              disabled={
                !libraryDeleteTarget ||
                libraryDeleteConfirm !== libraryDeleteTarget.name ||
                deleteLibrary.isPending
              }
              data-testid="files__library-delete__submit"
            >
              {t('file_manager.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="files__dialog__new-folder">
          <DialogHeader>
            <DialogTitle>{t('file_manager.new_folder')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-tertiary">{t('file_manager.folder_name_hint')}</div>
            <Input
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder={t('file_manager.folder_name_placeholder')}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button type="button" onClick={handleCreateFolder} disabled={!folderName.trim()}>
              {t('file_manager.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__move">
          <DialogHeader>
            <DialogTitle>{t('file_manager.rename')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2">
              <div className="text-[11px] text-tertiary">{t('file_manager.from')}</div>
              <div className="font-mono text-xs break-all text-primary" data-testid="files__move__from">
                {selectedForMove ? (selectedForMove.kind === 'object' ? selectedForMove.key : selectedForMove.prefix) : '-'}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex h-8 items-center justify-between gap-2">
                  <Label htmlFor="sources-move-dest">{t('file_manager.dest_prefix')}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setDestPickerPrefix(moveDestPrefix);
                      setDestPickerOpen(true);
                    }}
                    data-testid="files__move__browse"
                  >
                    {t('file_manager.browse')}
                  </Button>
                </div>
                <Input
                  id="sources-move-dest"
                  value={moveDestPrefix}
                  onChange={(e) => setMoveDestPrefix(e.target.value)}
                  placeholder={t('file_manager.dest_prefix_placeholder')}
                  data-testid="files__move__dest-prefix"
                />
                <div className="text-[11px] text-tertiary">{t('file_manager.dest_prefix_hint')}</div>
              </div>
              <div className="space-y-1.5">
                <div className="flex h-8 items-center">
                  <Label htmlFor="sources-move-name">{t('file_manager.new_name')}</Label>
                </div>
                <Input
                  id="sources-move-name"
                  value={moveName}
                  onChange={(e) => setMoveName(e.target.value)}
                  placeholder={moveNamePlaceholder}
                  data-testid="files__move__name"
                />
                <div className="text-[11px] text-tertiary">{t('file_manager.rename_hint')}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="sources-move-overwrite"
                checked={moveOverwrite}
                onCheckedChange={(v: boolean | 'indeterminate') => setMoveOverwrite(v === true)}
                data-testid="files__move__overwrite"
              />
              <Label htmlFor="sources-move-overwrite" className="text-sm">
                {t('file_manager.overwrite')}
              </Label>
            </div>

            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2">
              <div className="text-[11px] text-tertiary">{t('file_manager.to')}</div>
              <div className="font-mono text-xs break-all text-primary" data-testid="files__move__to">
                {(() => {
                  if (!selectedForMove) return '-';
                  const normalized = normalizeFolderPrefixInput(moveDestPrefix);
                  if (!normalized.ok) return t('file_manager.dest_prefix_invalid');
                  const name = moveName.trim() || moveNamePlaceholder || '-';
                  return selectedForMove.kind === 'object'
                    ? `${normalized.prefix}${name}`
                    : `${normalized.prefix}${name}/`;
                })()}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setMoveOpen(false);
                setMoveOverwrite(false);
              }}
            >
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void handleMove();
              }}
              disabled={!selectedForMove || !moveName.trim() || !selectedLibraryId}
              data-testid="files__move__submit"
            >
              {t('file_manager.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={destPickerOpen} onOpenChange={setDestPickerOpen}>
        <DialogContent className="sm:max-w-[720px]" data-testid="files__dialog__dest-picker">
          <DialogHeader>
            <DialogTitle>{t('file_manager.choose_destination')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-1 min-w-0">
              {destPickerCrumbs.map((c, idx) => (
                <React.Fragment key={c.prefix || 'root'}>
                  {idx > 0 && <span className="text-tertiary text-sm">/</span>}
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline truncate max-w-[200px]"
                    onClick={() => setDestPickerPrefix(c.prefix)}
                    data-testid={idx === 0 ? 'files__dest-picker__breadcrumb-root' : `files__dest-picker__breadcrumb--${idx}`}
                  >
                    {idx === 0 ? t('file_manager.root') : c.label}
                  </button>
                </React.Fragment>
              ))}
              <div className="ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => setDestPickerPrefix('')}
                >
                  {t('file_manager.go_root')}
                </Button>
              </div>
            </div>

            <div className="rounded-md border border-subtle overflow-hidden">
              <div className="max-h-[360px] overflow-auto">
                {destPickerQuery.isLoading ? (
                  <div className="p-4 text-sm text-tertiary">{t('file_manager.loading')}</div>
                ) : destPickerItems.length === 0 ? (
                  <div className="p-4 text-sm text-tertiary">{t('file_manager.no_folders')}</div>
                ) : (
                  <div className="divide-y divide-border-subtle">
                    {destPickerItems.map((it) => (
                      <button
                        key={it.prefix}
                        type="button"
                        className="w-full flex items-center justify-between px-4 py-2 hover:bg-hover/60 text-left"
                        onClick={() => setDestPickerPrefix(it.prefix)}
                        data-testid="files__dest-picker__row"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder className="h-4 w-4 text-tertiary shrink-0" />
                          <div className="truncate text-sm text-primary">{it.name}</div>
                        </div>
                        <div className="text-[11px] text-tertiary font-mono truncate max-w-[360px]">{it.prefix}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDestPickerOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setMoveDestPrefix(destPickerPrefix);
                setDestPickerOpen(false);
              }}
              data-testid="files__dest-picker__select"
            >
              {t('file_manager.select')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={moveConflictOpen}
        onOpenChange={setMoveConflictOpen}
        title={t('file_manager.conflict_title')}
        description={t('file_manager.conflict_description')}
        confirmText={t('file_manager.overwrite_action')}
        cancelText={t('file_manager.cancel')}
        variant="destructive"
        onConfirm={confirmMoveOverwrite}
        testId="files__dialog__move-conflict"
      />

      <Dialog
        open={uploadConflictOpen}
        onOpenChange={handleUploadConflictOpenChange}
      >
        <DialogContent className="sm:max-w-[520px]" data-testid="files__dialog__upload-conflict">
          <DialogHeader>
            <DialogTitle>{t('file_manager.upload_conflict_title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-sm text-tertiary">
              {t('file_manager.upload_conflict_description')}
            </div>
            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2 font-mono text-xs break-all text-primary">
              {uploadConflictFileName || '-'}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={dismissUploadConflict}
            >
              {t('file_manager.cancel')}
            </Button>
            <Button type="button" variant="outline" onClick={resolveUploadConflictRename} data-testid="files__upload-conflict__rename">
              {t('file_manager.upload_conflict_rename')}
            </Button>
            <Button type="button" variant="destructive" onClick={resolveUploadConflictOverwrite} data-testid="files__upload-conflict__overwrite">
              {t('file_manager.upload_conflict_overwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="files__dialog__delete">
          <DialogHeader>
            <DialogTitle>{t('file_manager.delete')}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-tertiary">
            {t('file_manager.delete_confirm', { count: String(selected.length) })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setDeleteConfirmOpen(false);
                void handleDelete();
              }}
              disabled={selected.length === 0}
            >
              {t('file_manager.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={batchResultOpen} onOpenChange={handleBatchResultOpenChange}>
        <DialogContent className="sm:max-w-[620px]" data-testid="files__dialog__batch-result">
          <DialogHeader>
            <DialogTitle>
              {batchResultType === 'delete'
                ? t('file_manager.batch_delete_result_title')
                : t('file_manager.batch_download_result_title')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-tertiary">
              {t('file_manager.batch_result_failed_count', { failed: String(batchFailedKeys.length) })}
            </div>
            <div className="rounded-md border border-subtle bg-surface-high/20 max-h-[260px] overflow-auto">
              <div className="divide-y divide-border-subtle">
                {batchFailedKeys.map((key) => (
                  <div key={key} className="px-3 py-2 text-xs font-mono break-all text-primary" data-testid="files__batch-result__row">
                    {key}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={closeBatchResult}
              >
              {t('file_manager.close')}
            </Button>
            <Button
              type="button"
              onClick={handleRetryBatchFailures}
              disabled={batchRetryPending || batchFailedKeys.length === 0}
              data-testid="files__batch-result__retry"
            >
              {t('file_manager.retry_failed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
