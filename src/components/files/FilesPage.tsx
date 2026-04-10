/**
 * Files Page - Object Browser (MinIO-like)
 *
 * This page intentionally focuses on the file manager UX:
 * libraries (bucket-like) + folders (prefixes) + objects (keys).
 *
 * This page focuses on project file libraries and filesystem browsing.
 */

'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';

import { PageLayout } from '@/components/layout/PageLayout';
import { ProjectWorkbenchBar } from '@/components/layout/ProjectWorkbenchBar';
import { toast } from '@/components/ui/toast';
import { DesktopAccessDialog } from '@/components/files/files-page/DesktopAccessDialog';
import { FilesPageContent } from '@/components/files/files-page/FilesPageContent';
import { LibraryDialogs } from '@/components/files/files-page/LibraryDialogs';
import { MoveDialogs } from '@/components/files/files-page/MoveDialogs';
import { ObjectOperationDialogs } from '@/components/files/files-page/ObjectOperationDialogs';

import type {
  FileLibrary,
  FileLibraryClientMountAccess,
  FileLibraryDesktopMountAccess,
  FileObjectsListItem,
} from '@/lib/api/types';
import { useFilesPageCapabilities } from '@/lib/hooks/use-permissions';
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
import {
  useFileLibraryDesktopMountAccess,
  useFileLibraryStorageCredentialExchange,
} from '@/lib/hooks/use-file-libraries-v2';
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
} from '@/components/files/files-page/utils';
import {
  useAuthStore,
  useAuthStoreHydration,
  selectIsAuthenticated,
  selectToken,
} from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api/client';

export interface FilesPageProps {
  workspaceId: string;
  projectId: string;
  locale?: string;
}

