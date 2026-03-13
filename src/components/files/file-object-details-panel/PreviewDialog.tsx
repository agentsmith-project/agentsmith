'use client';

import { FileType2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { basename, type PreviewKind } from './utils';

interface PreviewDialogProps {
  filename: string;
  metaKey: string;
  objectUrl: string | null;
  open: boolean;
  previewKind: PreviewKind;
  t: (key: string) => string;
  textPreview: string;
  onOpenChange: (open: boolean) => void;
}

export function PreviewDialog({
  filename,
  metaKey,
  objectUrl,
  open,
  previewKind,
  t,
  textPreview,
  onOpenChange,
}: PreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[86vh] flex flex-col" data-testid="files__dialog__preview-expand">
        <DialogHeader>
          <DialogTitle className="truncate">{filename}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          {previewKind === 'image' && objectUrl ? (
            <div className="h-full rounded border border-subtle bg-black/20 p-3">
              <img src={objectUrl} alt={basename(metaKey)} className="h-full w-full object-contain rounded" />
            </div>
          ) : previewKind === 'pdf' && objectUrl ? (
            <iframe src={objectUrl} title={basename(metaKey)} className="h-full w-full rounded border border-subtle bg-surface" />
          ) : previewKind === 'text' ? (
            <div className="h-full rounded border border-subtle bg-surface p-3 overflow-auto">
              <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words text-primary">
                {textPreview || t('file_manager.preview_loading')}
              </pre>
            </div>
          ) : (
            <div className="h-full rounded border border-subtle bg-surface flex flex-col items-center justify-center gap-2 text-tertiary">
              <FileType2 className="h-5 w-5" />
              <span>{t('file_manager.preview_unsupported')}</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
