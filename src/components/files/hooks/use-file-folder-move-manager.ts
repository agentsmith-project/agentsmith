import * as React from 'react';

import { APIError } from '@/lib/api/errors';
import { useFileObjects } from '@/lib/hooks/use-file-objects';
import { toast } from '@/components/ui/toast';
import { getOperationErrorDetail } from './error-utils';

type SelectedMoveTarget = { kind: 'prefix'; prefix: string } | { kind: 'object'; key: string };

type UseSourceFolderMoveManagerParams = {
  workspaceId: string;
  projectId: string;
  selectedLibraryId: string | null;
  prefix: string;
  selectedForMove: SelectedMoveTarget | null;
  refreshCurrentListing: () => Promise<unknown>;
  createFolder: (input: { workspaceId: string; projectId: string; libraryId: string; prefix: string }) => Promise<unknown>;
  moveObject: (input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    from_key: string;
    to_key: string;
    overwrite?: boolean;
  }) => Promise<unknown>;
  clearSelection: () => void;
  navigateToPrefix: (prefix: string) => void;
  t: (key: string, values?: Record<string, string>) => string;
  tErrors: (key: string, values?: Record<string, string | number>) => string;
};

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

export function useFileFolderMoveManager({
  workspaceId,
  projectId,
  selectedLibraryId,
  prefix,
  selectedForMove,
  refreshCurrentListing,
  createFolder,
  moveObject,
  clearSelection,
  navigateToPrefix,
  t,
  tErrors,
}: UseSourceFolderMoveManagerParams) {
  const [createFolderOpen, setCreateFolderOpen] = React.useState(false);
  const [folderName, setFolderName] = React.useState('');
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveName, setMoveName] = React.useState('');
  const [moveDestPrefix, setMoveDestPrefix] = React.useState('');
  const [moveOverwrite, setMoveOverwrite] = React.useState(false);
  const [moveConflictOpen, setMoveConflictOpen] = React.useState(false);
  const [destPickerOpen, setDestPickerOpen] = React.useState(false);
  const [destPickerPrefix, setDestPickerPrefix] = React.useState('');

  const destPickerParams = React.useMemo(
    () => ({ prefix: destPickerPrefix, delimiter: '/' as const, page_size: 200 }),
    [destPickerPrefix],
  );
  const destPickerQuery = useFileObjects(workspaceId, projectId, selectedLibraryId, destPickerParams);
  const destPickerItems = React.useMemo(
    () => (destPickerQuery.data?.items ?? []).filter((it) => it.kind === 'prefix'),
    [destPickerQuery.data?.items],
  );
  const destPickerCrumbs = React.useMemo(() => buildCrumbs(destPickerPrefix), [destPickerPrefix]);

  const handleCreateFolder = React.useCallback(async () => {
    if (!selectedLibraryId) return;
    const name = folderName.trim();
    if (!name) return;
    if (name.includes('/')) {
      toast.error(t('file_manager.folder_name_invalid'));
      return;
    }
    const nextPrefix = `${prefix}${name}/`;
    try {
      await createFolder({ workspaceId, projectId, libraryId: selectedLibraryId, prefix: nextPrefix });
      setCreateFolderOpen(false);
      setFolderName('');
      toast.success(t('file_manager.folder_created'));
      navigateToPrefix(nextPrefix);
      // Refresh the previous listing in the background without blocking the post-create UX.
      void refreshCurrentListing().catch(() => undefined);
    } catch (err) {
      const msg = getOperationErrorDetail(err, tErrors, t('file_manager.folder_create_failed'));
      toast.error(`${t('file_manager.folder_create_failed')}: ${msg}`);
    }
  }, [createFolder, folderName, navigateToPrefix, prefix, projectId, refreshCurrentListing, selectedLibraryId, t, tErrors, workspaceId]);

  const handleMove = React.useCallback(
    async (overwriteOverride?: boolean) => {
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
      const resolvedOverwrite = overwriteOverride ?? moveOverwrite;
      const fromKeyOrPrefix = selectedForMove.kind === 'object' ? selectedForMove.key : selectedForMove.prefix;
      const toKeyOrPrefix =
        selectedForMove.kind === 'object'
          ? `${normalizedDest.prefix}${nextName}`
          : `${normalizedDest.prefix}${nextName}/`;

      try {
        await moveObject({
          workspaceId,
          projectId,
          libraryId: selectedLibraryId,
          from_key: fromKeyOrPrefix,
          to_key: toKeyOrPrefix,
          overwrite: resolvedOverwrite,
        });
        setMoveOpen(false);
        setMoveName('');
        setMoveDestPrefix('');
        setMoveOverwrite(false);
        clearSelection();
        toast.success(t('file_manager.renamed'));
      } catch (err) {
        const apiErr = err instanceof APIError ? err : null;
        if (!resolvedOverwrite && apiErr?.statusCode === 409 && apiErr.errorCode === 'destination_exists') {
          setMoveConflictOpen(true);
          return;
        }
        const msg = getOperationErrorDetail(err, tErrors, t('file_manager.rename_failed'));
        toast.error(`${t('file_manager.rename_failed')}: ${msg}`);
      }
    },
    [clearSelection, moveDestPrefix, moveName, moveObject, moveOverwrite, projectId, selectedForMove, selectedLibraryId, t, tErrors, workspaceId],
  );

  const confirmMoveOverwrite = React.useCallback(async () => {
    setMoveOverwrite(true);
    setMoveConflictOpen(false);
    await handleMove(true);
  }, [handleMove]);

  return {
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
  };
}
