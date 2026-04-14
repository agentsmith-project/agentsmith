import * as React from 'react';

import type { FileLibrary } from '@/lib/api/types';
import { getOperationErrorDetail } from './error-utils';

type UseFileLibraryManagerParams = {
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
  tErrors: (key: string, values?: Record<string, string | number>) => string;
};

export function useFileLibraryManager({
  workspaceId,
  projectId,
  selectedLibraryId,
  setSelectedLibraryId,
  navigateToPrefix,
  createLibrary,
  updateLibrary,
  deleteLibrary,
  t,
  tErrors,
}: UseFileLibraryManagerParams) {
  const [libraryCreateOpen, setLibraryCreateOpen] = React.useState(false);
  const [libraryName, setLibraryName] = React.useState('');
  const [libraryDescription, setLibraryDescription] = React.useState('');
  const [libraryCreateError, setLibraryCreateError] = React.useState<string | null>(null);
  const [libraryRenameOpen, setLibraryRenameOpen] = React.useState(false);
  const [libraryRenameTarget, setLibraryRenameTarget] = React.useState<FileLibrary | null>(null);
  const [libraryRenameName, setLibraryRenameName] = React.useState('');
  const [libraryRenameDescription, setLibraryRenameDescription] = React.useState('');
  const [libraryDeleteOpen, setLibraryDeleteOpen] = React.useState(false);
  const [libraryDeleteTarget, setLibraryDeleteTarget] = React.useState<FileLibrary | null>(null);
  const [libraryDeleteConfirm, setLibraryDeleteConfirm] = React.useState('');

  const openCreateLibraryDialog = React.useCallback(() => {
    setLibraryName('');
    setLibraryDescription('');
    setLibraryCreateError(null);
    setLibraryCreateOpen(true);
  }, []);

  const setCreateLibraryName = React.useCallback((value: string) => {
    setLibraryCreateError(null);
    setLibraryName(value);
  }, []);

  const setCreateLibraryDescription = React.useCallback((value: string) => {
    setLibraryCreateError(null);
    setLibraryDescription(value);
  }, []);

  const openRenameLibraryDialog = React.useCallback((library: FileLibrary) => {
    setLibraryRenameTarget(library);
    setLibraryRenameName(library.name);
    setLibraryRenameDescription(library.description ?? '');
    setLibraryRenameOpen(true);
  }, []);

  const closeRenameLibraryDialog = React.useCallback(() => {
    setLibraryRenameOpen(false);
    setLibraryRenameTarget(null);
  }, []);

  const openDeleteLibraryDialog = React.useCallback((library: FileLibrary) => {
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
    setLibraryCreateError(null);
    try {
      const created = await createLibrary({
        workspaceId,
        projectId,
        name,
        description: libraryDescription.trim() || undefined,
      });
      setLibraryCreateOpen(false);
      setSelectedLibraryId(created.id);
      navigateToPrefix('');
    } catch (err) {
      const msg = getOperationErrorDetail(err, tErrors, t('file_manager.library_create_failed'));
      setLibraryCreateError(msg);
    }
  }, [
    createLibrary,
    libraryDescription,
    libraryName,
    navigateToPrefix,
    projectId,
    setSelectedLibraryId,
    t,
    tErrors,
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
      setLibraryRenameOpen(false);
      setLibraryRenameTarget(null);
    } catch {
      // Mutation hook surfaces the failure toast; keep dialog state local.
    }
  }, [libraryRenameDescription, libraryRenameName, libraryRenameTarget, projectId, updateLibrary, workspaceId]);

  const handleDeleteLibrary = React.useCallback(async () => {
    if (!libraryDeleteTarget) return;
    try {
      await deleteLibrary({
        workspaceId,
        projectId,
        libraryId: libraryDeleteTarget.id,
      });
      setLibraryDeleteOpen(false);
      const deletedId = libraryDeleteTarget.id;
      setLibraryDeleteTarget(null);
      if (selectedLibraryId === deletedId) {
        setSelectedLibraryId(null);
        navigateToPrefix('');
      }
    } catch {
      // Mutation hook surfaces the failure toast; keep dialog state local.
    }
  }, [
    deleteLibrary,
    libraryDeleteTarget,
    navigateToPrefix,
    projectId,
    selectedLibraryId,
    setSelectedLibraryId,
    workspaceId,
  ]);

  return {
    closeDeleteLibraryDialog,
    closeRenameLibraryDialog,
    handleCreateLibrary,
    handleDeleteLibrary,
    handleRenameLibrary,
    libraryCreateError,
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
    setCreateLibraryDescription,
    setCreateLibraryName,
    setLibraryCreateOpen,
    setLibraryDeleteConfirm,
    setLibraryDeleteOpen,
    setLibraryDescription: setCreateLibraryDescription,
    setLibraryName: setCreateLibraryName,
    setLibraryRenameDescription,
    setLibraryRenameName,
    setLibraryRenameOpen,
  };
}
