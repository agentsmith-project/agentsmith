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
import { Checkbox } from '@/components/ui/checkbox';
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
import { toast } from '@/components/ui/toast';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';

import { getApiClient, SourcesAPI } from '@/lib/api';
import type { SourceLibrary, SourceObjectsListItem } from '@/lib/api/types';
import { useHasPermission } from '@/lib/hooks/use-permissions';
import { APIError } from '@/lib/api/errors';
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

function normalizeFolderPrefixInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true as const, prefix: '' };
  if (trimmed.startsWith('/')) return { ok: false as const, prefix: '', reason: 'leading_slash' as const };
  const normalized = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  return { ok: true as const, prefix: normalized };
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

  // Library dialogs (create/rename/delete)
  const [libraryCreateOpen, setLibraryCreateOpen] = React.useState(false);
  const [libraryName, setLibraryName] = React.useState('');
  const [libraryDescription, setLibraryDescription] = React.useState('');
  const [libraryRenameOpen, setLibraryRenameOpen] = React.useState(false);
  const [libraryRenameTarget, setLibraryRenameTarget] = React.useState<SourceLibrary | null>(null);
  const [libraryRenameName, setLibraryRenameName] = React.useState('');
  const [libraryRenameDescription, setLibraryRenameDescription] = React.useState('');
  const [libraryDeleteOpen, setLibraryDeleteOpen] = React.useState(false);
  const [libraryDeleteTarget, setLibraryDeleteTarget] = React.useState<SourceLibrary | null>(null);
  const [libraryDeleteConfirm, setLibraryDeleteConfirm] = React.useState('');

  const [createFolderOpen, setCreateFolderOpen] = React.useState(false);
  const [folderName, setFolderName] = React.useState('');
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveName, setMoveName] = React.useState('');
  const [moveDestPrefix, setMoveDestPrefix] = React.useState('');
  const [moveOverwrite, setMoveOverwrite] = React.useState(false);
  const [moveConflictOpen, setMoveConflictOpen] = React.useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);

  const selectedForMove = selected.length === 1 ? selected[0] : null;
  const moveNamePlaceholder = selectedForMove
    ? (selectedForMove.kind === 'object' ? basename(selectedForMove.key) : basename(selectedForMove.prefix))
    : '';

  // Destination folder picker (browse prefixes)
  const [destPickerOpen, setDestPickerOpen] = React.useState(false);
  const [destPickerPrefix, setDestPickerPrefix] = React.useState('');
  const destPickerParams = React.useMemo(
    () => ({ prefix: destPickerPrefix, delimiter: '/' as const, page_size: 200 }),
    [destPickerPrefix],
  );
  const destPickerQuery = useSourceObjects(workspaceId, projectId, selectedLibraryId, destPickerParams);
  const destPickerItems = React.useMemo(
    () => (destPickerQuery.data?.items ?? []).filter((it) => it.kind === 'prefix'),
    [destPickerQuery.data?.items],
  );
  const destPickerCrumbs = React.useMemo(() => buildCrumbs(destPickerPrefix), [destPickerPrefix]);

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

  const handleMove = async () => {
    if (!selectedLibraryId || !selectedForMove) return;
    const nextName = moveName.trim();
    if (!nextName) return;
    if (nextName.includes('/')) {
      toast.error(t('file_manager.rename_invalid'));
      return;
    }
    const normalizedDest = normalizeFolderPrefixInput(moveDestPrefix);
    if (!normalizedDest.ok) {
      toast.error(t('file_manager.dest_prefix_invalid'));
      return;
    }

    const fromKeyOrPrefix = selectedForMove.kind === 'object' ? selectedForMove.key : selectedForMove.prefix;
    const toKeyOrPrefix =
      selectedForMove.kind === 'object'
        ? `${normalizedDest.prefix}${nextName}`
        : `${normalizedDest.prefix}${nextName}/`;

    try {
      await moveObject.mutateAsync({
        workspaceId,
        projectId,
        libraryId: selectedLibraryId,
        from_key: fromKeyOrPrefix,
        to_key: toKeyOrPrefix,
        overwrite: moveOverwrite,
      });
      setMoveOpen(false);
      setMoveName('');
      setMoveDestPrefix('');
      setMoveOverwrite(false);
      clearSelection();
      toast.success(t('file_manager.renamed'));
    } catch (err) {
      const apiErr = err instanceof APIError ? err : null;
      if (!moveOverwrite && apiErr?.statusCode === 409 && apiErr.errorCode === 'destination_exists') {
        setMoveConflictOpen(true);
        return;
      }
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

  const handleCreateLibrary = async () => {
    const name = libraryName.trim();
    if (!name) return;
    try {
      const created = await createLibrary.mutateAsync({
        workspaceId,
        projectId,
        name,
        description: libraryDescription.trim() || undefined,
      });
      toast.success(t('file_manager.library_created'));
      setLibraryCreateOpen(false);
      setSelectedLibraryId(created.id);
      navigateToPrefix('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('file_manager.library_create_failed')}: ${msg}`);
    }
  };

  const handleRenameLibrary = async () => {
    if (!libraryRenameTarget) return;
    const name = libraryRenameName.trim();
    if (!name) return;
    try {
      await updateLibrary.mutateAsync({
        workspaceId,
        projectId,
        libraryId: libraryRenameTarget.id,
        name,
        description: libraryRenameDescription.trim() || undefined,
      });
      toast.success(t('file_manager.library_renamed'));
      setLibraryRenameOpen(false);
      setLibraryRenameTarget(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('file_manager.library_rename_failed')}: ${msg}`);
    }
  };

  const handleDeleteLibrary = async () => {
    if (!libraryDeleteTarget) return;
    try {
      await deleteLibrary.mutateAsync({
        workspaceId,
        projectId,
        libraryId: libraryDeleteTarget.id,
      });
      toast.success(t('file_manager.library_deleted'));
      setLibraryDeleteOpen(false);
      const deletedId = libraryDeleteTarget.id;
      setLibraryDeleteTarget(null);
      if (selectedLibraryId === deletedId) {
        setSelectedLibraryId(null);
        navigateToPrefix('');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${t('file_manager.library_delete_failed')}: ${msg}`);
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
                onClick={() => {
                  setLibraryName('');
                  setLibraryDescription('');
                  setLibraryCreateOpen(true);
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
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setLibraryRenameTarget(lib);
                              setLibraryRenameName(lib.name);
                              setLibraryRenameDescription(lib.description ?? '');
                              setLibraryRenameOpen(true);
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
                              setLibraryDeleteTarget(lib);
                              setLibraryDeleteConfirm('');
                              setLibraryDeleteOpen(true);
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
                setLibraryRenameOpen(false);
                setLibraryRenameTarget(null);
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
                setLibraryDeleteOpen(false);
                setLibraryDeleteTarget(null);
                setLibraryDeleteConfirm('');
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
              onClick={handleMove}
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
        onConfirm={async () => {
          setMoveOverwrite(true);
          setMoveConflictOpen(false);
          await handleMove();
        }}
        testId="sources__dialog__move-conflict"
      />

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
