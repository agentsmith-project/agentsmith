'use client';
import * as React from 'react';
import { Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConversationInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  disabled?: boolean;
  sending?: boolean;
  placeholder?: string;
}

export function ConversationInput({
  value,
  onChange,
  onSend,
  disabled = false,
  sending = false,
  placeholder = 'Type your message...',
}: ConversationInputProps) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && !sending && value.trim().length > 0;

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
    <div className="border-t border-subtle bg-background px-4 py-4" data-testid="studio__conversation-input">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled || sending}
            rows={2}
            className={cn(
              'w-full resize-none rounded-md border border-subtle bg-surface-high px-3 py-2 text-sm text-primary',
              'placeholder:text-tertiary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
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
          data-testid="studio__send-btn"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Send
        </Button>
      </div>
      <div className="mt-2 text-xs text-tertiary">
        Enter to send · Shift+Enter for newline
      </div>
    </div>
  );
}
