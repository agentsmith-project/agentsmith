'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Download, Save, Copy, FileText, Image as ImageIcon, File, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Artifact } from '@/lib/types/task';
import { toast } from '@/components/ui/toast';
import { formatBytes } from '@/lib/utils/formatters';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

  const compactTextPreview = React.useMemo(() => {
    if (artifact.type !== 'text' || !artifact.content) return null;
    return artifact.content.replace(/\s+/g, ' ').trim();
  }, [artifact.content, artifact.type]);

  const summary = React.useMemo(() => {
    if (artifact.type === 'text') return compactTextPreview;
    if (artifact.type === 'image') return tArtifacts('filter.image');
    if (artifact.file_size) return formatBytes(artifact.file_size);
    return tStudio('artifact.file_default');
  }, [artifact.file_size, artifact.type, compactTextPreview, tArtifacts, tStudio]);

  const title = React.useMemo(() => {
    if (artifact.title) return artifact.title;
    if (artifact.type === 'text') return tStudio('artifact.text_default');
    if (artifact.type === 'image') return tStudio('artifact.image_default');
    return tStudio('artifact.file_default');
  }, [artifact.title, artifact.type, tStudio]);

  const previewNode = React.useMemo(() => {
    if (artifact.type === 'image') {
      const src = artifact.thumbnail_url || artifact.content || null;
      if (src) {
        return (
          <img
            src={src}
            alt={title}
            className="h-full w-full object-cover"
          />
        );
      }
      return <ImageIcon className="h-4 w-4 text-tertiary" />;
    }
    if (artifact.type === 'text') return <FileText className="h-4 w-4 text-icon-default" />;
    return <File className="h-4 w-4 text-icon-default" />;
  }, [artifact.content, artifact.thumbnail_url, artifact.type, title]);

  return (
    <TooltipProvider>
      <div
        className="rounded-lg border border-white/6 bg-surface/50 px-2 py-1.5 transition-colors hover:bg-hover/45"
        data-testid="notebook__artifact-card"
        data-artifact-id={artifact.id}
      >
        <div className="flex items-start gap-2">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-high/40">
            {previewNode}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="truncate text-[12px] font-medium text-foreground">{title}</div>
              <span className="shrink-0 rounded-full bg-surface-high/35 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-tertiary">
                {artifact.type}
              </span>
            </div>
            {summary ? (
              <div className="text-[10px] leading-4 text-tertiary line-clamp-2 break-words">
                {summary}
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 pt-0.5">
              {onView ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onView}
                  disabled={disabled}
                  className="h-6 px-1.5 text-[10px]"
                >
                  {tCommon('view')}
                </Button>
              ) : null}
              {onAttachAsInput ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onAttachAsInput}
                  disabled={disabled}
                  className="h-6 px-1.5 text-[10px]"
                  aria-label="attach as input"
                >
                  {tArtifacts('actions.attach_input')}
                </Button>
              ) : null}
            </div>
          </div>
          <ArtifactActionsMenu
            artifactType={artifact.type}
            onCopy={artifact.type === 'text' ? handleCopy : undefined}
            onSave={onSave}
            onDownload={onDownload}
            disabled={disabled}
            copyLabel={tCommon('copy')}
            saveLabel={tCommon('save')}
            downloadLabel={tCommon('download')}
            menuLabel={tCommon('actions')}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

function ArtifactActionsMenu({
  artifactType,
  onCopy,
  onSave,
  onDownload,
  disabled,
  copyLabel,
  saveLabel,
  downloadLabel,
  menuLabel,
}: {
  artifactType: Artifact['type'];
  onCopy?: () => void;
  onSave?: () => void;
  onDownload?: () => void;
  disabled?: boolean;
  copyLabel: string;
  saveLabel: string;
  downloadLabel: string;
  menuLabel: string;
}) {
  const hasMenuActions = Boolean((artifactType === 'text' && onCopy) || onSave || onDownload);
  if (!hasMenuActions) return null;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              className="mt-0.5 h-7 w-7 shrink-0 px-0"
              aria-label="artifact actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
              <span className="sr-only">{menuLabel}</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{menuLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {artifactType === 'text' && onCopy ? (
          <DropdownMenuItem onSelect={onCopy}>
            <Copy className="h-3.5 w-3.5" />
            {copyLabel}
          </DropdownMenuItem>
        ) : null}
        {onSave ? (
          <DropdownMenuItem onSelect={onSave}>
            <Save className="h-3.5 w-3.5" />
            {saveLabel}
          </DropdownMenuItem>
        ) : null}
        {onDownload ? (
          <>
            {artifactType === 'text' && onCopy ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={onDownload}>
              <Download className="h-3.5 w-3.5" />
              {downloadLabel}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
