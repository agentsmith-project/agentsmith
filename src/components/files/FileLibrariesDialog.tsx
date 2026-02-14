'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import type { FileLibrary } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ResourcePolicyStatusBadge } from '@/components/resource-policy/ResourcePolicyStatusBadge';
import type { ResourcePolicyStatusMeta } from '@/lib/constants/resource-policy';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FileLibrariesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraries: FileLibrary[];
  libraryPolicyStatusById?: Record<string, ResourcePolicyStatusMeta>;
  libraryPolicyLoadingById?: Record<string, boolean>;
  selectedLibraryId: string;
  onSelectLibrary: (libraryId: string) => void;
  onCreateLibrary: (name: string) => Promise<void>;
  onRenameLibrary: (libraryId: string, name: string) => Promise<void>;
  onDeleteLibrary: (libraryId: string) => Promise<void>;
  creating?: boolean;
  updating?: boolean;
  deleting?: boolean;
}

export function FileLibrariesDialog({
  open,
  onOpenChange,
  libraries,
  libraryPolicyStatusById = {},
  libraryPolicyLoadingById = {},
  selectedLibraryId,
  onSelectLibrary,
  onCreateLibrary,
  onRenameLibrary,
  onDeleteLibrary,
  creating = false,
  updating = false,
  deleting = false,
}: FileLibrariesDialogProps) {
  const tResourcePolicy = useTranslations('resource_policy');
  const tSources = useTranslations('files');
  const [newLibraryName, setNewLibraryName] = React.useState('');
  const [editingLibraryId, setEditingLibraryId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState('');
  const [deletingLibrary, setDeletingLibrary] = React.useState<FileLibrary | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = React.useState('');

  const handleCreate = async () => {
    const name = newLibraryName.trim();
    if (!name) return;
    await onCreateLibrary(name);
    setNewLibraryName('');
  };

  const beginRename = (library: FileLibrary) => {
    setEditingLibraryId(library.id);
    setEditingName(library.name);
  };

  const submitRename = async () => {
    if (!editingLibraryId) return;
    const name = editingName.trim();
    if (!name) return;
    await onRenameLibrary(editingLibraryId, name);
    setEditingLibraryId(null);
    setEditingName('');
  };

  const openDeleteConfirm = (library: FileLibrary) => {
    setDeletingLibrary(library);
    setDeleteConfirmInput('');
  };

  const closeDeleteConfirm = (open: boolean) => {
    if (!open) {
      setDeletingLibrary(null);
      setDeleteConfirmInput('');
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deletingLibrary) return;
    await onDeleteLibrary(deletingLibrary.id);
    setDeletingLibrary(null);
    setDeleteConfirmInput('');
  };

  const canConfirmDelete = deletingLibrary ? deleteConfirmInput.trim() === deletingLibrary.name : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="files__libraries-dialog" className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{tSources('libraries.manage')}</DialogTitle>
          <DialogDescription>
            {tSources('libraries.manage_description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-subtle bg-surface-high p-3">
            <p className="mb-2 text-xs text-tertiary">{tSources('libraries.create_hint')}</p>
            <div className="flex items-center gap-2">
              <Input
                value={newLibraryName}
                onChange={(event) => setNewLibraryName(event.target.value)}
                placeholder={tSources('libraries.name_placeholder')}
                disabled={creating}
                data-testid="files__library-create-input"
              />
              <Button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newLibraryName.trim()}
                data-testid="files__library-create-btn"
              >
                <Plus className="mr-1 h-4 w-4" />
                {tSources('libraries.create')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              className="w-full rounded-sm border border-subtle bg-surface px-3 py-2 text-left text-sm"
              data-testid="files__library-row--all"
              onClick={() => onSelectLibrary('all')}
            >
              <span className={selectedLibraryId === 'all' ? 'text-foreground font-medium' : 'text-primary'}>
                {tSources('libraries.all')}
              </span>
            </button>

            {libraries.map((library) => (
              <div
                key={library.id}
                className="rounded-sm border border-subtle bg-surface px-3 py-2"
                data-testid={`files__library-row--${library.id}`}
              >
                {editingLibraryId === library.id ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      disabled={updating}
                      data-testid={`files__library-rename-input--${library.id}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={submitRename}
                      disabled={updating || !editingName.trim()}
                      data-testid={`files__library-rename-save--${library.id}`}
                    >
                      {tSources('libraries.save')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingLibraryId(null)}
                    >
                      {tSources('libraries.cancel')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      className="text-left text-sm"
                      onClick={() => onSelectLibrary(library.id)}
                    >
                      <span className={selectedLibraryId === library.id ? 'text-foreground font-medium' : 'text-primary'}>
                        {library.name}
                      </span>
                    </button>
                    <div className="flex items-center gap-2">
                      <ResourcePolicyStatusBadge
                        data-testid={`files__library-policy-status--${library.id}`}
                        status={libraryPolicyLoadingById[library.id] ? 'loading' : (libraryPolicyStatusById[library.id]?.status ?? 'default')}
                        label={
                          libraryPolicyLoadingById[library.id]
                            ? tResourcePolicy('resource_status.loading')
                            : tResourcePolicy(libraryPolicyStatusById[library.id]?.labelKey ?? 'resource_status.default')
                        }
                        title={
                          libraryPolicyLoadingById[library.id]
                            ? tResourcePolicy('resource_status_reason.loading')
                            : tResourcePolicy(
                                libraryPolicyStatusById[library.id]?.reasonKey ??
                                  'resource_status_reason.default'
                              )
                        }
                      />
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => beginRename(library)}
                          data-testid={`files__library-rename-btn--${library.id}`}
                          aria-label={tSources('libraries.rename')}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-error hover:text-error"
                          onClick={() => openDeleteConfirm(library)}
                          disabled={deleting}
                          data-testid={`files__library-delete-btn--${library.id}`}
                          aria-label={tSources('libraries.delete')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <AlertDialog open={!!deletingLibrary} onOpenChange={closeDeleteConfirm}>
          <AlertDialogContent data-testid="files__library-delete-confirm-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>{tSources('libraries.delete_confirm_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {tSources('libraries.delete_confirm_description')}
              </AlertDialogDescription>
            </AlertDialogHeader>

            {deletingLibrary ? (
              <div className="space-y-3">
                <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
                  {tSources('libraries.delete_confirm_warning')}
                </div>
                <p className="text-sm text-primary">
                  {tSources('libraries.delete_confirm_type_label', { name: deletingLibrary.name })}
                </p>
                <Input
                  value={deleteConfirmInput}
                  onChange={(event) => setDeleteConfirmInput(event.target.value)}
                  placeholder={tSources('libraries.delete_confirm_input_placeholder')}
                  autoFocus
                  data-testid="files__library-delete-confirm-input"
                />
              </div>
            ) : null}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>
                {tSources('libraries.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleting || !canConfirmDelete}
                onClick={handleDeleteConfirmed}
                data-testid="files__library-delete-confirm-action"
              >
                {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {tSources('libraries.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
