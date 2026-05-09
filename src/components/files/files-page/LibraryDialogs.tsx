'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';

interface LibraryDeleteTarget {
  name: string;
  status?: 'creating' | 'ready' | 'degraded' | 'failed' | 'deleting';
  task_home_binding_status?: 'unbound' | 'bound';
  bound_task_visible?: boolean;
  bound_task_title?: string;
  bound_task_status?: 'active' | 'archived';
}

interface LibraryDialogsProps {
  createLibraryPending: boolean;
  deleteLibraryPending: boolean;
  libraryCreateError: string | null;
  libraryCreateOpen: boolean;
  libraryDeleteConfirm: string;
  libraryDeleteError: string | null;
  libraryDeleteOpen: boolean;
  libraryDeleteTarget: LibraryDeleteTarget | null;
  libraryDescription: string;
  libraryName: string;
  libraryRenameDescription: string;
  libraryRenameError: string | null;
  libraryRenameName: string;
  libraryRenameOpen: boolean;
  libraryRenameTarget: unknown;
  t: (key: string, values?: Record<string, string>) => string;
  updateLibraryPending: boolean;
  onCloseDeleteLibraryDialog: () => void;
  onCloseRenameLibraryDialog: () => void;
  onCreateLibrary: () => void;
  onDeleteLibrary: () => void;
  onRenameLibrary: () => void;
  onSetLibraryCreateOpen: (open: boolean) => void;
  onSetLibraryDeleteConfirm: (value: string) => void;
  onSetLibraryDeleteOpen: (open: boolean) => void;
  onSetLibraryDescription: (value: string) => void;
  onSetLibraryName: (value: string) => void;
  onSetLibraryRenameDescription: (value: string) => void;
  onSetLibraryRenameName: (value: string) => void;
  onSetLibraryRenameOpen: (open: boolean) => void;
}

