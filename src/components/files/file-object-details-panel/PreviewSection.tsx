'use client';

import { Expand, FileText, FileType2, Image as ImageIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { FileObjectMeta } from '@/lib/api/types';

import { basename, type PreviewKind } from './utils';

interface PreviewSectionProps {
  meta: FileObjectMeta;
  objectUrl: string | null;
  onDownload: () => void;
  onExpand: () => void;
  previewError: boolean;
  previewKind: PreviewKind;
  previewLoading: boolean;
  t: (key: string) => string;
  textPreview: string;
}

export function PreviewSection({
  meta,
  objectUrl,
  onDownload,
  onExpand,
  previewError,
  previewKind,
  previewLoading,
  t,
  textPreview,
}: PreviewSectionProps) {
  const expandable = previewKind !== 'none' && !previewLoading && !previewError;

  return (
    <div className="rounded-2xl border border-subtle bg-surface-high/20 p-3 space-y-3" data-testid="files__details-preview">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-tertiary">{t('file_manager.preview')}</div>
          <div className="mt-1 text-[11px] text-tertiary">{basename(meta.key)}</div>
        </div>
        {expandable ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={onExpand} data-testid="files__preview-expand">
            <Expand className="h-3.5 w-3.5" />
            {t('file_manager.preview_expand')}
          </Button>
        ) : null}
      </div>

      {previewKind === 'none' ? (
        <div className="h-40 rounded border border-subtle bg-surface flex flex-col items-center justify-center text-tertiary gap-2">
          <FileType2 className="h-5 w-5" />
          <span className="text-sm">{t('file_manager.preview_unsupported')}</span>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={onDownload}>
            {t('file_manager.download_to_view')}
          </Button>
        </div>
      ) : previewLoading ? (
        <div className="h-40 rounded border border-subtle bg-surface flex items-center justify-center text-tertiary text-sm">
          {t('file_manager.preview_loading')}
        </div>
      ) : previewError ? (
        <div className="h-40 rounded border border-subtle bg-surface flex flex-col items-center justify-center text-tertiary text-sm gap-2">
          <span>{t('file_manager.preview_failed')}</span>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={onDownload}>
            {t('file_manager.download_to_view')}
          </Button>
        </div>
      ) : previewKind === 'image' && objectUrl ? (
        <div className="rounded-xl border border-subtle bg-black/10 p-2">
          <img src={objectUrl} alt={basename(meta.key)} className="max-h-[280px] w-full object-contain rounded" />
        </div>
      ) : previewKind === 'pdf' && objectUrl ? (
        <iframe src={objectUrl} title={basename(meta.key)} className="h-[320px] w-full rounded-xl border border-subtle bg-surface" />
      ) : previewKind === 'text' ? (
        <div className="rounded-xl border border-subtle bg-surface p-2 max-h-[320px] overflow-auto">
          <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words text-primary">
            {textPreview || t('file_manager.preview_loading')}
          </pre>
        </div>
      ) : (
        <div className="h-40 rounded border border-subtle bg-surface flex items-center justify-center text-tertiary text-sm">
          {t('file_manager.preview_unsupported')}
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-tertiary">
        {previewKind === 'image' ? <ImageIcon className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
        <span>{meta.content_type}</span>
      </div>
    </div>
  );
}
