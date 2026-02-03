'use client';
import * as React from 'react';
import { Copy } from 'lucide-react';
import type { RecipeMessage } from '@/lib/types/recipe';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/chat/Markdown';

export interface MessageItemProps {
  message: RecipeMessage;
  streamingContent?: string | null;
  disabled?: boolean;
}

export function MessageItem({ message, streamingContent, disabled = false }: MessageItemProps) {
  const isUser = message.role === 'user';

  const displayContent = streamingContent ?? message.content;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast.info('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-md px-4 py-3 border relative',
          isUser
            ? 'bg-hover text-foreground border-subtle'
            : 'bg-surface-high text-primary border-subtle',
        )}
      >
        <div className="space-y-2">
          {streamingContent != null ? (
            <div className="min-h-[48px]">
              {displayContent.trim().length === 0 ? (
                <div className="space-y-2">
                  <div className="h-3 w-2/3 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/2 rounded-sm bg-surface-high/60 animate-pulse" />
                  <div className="h-3 w-1/3 rounded-sm bg-surface-high/60 animate-pulse" />
                </div>
              ) : (
                <Markdown content={displayContent || '…'} />
              )}
            </div>
          ) : (
            <Markdown content={displayContent} />
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 justify-end">
          <span className="text-[11px] text-tertiary">{formatTime(message.created_at)}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={handleCopy}
            disabled={disabled}
            aria-label="Copy"
            title="Copy"
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
