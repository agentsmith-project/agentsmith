'use client';
import * as React from 'react';
import { Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TaskMessage } from '@/lib/types/task';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/chat/Markdown';

export interface MessageItemProps {
  message: TaskMessage;
  streamingContent?: string | null;
  disabled?: boolean;
}

function splitConcatenatedJsonObjects(input: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (!ch) continue;

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        items.push(input.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return items;
}

function decodeCodexEventText(raw: string): string {
  if (!raw || raw.indexOf('"type":"') < 0) return raw;

  const objects = splitConcatenatedJsonObjects(raw);
  if (objects.length === 0) return raw;

  const agentTexts: string[] = [];
  const agentDeltas: string[] = [];
  const errors: string[] = [];

  for (const text of objects) {
    try {
      const evt = JSON.parse(text) as {
        type?: string;
        item?: { type?: string; text?: string; message?: string };
        delta?: string | { text?: string };
        text?: string;
        message?: string;
        error?: { message?: string };
      };
      if (evt.type === 'response.output_text.delta') {
        if (typeof evt.delta === 'string') {
          agentDeltas.push(evt.delta);
          continue;
        }
      }
      if (evt.type === 'response.output_text.done' && typeof evt.text === 'string') {
        agentTexts.push(evt.text);
        continue;
      }
      if (evt.type === 'item.delta' && typeof evt.delta === 'object' && evt.delta && typeof evt.delta.text === 'string') {
        agentDeltas.push(evt.delta.text);
        continue;
      }
      if (evt.type === 'item.completed' && evt.item?.type === 'agent_message' && typeof evt.item.text === 'string') {
        agentTexts.push(evt.item.text);
        continue;
      }
      if (evt.type === 'error' && typeof evt.message === 'string') {
        errors.push(evt.message);
        continue;
      }
      if (evt.type === 'turn.failed' && typeof evt.error?.message === 'string') {
        errors.push(evt.error.message);
      }
    } catch {
      // Ignore incomplete trailing JSON while streaming and keep the decoded prefix.
      continue;
    }
  }

  if (agentTexts.length > 0) {
    return agentTexts.join('\n\n');
  }
  if (agentDeltas.length > 0) {
    return agentDeltas.join('');
  }
  if (errors.length > 0) {
    return errors.join('\n');
  }
  // Streaming state before agent_message is completed: render as empty to keep placeholder skeleton.
  return '';
}

export function MessageItem({ message, streamingContent, disabled = false }: MessageItemProps) {
  const t = useTranslations('common.toast');
  const tCommon = useTranslations('common');
  const tNotebookConversation = useTranslations('notebook.conversation');
  const isUser = message.role === 'user';

  const rawDisplayContent = streamingContent ?? message.content;
  const displayContent = isUser ? rawDisplayContent : decodeCodexEventText(rawDisplayContent);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      toast.info(t('copied'));
    } catch {
      toast.error(t('copy_failed'));
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
                  <div className="pt-1 text-xs text-tertiary" data-testid="notebook__agent-streaming-status">
                    {tNotebookConversation('agent_working')}
                  </div>
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
            aria-label={tCommon('copy')}
            title={tCommon('copy')}
          >
            <Copy className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
