'use client';

import * as React from 'react';
import { Copy, Pencil, RotateCcw, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Attachment, ChatMessage } from '@/lib/api/types';
import { getReferenceNow } from '@/lib/reference-now';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/chat/Markdown';
import { type VariantGroups, getVariantMeta } from '@/lib/chat/branch';
import type { ChatLayoutMode } from '@/lib/chat/layout';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export const MessageItem = React.memo(function MessageItem({
  message,
  variantGroups,
  activeVariantIndexByGroup,
  onSelectVariant,
  onEdit,
  onEditCommit,
  onEditCancel,
  isEditing,
  onRegenerate,
  streamingOverride,
  streamingMeta,
  disabled,
  layoutMode = 'standard',
  attachmentsById,
}: {
  message: ChatMessage;
  variantGroups: VariantGroups;
  activeVariantIndexByGroup: Record<string, number>;
  onSelectVariant: (groupId: string, nextIndex: number) => void;
  onEdit: (message: ChatMessage) => void;
  onEditCommit: (message: ChatMessage, nextContent: string) => void;
  onEditCancel: () => void;
  isEditing: boolean;
  onRegenerate: (message: ChatMessage) => void;
  streamingOverride?: string | null;
  streamingMeta?: { startedAt: number; lastTokenAt: number } | null;
  disabled: boolean;
  layoutMode?: ChatLayoutMode;
  attachmentsById?: Record<string, Attachment>;
}) {
  const t = useTranslations('common.toast');
  const tChat = useTranslations('chat');
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isEditingUser = isUser && isEditing;

  const variantMeta = getVariantMeta(message, variantGroups);
  const activeVariantIndex = variantMeta ? (activeVariantIndexByGroup[variantMeta.groupId] ?? variantMeta.index) : null;
  const [draft, setDraft] = React.useState(message.content);
  const [showDiff, setShowDiff] = React.useState(false);
  const [previewAttachmentId, setPreviewAttachmentId] = React.useState<string | null>(null);
  const attachmentSnapshots = message.attachment_snapshots ?? [];
  const previewAttachment = previewAttachmentId
    ? attachmentsById?.[previewAttachmentId] ?? null
    : null;

  React.useEffect(() => {
    if (isEditing) setDraft(message.content);
    if (!isEditing) setShowDiff(false);
  }, [isEditing, message.content]);

  const [nowTick, setNowTick] = React.useState(() => getReferenceNow().getTime());
  React.useEffect(() => {
    if (!streamingMeta) return;
    const id = window.setInterval(() => setNowTick(getReferenceNow().getTime()), 1000);
    return () => window.clearInterval(id);
  }, [streamingMeta]);

  const streamingText = typeof streamingOverride === 'string' ? streamingOverride : '';
  const shouldShowWaitingIndicator = Boolean(
    streamingOverride != null
    && streamingMeta
    && (streamingText.trim().length === 0 || nowTick - streamingMeta.lastTokenAt >= 3000),
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.info(t('copied'));
    } catch {
      toast.error(t('copy_failed'));
    }
  };

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')} data-testid="chat__message" data-message-id={message.id}>
      <div
        className={cn(
          isEditingUser
            ? 'w-full max-w-[92%] min-w-[360px]'
            : (layoutMode === 'ultrawide' ? 'max-w-[86%]' : 'max-w-[80%]'),
          'rounded-md px-4 py-3 border relative',
          isUser ? 'bg-hover text-foreground border-subtle' : 'bg-surface-high text-primary border-subtle',
          message.is_stale ? 'opacity-60' : 'opacity-100',
        )}
      >
        {message.is_stale && (
          <div className="text-[11px] text-tertiary mb-1">{tChat('message_item.older_branch')}</div>
        )}
        {streamingOverride != null && (
          <div className="text-[11px] text-tertiary mb-1 flex items-center gap-2">
            <span>{tChat('message_item.regenerating')}</span>
          </div>
        )}

        {attachmentSnapshots.length > 0 && !isEditing && (
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-tertiary">{tChat('message_item.attachments')}</div>
            <div className="flex flex-wrap gap-1.5">
              {attachmentSnapshots.map((attachment) => {
                const currentAttachment = attachmentsById?.[attachment.id];
                const previewUrl = currentAttachment?.preview_url;
                const isImage =
                  typeof previewUrl === 'string' &&
                  previewUrl.length > 0 &&
                  (attachment.file_type.startsWith('image/') || previewUrl.startsWith('data:image/'));
                return (
                  <button
                    key={attachment.id}
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1 rounded-sm border border-subtle bg-surface-high px-2 py-1 text-left',
                      isImage ? 'hover:bg-hover cursor-pointer' : 'cursor-default',
                    )}
                    onClick={() => {
                      if (isImage) setPreviewAttachmentId(attachment.id);
                    }}
                    data-testid={`chat__message-attachment-${attachment.id}`}
                  >
                    <span className="max-w-[180px] truncate text-[11px] text-primary">{attachment.file_name}</span>
                    <span className="text-[10px] text-tertiary">{formatSize(attachment.file_size)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className={cn('space-y-2', streamingOverride != null && 'min-h-[44px]')}>
          {isEditing ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.max(3, Math.min(10, draft.split('\n').length + 1))}
                className={cn(
                  'w-full resize-none rounded-md border border-subtle bg-surface-high px-3 py-2 text-sm text-primary',
                  'placeholder:text-tertiary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
                )}
              />
              <div className="flex items-center justify-between text-[11px] text-tertiary">
                <span>{tChat('message_item.preview_changes')}</span>
                <button
                  type="button"
                  onClick={() => setShowDiff((v) => !v)}
                  className="underline decoration-dashed"
                >
                  {showDiff ? tChat('message_item.hide_diff') : tChat('message_item.show_diff')}
                </button>
              </div>
              {showDiff && (
                <div className="rounded-sm border border-subtle bg-surface-high/60 p-2 text-[11px] text-tertiary">
                  <div className="mb-1 text-tertiary">{tChat('message_item.original')}</div>
                  <div className="whitespace-pre-wrap text-tertiary line-through/30">
                    {message.content}
                  </div>
                  <div className="mt-2 mb-1 text-tertiary">{tChat('message_item.edited')}</div>
                  <div className="whitespace-pre-wrap text-primary">
                    {draft}
                  </div>
                </div>
              )}
            </div>
          ) : streamingOverride != null ? (
            <div className="min-h-[48px]">
              {streamingText.trim().length === 0 ? (
                <div className="space-y-2">
                  <div className="h-3 w-2/3 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/2 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/3 rounded-sm bg-surface-high/60 animate-pulse" />
                </div>
              ) : (
                <Markdown content={streamingText || '…'} />
              )}
              {shouldShowWaitingIndicator ? (
                <div className="mt-2 flex justify-end" data-testid="chat__message-stream-waiting">
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-tertiary animate-pulse" />
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-tertiary animate-pulse [animation-delay:120ms]" />
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-tertiary animate-pulse [animation-delay:240ms]" />
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <Markdown content={message.content} />
          )}
        </div>

        <div className={cn('mt-2 flex items-center gap-1 justify-end')}>
          {isUser && !isEditing && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onEdit(message)}
              disabled={disabled}
              aria-label={tChat('message_item.edit')}
              title={tChat('message_item.edit')}
            >
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          {isUser && isEditing && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onEditCommit(message, draft)}
                disabled={disabled || draft.trim().length === 0}
                aria-label={tChat('message_item.save')}
              >
                <Check className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onEditCancel}
                disabled={disabled}
                aria-label={tChat('message_item.cancel')}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}
          {isAssistant && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => onRegenerate(message)}
              disabled={disabled}
              aria-label={tChat('message_item.regenerate')}
              title={tChat('message_item.regenerate')}
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          )}
          {variantMeta && !isEditing && (
            <div className="flex items-center gap-1 ml-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => onSelectVariant(variantMeta.groupId, Math.max(0, (activeVariantIndex ?? 0) - 1))}
                disabled={disabled || (activeVariantIndex ?? 0) <= 0}
                aria-label={tChat('message_item.prev_variant')}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="text-xs text-tertiary tabular-nums">
                {(activeVariantIndex ?? variantMeta.index) + 1}/{variantMeta.total}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() =>
                  onSelectVariant(variantMeta.groupId, Math.min(variantMeta.total - 1, (activeVariantIndex ?? 0) + 1))
                }
                disabled={disabled || (activeVariantIndex ?? variantMeta.index) >= variantMeta.total - 1}
                aria-label={tChat('message_item.next_variant')}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopy}
            aria-label={tChat('message_item.copy')}
            title={tChat('message_item.copy')}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <Dialog
        open={previewAttachmentId !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewAttachmentId(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewAttachment?.file_name ?? tChat('message_item.attachment_preview')}</DialogTitle>
            <DialogDescription className="sr-only">
              {tChat('message_item.attachment_preview')}
            </DialogDescription>
          </DialogHeader>
          {previewAttachment?.preview_url ? (
            <div className="flex max-h-[70vh] justify-center overflow-auto">
              <img
                src={previewAttachment.preview_url}
                alt={previewAttachment.file_name}
                className="max-h-[70vh] w-auto rounded-md border border-subtle object-contain"
              />
            </div>
          ) : (
            <div className="text-sm text-tertiary">{tChat('message_item.attachment_preview_unavailable')}</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
});
