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

interface LibraryDeleteTarget {
  name: string;
  status?: 'creating' | 'ready' | 'degraded' | 'failed' | 'deleting';
}

interface LibraryDialogsProps {
  createLibraryPending: boolean;
  deleteLibraryPending: boolean;
  libraryCreateOpen: boolean;
  libraryDeleteConfirm: string;
  libraryDeleteOpen: boolean;
  libraryDeleteTarget: LibraryDeleteTarget | null;
  libraryDescription: string;
  libraryName: string;
  libraryRenameDescription: string;
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

  return (
    <>
      <Dialog open={libraryCreateOpen} onOpenChange={onSetLibraryCreateOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__library-create">
          <DialogHeader>
            <DialogTitle>{t('file_manager.library_create')}</DialogTitle>
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
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onSetLibraryCreateOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={onCreateLibrary}
              disabled={!libraryName.trim() || createLibraryPending}
              data-testid="files__library-create__submit"
            >
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
                    isFailedLibraryDelete
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
                  isFailedLibraryDelete
                    ? 'rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning'
                    : 'rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error'
                }
                data-testid="files__library-delete__warning"
              >
                {isFailedLibraryDelete
                  ? t('file_manager.library_delete_failed_recovery_warning')
                  : t('file_manager.library_delete_warning')}
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
