import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileText, FolderPlus, Pencil, RefreshCw, RotateCcw, Search, Trash2, Upload, X } from 'lucide-react';
import { Virtuoso } from 'react-virtuoso';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { FileItemIcon } from '@/components/files/FileItemIcon';
import { formatBytes } from '@/lib/utils/formatters';
import type { FileLibrary, FileObjectsListItem } from '@/lib/api/types';
import type { FileSortBy, FileSortOrder } from '@/lib/hooks/use-files-url-state';
import type { FileSelectionMode, SelectedRowId } from './utils';
import { getRuntimeSystemDotFolderInfo, rowId } from './utils';

type FilesBrowserPaneProps = {
  t: (key: string, values?: Record<string, string>) => string;
  canManage: boolean;
  prefix: string;
  crumbs: Array<{ label: string; prefix: string }>;
  searchInput: string;
  setSearchInput: (value: string) => void;
  selectedLibraryId: string | null;
  selectedLibraryStatus: 'creating' | 'ready' | 'degraded' | 'failed' | 'deleting' | null;
  selectedLibraryTaskHomeBinding: Pick<
    FileLibrary,
    'task_home_binding_status' | 'bound_task_visible' | 'bound_task_title' | 'bound_task_status'
  > | null;
  filteredItems: FileObjectsListItem[];
  selectedIds: SelectedRowId[];
  selectionMode: FileSelectionMode;
  selectedCount: number;
  selectedObjectsCount: number;
  allSelected: boolean;
  hasSelection: boolean;
  uploadCanCancel: boolean;
  uploadInProgress: boolean;
  uploadCurrentFileName: string;
  uploadQueueCompleted: number;
  uploadQueueTotal: number;
  uploadCurrentProgress: number;
  isDropActive: boolean;
  sortBy: FileSortBy;
  sortOrder: FileSortOrder;
  objectsQuery: {
    isLoading: boolean;
    isFetching: boolean;
    isFetchingNextPage: boolean;
    hasNextPage: boolean | undefined;
    refetch: () => void;
    fetchNextPage: () => Promise<unknown>;
  };
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  selectedForMove:
    | { kind: 'prefix'; prefix: string }
    | { kind: 'object'; key: string }
    | null;
  moveNamePlaceholder: string;
  onNavigateToPrefix: (prefix: string) => void;
  onGoUp: () => void;
  onRefresh: () => void;
  onCreateFolder: () => void;
  onOpenTemplateManagement: () => void;
  onOpenVersionManagement: () => void;
  onUploadClick: () => void;
  onCancelUpload: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onClearSelection: () => void;
  onToggleAll: () => void;
  onSortHeaderClick: (sortBy: FileSortBy) => void;
  onLoadNextPage: () => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onDropEnter: (event: React.DragEvent<HTMLDivElement>) => void;
  onDropOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDropLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onRowActivate: (
    event: React.MouseEvent<HTMLButtonElement>,
    item: FileObjectsListItem,
    id: SelectedRowId,
    index: number,
  ) => void;
  onRowOpen: (item: FileObjectsListItem) => void;
  onToggleRowCheckbox: (id: SelectedRowId, index: number) => void;
};

function SortIcon({ active, order }: { active: boolean; order: FileSortOrder }) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5" />;
  return order === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;
}

function emptyDescriptionKey(prefix: string, canWrite: boolean) {
  if (!canWrite) return 'file_manager.empty_read_only_description';
  if (!prefix) return 'file_manager.empty_home_root_description';
  if (prefix === 'workspace/') return 'file_manager.empty_workspace_description';
  return 'file_manager.empty_description';
}

function libraryUnavailableReasonKey(status: FilesBrowserPaneProps['selectedLibraryStatus']) {
  if (status === 'failed') return 'file_manager.library_status_reason_failed';
  if (status === 'degraded') return 'file_manager.library_status_reason_degraded';
  return null;
}

