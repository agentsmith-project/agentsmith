import * as React from 'react';

import type { SourceLibrary } from '@/lib/api/types';
import { toast } from '@/components/ui/toast';

type UseSourceLibraryManagerParams = {
  workspaceId: string;
  projectId: string;
  selectedLibraryId: string | null;
  setSelectedLibraryId: (value: string | null) => void;
  navigateToPrefix: (prefix: string) => void;
  createLibrary: (input: {
    workspaceId: string;
    projectId: string;
    name: string;
    description?: string;
  }) => Promise<{ id: string }>;
  updateLibrary: (input: {
    workspaceId: string;
    projectId: string;
    libraryId: string;
    name: string;
    description?: string;
  }) => Promise<unknown>;
  deleteLibrary: (input: { workspaceId: string; projectId: string; libraryId: string }) => Promise<unknown>;
  t: (key: string, values?: Record<string, string>) => string;
};

export function useSourceLibraryManager({
  workspaceId,
  projectId,
  selectedLibraryId,
  setSelectedLibraryId,
  navigateToPrefix,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  t,
}: UseSourceLibraryManagerParams) {
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

  const openCreateLibraryDialog = React.useCallback(() => {
    setLibraryName('');
    setLibraryDescription('');
    setLibraryCreateOpen(true);
  }, []);

  const openRenameLibraryDialog = React.useCallback((library: SourceLibrary) => {
    setLibraryRenameTarget(library);
    setLibraryRenameName(library.name);
    setLibraryRenameDescription(library.description ?? '');
    setLibraryRenameOpen(true);
  }, []);

  const closeRenameLibraryDialog = React.useCallback(() => {
    setLibraryRenameOpen(false);
    setLibraryRenameTarget(null);
  }, []);

  const openDeleteLibraryDialog = React.useCallback((library: SourceLibrary) => {
    setLibraryDeleteTarget(library);
    setLibraryDeleteConfirm('');
    setLibraryDeleteOpen(true);
  }, []);

  const closeDeleteLibraryDialog = React.useCallback(() => {
    setLibraryDeleteOpen(false);
    setLibraryDeleteTarget(null);
    setLibraryDeleteConfirm('');
  }, []);

  const handleCreateLibrary = React.useCallback(async () => {
    const name = libraryName.trim();
    if (!name) return;
    try {
      const created = await createLibrary({
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
  }, [
    createLibrary,
    libraryDescription,
    libraryName,
    navigateToPrefix,
    projectId,
    setSelectedLibraryId,
    t,
    workspaceId,
  ]);

  const handleRenameLibrary = React.useCallback(async () => {
    if (!libraryRenameTarget) return;
    const name = libraryRenameName.trim();
    if (!name) return;
    try {
      await updateLibrary({
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
  }, [libraryRenameDescription, libraryRenameName, libraryRenameTarget, projectId, t, updateLibrary, workspaceId]);

  const handleDeleteLibrary = React.useCallback(async () => {
    if (!libraryDeleteTarget) return;
    try {
      await deleteLibrary({
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
  }, [
    deleteLibrary,
    libraryDeleteTarget,
    navigateToPrefix,
    projectId,
    selectedLibraryId,
    setSelectedLibraryId,
    t,
    workspaceId,
  ]);

  return {
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
  };
}
