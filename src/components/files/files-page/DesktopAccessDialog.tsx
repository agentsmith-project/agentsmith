'use client';

import * as React from 'react';
import { Copy, MonitorCog } from 'lucide-react';

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
import { toast } from '@/components/ui/toast';
import type { FileLibrary, FileLibraryDesktopMountAccess } from '@/lib/api/types';

interface DesktopAccessDialogProps {
  exchangePending: boolean;
  desktopMountAccess: FileLibraryDesktopMountAccess | null;
  open: boolean;
  targetLibrary: FileLibrary | null;
  t: (key: string, values?: Record<string, string>) => string;
  onOpenChange: (open: boolean) => void;
}

export function DesktopAccessDialog({
  exchangePending,
  desktopMountAccess,
  open,
  targetLibrary,
  t,
  onOpenChange,
}: DesktopAccessDialogProps) {
  const copyText = React.useCallback(async (value: string, successMessage: string, errorMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(errorMessage);
    }
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] sm:max-w-[820px]" data-testid="files__dialog__desktop-mount-access">
        <DialogHeader>
          <DialogTitle>
            {targetLibrary
              ? t('file_manager.desktop_access_title_with_name', { name: targetLibrary.name })
              : t('file_manager.desktop_access_title')}
          </DialogTitle>
          <DialogDescription>{t('file_manager.desktop_access_description')}</DialogDescription>
        </DialogHeader>

        {exchangePending ? (
          <div className="py-6 text-sm text-secondary">{t('file_manager.desktop_access_loading')}</div>
        ) : desktopMountAccess ? (
          <div className="space-y-6">
            <div className="rounded-[18px] border border-accent/12 bg-accent/5 p-4 shadow-[0_14px_34px_rgba(0,0,0,0.12)]">
              <div className="flex items-start gap-2 text-sm font-medium text-foreground">
                <MonitorCog className="mt-0.5 h-4 w-4 text-accent" />
                <div>
                  <div>{t('file_manager.desktop_access_primary_title')}</div>
                  <p className="mt-1 text-xs text-secondary">{t('file_manager.desktop_access_primary_description')}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="desktop-deployment-url">{t('file_manager.desktop_deployment_url')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="desktop-deployment-url"
                    value={desktopMountAccess.deployment_base_url}
                    readOnly
                    data-testid="files__desktop-mount__deployment-url"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => copyText(
                      desktopMountAccess.deployment_base_url,
                      t('file_manager.desktop_deployment_url_copied'),
                      t('file_manager.desktop_deployment_url_copy_failed'),
                    )}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="desktop-filesystem-name">{t('file_manager.filesystem_name')}</Label>
                <Input
                  id="desktop-filesystem-name"
                  value={desktopMountAccess.filesystem_name}
                  readOnly
                  data-testid="files__desktop-mount__filesystem-name"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="desktop-root-linux">{t('file_manager.mount_platform_linux')}</Label>
                <Input
                  id="desktop-root-linux"
                  value={desktopMountAccess.default_mount_roots.linux}
                  readOnly
                  data-testid="files__desktop-mount__root-linux"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="desktop-root-macos">{t('file_manager.mount_platform_macos')}</Label>
                <Input
                  id="desktop-root-macos"
                  value={desktopMountAccess.default_mount_roots.macos}
                  readOnly
                  data-testid="files__desktop-mount__root-macos"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="desktop-root-windows">{t('file_manager.mount_platform_windows_cmd')}</Label>
                <Input
                  id="desktop-root-windows"
                  value={desktopMountAccess.default_mount_roots.windows}
                  readOnly
                  data-testid="files__desktop-mount__root-windows"
                />
              </div>
            </div>

            <div className="rounded-[14px] border border-white/8 bg-surface/70 px-4 py-3 text-sm text-secondary">
              {desktopMountAccess.windows_requires_drive_letter
                ? t('file_manager.desktop_windows_drive_letter_hint')
                : t('file_manager.desktop_mount_root_hint')}
            </div>
          </div>
        ) : (
          <div className="py-6 text-sm text-secondary">{t('file_manager.desktop_access_empty')}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