export function FilesBrowserPane(props: FilesBrowserPaneProps) {
  const {
    t,
    canManage,
    prefix,
    crumbs,
    searchInput,
    setSearchInput,
    selectedLibraryId,
    selectedLibraryStatus,
    selectedLibraryTaskHomeBinding,
    filteredItems,
    selectedIds,
    selectionMode,
    selectedCount,
    selectedObjectsCount,
    allSelected,
    hasSelection,
    uploadCanCancel,
    uploadInProgress,
    uploadCurrentFileName,
    uploadQueueCompleted,
    uploadQueueTotal,
    uploadCurrentProgress,
    isDropActive,
    sortBy,
    sortOrder,
    objectsQuery,
    onNavigateToPrefix,
    onGoUp,
    onRefresh,
    onCreateFolder,
    onOpenTemplateManagement,
    onOpenVersionManagement,
    onUploadClick,
    onCancelUpload,
    onRename,
    onDelete,
    onDownload,
    onClearSelection,
    onToggleAll,
    onSortHeaderClick,
    onLoadNextPage,
    onDrop,
    onDropEnter,
    onDropOver,
    onDropLeave,
    onRowActivate,
    onRowOpen,
    onToggleRowCheckbox,
    selectedForMove: _selectedForMove,
    moveNamePlaceholder: _moveNamePlaceholder,
  } = props;

  const isMultiMode = selectionMode === 'multi';
  const selectedLibraryUnavailable = selectedLibraryStatus !== null && selectedLibraryStatus !== 'ready';
  const unavailableReasonKey = libraryUnavailableReasonKey(selectedLibraryStatus);
  const libraryActionsDisabled = !selectedLibraryId || selectedLibraryUnavailable;
  const showWriteActions = canManage;
  const selectedLibraryBound = selectedLibraryTaskHomeBinding?.task_home_binding_status === 'bound';
  const homeRootNoteKey = selectedLibraryBound
    ? 'file_manager.home_root_note_bound'
    : 'file_manager.home_root_note';
  const boundLibraryBanner = selectedLibraryBound
    ? (
        selectedLibraryTaskHomeBinding.bound_task_visible && selectedLibraryTaskHomeBinding.bound_task_title
          ? t('file_manager.library_bound_home_banner_visible', {
              title: selectedLibraryTaskHomeBinding.bound_task_title,
              status: selectedLibraryTaskHomeBinding.bound_task_status ?? 'unknown',
            })
          : t('file_manager.library_bound_home_banner')
      )
    : null;

  return (
    <div
      className="relative flex min-h-0 flex-col overflow-hidden rounded-md border border-subtle bg-surface/78 shadow-ambient"
      onDragEnter={onDropEnter}
      onDragOver={onDropOver}
      onDragLeave={onDropLeave}
      onDrop={onDrop}
      data-testid="files__dropzone"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-3.5 py-1.5">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase text-tertiary">{t('file_manager.location')}</div>
          <div className="mt-0.5 text-sm text-secondary">{selectedLibraryId ? t('file_manager.home_root') : t('file_manager.no_libraries')}</div>
          {selectedLibraryId && !prefix ? (
            <div className="mt-0.5 max-w-[360px] text-[11px] text-tertiary" data-testid="files__root-scope-note">
              {t(homeRootNoteKey)}
            </div>
          ) : null}
        </div>
        {prefix ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2"
            onClick={onGoUp}
            data-testid="files__go-up"
          >
            <ArrowUp className="h-3.5 w-3.5 mr-1" />
            {t('file_manager.go_up')}
          </Button>
        ) : null}
        <div className="flex items-center gap-1 min-w-0">
          {crumbs.map((crumb, index) => (
            <React.Fragment key={crumb.prefix || 'root'}>
              {index > 0 ? <span className="text-tertiary text-sm">/</span> : null}
              <button
                type="button"
                className="text-sm text-primary hover:underline truncate max-w-[160px]"
                onClick={() => onNavigateToPrefix(crumb.prefix)}
                data-testid={index === 0 ? 'files__breadcrumb-root' : `files__breadcrumb--${index}`}
              >
                {index === 0 ? t('file_manager.home_root') : crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="text-[11px] text-tertiary">
            {isMultiMode
              ? t('file_manager.selected_count', { count: String(selectedCount) })
              : `${filteredItems.length} ${t('file_manager.items')}`}
          </div>
          <div className="relative w-[240px] max-w-full">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t('file_manager.search_placeholder')}
              className="h-8 pl-9 pr-9 bg-surface-high/20"
              data-testid="files__search"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-tertiary hover:text-primary"
              onClick={onRefresh}
              disabled={libraryActionsDisabled}
              data-testid="files__refresh"
              title={t('file_manager.refresh')}
              aria-label={t('file_manager.refresh')}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
          {showWriteActions ? (
            <>
              <Button type="button" variant="outline" onClick={onCreateFolder} disabled={libraryActionsDisabled} data-testid="files__new-folder">
                <FolderPlus className="h-4 w-4 mr-2" />
                {t('file_manager.new_folder')}
              </Button>
              <Button type="button" variant="outline" onClick={onOpenVersionManagement} disabled={libraryActionsDisabled} data-testid="files__version-entry">
                <RotateCcw className="h-4 w-4 mr-2" />
                {t('file_manager.version_save_restore_entry')}
              </Button>
              <Button type="button" variant="outline" onClick={onOpenTemplateManagement} disabled={libraryActionsDisabled} data-testid="files__template-entry">
                <FileText className="h-4 w-4 mr-2" />
                {t('file_manager.template_save_publish_entry')}
              </Button>
              <Button type="button" onClick={onUploadClick} disabled={libraryActionsDisabled || uploadInProgress} data-testid="files__upload">
                <Upload className="h-4 w-4 mr-2" />
                {t('file_manager.upload')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <div className="w-full h-full text-sm flex flex-col" data-testid="files__objects-table">
          {boundLibraryBanner ? (
            <div
              className="border-b border-warning/25 bg-warning/10 px-3.5 py-2 text-xs text-warning"
              data-testid="files__bound-home-banner"
            >
              {boundLibraryBanner}
            </div>
          ) : null}
          <div className="flex min-h-0 items-center justify-between gap-2 border-b border-subtle px-3.5 py-1.5" data-testid="files__selection-summary">
            {isMultiMode ? (
              <div className="flex items-center gap-2 min-w-0 text-[11px] text-primary">
                <span>{t('file_manager.selected_count', { count: String(selectedCount) })}</span>
                <span className="text-tertiary">{t('file_manager.multi_select_hint_esc')}</span>
              </div>
            ) : selectedCount === 1 ? (
              <div className="flex items-center gap-2 min-w-0 text-[11px] text-tertiary">
                <span>{t('file_manager.selected_count', { count: '1' })}</span>
              </div>
            ) : (
              <div className="min-w-0 text-[11px] text-tertiary" data-testid="files__selection-shortcuts">
                {t('file_manager.selection_shortcuts')}
              </div>
            )}

            <div className="flex items-center gap-2 shrink-0">
              {showWriteActions && uploadInProgress ? (
                <div className="flex items-center gap-2 rounded-md bg-surface-high/30 px-2.5 py-1.5 min-w-[260px]" data-testid="files__upload-progress">
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
                    onClick={onCancelUpload}
                    disabled={!uploadCanCancel}
                    data-testid="files__upload-cancel"
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    {t('file_manager.upload_cancel')}
                  </Button>
                </div>
              ) : null}

              {showWriteActions ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    onClick={onRename}
                    disabled={libraryActionsDisabled || selectedCount !== 1}
                    data-testid="files__rename"
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    {t('file_manager.rename')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs"
                    onClick={onDelete}
                    disabled={libraryActionsDisabled || selectedCount === 0}
                    data-testid="files__delete"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {t('file_manager.delete')}
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={onDownload}
                disabled={libraryActionsDisabled || selectedObjectsCount === 0}
                data-testid="files__download"
              >
                <Download className="h-3.5 w-3.5 mr-1" />
                {selectedObjectsCount > 1
                  ? t('file_manager.download_selected', { count: String(selectedObjectsCount) })
                  : t('file_manager.download')}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onClearSelection} disabled={!hasSelection} data-testid="files__clear-selection">
                {t('file_manager.clear_selection')}
              </Button>
            </div>
          </div>

          <div className="sticky top-0 z-10 bg-surface/95 border-b border-subtle text-xs text-tertiary">
            <div className={cn('grid', isMultiMode ? 'grid-cols-[40px_minmax(0,1fr)_128px_192px]' : 'grid-cols-[minmax(0,1fr)_128px_192px]')}>
              {isMultiMode ? (
                <div className="px-3 py-2">
                  <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label={t('file_manager.select_all')} />
                </div>
              ) : null}
              <div className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-primary"
                  onClick={() => onSortHeaderClick('name')}
                  data-testid="files__sort-header--name"
                  data-active={sortBy === 'name' ? 'true' : 'false'}
                  data-order={sortBy === 'name' ? sortOrder : 'none'}
                >
                  {t('file_manager.col_name')}
                  <SortIcon active={sortBy === 'name'} order={sortOrder} />
                </button>
              </div>
              <div className="px-3 py-2 text-right">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-primary"
                  onClick={() => onSortHeaderClick('size_bytes')}
                  data-testid="files__sort-header--size_bytes"
                  data-active={sortBy === 'size_bytes' ? 'true' : 'false'}
                  data-order={sortBy === 'size_bytes' ? sortOrder : 'none'}
                >
                  {t('file_manager.col_size')}
                  <SortIcon active={sortBy === 'size_bytes'} order={sortOrder} />
                </button>
              </div>
              <div className="px-3 py-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-primary"
                  onClick={() => onSortHeaderClick('last_modified')}
                  data-testid="files__sort-header--last_modified"
                  data-active={sortBy === 'last_modified' ? 'true' : 'false'}
                  data-order={sortBy === 'last_modified' ? sortOrder : 'none'}
                >
                  {t('file_manager.col_modified')}
                  <SortIcon active={sortBy === 'last_modified'} order={sortOrder} />
                </button>
              </div>
            </div>
          </div>

          <div className="flex-1 min-h-0">
            {selectedLibraryUnavailable ? (
              <div
                className="px-6 py-12 text-center"
                data-testid="files__library-unavailable-empty-state"
              >
                <div className="text-sm font-medium text-primary">
                  {t('file_manager.library_unavailable_title')}
                </div>
                <div className="mt-2 text-sm text-tertiary">
                  {t('file_manager.library_unavailable_description')}
                </div>
                {unavailableReasonKey ? (
                  <div className="mt-2 text-sm text-secondary" data-testid="files__library-unavailable-reason">
                    {t(unavailableReasonKey)}
                  </div>
                ) : null}
              </div>
            ) : objectsQuery.isLoading ? (
              <div className="px-3 py-8 text-center text-tertiary">{t('file_manager.loading')}</div>
            ) : filteredItems.length === 0 ? (
              <div className="px-4 py-12 text-center" data-testid="files__empty-state">
                <div className="mx-auto flex max-w-[520px] flex-col items-center gap-3 rounded-md border border-dashed border-subtle bg-surface-low px-5 py-6">
                  <div>
                    <div className="text-sm font-medium text-primary">
                      {searchInput.trim().length > 0
                        ? t('file_manager.search_empty_title')
                        : t('file_manager.empty')}
                    </div>
                    <div className="mt-2 text-sm text-tertiary">
                      {searchInput.trim().length > 0
                        ? t('file_manager.search_empty_description')
                        : t(emptyDescriptionKey(prefix, showWriteActions))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {searchInput.trim().length > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => setSearchInput('')}
                        data-testid="files__empty-clear-search"
                      >
                        {t('file_manager.search_empty_clear')}
                      </Button>
                    ) : null}
                    {showWriteActions ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={onCreateFolder}
                          disabled={libraryActionsDisabled}
                          data-testid="files__empty-new-folder"
                        >
                          <FolderPlus className="h-3.5 w-3.5 mr-1" />
                          {t('file_manager.new_folder')}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          onClick={onUploadClick}
                          disabled={libraryActionsDisabled || uploadInProgress}
                          data-testid="files__empty-upload"
                        >
                          <Upload className="h-3.5 w-3.5 mr-1" />
                          {t('file_manager.upload')}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : (
              <Virtuoso
                style={{ height: '100%' }}
                data={filteredItems}
                endReached={onLoadNextPage}
                overscan={240}
                itemContent={(index, item) => {
                  const id = rowId(item);
                  const checked = selectedIds.includes(id);
                  const runtimeSystemDotFolder = getRuntimeSystemDotFolderInfo(item);
                  return (
                    <div
                      key={id}
                      className={cn(
                        'grid border-b border-subtle hover:bg-hover/60',
                        isMultiMode ? 'grid-cols-[40px_minmax(0,1fr)_128px_192px]' : 'grid-cols-[minmax(0,1fr)_128px_192px]',
                        checked && 'bg-hover',
                      )}
                      data-testid="files__object-row"
                      data-row-id={id}
                    >
                      {isMultiMode ? (
                        <div className="px-3 py-2">
                          <input type="checkbox" checked={checked} onChange={() => onToggleRowCheckbox(id, index)} aria-label={t('file_manager.select_row')} />
                        </div>
                      ) : null}
                      <div className="px-3 py-2 min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            onClick={(event) => onRowActivate(event, item, id, index)}
                            onDoubleClick={() => onRowOpen(item)}
                          >
                            <FileItemIcon
                              kind={item.kind}
                              name={item.name}
                              contentType={item.kind === 'object' ? item.content_type : undefined}
                              className="h-4 w-4 text-tertiary shrink-0"
                            />
                            <span className="truncate" title={item.name} aria-label={item.name}>
                              {item.name}
                            </span>
                          </button>
                          {runtimeSystemDotFolder ? (
                            <span
                              className="shrink-0 rounded-sm border border-warning/25 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium leading-none text-warning"
                              data-testid={`files__object-row__runtime-system-badge--${runtimeSystemDotFolder.testIdSegment}`}
                              title={t('file_manager.runtime_system_badge')}
                            >
                              {t('file_manager.runtime_system_badge')}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="px-3 py-2 text-right text-tertiary tabular-nums">
                        {item.kind === 'object' ? formatBytes(item.size_bytes) : ''}
                      </div>
                      <div className="px-3 py-2 text-tertiary truncate">
                        {item.kind === 'object' ? new Date(item.last_modified).toLocaleString() : ''}
                      </div>
                    </div>
                  );
                }}
                components={{
                  Footer: () =>
                    objectsQuery.hasNextPage ? (
                      <div className="flex items-center justify-center py-3">
                        <Button type="button" variant="ghost" size="sm" onClick={onLoadNextPage} disabled={objectsQuery.isFetchingNextPage} data-testid="files__load-more">
                          {objectsQuery.isFetchingNextPage ? t('file_manager.loading') : t('file_manager.load_more')}
                        </Button>
                      </div>
                    ) : null,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {isDropActive ? (
        <div className="absolute inset-0 z-20 bg-surface/95 backdrop-blur-[1px] border-2 border-dashed border-accent flex items-center justify-center pointer-events-none" data-testid="files__dropzone-overlay">
          <div className="text-center px-6">
            <div className="text-sm font-medium text-strong">{t('file_manager.dropzone_title')}</div>
            <div className="mt-1 text-xs text-tertiary">{t('file_manager.dropzone_hint')}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
