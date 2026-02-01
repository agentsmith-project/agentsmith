'use client';

import * as React from 'react';
import { Copy, Pencil, RotateCcw, ChevronLeft, ChevronRight, Check, X } from 'lucide-react';

import type { ChatMessage } from '@/lib/api/types';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/chat/Markdown';
import { type VariantGroups, getVariantMeta } from '@/lib/chat/branch';

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
  disabled,
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
  disabled: boolean;
}) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';

  const variantMeta = getVariantMeta(message, variantGroups);
  const activeVariantIndex = variantMeta ? (activeVariantIndexByGroup[variantMeta.groupId] ?? variantMeta.index) : null;
  const [draft, setDraft] = React.useState(message.content);

  React.useEffect(() => {
    if (isEditing) setDraft(message.content);
  }, [isEditing, message.content]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.info('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-md px-4 py-3 border relative',
          isUser ? 'bg-hover text-foreground border-subtle' : 'bg-surface-high text-primary border-subtle',
          message.is_stale ? 'opacity-60' : 'opacity-100',
        )}
      >
        {message.is_stale && (
          <div className="text-[11px] text-tertiary mb-1">Older branch</div>
        )}

        <div className="space-y-2">
          {isEditing ? (
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
          ) : streamingOverride ? (
            <Markdown content={streamingOverride || '…'} />
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
              aria-label="Edit message"
              title="Edit"
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
                aria-label="Save"
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
                aria-label="Cancel"
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
              aria-label="Regenerate"
              title="Regenerate"
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
                aria-label="Previous variant"
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
                aria-label="Next variant"
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
            aria-label="Copy"
            title="Copy"
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
});