export function FilesPage({ workspaceId, projectId, locale: _locale = 'en-US' }: FilesPageProps) {
  const t = useTranslations('files');
  const tErrors = useTranslations('errors');
  const authHydrated = useAuthStoreHydration();
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const token = useAuthStore(selectToken);
  const [apiClientAuthReady, setApiClientAuthReady] = React.useState(false);
  React.useEffect(() => {
    if (!authHydrated) {
      setApiClientAuthReady(false);
      return;
    }
    const client = getApiClient();
    if (token) {
      client.setToken(token);
      setApiClientAuthReady(true);
      return;
    }
    client.clearToken();
    setApiClientAuthReady(false);
  }, [authHydrated, token]);
  const authReady = authHydrated && isAuthenticated && !!token && apiClientAuthReady;
  const { canManage, canExchangeCredentials } = useFilesPageCapabilities();
  const { layoutMode } = useProjectLayoutMode();

  const { data: librariesData, isLoading: libsLoading } = useFileLibraries(workspaceId, projectId, {
    enabled: authReady,
  });
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
  const selectedLibrary = React.useMemo(
    () => libraries.find((library) => library.id === selectedLibraryId) ?? null,
    [libraries, selectedLibraryId],
  );

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
  const objectsQuery = useFileObjectsInfinite(workspaceId, projectId, selectedLibraryId, listParams, {
    enabled: authReady,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
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
  const exchangeStorageCredentials = useFileLibraryStorageCredentialExchange();
  const exchangeDesktopMountAccess = useFileLibraryDesktopMountAccess();

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [desktopAccessOpen, setDesktopAccessOpen] = React.useState(false);
  const [desktopAccessTarget, setDesktopAccessTarget] = React.useState<FileLibrary | null>(null);
  const [desktopMountAccess, setDesktopMountAccess] = React.useState<FileLibraryDesktopMountAccess | null>(null);
  const [libraryMountAccess, setLibraryMountAccess] = React.useState<FileLibraryClientMountAccess | null>(null);
  const [revealMetadataUrl, setRevealMetadataUrl] = React.useState(false);

  const crumbs = React.useMemo(() => buildCrumbs(prefix), [prefix]);
  const {
    allSelected,
    clearSelection,
    handleRowActivate,
    handleToggleRowCheckbox,
    hasSelection,
    navigateToPrefix,
    selectLibrary,
    selected,
    selectedIds,
    selectedObjects,
    selectionMode,
    setSelectedIds,
    toggleAll,
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
    [selected, setSelectedIds],
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

  const openMountAccessDialog = React.useCallback(async (library: FileLibrary) => {
    setRevealMetadataUrl(false);
    setLibraryMountAccess(null);
    try {
      const result = await exchangeStorageCredentials.mutateAsync({
        workspaceId,
        projectId,
        libraryId: library.id,
      });
      setLibraryMountAccess(result.client_mount_access);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('file_manager.mount_access_failed');
      toast.error(`${t('file_manager.mount_access_failed')}: ${message}`);
    }
  }, [exchangeStorageCredentials, projectId, t, workspaceId]);

  const openDesktopAccessDialog = React.useCallback(async (library: FileLibrary) => {
    setDesktopAccessTarget(library);
    setDesktopAccessOpen(true);
    setDesktopMountAccess(null);
    setLibraryMountAccess(null);
    setRevealMetadataUrl(false);
    try {
      const result = await exchangeDesktopMountAccess.mutateAsync({
        workspaceId,
        projectId,
        libraryId: library.id,
      });
      setDesktopMountAccess(result.desktop_mount_access);
    } catch (error) {
      const message = error instanceof Error ? error.message : t('file_manager.desktop_access_failed');
      toast.error(`${t('file_manager.desktop_access_failed')}: ${message}`);
    }
  }, [exchangeDesktopMountAccess, projectId, t, workspaceId]);

  return (
    <PageLayout
      density="immersive"
      contentWidth={layoutMode === 'ultrawide' ? 'full' : 'wide'}
    >
      <ProjectWorkbenchBar
        title={t('title')}
        meta={(
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-secondary">
            <span className="rounded-full border border-subtle bg-surface-high/60 px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">
              {t('project_library_label')}
            </span>
            <span className="font-medium text-foreground">{selectedLibrary?.name ?? t('file_manager.no_libraries')}</span>
            <span className="truncate text-tertiary">{prefix || t('file_manager.root')}</span>
            <span className="text-tertiary">{filteredItems.length} {t('file_manager.items')}</span>
          </div>
        )}
        className="mb-4"
      />
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
      <FilesPageContent
        allSelected={allSelected}
        canManage={canManage}
        canExchangeCredentials={canExchangeCredentials}
        crumbs={crumbs}
        fileInputRef={fileInputRef}
        filteredItems={filteredItems}
        handleCancelUpload={handleCancelUpload}
        handleDelete={() => setDeleteConfirmOpen(true)}
        handleDownload={handleDownload}
        handleDrop={handleDrop}
        handleDropEnter={handleDropEnter}
        handleDropLeave={handleDropLeave}
        handleDropOver={handleDropOver}
        handleLoadNextPage={loadNextObjectsPage}
        handleRefresh={() => {
          void objectsQuery.refetch();
        }}
        handleRename={() => {
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
        handleRowActivate={(event, item, id, index) => handleRowActivate(event, id, index)}
        handleRowOpen={handleRowOpen}
        handleSortHeaderClick={handleSortHeaderClick}
        handleToggleRowCheckbox={handleToggleRowCheckbox}
        handleUploadClick={handleUploadClick}
        hasSelection={hasSelection}
        isDropActive={isDropActive}
        layoutMode={layoutMode}
        libraries={libraries}
        libsLoading={libsLoading}
        moveNamePlaceholder={moveNamePlaceholder}
        objectsQuery={objectsQuery}
        onClearSelection={clearSelection}
        onCreateFolder={() => setCreateFolderOpen(true)}
        onCreateLibrary={openCreateLibraryDialog}
        onOpenDesktopAccess={openDesktopAccessDialog}
        onDeleteLibrary={openDeleteLibraryDialog}
        onGoUp={() => navigateToPrefix(parentPrefixForPrefix(prefix))}
        onNavigateToPrefix={navigateToPrefix}
        onRenameLibrary={openRenameLibraryDialog}
        onSelectLibrary={selectLibrary}
        onToggleAll={toggleAll}
        prefix={prefix}
        projectId={projectId}
        searchInput={searchInput}
        selected={selected}
        selectedCount={selected.length}
        selectedForMove={selectedForMove}
        selectedIds={selectedIds}
        selectedLibraryId={selectedLibraryId}
        selectedLibraryStatus={selectedLibrary?.status ?? null}
        selectedObjectsCount={selectedObjects.length}
        selectionMode={selectionMode}
        setSearchInput={setSearchInput}
        sortBy={sortBy}
        sortOrder={sortOrder}
        t={t}
        uploadCurrentFileName={uploadCurrentFileName}
        uploadCurrentProgress={uploadCurrentProgress}
        uploadInProgress={uploadInProgress}
        uploadQueueCompleted={uploadQueueCompleted}
        uploadQueueTotal={uploadQueueTotal}
        workspaceId={workspaceId}
      />

      <DesktopAccessDialog
        exchangePending={exchangeDesktopMountAccess.isPending}
        desktopMountAccess={desktopMountAccess}
        manualMountAccess={libraryMountAccess}
        manualMountAccessPending={exchangeStorageCredentials.isPending}
        open={desktopAccessOpen}
        revealMetadataUrl={revealMetadataUrl}
        targetLibrary={desktopAccessTarget}
        t={t}
        onLoadManualMountAccess={() => {
          if (!desktopAccessTarget) return;
          void openMountAccessDialog(desktopAccessTarget);
        }}
        onOpenChange={setDesktopAccessOpen}
        onToggleRevealMetadataUrl={() => setRevealMetadataUrl((value) => !value)}
      />

      <LibraryDialogs
        createLibraryPending={createLibrary.isPending}
        deleteLibraryPending={deleteLibrary.isPending}
        libraryCreateOpen={libraryCreateOpen}
        libraryDeleteConfirm={libraryDeleteConfirm}
        libraryDeleteOpen={libraryDeleteOpen}
        libraryDeleteTarget={libraryDeleteTarget}
        libraryDescription={libraryDescription}
        libraryName={libraryName}
        libraryRenameDescription={libraryRenameDescription}
        libraryRenameName={libraryRenameName}
        libraryRenameOpen={libraryRenameOpen}
        libraryRenameTarget={libraryRenameTarget}
        t={t}
        updateLibraryPending={updateLibrary.isPending}
        onCloseDeleteLibraryDialog={closeDeleteLibraryDialog}
        onCloseRenameLibraryDialog={closeRenameLibraryDialog}
        onCreateLibrary={handleCreateLibrary}
        onDeleteLibrary={handleDeleteLibrary}
        onRenameLibrary={handleRenameLibrary}
        onSetLibraryCreateOpen={setLibraryCreateOpen}
        onSetLibraryDeleteConfirm={setLibraryDeleteConfirm}
        onSetLibraryDeleteOpen={setLibraryDeleteOpen}
        onSetLibraryDescription={setLibraryDescription}
        onSetLibraryName={setLibraryName}
        onSetLibraryRenameDescription={setLibraryRenameDescription}
        onSetLibraryRenameName={setLibraryRenameName}
        onSetLibraryRenameOpen={setLibraryRenameOpen}
      />

      <MoveDialogs
        confirmMoveOverwrite={confirmMoveOverwrite}
        createFolderOpen={createFolderOpen}
        destPickerCrumbs={destPickerCrumbs}
        destPickerItems={destPickerItems}
        destPickerOpen={destPickerOpen}
        destPickerPrefix={destPickerPrefix}
        destPickerQuery={destPickerQuery}
        folderName={folderName}
        moveConflictOpen={moveConflictOpen}
        moveDestPrefix={moveDestPrefix}
        moveName={moveName}
        moveNamePlaceholder={moveNamePlaceholder}
        moveOpen={moveOpen}
        moveOverwrite={moveOverwrite}
        normalizeFolderPrefixInput={normalizeFolderPrefixInput}
        selectedForMove={selectedForMove}
        selectedLibraryId={selectedLibraryId}
        t={t}
        onHandleCreateFolder={handleCreateFolder}
        onHandleMove={handleMove}
        onSetCreateFolderOpen={setCreateFolderOpen}
        onSetDestPickerOpen={setDestPickerOpen}
        onSetDestPickerPrefix={setDestPickerPrefix}
        onSetFolderName={setFolderName}
        onSetMoveConflictOpen={setMoveConflictOpen}
        onSetMoveDestPrefix={setMoveDestPrefix}
        onSetMoveName={setMoveName}
        onSetMoveOpen={setMoveOpen}
        onSetMoveOverwrite={setMoveOverwrite}
      />

      <ObjectOperationDialogs
        batchFailedKeys={batchFailedKeys}
        batchResultOpen={batchResultOpen}
        batchResultType={batchResultType}
        batchRetryPending={batchRetryPending}
        deleteConfirmOpen={deleteConfirmOpen}
        selectedCount={selected.length}
        t={t}
        uploadConflictFileName={uploadConflictFileName}
        uploadConflictOpen={uploadConflictOpen}
        onCloseBatchResult={closeBatchResult}
        onDismissUploadConflict={dismissUploadConflict}
        onHandleBatchResultOpenChange={handleBatchResultOpenChange}
        onHandleDelete={handleDelete}
        onHandleRetryBatchFailures={handleRetryBatchFailures}
        onHandleUploadConflictOpenChange={handleUploadConflictOpenChange}
        onResolveUploadConflictOverwrite={resolveUploadConflictOverwrite}
        onResolveUploadConflictRename={resolveUploadConflictRename}
        onSetDeleteConfirmOpen={setDeleteConfirmOpen}
      />
    </PageLayout>
  );
}
