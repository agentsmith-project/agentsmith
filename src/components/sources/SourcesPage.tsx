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
  Download,
  Folder,
  FolderPlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Pencil,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageToolbar } from '@/components/layout/PageToolbar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';

import { getApiClient, SourcesAPI } from '@/lib/api';
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
  useSourceObjects,
  useUploadSourceObject,
} from '@/lib/hooks/use-source-objects';
import { queryKeys } from '@/lib/query-keys';

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

export function SourcesPage({ workspaceId, projectId }: SourcesPageProps) {
  const t = useTranslations('sources');
  const canManage = useHasPermission('project:source:manage');

  const { data: librariesData, isLoading: libsLoading } = useSourceLibraries(workspaceId, projectId);
  const libraries = React.useMemo(() => librariesData?.items ?? [], [librariesData?.items]);

  const [selectedLibraryId, setSelectedLibraryId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (selectedLibraryId) return;
    if (libraries.length === 0) return;
    setSelectedLibraryId(libraries[0].id);
  }, [libraries, selectedLibraryId]);

  const [prefix, setPrefix] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [selectedIds, setSelectedIds] = React.useState<SelectedRowId[]>([]);

  const listParams = React.useMemo(() => ({ prefix, delimiter: '/' as const, page_size: 200 }), [prefix]);
  const objectsQuery = useSourceObjects(workspaceId, projectId, selectedLibraryId, listParams);
  const items = React.useMemo(() => objectsQuery.data?.items ?? [], [objectsQuery.data?.items]);
  const filteredItems = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => it.name.toLowerCase().includes(q));
  }, [items, search]);

  const selected = React.useMemo(() => selectedIds.map(parseSelectedRowId), [selectedIds]);
  const selectedObject = selected.length === 1 && selected[0].kind === 'object' ? selected[0] : null;

  const metaQuery = useQuery({
    queryKey: selectedLibraryId && selectedObject
      ? queryKeys.sourceObjects.meta(workspaceId, projectId, selectedLibraryId, selectedObject.key)
      : ['source-object-meta', 'disabled', workspaceId, projectId],
    queryFn: async () => {
      if (!selectedLibraryId || !selectedObject) throw new Error('meta disabled');
      const api = new SourcesAPI(getApiClient());
      return api.getObjectMeta(workspaceId, projectId, selectedLibraryId, selectedObject.key);
    },
    enabled: !!selectedLibraryId && !!selectedObject,
    staleTime: 5_000,
  });

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
    setSearch('');
    clearSelection();
  };

  const toggleRow = (id: SelectedRowId) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const allSelected = filteredItems.length > 0 && selectedIds.length === filteredItems.length;
  const toggleAll = () => {
    setSelectedIds((prev) => (prev.length > 0 ? [] : filteredItems.map((it) => rowId(it))));
  };

  const [createFolderOpen, setCreateFolderOpen] = React.useState(false);
  const [folderName, setFolderName] = React.useState('');
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState('');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);

  const selectedForRename = selected.length === 1 ? selected[0] : null;
  const renamePlaceholder = selectedForRename
    ? (selectedForRename.kind === 'object' ? basename(selectedForRename.key) : basename(selectedForRename.prefix))
    : '';

  const handleUploadClick = () => fileInputRef.current?.click();

  const handleFilesPicked = async (files: FileList | null) => {
    if (!files || !selectedLibraryId) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    for (const f of list) {
      try {
        await uploadObject.mutateAsync({
          workspaceId,
          projectId,
          libraryId: selectedLibraryId,
          file: f,
          prefix: prefix || undefined,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`${t('file_manager.upload_failed')}: ${msg}`);
        return;
      }
    }
    toast.success(t('file_manager.upload_success'));
  };

  const handleCreateFolder = async () => {
    if (!selectedLibraryId) return;
    const name = folderName.trim();
    if (!name) return;
    if (name.includes('/')) {
      toast.error(t('file_manager.folder_name_invalid'));
      return;
    }
    const nextPrefix = `${prefix}${name}/`;
    try {
      await createFolder.mutateAsync({ workspaceId, projectId, libraryId: selectedLibraryId, prefix: nextPrefix });
      setCreateFolderOpen(false);
      setFolderName('');
      toast.success(t('file_manager.folder_created'));
      navigateToPrefix(nextPrefix);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('file_manager.folder_create_failed')}: ${msg}`);
    }
  };

  const handleRename = async () => {
    if (!selectedLibraryId || !selectedForRename) return;
    const nextName = renameValue.trim();
    if (!nextName) return;
    if (nextName.includes('/')) {
      toast.error(t('file_manager.rename_invalid'));
      return;
    }

    const fromKeyOrPrefix = selectedForRename.kind === 'object' ? selectedForRename.key : selectedForRename.prefix;
    const toKeyOrPrefix =
      selectedForRename.kind === 'object'
        ? `${prefix}${nextName}`
        : `${prefix}${nextName}/`;

    try {
      await moveObject.mutateAsync({
        workspaceId,
        projectId,
        libraryId: selectedLibraryId,
        from_key: fromKeyOrPrefix,
        to_key: toKeyOrPrefix,
      });
      setRenameOpen(false);
      setRenameValue('');
      clearSelection();
      toast.success(t('file_manager.renamed'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('file_manager.rename_failed')}: ${msg}`);
    }
  };

  const handleDelete = async () => {
    if (!selectedLibraryId || selected.length === 0) return;
    const keys = selected.map((s) => (s.kind === 'object' ? s.key : s.prefix));
    try {
      await deleteObjects.mutateAsync({ workspaceId, projectId, libraryId: selectedLibraryId, keys });
      setDeleteConfirmOpen(false);
      clearSelection();
      toast.success(t('file_manager.deleted'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('file_manager.delete_failed')}: ${msg}`);
    }
  };

  const handleDownload = async () => {
    if (!selectedLibraryId || !selectedObject) return;
    try {
      const api = new SourcesAPI(getApiClient());
      const blob = await api.downloadObject(workspaceId, projectId, selectedLibraryId, selectedObject.key);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = basename(selectedObject.key) || 'download';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('file_manager.download_failed')}: ${msg}`);
    }
  };

  return (
    <PageLayout
      header={<PageHeader title={t('title')} />}
      toolbar={(
        <PageToolbar>
          <div className="flex items-center gap-2 w-full">
            <Button
              type="button"
              variant="outline"
              onClick={() => objectsQuery.refetch()}
              disabled={!selectedLibraryId}
              data-testid="sources__refresh"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('file_manager.refresh')}
            </Button>
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-tertiary" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('file_manager.search_placeholder')}
                className="pl-9"
                data-testid="sources__search"
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
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
                  setRenameValue(renamePlaceholder);
                  setRenameOpen(true);
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
                disabled={!selectedLibraryId || !selectedObject}
                data-testid="sources__download"
              >
                <Download className="h-4 w-4 mr-2" />
                {t('file_manager.download')}
              </Button>
              <Button
                type="button"
                onClick={handleUploadClick}
                disabled={!selectedLibraryId}
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
                onChange={(e) => handleFilesPicked(e.target.files)}
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
                onClick={async () => {
                  const name = window.prompt(t('file_manager.library_create_prompt'));
                  if (!name) return;
                  await createLibrary.mutateAsync({ workspaceId, projectId, name: name.trim() });
                  toast.success(t('file_manager.library_created'));
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
                        setSearch('');
                        clearSelection();
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        setSelectedLibraryId(lib.id);
                        setPrefix('');
                        setSearch('');
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
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const name = window.prompt(t('file_manager.library_rename_prompt'), lib.name);
                              if (!name) return;
                              await updateLibrary.mutateAsync({ workspaceId, projectId, libraryId: lib.id, name: name.trim() });
                              toast.success(t('file_manager.library_renamed'));
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
                            onClick={async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const confirm = window.prompt(t('file_manager.library_delete_confirm'), lib.name);
                              if (confirm !== lib.name) return;
                              await deleteLibrary.mutateAsync({ workspaceId, projectId, libraryId: lib.id });
                              toast.success(t('file_manager.library_deleted'));
                              if (selectedLibraryId === lib.id) setSelectedLibraryId(null);
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

        <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-subtle flex items-center gap-2">
            <div className="text-sm text-primary">{t('file_manager.location')}</div>
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

          <div className="flex-1 min-h-0 overflow-auto">
            <table className="w-full text-sm" data-testid="sources__objects-table">
              <thead className="sticky top-0 bg-surface border-b border-subtle text-xs text-tertiary">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label={t('file_manager.select_all')}
                    />
                  </th>
                  <th className="text-left px-3 py-2">{t('file_manager.col_name')}</th>
                  <th className="text-right px-3 py-2 w-32">{t('file_manager.col_size')}</th>
                  <th className="text-left px-3 py-2 w-48">{t('file_manager.col_modified')}</th>
                </tr>
              </thead>
              <tbody>
                {objectsQuery.isLoading ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-tertiary">
                      {t('file_manager.loading')}
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-10 text-center text-tertiary">
                      {t('file_manager.empty')}
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((it) => {
                    const id = rowId(it);
                    const checked = selectedIds.includes(id);
                    return (
                      <tr
                        key={id}
                        className={cn('border-b border-subtle hover:bg-hover/60', checked && 'bg-hover')}
                        data-testid="sources__object-row"
                        data-row-id={id}
                      >
                        <td className="px-3 py-2 align-middle">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleRow(id)}
                            aria-label={t('file_manager.select_row')}
                          />
                        </td>
                        <td className="px-3 py-2 align-middle">
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
                        </td>
                        <td className="px-3 py-2 text-right text-tertiary tabular-nums">
                          {it.kind === 'object' ? it.size_bytes.toLocaleString() : ''}
                        </td>
                        <td className="px-3 py-2 text-tertiary">
                          {it.kind === 'object' ? new Date(it.last_modified).toLocaleString() : ''}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="min-h-0 rounded-md border border-subtle bg-surface overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-subtle text-sm text-primary">
            {t('file_manager.details')}
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-3 text-sm">
            {!selectedLibraryId ? (
              <div className="text-tertiary">{t('file_manager.details_empty')}</div>
            ) : selected.length === 0 ? (
              <div className="text-tertiary">{t('file_manager.details_empty')}</div>
            ) : selected.length > 1 ? (
              <div className="text-tertiary">{t('file_manager.details_multi', { count: String(selected.length) })}</div>
            ) : selected[0].kind === 'prefix' ? (
              <div className="space-y-2">
                <div className="text-xs text-tertiary">{t('file_manager.folder')}</div>
                <div className="font-mono text-xs break-all">{selected[0].prefix}</div>
              </div>
            ) : metaQuery.isLoading ? (
              <div className="text-tertiary">{t('file_manager.loading')}</div>
            ) : metaQuery.data ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-tertiary">{t('file_manager.key')}</div>
                  <div className="font-mono text-xs break-all">{metaQuery.data.key}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-tertiary">{t('file_manager.size')}</div>
                    <div className="tabular-nums">{metaQuery.data.size_bytes.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-tertiary">{t('file_manager.type')}</div>
                    <div className="truncate">{metaQuery.data.content_type}</div>
                  </div>
                  <div>
                    <div className="text-xs text-tertiary">{t('file_manager.modified')}</div>
                    <div className="truncate">{new Date(metaQuery.data.last_modified).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-tertiary">{t('file_manager.etag')}</div>
                    <div className="truncate">{metaQuery.data.etag ?? '-'}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-tertiary">{t('file_manager.details_empty')}</div>
            )}
          </div>
        </div>
      </div>

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

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="sources__dialog__rename">
          <DialogHeader>
            <DialogTitle>{t('file_manager.rename')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs text-tertiary">{t('file_manager.rename_hint')}</div>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={renamePlaceholder}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button type="button" onClick={handleRename} disabled={!renameValue.trim()}>
              {t('file_manager.save')}
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
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={selected.length === 0}>
              {t('file_manager.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
