'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import type { FileLibrary, StorageCredentialExchangeResponse } from '@/lib/api/types';

interface LibraryAccessDialogProps {
  exchangePending: boolean;
  mountAccess: StorageCredentialExchangeResponse | null;
  open: boolean;
  revealMetadataUrl: boolean;
  targetLibrary: FileLibrary | null;
  t: (key: string, values?: Record<string, string>) => string;
  onOpenChange: (open: boolean) => void;
  onToggleRevealMetadataUrl: () => void;
}

export function LibraryAccessDialog({
  exchangePending,
  mountAccess,
  open,
  revealMetadataUrl,
  targetLibrary,
  t,
  onOpenChange,
  onToggleRevealMetadataUrl,
}: LibraryAccessDialogProps) {
  const copyText = React.useCallback(async (value: string, successMessage: string, errorMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(errorMessage);
    }
  }, []);

  const metadataUrlValue = !mountAccess
    ? ''
    : revealMetadataUrl
      ? mountAccess.metadata_url
      : '••••••••••••••••••••';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px]" data-testid="files__dialog__library-mount-access">
        <DialogHeader>
          <DialogTitle>
            {targetLibrary
              ? t('file_manager.mount_access_title_with_name', { name: targetLibrary.name })
              : t('file_manager.mount_access_title')}
          </DialogTitle>
          <DialogDescription>
            {t('file_manager.mount_access_description')}
          </DialogDescription>
        </DialogHeader>

        {exchangePending ? (
          <div className="py-6 text-sm text-secondary">{t('file_manager.mount_access_loading')}</div>
        ) : mountAccess ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="file-library-filesystem-name">{t('file_manager.filesystem_name')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="file-library-filesystem-name"
                    value={mountAccess.filesystem_name}
                    readOnly
                    data-testid="files__library-mount__filesystem-name"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyText(
                      mountAccess.filesystem_name,
                      t('file_manager.filesystem_name_copied'),
                      t('file_manager.filesystem_name_copy_failed'),
                    )}
                  >
                    {t('file_manager.copy')}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="file-library-mount-path">{t('file_manager.mount_path')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="file-library-mount-path"
                    value={mountAccess.recommended_mount_path}
                    readOnly
                    data-testid="files__library-mount__path"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyText(
                      mountAccess.recommended_mount_path,
                      t('file_manager.mount_path_copied'),
                      t('file_manager.mount_path_copy_failed'),
                    )}
                  >
                    {t('file_manager.copy')}
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="file-library-metadata-url">{t('file_manager.metadata_url')}</Label>
              <div className="flex gap-2">
                <Input
                  id="file-library-metadata-url"
                  value={metadataUrlValue}
                  readOnly
                  data-testid="files__library-mount__metadata-url"
                />
                <Button type="button" variant="outline" onClick={onToggleRevealMetadataUrl}>
                  {revealMetadataUrl ? t('file_manager.hide_metadata_url') : t('file_manager.reveal_metadata_url')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!revealMetadataUrl}
                  onClick={() => copyText(
                    mountAccess.metadata_url,
                    t('file_manager.metadata_url_copied'),
                    t('file_manager.metadata_url_copy_failed'),
                  )}
                >
                  {t('file_manager.copy')}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="file-library-mount-linux">{t('file_manager.mount_command_linux')}</Label>
                <Textarea
                  id="file-library-mount-linux"
                  value={mountAccess.recommended_mount_commands.linux}
                  readOnly
                  className="min-h-[100px] font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="file-library-mount-macos">{t('file_manager.mount_command_macos')}</Label>
                <Textarea
                  id="file-library-mount-macos"
                  value={mountAccess.recommended_mount_commands.macos}
                  readOnly
                  className="min-h-[100px] font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="file-library-mount-windows">{t('file_manager.mount_command_windows')}</Label>
                <Textarea
                  id="file-library-mount-windows"
                  value={mountAccess.recommended_mount_commands.windows}
                  readOnly
                  className="min-h-[100px] font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-sm font-medium text-foreground">{t('file_manager.platform_notes')}</div>
              <ul className="space-y-1 text-sm text-secondary">
                {mountAccess.platform_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="py-6 text-sm text-secondary">{t('file_manager.mount_access_empty')}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
