'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConversationInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  sending?: boolean;
  agentRunning?: boolean;
  pendingQueue?: Array<{ id: string; content: string }>;
  onPendingUpdate?: (id: string, content: string) => void;
  onPendingRemove?: (id: string) => void;
  placeholder?: string;
}

export function ConversationInput({
  value,
  onChange,
  onSend,
  disabled = false,
  sending = false,
  agentRunning = false,
  pendingQueue = [],
  onPendingUpdate,
  onPendingRemove,
  placeholder,
}: ConversationInputProps) {
  const t = useTranslations('agent_tasks.conversation');
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && value.trim().length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSend();
      }
    }
  };

  // Auto-resize textarea
  React.useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  return (
    <div className="border-t border-subtle bg-background/70 px-4 py-3" data-testid="agent-tasks__conversation-input">
      <div
        className="rounded-xl border border-subtle bg-background/95 px-3 py-3 shadow-ambient"
        data-testid="agent-tasks__conversation-input-shell"
      >
        <div className="flex items-end gap-3">
          <div
            className="flex-1 rounded-lg border border-subtle bg-surface-high/70 px-3 py-2 focus-within:border-accent/30 focus-within:ring-2 focus-within:ring-accent/20"
            data-testid="agent-tasks__conversation-input-surface"
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder ?? t('input_placeholder')}
              disabled={disabled}
              rows={2}
              className={cn(
                'w-full resize-none bg-transparent text-sm text-primary',
                'placeholder:text-tertiary',
                'border-0 outline-none focus-visible:outline-none',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            />
          </div>
          <Button
            type="button"
            variant="default"
            onClick={onSend}
            disabled={!canSend}
            className="gap-2"
            data-testid="agent-tasks__send-btn"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {t('send')}
          </Button>
        </div>
        {agentRunning ? (
          <div
            className="mt-3 rounded-lg border border-accent/20 bg-surface-low/60 px-3 py-2 text-[11px] text-secondary"
            data-testid="agent-tasks__pending-hint"
          >
            {t('pending_hint_running')}
          </div>
        ) : null}
        {pendingQueue.length > 0 ? (
          <div className="mt-3 rounded-lg border border-subtle bg-surface-low/55 p-2.5" data-testid="agent-tasks__pending-queue">
            <div className="mb-2 text-[11px] font-medium text-primary">
              {t('pending_queue_title', { count: pendingQueue.length })}
            </div>
            <div className="space-y-2">
              {pendingQueue.map((item, index) => (
                <div key={item.id} className="rounded-lg border border-subtle bg-background/85 p-2">
                  <div className="mb-1 text-[11px] text-tertiary">
                    {t('pending_item_label', { index: index + 1 })}
                  </div>
                  <textarea
                    value={item.content}
                    onChange={(e) => onPendingUpdate?.(item.id, e.target.value)}
                    rows={2}
                    className={cn(
                      'w-full resize-none rounded-lg border border-subtle bg-background px-2 py-1 text-xs text-primary',
                      'placeholder:text-tertiary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30',
                    )}
                    data-testid={`agent-tasks__pending-item-input--${item.id}`}
                  />
                  <div className="mt-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onPendingRemove?.(item.id)}
                      className="h-6 px-2 text-[11px]"
                      data-testid={`agent-tasks__pending-item-remove--${item.id}`}
                    >
                      {t('pending_item_remove')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="mt-2 text-[11px] text-tertiary">
          {t('hotkey_compose')}
        </div>
      </div>
    </div>
  );
}
