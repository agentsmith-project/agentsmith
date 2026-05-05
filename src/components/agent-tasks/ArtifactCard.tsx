'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { FileText, Image as ImageIcon, File } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Artifact } from '@/lib/types/task';
import { toast } from '@/components/ui/toast';
import { formatBytes } from '@/lib/utils/formatters';
import { TooltipProvider } from '@/components/ui/tooltip';

export interface ArtifactCardProps {
  artifact: Artifact;
  onView?: () => void;
  onDownload?: () => void;
  disabled?: boolean;
}

export function ArtifactCard({
  artifact,
  onView,
  onDownload,
  disabled = false,
}: ArtifactCardProps) {
  const t = useTranslations('common.toast');
  const tStudio = useTranslations('agent_tasks');
  const tCommon = useTranslations('common');
  const tArtifacts = useTranslations('agent_tasks.artifacts');

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
  const [isDetailsVisible, setIsDetailsVisible] = React.useState(false);
  const [hoverRect, setHoverRect] = React.useState<DOMRect | null>(null);
  const [isHoveringPanel, setIsHoveringPanel] = React.useState(false);
  const closeDetailsTimeoutRef = React.useRef<number | null>(null);
  const isActionsMenuOpen = false;

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

  const cancelScheduledClose = React.useCallback(() => {
    if (closeDetailsTimeoutRef.current != null) {
      window.clearTimeout(closeDetailsTimeoutRef.current);
      closeDetailsTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = React.useCallback(() => {
    cancelScheduledClose();
    closeDetailsTimeoutRef.current = window.setTimeout(() => {
      if (!isActionsMenuOpen) {
        setIsDetailsVisible(false);
        setIsHoveringPanel(false);
      }
      closeDetailsTimeoutRef.current = null;
    }, 120);
  }, [cancelScheduledClose, isActionsMenuOpen]);

  React.useEffect(() => () => cancelScheduledClose(), [cancelScheduledClose]);

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

  const handleBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    if (!isHoveringPanel && !isActionsMenuOpen) scheduleClose();
  };

  const openDetails = (element: HTMLDivElement) => {
    cancelScheduledClose();
    setHoverRect(element.getBoundingClientRect());
    setIsDetailsVisible(true);
  };

  const closeDetails = () => {
    if (isHoveringPanel || isActionsMenuOpen) return;
    scheduleClose();
  };

  const hoverStyle = React.useMemo(() => {
    if (!hoverRect) return undefined;
    const width = 252;
    const gap = 4;
    const left = Math.max(16, hoverRect.left - width - gap);
    const top = Math.max(16, hoverRect.top + hoverRect.height / 2 - 72);
    return { left: `${left}px`, top: `${top}px`, width: `${width}px` };
  }, [hoverRect]);

  return (
    <TooltipProvider>
      <div
        className="group relative rounded-lg border border-subtle bg-surface/40 px-2 py-1.5 transition-colors hover:border-subtle hover:bg-hover/35 focus-within:border-subtle focus-within:bg-hover/35"
        data-testid="agent-tasks__artifact-card"
        data-artifact-id={artifact.id}
        onMouseEnter={(event) => openDetails(event.currentTarget)}
        onMouseLeave={closeDetails}
        onFocus={(event) => openDetails(event.currentTarget)}
        onBlur={handleBlur}
        tabIndex={0}
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-high/35">
            {previewNode}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-foreground">{title}</div>
          </div>
        </div>
        {isDetailsVisible && hoverRect
          ? createPortal(
              <div
                className="fixed z-[90] rounded-md border border-subtle bg-background/95 p-2.5 shadow-[0_18px_40px_rgba(0,0,0,0.4)]"
                style={hoverStyle}
                data-testid="agent-tasks__artifact-hover-panel"
                onMouseEnter={() => {
                  cancelScheduledClose();
                  setIsHoveringPanel(true);
                }}
                onMouseLeave={() => {
                  setIsHoveringPanel(false);
                  scheduleClose();
                }}
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-[11px] font-medium text-foreground">{title}</div>
                    <span className="shrink-0 rounded-full bg-surface-high/35 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-tertiary">
                      {artifact.type}
                    </span>
                  </div>
                  {summary ? (
                    <div className="text-[10px] leading-4 text-tertiary line-clamp-3 break-words">
                      {summary}
                    </div>
                  ) : null}
                  <div className="grid grid-cols-2 gap-1.5">
                    {onView ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onView}
                        disabled={disabled}
                        className="h-7 justify-start px-2 text-[10px]"
                      >
                        {tCommon('view')}
                      </Button>
                    ) : null}
                    {artifact.type === 'text' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopy}
                        disabled={disabled}
                        className="h-7 justify-start px-2 text-[10px]"
                        aria-label="copy artifact"
                      >
                        {tCommon('copy')}
                      </Button>
                    ) : null}
                    {onDownload ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onDownload}
                        disabled={disabled}
                        className="h-7 justify-start px-2 text-[10px]"
                        aria-label="download artifact"
                      >
                        {tCommon('download')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>,
              document.body,
            )
          : null}
      </div>
    </TooltipProvider>
  );
}
