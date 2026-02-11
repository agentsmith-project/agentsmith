/**
 * Sources Page - Object Browser (MinIO-like)
 *
 * This page intentionally focuses on the file manager UX:
 * libraries (bucket-like) + folders (prefixes) + objects (keys).
 *
 * AIReady / plugin processing is out of scope for this phase.
 */

'use client';

import * as React from 'react';
import {
  ArrowUp,
  ArrowUpDown,
  Download,
  Folder,
  FolderPlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
  Pencil,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Virtuoso } from 'react-virtuoso';

import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import { SourceObjectDetailsPanel } from '@/components/sources/SourceObjectDetailsPanel';

import type { SourceObjectsListItem } from '@/lib/api/types';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import {
  useCreateSourceLibrary,
  useDeleteSourceLibrary,
  useSourceLibraries,
  useUpdateSourceLibrary,
} from '@/lib/hooks/use-sources';
import {
  useCreateSourceFolder,
  useDeleteSourceObjects,
  useMoveSourceObject,
  useSourceObjectsInfinite,
  useUploadSourceObject,
} from '@/lib/hooks/use-source-objects';
import { parseSourceSortBy, SourceSortBy, SourceSortOrder, useSourcesUrlState } from '@/lib/hooks/use-sources-url-state';
import { useSourceUploadManager } from '@/components/sources/hooks/use-source-upload-manager';
import { useSourceBatchOperations } from '@/components/sources/hooks/use-source-batch-operations';
import { useSourceLibraryManager } from '@/components/sources/hooks/use-source-library-manager';
import { useSourceFolderMoveManager } from '@/components/sources/hooks/use-source-folder-move-manager';

export interface SourcesPageProps {
  workspaceId: string;
  projectId: string;
}

type SelectedRowId = `p:${string}` | `o:${string}`;

function rowId(item: SourceObjectsListItem): SelectedRowId {
  return item.kind === 'prefix' ? (`p:${item.prefix}` as const) : (`o:${item.key}` as const);
}

function parseSelectedRowId(id: SelectedRowId): { kind: 'prefix'; prefix: string } | { kind: 'object'; key: string } {
  if (id.startsWith('p:')) return { kind: 'prefix', prefix: id.slice(2) };
  return { kind: 'object', key: id.slice(2) };
}

