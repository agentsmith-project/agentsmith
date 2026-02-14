'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Play, X, Trash2, Download } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FileItemWithAIReady } from '@/lib/api/types';

export interface FilesSelectionBarProps {
  selectedIds: string[];
  files: FileItemWithAIReady[];
  quotaExceeded: boolean;
  canSourceDelete: boolean;
  canSourceDownload: boolean;
  canControlAIReady: boolean;
  onDelete: () => void;
  onStartAIReady: () => void;
  onCancelAIReady: () => void;
  onDownload: (fileId: string) => void;
  onClearSelection: () => void;
  batchStartPending?: boolean;
  batchCancelPending?: boolean;
  /** Overlay mode: no border/radius, for floating bar */
  overlay?: boolean;
}

export function FilesSelectionBar({
  selectedIds,
  files,
  quotaExceeded,
  canSourceDelete,
  canSourceDownload,
  canControlAIReady,
  onDelete,
  onStartAIReady,
  onCancelAIReady,
  onDownload,
  onClearSelection,
  batchStartPending = false,
  batchCancelPending = false,
  overlay = false,
}: FilesSelectionBarProps) {
  const t = useTranslations('files');

  if (selectedIds.length === 0) return null;

  const selectedFiles = files.filter((f) => selectedIds.includes(f.id));
  const canStartCount = selectedFiles.filter(
    (f) => (f.ai_ready?.status || 'idle') === 'idle' || (f.ai_ready?.status || 'idle') === 'cancelled',
  ).length;
  const canCancelCount = selectedFiles.filter(
    (f) =>
      (f.ai_ready?.status || 'idle') === 'preparing' || (f.ai_ready?.status || 'idle') === 'ready',
  ).length;
  const singleFile = selectedIds.length === 1;

  return (
    <TooltipProvider>
      <div
        className={cn(
          'flex items-center justify-between gap-4 px-4 py-3',
          overlay ? 'bg-surface-high' : 'border border-subtle rounded-md bg-surface-high',
        )}
        role="region"
        aria-label={t('selection_bar_label')}
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.length} {t('selection_count')}
          </span>
          <Button variant="ghost" size="sm" onClick={onClearSelection} className="text-tertiary">
            {t('selection_clear')}
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {singleFile && canSourceDownload && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDownload(selectedIds[0])}
              className="gap-1.5"
            >
              <Download className="h-3.5 w-3.5" />
              {t('action_download')}
            </Button>
          )}

          {canControlAIReady && canStartCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onStartAIReady}
                    disabled={quotaExceeded || batchStartPending}
                    className="gap-1.5"
                  >
                    {batchStartPending ? (
                      <span className="animate-pulse">{t('action_processing')}</span>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        {t('action_start_ai_ready')} ({canStartCount})
                      </>
                    )}
                  </Button>
                </span>
              </TooltipTrigger>
              {quotaExceeded && (
                <TooltipContent>
                  <p>{t('quota_exceeded_hint')}</p>
                </TooltipContent>
              )}
            </Tooltip>
          )}

          {canControlAIReady && canCancelCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onCancelAIReady}
              disabled={batchCancelPending}
              className="gap-1.5"
            >
              {batchCancelPending ? (
                <span className="animate-pulse">{t('action_processing')}</span>
              ) : (
                <>
                  <X className="h-3.5 w-3.5" />
                  {t('action_cancel_ai_ready')} ({canCancelCount})
                </>
              )}
            </Button>
          )}

          {canSourceDelete && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="gap-1.5 text-error hover:text-error hover:bg-error/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('action_delete')}
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