export function LibraryDialogs({
  createLibraryPending,
  deleteLibraryPending,
  libraryCreateError,
  libraryCreateOpen,
  libraryDeleteConfirm,
  libraryDeleteError,
  libraryDeleteOpen,
  libraryDeleteTarget,
  libraryDescription,
  libraryName,
  libraryRenameDescription,
  libraryRenameError,
  libraryRenameName,
  libraryRenameOpen,
  libraryRenameTarget,
  t,
  updateLibraryPending,
  onCloseDeleteLibraryDialog,
  onCloseRenameLibraryDialog,
  onCreateLibrary,
  onDeleteLibrary,
  onRenameLibrary,
  onSetLibraryCreateOpen,
  onSetLibraryDeleteConfirm,
  onSetLibraryDeleteOpen,
  onSetLibraryDescription,
  onSetLibraryName,
  onSetLibraryRenameDescription,
  onSetLibraryRenameName,
  onSetLibraryRenameOpen,
}: LibraryDialogsProps) {
  const isFailedLibraryDelete = libraryDeleteTarget?.status === 'failed' || libraryDeleteTarget?.status === 'degraded';
  const isBoundLibraryDelete = libraryDeleteTarget?.task_home_binding_status === 'bound';
  const handleCreateDialogOpenChange = (open: boolean) => {
    if (!open && createLibraryPending) return;
    onSetLibraryCreateOpen(open);
  };

  return (
    <>
      <Dialog open={libraryCreateOpen} onOpenChange={handleCreateDialogOpenChange}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__library-create">
          <DialogHeader>
            <DialogTitle>{t('file_manager.library_create')}</DialogTitle>
            <DialogDescription>{t('file_manager.library_create_description')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-name">{t('file_manager.library_name')}</Label>
              <Input
                id="sources-library-name"
                value={libraryName}
                onChange={(event) => onSetLibraryName(event.target.value)}
                placeholder={t('file_manager.library_name_placeholder')}
                data-testid="files__library-create__name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-desc">{t('file_manager.library_description')}</Label>
              <Textarea
                id="sources-library-desc"
                value={libraryDescription}
                onChange={(event) => onSetLibraryDescription(event.target.value)}
                placeholder={t('file_manager.library_description_placeholder')}
                className="min-h-[90px]"
                data-testid="files__library-create__description"
              />
            </div>
            {createLibraryPending ? (
              <div
                className="flex items-start gap-2 rounded-md border border-accent/20 bg-accent/8 px-3 py-2 text-sm text-secondary"
                data-testid="files__library-create__pending"
              >
                <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-accent" />
                <div>{t('file_manager.library_create_pending')}</div>
              </div>
            ) : null}
            {libraryCreateError ? (
              <div
                className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error"
                data-testid="files__library-create__error"
                role="alert"
              >
                {libraryCreateError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onSetLibraryCreateOpen(false)} disabled={createLibraryPending}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={onCreateLibrary}
              disabled={!libraryName.trim() || createLibraryPending}
              data-testid="files__library-create__submit"
            >
              {createLibraryPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {t('file_manager.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryRenameOpen} onOpenChange={onSetLibraryRenameOpen}>
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
                onChange={(event) => onSetLibraryRenameName(event.target.value)}
                placeholder={t('file_manager.library_name_placeholder')}
                data-testid="files__library-rename__name"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-rename-desc">{t('file_manager.library_description')}</Label>
              <Textarea
                id="sources-library-rename-desc"
                value={libraryRenameDescription}
                onChange={(event) => onSetLibraryRenameDescription(event.target.value)}
                placeholder={t('file_manager.library_description_placeholder')}
                className="min-h-[90px]"
                data-testid="files__library-rename__description"
              />
            </div>
            {libraryRenameError ? (
              <div
                className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                role="alert"
                data-testid="files__library-rename__error"
              >
                {libraryRenameError}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCloseRenameLibraryDialog}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={onRenameLibrary}
              disabled={!libraryRenameTarget || !libraryRenameName.trim() || updateLibraryPending}
              data-testid="files__library-rename__submit"
            >
              {t('file_manager.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={libraryDeleteOpen} onOpenChange={onSetLibraryDeleteOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__library-delete">
          <DialogHeader>
            <DialogTitle>{t('file_manager.library_delete')}</DialogTitle>
            <DialogDescription>
              {libraryDeleteTarget
                ? (
                    isBoundLibraryDelete
                      ? t('file_manager.library_delete_bound_description', { name: libraryDeleteTarget.name })
                      : isFailedLibraryDelete
                      ? t('file_manager.library_delete_failed_recovery_description', { name: libraryDeleteTarget.name })
                      : t('file_manager.library_delete_confirm', { name: libraryDeleteTarget.name })
                  )
                : t('file_manager.library_delete_confirm_empty')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {libraryDeleteTarget ? (
              <div
                className={
                  isBoundLibraryDelete
                    ? 'rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning'
                    : isFailedLibraryDelete
                    ? 'rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning'
                    : 'rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error'
                }
                data-testid="files__library-delete__warning"
              >
                {isBoundLibraryDelete
                  ? t('file_manager.library_delete_bound_warning')
                  : isFailedLibraryDelete
                  ? t('file_manager.library_delete_failed_recovery_warning')
                  : t('file_manager.library_delete_warning')}
              </div>
            ) : null}
            {libraryDeleteError ? (
              <div
                className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
                role="alert"
                data-testid="files__library-delete__error"
              >
                {libraryDeleteError}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="sources-library-delete-confirm">{t('file_manager.confirm_name')}</Label>
              <Input
                id="sources-library-delete-confirm"
                value={libraryDeleteConfirm}
                onChange={(event) => onSetLibraryDeleteConfirm(event.target.value)}
                placeholder={libraryDeleteTarget?.name ?? ''}
                data-testid="files__library-delete__confirm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCloseDeleteLibraryDialog}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onDeleteLibrary}
              disabled={
                !libraryDeleteTarget
                || libraryDeleteConfirm !== libraryDeleteTarget.name
                || isBoundLibraryDelete
                || deleteLibraryPending
              }
              data-testid="files__library-delete__submit"
            >
              {t('file_manager.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