function basename(path: string) {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf('/');
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

function buildCrumbs(prefix: string) {
  const normalized = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;
  const parts = (normalized || '').split('/').filter(Boolean);
  const crumbs: Array<{ label: string; prefix: string }> = [{ label: '', prefix: '' }];
  let cur = '';
  for (const p of parts) {
    cur = `${cur}${p}/`;
    crumbs.push({ label: p, prefix: cur });
  }
  return crumbs;
}

function parentPrefixForKey(key: string) {
  const idx = key.lastIndexOf('/');
  if (idx < 0) return '';
  return key.slice(0, idx + 1);
}

function parentPrefixForPrefix(prefix: string) {
  const normalized = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return '';
  return normalized.slice(0, idx + 1);
}

export function SourcesPage({ workspaceId, projectId }: SourcesPageProps) {
  const t = useTranslations('sources');
  const canManage = useHasPermission('project:source:manage');

  const { data: librariesData, isLoading: libsLoading } = useSourceLibraries(workspaceId, projectId);
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
  } = useSourcesUrlState(libraries);
  const [selectedIds, setSelectedIds] = React.useState<SelectedRowId[]>([]);

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
  const objectsQuery = useSourceObjectsInfinite(workspaceId, projectId, selectedLibraryId, listParams);
  const items = React.useMemo(
    () => objectsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [objectsQuery.data?.pages],
  );
  const filteredItems = items;

  const selected = React.useMemo(() => selectedIds.map(parseSelectedRowId), [selectedIds]);
  const selectedObjects = React.useMemo(
    () => selected.filter((s): s is { kind: 'object'; key: string } => s.kind === 'object'),
    [selected],
  );

  const createLibrary = useCreateSourceLibrary();
  const updateLibrary = useUpdateSourceLibrary();
  const deleteLibrary = useDeleteSourceLibrary();

  const createFolder = useCreateSourceFolder();
  const uploadObject = useUploadSourceObject();
  const deleteObjects = useDeleteSourceObjects();
  const moveObject = useMoveSourceObject();

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const crumbs = React.useMemo(() => buildCrumbs(prefix), [prefix]);

  const clearSelection = () => setSelectedIds([]);

  const navigateToPrefix = (nextPrefix: string) => {
    setPrefix(nextPrefix);
    setSearchImmediately('');
    clearSelection();
  };

  const toggleRow = (id: SelectedRowId) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const visibleSelectedCount = React.useMemo(
    () => filteredItems.filter((it) => selectedIds.includes(rowId(it))).length,
    [filteredItems, selectedIds],
  );
  const allSelected = filteredItems.length > 0 && visibleSelectedCount === filteredItems.length;
  const toggleAll = () => {
    setSelectedIds((prev) => (prev.length > 0 ? [] : filteredItems.map((it) => rowId(it))));
  };

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
  } = useSourceUploadManager({
    workspaceId,
    projectId,
    selectedLibraryId,
    prefix,
    uploadObject: uploadObject.mutateAsync,
    t,
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
  } = useSourceBatchOperations({
    workspaceId,
    projectId,
    selectedLibraryId,
    selected,
    selectedObjects,
    clearSelection,
    deleteObjects: deleteObjects.mutateAsync,
    onDeletePartialFailure: handleDeletePartialFailureSelection,
    t,
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
  } = useSourceLibraryManager({
    workspaceId,
    projectId,
    selectedLibraryId,
    setSelectedLibraryId,
    navigateToPrefix,
    createLibrary: createLibrary.mutateAsync,
    updateLibrary: updateLibrary.mutateAsync,
    deleteLibrary: deleteLibrary.mutateAsync,
    t,
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
  } = useSourceFolderMoveManager({
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
  });

  const handleSortByChange = React.useCallback(
    (value: SourceSortBy) => {
      updateSort(value, sortOrder);
    },
    [sortOrder, updateSort],
  );

  const handleSortOrderToggle = React.useCallback(() => {
    const nextOrder: SourceSortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    updateSort(sortBy, nextOrder);
  }, [sortBy, sortOrder, updateSort]);

  const loadNextObjectsPage = React.useCallback(() => {
    if (objectsQuery.hasNextPage && !objectsQuery.isFetchingNextPage) {
      void objectsQuery.fetchNextPage();
    }
  }, [objectsQuery]);

  return (
    <PageLayout
      header={<PageHeader title={t('title')} />}
      toolbar={(
        <PageToolbar>
          <div className="flex items-center gap-2 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={() => void objectsQuery.refetch()}
              disabled={!selectedLibraryId}
              data-testid="sources__refresh"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('file_manager.refresh')}
            </Button>
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('file_manager.search_placeholder')}
                className="pl-9"
                data-testid="sources__search"
              />
            </div>
            <div className="hidden lg:flex items-center gap-2">
              <Select
                value={sortBy}
                onValueChange={(value) => handleSortByChange(parseSourceSortBy(value))}
              >
                <SelectTrigger className="h-9 w-[180px]" data-testid="sources__sort-by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">{t('file_manager.sort_name')}</SelectItem>
                  <SelectItem value="size_bytes">{t('file_manager.sort_size')}</SelectItem>
                  <SelectItem value="last_modified">{t('file_manager.sort_modified')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                className="h-9 px-3"
                onClick={handleSortOrderToggle}
                data-testid="sources__sort-order"
              >
                <ArrowUpDown className="h-4 w-4 mr-2" />
                {sortOrder === 'asc' ? t('file_manager.order_asc') : t('file_manager.order_desc')}
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {uploadInProgress && (
                <div className="hidden xl:flex items-center gap-2 rounded-md border border-subtle bg-surface-high/40 px-2.5 py-1.5 min-w-[300px]" data-testid="sources__upload-progress">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-primary truncate">
                      {t('file_manager.uploading', {
                        name: uploadCurrentFileName || '-',
                        completed: String(uploadQueueCompleted),
                        total: String(uploadQueueTotal),
                      })}
                    </div>
                    <Progress value={uploadCurrentProgress} className="mt-1 h-1.5" />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={handleCancelUpload}
                    data-testid="sources__upload-cancel"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    {t('file_manager.upload_cancel')}
                  </Button>
                </div>
              )}
              <div
                className={cn(
                  'hidden xl:flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-opacity min-w-[170px]',
                  selected.length > 0
                    ? 'border-subtle bg-surface-high/40 text-primary opacity-100'
                    : 'border-transparent text-transparent opacity-0 pointer-events-none select-none',
                )}
                data-testid="sources__selection-summary"
              >
                <span>{t('file_manager.selected_count', { count: String(selected.length) })}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={clearSelection}
                  data-testid="sources__clear-selection"
                >
                  {t('file_manager.clear_selection')}
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateFolderOpen(true)}
                disabled={!selectedLibraryId}
                data-testid="sources__new-folder"
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                {t('file_manager.new_folder')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
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
                disabled={!selectedLibraryId || selected.length !== 1}
                data-testid="sources__rename"
              >
                <Pencil className="h-4 w-4 mr-2" />
                {t('file_manager.rename')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={!selectedLibraryId || selected.length === 0}
                data-testid="sources__delete"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('file_manager.delete')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleDownload}
                disabled={!selectedLibraryId || selectedObjects.length === 0}
                data-testid="sources__download"
              >
                <Download className="h-4 w-4 mr-2" />
                {selectedObjects.length > 1
                  ? t('file_manager.download_selected', { count: String(selectedObjects.length) })
                  : t('file_manager.download')}
              </Button>
              <Button
                type="button"
                onClick={handleUploadClick}
                disabled={!selectedLibraryId || uploadInProgress}
                data-testid="sources__upload"
              >
                <Upload className="h-4 w-4 mr-2" />
                {t('file_manager.upload')}
              </Button>
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
            </div>
          </div>
        </PageToolbar>
      )}
    >
      <div className="flex-1 min-h-0 grid grid-cols-[260px_minmax(0,1fr)_320px] gap-3">
        <div className="min-h-0 rounded-md border border-subtle bg-surface">
          <div className="px-3 py-2 border-b border-subtle flex items-center justify-between">
            <div className="text-sm text-primary">{t('file_manager.libraries')}</div>
            {canManage && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => {
                  openCreateLibraryDialog();
                }}
                aria-label={t('file_manager.library_create')}
                data-testid="sources__library-create"
              >
                <Plus className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="min-h-0 overflow-auto">
            {libsLoading ? (
              <div className="p-3 text-sm text-tertiary">{t('file_manager.loading')}</div>
            ) : libraries.length === 0 ? (
              <div className="p-3 text-sm text-tertiary">{t('file_manager.no_libraries')}</div>
            ) : (
              <div className="p-1" data-testid="sources__library-list">
                {libraries.map((lib) => {
                  const active = lib.id === selectedLibraryId;
                  return (
                    <div
                      key={lib.id}
                      onClick={() => {
                        setSelectedLibraryId(lib.id);
                        setPrefix('');
                        setSearchImmediately('');
                        clearSelection();
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        setSelectedLibraryId(lib.id);
                        setPrefix('');
                        setSearchImmediately('');
                        clearSelection();
                      }}
                      className={cn(
                        'w-full text-left px-3 py-2 rounded-sm flex items-center justify-between gap-2',
                        active ? 'bg-hover text-strong' : 'hover:bg-hover/70 text-primary',
                      )}
                      role="button"
                      tabIndex={0}
                      data-testid={`sources__library-item--${lib.id}`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm">{lib.name}</div>
                        {lib.bucket && <div className="truncate text-[11px] text-tertiary">{lib.bucket}</div>}
                      </div>
                      {canManage && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openRenameLibraryDialog(lib);
                            }}
                            aria-label={t('file_manager.library_rename')}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openDeleteLibraryDialog(lib);
                            }}
                            aria-label={t('file_manager.library_delete')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div
          className="relative min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col"
          onDragEnter={handleDropEnter}
          onDragOver={handleDropOver}
          onDragLeave={handleDropLeave}
          onDrop={handleDrop}
          data-testid="sources__dropzone"
        >
          <div className="px-3 py-2 border-b border-subtle flex items-center gap-2">
            <div className="text-sm text-primary">{t('file_manager.location')}</div>
            {prefix ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => navigateToPrefix(parentPrefixForPrefix(prefix))}
                data-testid="sources__go-up"
              >
                <ArrowUp className="h-3.5 w-3.5 mr-1" />
                {t('file_manager.go_up')}
              </Button>
            ) : null}
            <div className="flex items-center gap-1 min-w-0">
              {crumbs.map((c, idx) => (
                <React.Fragment key={c.prefix || 'root'}>
                  {idx > 0 && <span className="text-tertiary text-sm">/</span>}
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline truncate max-w-[160px]"
                    onClick={() => navigateToPrefix(c.prefix)}
                    data-testid={idx === 0 ? 'sources__breadcrumb-root' : `sources__breadcrumb--${idx}`}
                  >
                    {idx === 0 ? t('file_manager.root') : c.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
            <div className="ml-auto text-xs text-tertiary tabular-nums">
              {filteredItems.length} {t('file_manager.items')}
            </div>
          </div>

          <div className="flex-1 min-h-0">
            <div className="w-full h-full text-sm flex flex-col" data-testid="sources__objects-table">
              <div className="sticky top-0 z-10 bg-surface border-b border-subtle text-xs text-tertiary">
                <div className="grid grid-cols-[40px_minmax(0,1fr)_128px_192px]">
                  <div className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={t('file_manager.select_all')}
                    />
                  </div>
                  <div className="px-3 py-2">{t('file_manager.col_name')}</div>
                  <div className="px-3 py-2 text-right">{t('file_manager.col_size')}</div>
                  <div className="px-3 py-2">{t('file_manager.col_modified')}</div>
                </div>
              </div>

              <div className="flex-1 min-h-0">
                {objectsQuery.isLoading ? (
                  <div className="px-3 py-8 text-center text-tertiary">{t('file_manager.loading')}</div>
                ) : filteredItems.length === 0 ? (
                  <div className="px-3 py-10 text-center text-tertiary">{t('file_manager.empty')}</div>
                ) : (
                  <Virtuoso
                    style={{ height: '100%' }}
                    data={filteredItems}
                    endReached={loadNextObjectsPage}
                    overscan={240}
                    itemContent={(_index, it) => {
                      const id = rowId(it);
                      const checked = selectedIds.includes(id);
                      return (
                        <div
                          key={id}
                          className={cn(
                            'grid grid-cols-[40px_minmax(0,1fr)_128px_192px] border-b border-subtle hover:bg-hover/60',
                            checked && 'bg-hover',
                          )}
                          data-testid="sources__object-row"
                          data-row-id={id}
                        >
                          <div className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRow(id)}
                              aria-label={t('file_manager.select_row')}
                            />
                          </div>
                          <div className="px-3 py-2 min-w-0">
                            <button
                              type="button"
                              className="flex items-center gap-2 w-full text-left"
                              onClick={() => {
                                if (it.kind === 'prefix') {
                                  navigateToPrefix(it.prefix);
                                  return;
                                }
                                toggleRow(id);
                              }}
                            >
                              {it.kind === 'prefix' ? (
                                <Folder className="h-4 w-4 text-tertiary shrink-0" />
                              ) : (
                                <span className="h-4 w-4 rounded-sm bg-surface-high border border-subtle shrink-0" />
                              )}
                              <span className="truncate">{it.name}</span>
                            </button>
                          </div>
                          <div className="px-3 py-2 text-right text-tertiary tabular-nums">
                            {it.kind === 'object' ? it.size_bytes.toLocaleString() : ''}
                          </div>
                          <div className="px-3 py-2 text-tertiary truncate">
                            {it.kind === 'object' ? new Date(it.last_modified).toLocaleString() : ''}
                          </div>
                        </div>
                      );
                    }}
                    components={{
                      Footer: () =>
                        objectsQuery.hasNextPage ? (
                          <div className="flex items-center justify-center py-3">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={loadNextObjectsPage}
                              disabled={objectsQuery.isFetchingNextPage}
                              data-testid="sources__load-more"
                            >
                              {objectsQuery.isFetchingNextPage
                                ? t('file_manager.loading')
                                : t('file_manager.load_more')}
                            </Button>
                          </div>
                        ) : null,
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {isDropActive && (
            <div className="absolute inset-0 z-20 bg-surface/95 backdrop-blur-[1px] border-2 border-dashed border-accent flex items-center justify-center pointer-events-none" data-testid="sources__dropzone-overlay">
              <div className="text-center px-6">
                <div className="text-sm font-medium text-strong">{t('file_manager.dropzone_title')}</div>
                <div className="mt-1 text-xs text-tertiary">{t('file_manager.dropzone_hint')}</div>
              </div>
            </div>
          )}
        </div>

        <SourceObjectDetailsPanel
          workspaceId={workspaceId}
          projectId={projectId}
          selectedLibraryId={selectedLibraryId}
          selected={selected}
          onDownload={handleDownload}
        />
      </div>

      <Dialog open={libraryCreateOpen} onOpenChange={setLibraryCreateOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="sources__dialog__library-create">
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
                data-testid="sources__library-create__name"
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
                data-testid="sources__library-create__description"
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
              data-testid="sources__library-create__submit"
            >
              {t('file_manager.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryRenameOpen} onOpenChange={setLibraryRenameOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="sources__dialog__library-rename">
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
                data-testid="sources__library-rename__name"
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
                data-testid="sources__library-rename__description"
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
              data-testid="sources__library-rename__submit"
            >
              {t('file_manager.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryDeleteOpen} onOpenChange={setLibraryDeleteOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="sources__dialog__library-delete">
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
                data-testid="sources__library-delete__confirm"
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
              data-testid="sources__library-delete__submit"
            >
              {t('file_manager.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="sources__dialog__new-folder">
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
        <DialogContent className="sm:max-w-[560px]" data-testid="sources__dialog__move">
          <DialogHeader>
            <DialogTitle>{t('file_manager.rename')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2">
              <div className="text-[11px] text-tertiary">{t('file_manager.from')}</div>
              <div className="font-mono text-xs break-all text-primary" data-testid="sources__move__from">
                {selectedForMove ? (selectedForMove.kind === 'object' ? selectedForMove.key : selectedForMove.prefix) : '-'}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="sources-move-dest">{t('file_manager.dest_prefix')}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setDestPickerPrefix(moveDestPrefix);
                      setDestPickerOpen(true);
                    }}
                    data-testid="sources__move__browse"
                  >
                    {t('file_manager.browse')}
                  </Button>
                </div>
                <Input
                  id="sources-move-dest"
                  value={moveDestPrefix}
                  onChange={(e) => setMoveDestPrefix(e.target.value)}
                  placeholder={t('file_manager.dest_prefix_placeholder')}
                  data-testid="sources__move__dest-prefix"
                />
                <div className="text-[11px] text-tertiary">{t('file_manager.dest_prefix_hint')}</div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sources-move-name">{t('file_manager.new_name')}</Label>
                <Input
                  id="sources-move-name"
                  value={moveName}
                  onChange={(e) => setMoveName(e.target.value)}
                  placeholder={moveNamePlaceholder}
                  data-testid="sources__move__name"
                />
                <div className="text-[11px] text-tertiary">{t('file_manager.rename_hint')}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="sources-move-overwrite"
                checked={moveOverwrite}
                onCheckedChange={(v) => setMoveOverwrite(v === true)}
                data-testid="sources__move__overwrite"
              />
              <Label htmlFor="sources-move-overwrite" className="text-sm">
                {t('file_manager.overwrite')}
              </Label>
            </div>

            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2">
              <div className="text-[11px] text-tertiary">{t('file_manager.to')}</div>
              <div className="font-mono text-xs break-all text-primary" data-testid="sources__move__to">
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
              data-testid="sources__move__submit"
            >
              {t('file_manager.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={destPickerOpen} onOpenChange={setDestPickerOpen}>
        <DialogContent className="sm:max-w-[720px]" data-testid="sources__dialog__dest-picker">
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
                    data-testid={idx === 0 ? 'sources__dest-picker__breadcrumb-root' : `sources__dest-picker__breadcrumb--${idx}`}
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
                        data-testid="sources__dest-picker__row"
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
              data-testid="sources__dest-picker__select"
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
        testId="sources__dialog__move-conflict"
      />

      <Dialog
        open={uploadConflictOpen}
        onOpenChange={handleUploadConflictOpenChange}
      >
        <DialogContent className="sm:max-w-[520px]" data-testid="sources__dialog__upload-conflict">
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
            <Button type="button" variant="outline" onClick={resolveUploadConflictRename} data-testid="sources__upload-conflict__rename">
              {t('file_manager.upload_conflict_rename')}
            </Button>
            <Button type="button" variant="destructive" onClick={resolveUploadConflictOverwrite} data-testid="sources__upload-conflict__overwrite">
              {t('file_manager.upload_conflict_overwrite')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="sources__dialog__delete">
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
        <DialogContent className="sm:max-w-[620px]" data-testid="sources__dialog__batch-result">
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
                  <div key={key} className="px-3 py-2 text-xs font-mono break-all text-primary" data-testid="sources__batch-result__row">
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
              data-testid="sources__batch-result__retry"
            >
              {t('file_manager.retry_failed')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
