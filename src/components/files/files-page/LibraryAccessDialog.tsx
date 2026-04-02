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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import type { FileLibrary, FileLibraryClientMountAccess } from '@/lib/api/types';

type PlatformTab = 'linux' | 'macos' | 'windows';

interface LibraryAccessDialogProps {
  exchangePending: boolean;
  mountAccess: FileLibraryClientMountAccess | null;
  open: boolean;
  revealMetadataUrl: boolean;
  targetLibrary: FileLibrary | null;
  t: (key: string, values?: Record<string, string>) => string;
  onOpenChange: (open: boolean) => void;
  onToggleRevealMetadataUrl: () => void;
}

function detectPreferredPlatform(): PlatformTab {
  if (typeof navigator === 'undefined') return 'linux';

  const userAgentDataPlatform = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const platformHints = [
    userAgentDataPlatform,
    navigator.platform,
    navigator.userAgent,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const value of platformHints) {
    if (/win/i.test(value)) return 'windows';
    if (/mac/i.test(value)) return 'macos';
    if (/linux|x11|ubuntu|debian|fedora|centos/i.test(value)) return 'linux';
  }

  return 'linux';
}

interface ManualMountAccessContentProps {
  mountAccess: FileLibraryClientMountAccess | null;
  revealMetadataUrl: boolean;
  t: (key: string, values?: Record<string, string>) => string;
  onToggleRevealMetadataUrl: () => void;
}

export function ManualMountAccessContent({
  mountAccess,
  revealMetadataUrl,
  t,
  onToggleRevealMetadataUrl,
}: ManualMountAccessContentProps) {
  const [activePlatform, setActivePlatform] = React.useState<PlatformTab>('linux');

  React.useEffect(() => {
    setActivePlatform(detectPreferredPlatform());
  }, []);

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

  const platformCommands = mountAccess
    ? {
        linux: mountAccess.recommended_mount_commands.linux,
        macos: mountAccess.recommended_mount_commands.macos,
        windows: mountAccess.recommended_mount_commands.windows,
      }
    : null;

  const platformLabelKeys: Record<PlatformTab, string> = {
    linux: 'file_manager.mount_platform_linux',
    macos: 'file_manager.mount_platform_macos',
    windows: 'file_manager.mount_platform_windows_cmd',
  };

  if (!mountAccess || !platformCommands) {
    return <div className="py-2 text-sm text-secondary">{t('file_manager.mount_access_empty')}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[18px] border border-accent/12 bg-accent/5 p-4 shadow-[0_14px_34px_rgba(0,0,0,0.12)]">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <MonitorCog className="h-4 w-4 text-accent" />
              <span>{t('file_manager.mount_command_title')}</span>
            </div>
            <p className="mt-1 text-xs text-secondary">{t('file_manager.mount_command_description')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-1.5"
            onClick={() => copyText(
              platformCommands[activePlatform],
              t('file_manager.mount_command_copied'),
              t('file_manager.mount_command_copy_failed'),
            )}
            data-testid="files__library-mount__copy-command"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('file_manager.copy')}
          </Button>
        </div>

        <Tabs value={activePlatform} onValueChange={(value) => setActivePlatform(value as PlatformTab)}>
          <TabsList className="mb-3 grid h-auto w-full grid-cols-3">
            <TabsTrigger value="linux" data-testid="files__library-mount__tab-linux">
              {t(platformLabelKeys.linux)}
            </TabsTrigger>
            <TabsTrigger value="macos" data-testid="files__library-mount__tab-macos">
              {t(platformLabelKeys.macos)}
            </TabsTrigger>
            <TabsTrigger value="windows" data-testid="files__library-mount__tab-windows">
              {t(platformLabelKeys.windows)}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="linux" className="mt-0">
            <Textarea
              value={platformCommands.linux}
              readOnly
              className="min-h-[180px] resize-y font-mono text-xs leading-6"
              data-testid="files__library-mount__command-linux"
            />
          </TabsContent>
          <TabsContent value="macos" className="mt-0">
            <Textarea
              value={platformCommands.macos}
              readOnly
              className="min-h-[180px] resize-y font-mono text-xs leading-6"
              data-testid="files__library-mount__command-macos"
            />
          </TabsContent>
          <TabsContent value="windows" className="mt-0">
            <Textarea
              value={platformCommands.windows}
              readOnly
              className="min-h-[180px] resize-y font-mono text-xs leading-6"
              data-testid="files__library-mount__command-windows"
            />
          </TabsContent>
        </Tabs>
      </div>

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

      <div className="space-y-1.5">
        <Label htmlFor="file-library-bucket-url">{t('file_manager.bucket_url')}</Label>
        <div className="flex gap-2">
          <Input
            id="file-library-bucket-url"
            value={mountAccess.storage_bucket_url ?? ''}
            readOnly
            data-testid="files__library-mount__bucket-url"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!mountAccess.storage_bucket_url}
            onClick={() => copyText(
              mountAccess.storage_bucket_url ?? '',
              t('file_manager.bucket_url_copied'),
              t('file_manager.bucket_url_copy_failed'),
            )}
          >
            {t('file_manager.copy')}
          </Button>
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
  );
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] sm:max-w-[940px]" data-testid="files__dialog__library-mount-access">
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
          <ManualMountAccessContent
            mountAccess={mountAccess}
            revealMetadataUrl={revealMetadataUrl}
            t={t}
            onToggleRevealMetadataUrl={onToggleRevealMetadataUrl}
          />
        ) : (
          <div className="py-6 text-sm text-secondary">{t('file_manager.mount_access_empty')}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
