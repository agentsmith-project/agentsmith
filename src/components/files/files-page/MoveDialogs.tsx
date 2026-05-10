'use client';

import * as React from 'react';
import { Folder, FolderPlus, PencilLine } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DestPickerItem {
  name: string;
  prefix: string;
}

interface DestPickerCrumb {
  label: string;
  prefix: string;
}

interface DestPickerQueryLike {
  isLoading?: boolean;
}

interface MoveDialogsProps {
  confirmMoveOverwrite: () => void;
  createFolderOpen: boolean;
  destPickerCrumbs: DestPickerCrumb[];
  destPickerItems: DestPickerItem[];
  destPickerOpen: boolean;
  destPickerPrefix: string;
  destPickerQuery: DestPickerQueryLike;
  folderName: string;
  moveConflictOpen: boolean;
  moveDestPrefix: string;
  moveName: string;
  moveNamePlaceholder: string;
  moveOpen: boolean;
  moveOverwrite: boolean;
  normalizeFolderPrefixInput: (value: string) => { ok: boolean; prefix: string };
  selectedForMove: { kind: 'object'; key: string } | { kind: 'prefix'; prefix: string } | null;
  selectedLibraryId: string | null;
  t: (key: string) => string;
  onHandleCreateFolder: () => void;
  onHandleMove: () => Promise<void>;
  onSetCreateFolderOpen: (open: boolean) => void;
  onSetDestPickerOpen: (open: boolean) => void;
  onSetDestPickerPrefix: (value: string) => void;
  onSetFolderName: (value: string) => void;
  onSetMoveConflictOpen: (open: boolean) => void;
  onSetMoveDestPrefix: (value: string) => void;
  onSetMoveName: (value: string) => void;
  onSetMoveOpen: (open: boolean) => void;
  onSetMoveOverwrite: (value: boolean) => void;
}

