'use client';

import * as React from 'react';
import { Copy, Download, Laptop, MonitorCog } from 'lucide-react';

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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import type { FileLibrary, FileLibraryClientMountAccess, FileLibraryDesktopMountAccess } from '@/lib/api/types';
import { ManualMountAccessContent } from '@/components/files/files-page/LibraryAccessDialog';
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';

type DesktopPlatform = 'linux' | 'macos' | 'windows';

interface DesktopAccessDialogProps {
  exchangePending: boolean;
  desktopMountAccess: FileLibraryDesktopMountAccess | null;
  manualMountAccess: FileLibraryClientMountAccess | null;
  manualMountAccessPending: boolean;
  open: boolean;
  revealMetadataUrl: boolean;
  targetLibrary: FileLibrary | null;
  t: (key: string, values?: Record<string, string>) => string;
  onLoadManualMountAccess: () => void;
  onOpenChange: (open: boolean) => void;
  onToggleRevealMetadataUrl: () => void;
}

type DesktopDownloadOption = {
  platform: DesktopPlatform;
  label: string;
  buttonLabel: string;
  url: string;
};

function detectPreferredPlatform(): DesktopPlatform {
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

function buildDesktopDownloadOptions(t: DesktopAccessDialogProps['t']): DesktopDownloadOption[] {
  const releasePage = 'https://github.com/lzjever/agentsmith-desktop/releases/latest';
  const runtimeConfig = getPublicRuntimeConfig();
  return [
    {
      platform: 'macos',
      label: t('file_manager.desktop_platform_macos'),
      buttonLabel: t('file_manager.desktop_download_button', { platform: t('file_manager.desktop_platform_macos') }),
      url: runtimeConfig.desktopDownloadUrlMacos || releasePage,
    },
    {
      platform: 'windows',
      label: t('file_manager.desktop_platform_windows'),
      buttonLabel: t('file_manager.desktop_download_button', { platform: t('file_manager.desktop_platform_windows') }),
      url: runtimeConfig.desktopDownloadUrlWindows || releasePage,
    },
    {
      platform: 'linux',
      label: t('file_manager.desktop_platform_linux'),
      buttonLabel: t('file_manager.desktop_download_button', { platform: t('file_manager.desktop_platform_linux') }),
      url: runtimeConfig.desktopDownloadUrlLinux || releasePage,
    },
  ];
}

export function DesktopAccessDialog({
  exchangePending,
  desktopMountAccess,
  manualMountAccess,
  manualMountAccessPending,
  open,
  revealMetadataUrl,
  targetLibrary,
  t,
  onLoadManualMountAccess,
  onOpenChange,
  onToggleRevealMetadataUrl,
}: DesktopAccessDialogProps) {
  const [activePlatform, setActivePlatform] = React.useState<DesktopPlatform>('linux');
  const [showManualDebug, setShowManualDebug] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setActivePlatform(detectPreferredPlatform());
    setShowManualDebug(false);
  }, [open]);

  React.useEffect(() => {
    if (!open || !showManualDebug || manualMountAccess || manualMountAccessPending) {
      return;
    }
    onLoadManualMountAccess();
  }, [manualMountAccess, manualMountAccessPending, onLoadManualMountAccess, open, showManualDebug]);

  const copyText = React.useCallback(async (value: string, successMessage: string, errorMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error(errorMessage);
    }
  }, []);

  const downloadOptions = React.useMemo(() => buildDesktopDownloadOptions(t), [t]);
  const activeDownload = downloadOptions.find((option) => option.platform === activePlatform) ?? downloadOptions[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[96vw] sm:max-w-[760px]" data-testid="files__dialog__desktop-mount-access">
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
            <div className="rounded-md border border-accent/12 bg-accent/5 p-4 shadow-card">
              <div className="flex items-start gap-3">
                <Laptop className="mt-0.5 h-4 w-4 text-accent" />
                <div>
                  <div className="text-sm font-medium text-foreground">{t('file_manager.desktop_access_primary_title')}</div>
                  <p className="mt-1 text-sm text-secondary">{t('file_manager.desktop_access_primary_description')}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-md border border-subtle bg-surface/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{t('file_manager.desktop_platform_title')}</div>
                  <p className="mt-1 text-xs text-secondary">{t('file_manager.desktop_platform_hint')}</p>
                </div>
              </div>

              <Tabs value={activePlatform} onValueChange={(value) => setActivePlatform(value as DesktopPlatform)}>
                <TabsList className="grid h-auto w-full grid-cols-3">
                  {downloadOptions.map((option) => (
                    <TabsTrigger
                      key={option.platform}
                      value={option.platform}
                      data-testid={`files__desktop-setup__platform-${option.platform}`}
                    >
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              <div className="rounded-md border border-subtle bg-background/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">{t('file_manager.desktop_app_name')}</div>
                    <p className="mt-1 text-xs text-secondary">
                      {t('file_manager.desktop_download_description', { platform: activeDownload.label })}
                    </p>
                  </div>
                  <Button asChild variant="primary" className="shrink-0" data-testid="files__desktop-setup__download">
                    <a href={activeDownload.url} target="_blank" rel="noreferrer">
                      <Download className="h-4 w-4" />
                      {activeDownload.buttonLabel}
                    </a>
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-subtle bg-surface/70 p-4 sm:grid-cols-3">
              <div className="rounded-md border border-subtle bg-background/30 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tertiary">
                  {t('file_manager.desktop_step_label', { step: '1' })}
                </div>
                <div className="mt-1 text-sm text-primary">{t('file_manager.desktop_step_install')}</div>
              </div>
              <div className="rounded-md border border-subtle bg-background/30 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tertiary">
                  {t('file_manager.desktop_step_label', { step: '2' })}
                </div>
                <div className="mt-1 text-sm text-primary">{t('file_manager.desktop_step_sign_in')}</div>
              </div>
              <div className="rounded-md border border-subtle bg-background/30 px-3 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tertiary">
                  {t('file_manager.desktop_step_label', { step: '3' })}
                </div>
                <div className="mt-1 text-sm text-primary">{t('file_manager.desktop_step_enable')}</div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="desktop-deployment-url">{t('file_manager.desktop_address')}</Label>
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
              <p className="text-xs text-secondary">{t('file_manager.desktop_address_hint')}</p>
            </div>

            <div className="rounded-md border border-subtle bg-background/20 p-4">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() => setShowManualDebug((value) => !value)}
                data-testid="files__desktop-setup__debug-toggle"
              >
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <MonitorCog className="h-4 w-4 text-tertiary" />
                  <span>{t('file_manager.desktop_debug_title')}</span>
                </div>
                <span className="text-xs text-tertiary">
                  {showManualDebug ? t('file_manager.desktop_debug_hide') : t('file_manager.desktop_debug_show')}
                </span>
              </button>
              <p className="mt-2 text-xs text-secondary">{t('file_manager.desktop_debug_description')}</p>

              {showManualDebug ? (
                <div className="mt-4 border-t border-subtle pt-4" data-testid="files__desktop-setup__debug-panel">
                  {manualMountAccessPending ? (
                    <div className="py-3 text-sm text-secondary">{t('file_manager.mount_access_loading')}</div>
                  ) : (
                    <ManualMountAccessContent
                      mountAccess={manualMountAccess}
                      revealMetadataUrl={revealMetadataUrl}
                      t={t}
                      onToggleRevealMetadataUrl={onToggleRevealMetadataUrl}
                    />
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="py-6 text-sm text-secondary">{t('file_manager.desktop_access_empty')}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
