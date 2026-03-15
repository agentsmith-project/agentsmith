'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, Save, Copy, Eye, FileText, Image as ImageIcon, File } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Artifact } from '@/lib/types/task';
import { toast } from '@/components/ui/toast';
import { formatBytes } from '@/lib/utils/formatters';

export interface ArtifactCardProps {
  artifact: Artifact;
  onView?: () => void;
  onSave?: () => void;
  onDownload?: () => void;
  onAttachAsInput?: () => void;
  disabled?: boolean;
}

export function ArtifactCard({
  artifact,
  onView,
  onSave,
  onDownload,
  onAttachAsInput,
  disabled = false,
}: ArtifactCardProps) {
  const t = useTranslations('common.toast');
  const tStudio = useTranslations('notebook');
  const tCommon = useTranslations('common');
  const tArtifacts = useTranslations('notebook.artifacts');

  const handleCopy = async () => {
    if (artifact.type === 'text' && artifact.content) {
      try {
        await navigator.clipboard.writeText(artifact.content);
        toast.info(t('copied'));
      } catch {
        toast.error(t('copy_failed'));
      }
    }
  };

  const renderContent = () => {
    switch (artifact.type) {
      case 'text':
        return (
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-icon-default" />
              <span className="truncate text-[13px] font-medium text-foreground">
                {artifact.title || tStudio('artifact.text_default')}
              </span>
            </div>
            {artifact.content && (
              <p className="text-[12px] leading-5 text-primary line-clamp-2">{artifact.content}</p>
            )}
          </div>
        );
      case 'image':
        return (
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-surface-high/45">
              {artifact.thumbnail_url ? (
                <img
                  src={artifact.thumbnail_url}
                  alt={artifact.title || tStudio('artifact.image_default')}
                  className="h-full w-full object-cover"
                />
              ) : artifact.content ? (
                <img
                  src={artifact.content}
                  alt={artifact.title || tStudio('artifact.image_default')}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <ImageIcon className="h-5 w-5 text-tertiary" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-icon-default" />
                <span className="truncate text-[13px] font-medium text-foreground">
                  {artifact.title || tStudio('artifact.image_default')}
                </span>
              </div>
              <p className="text-[11px] text-tertiary">{tArtifacts('filter.image')}</p>
            </div>
          </div>
        );
      default:
        return (
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <File className="h-3.5 w-3.5 text-icon-default" />
              <span className="truncate text-[13px] font-medium text-foreground">
                {artifact.title || tStudio('artifact.file_default')}
              </span>
            </div>
            {artifact.file_size && (
              <p className="text-[11px] text-tertiary">
                {formatBytes(artifact.file_size)}
              </p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="rounded-xl border border-white/6 bg-surface/55 p-2.5 transition-colors hover:bg-hover hover:bg-hover/60" data-testid="notebook__artifact-card" data-artifact-id={artifact.id}>
      {renderContent()}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {artifact.type === 'text' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            disabled={disabled}
            className="h-6 px-2 text-[11px]"
          >
            <Copy className="h-3 w-3 mr-1" />
            {tCommon('copy')}
          </Button>
        )}
        {onView && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onView}
            disabled={disabled}
            className="h-6 px-2 text-[11px]"
          >
            <Eye className="h-3 w-3 mr-1" />
            {tCommon('view')}
          </Button>
        )}
        {onSave && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSave}
            disabled={disabled}
            className="h-6 px-2 text-[11px]"
          >
            <Save className="h-3 w-3 mr-1" />
            {tCommon('save')}
          </Button>
        )}
        {onDownload && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDownload}
            disabled={disabled}
            className="h-6 px-2 text-[11px]"
          >
            <Download className="h-3 w-3 mr-1" />
            {tCommon('download')}
          </Button>
        )}
        {onAttachAsInput && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onAttachAsInput}
            disabled={disabled}
            className="h-6 px-2 text-[11px]"
          >
            {tArtifacts('actions.attach_input')}
          </Button>
        )}
      </div>
    </div>
  );
}