export function MoveDialogs({
  confirmMoveOverwrite,
  createFolderOpen,
  destPickerCrumbs,
  destPickerItems,
  destPickerOpen,
  destPickerPrefix,
  destPickerQuery,
  folderName,
  moveConflictOpen,
  moveDestPrefix,
  moveName,
  moveNamePlaceholder,
  moveOpen,
  moveOverwrite,
  normalizeFolderPrefixInput,
  selectedForMove,
  selectedLibraryId,
  t,
  onHandleCreateFolder,
  onHandleMove,
  onSetCreateFolderOpen,
  onSetDestPickerOpen,
  onSetDestPickerPrefix,
  onSetFolderName,
  onSetMoveConflictOpen,
  onSetMoveDestPrefix,
  onSetMoveName,
  onSetMoveOpen,
  onSetMoveOverwrite,
}: MoveDialogsProps) {
  return (
    <>
      <Dialog open={createFolderOpen} onOpenChange={onSetCreateFolderOpen}>
        <DialogContent className="sm:max-w-[480px]" data-testid="files__dialog__new-folder">
          <DialogHeader className="space-y-3">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase text-accent">
              <FolderPlus className="h-3.5 w-3.5" />
              Files
            </div>
            <DialogTitle>{t('file_manager.new_folder')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-subtle bg-surface-low p-4">
              <p className="text-sm leading-6 text-secondary">{t('file_manager.folder_name_hint')}</p>
            </div>
            <div className="space-y-2 rounded-lg border border-subtle bg-surface-low p-4">
              <div className="text-xs text-tertiary">{t('file_manager.folder_name_hint')}</div>
              <Input
                value={folderName}
                onChange={(event) => onSetFolderName(event.target.value)}
                placeholder={t('file_manager.folder_name_placeholder')}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onSetCreateFolderOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button type="button" onClick={onHandleCreateFolder} disabled={!folderName.trim()}>
              {t('file_manager.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={onSetMoveOpen}>
        <DialogContent className="sm:max-w-[560px]" data-testid="files__dialog__move">
          <DialogHeader className="space-y-3">
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase text-accent">
              <PencilLine className="h-3.5 w-3.5" />
              Files
            </div>
            <DialogTitle>{t('file_manager.rename')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2">
              <div className="text-[11px] text-tertiary">{t('file_manager.from')}</div>
              <div className="font-mono text-xs break-all text-primary" data-testid="files__move__from">
                {selectedForMove ? (selectedForMove.kind === 'object' ? selectedForMove.key : selectedForMove.prefix) : '-'}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex h-8 items-center justify-between gap-2">
                  <Label htmlFor="sources-move-dest">{t('file_manager.dest_prefix')}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      onSetDestPickerPrefix(moveDestPrefix);
                      onSetDestPickerOpen(true);
                    }}
                    data-testid="files__move__browse"
                  >
                    {t('file_manager.browse')}
                  </Button>
                </div>
                <Input
                  id="sources-move-dest"
                  value={moveDestPrefix}
                  onChange={(event) => onSetMoveDestPrefix(event.target.value)}
                  placeholder={t('file_manager.dest_prefix_placeholder')}
                  data-testid="files__move__dest-prefix"
                />
                <div className="text-[11px] text-tertiary">{t('file_manager.dest_prefix_hint')}</div>
              </div>
              <div className="space-y-1.5">
                <div className="flex h-8 items-center">
                  <Label htmlFor="sources-move-name">{t('file_manager.new_name')}</Label>
                </div>
                <Input
                  id="sources-move-name"
                  value={moveName}
                  onChange={(event) => onSetMoveName(event.target.value)}
                  placeholder={moveNamePlaceholder}
                  data-testid="files__move__name"
                />
                <div className="text-[11px] text-tertiary">{t('file_manager.rename_hint')}</div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox
                id="sources-move-overwrite"
                checked={moveOverwrite}
                onCheckedChange={(value: boolean | 'indeterminate') => onSetMoveOverwrite(value === true)}
                data-testid="files__move__overwrite"
              />
              <Label htmlFor="sources-move-overwrite" className="text-sm">
                {t('file_manager.overwrite')}
              </Label>
            </div>

            <div className="rounded-sm border border-subtle bg-surface-high/40 px-3 py-2">
              <div className="text-[11px] text-tertiary">{t('file_manager.to')}</div>
              <div className="font-mono text-xs break-all text-primary" data-testid="files__move__to">
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
                onSetMoveOpen(false);
                onSetMoveOverwrite(false);
              }}
            >
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                void onHandleMove();
              }}
              disabled={!selectedForMove || !moveName.trim() || !selectedLibraryId}
              data-testid="files__move__submit"
            >
              {t('file_manager.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={destPickerOpen} onOpenChange={onSetDestPickerOpen}>
        <DialogContent className="sm:max-w-[720px]" data-testid="files__dialog__dest-picker">
          <DialogHeader>
            <DialogTitle>{t('file_manager.choose_destination')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-1 min-w-0">
              {destPickerCrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.prefix || 'root'}>
                  {index > 0 ? <span className="text-tertiary text-sm">/</span> : null}
                  <button
                    type="button"
                    className="text-sm text-primary hover:underline truncate max-w-[200px]"
                    onClick={() => onSetDestPickerPrefix(crumb.prefix)}
                    data-testid={index === 0 ? 'files__dest-picker__breadcrumb-root' : `files__dest-picker__breadcrumb--${index}`}
                  >
                    {index === 0 ? t('file_manager.root') : crumb.label}
                  </button>
                </React.Fragment>
              ))}
              <div className="ml-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => onSetDestPickerPrefix('')}
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
                    {destPickerItems.map((item) => (
                      <button
                        key={item.prefix}
                        type="button"
                        className="w-full flex items-center justify-between px-4 py-2 hover:bg-hover/60 text-left"
                        onClick={() => onSetDestPickerPrefix(item.prefix)}
                        data-testid="files__dest-picker__row"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Folder className="h-4 w-4 text-tertiary shrink-0" />
                          <div className="truncate text-sm text-primary">{item.name}</div>
                        </div>
                        <div className="text-[11px] text-tertiary font-mono truncate max-w-[360px]">{item.prefix}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onSetDestPickerOpen(false)}>
              {t('file_manager.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                onSetMoveDestPrefix(destPickerPrefix);
                onSetDestPickerOpen(false);
              }}
              data-testid="files__dest-picker__select"
            >
              {t('file_manager.select')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={moveConflictOpen}
        onOpenChange={onSetMoveConflictOpen}
        title={t('file_manager.conflict_title')}
        description={t('file_manager.conflict_description')}
        confirmText={t('file_manager.overwrite_action')}
        cancelText={t('file_manager.cancel')}
        variant="destructive"
        onConfirm={confirmMoveOverwrite}
        testId="files__dialog__move-conflict"
      />
    </>
  );
}
