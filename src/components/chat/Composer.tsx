'use client';

import * as React from 'react';
import { Paperclip, Send, Square } from 'lucide-react';

import type { Attachment } from '@/lib/api/types';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';

function hasBlockingAttachment(attachments: Attachment[]) {
  return attachments.some((a) => a.upload_status === 'uploading' || a.upload_status === 'processing' || a.upload_status === 'failed');
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  mode = 'compose',
  onCancelEdit,
  onPickFiles,
  attachments,
  onRemoveAttachment,
  onRetryAttachment,
  disabled,
  streaming,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  mode?: 'compose' | 'edit';
  onCancelEdit?: () => void;
  onPickFiles: () => void;
  attachments: Attachment[];
  onRemoveAttachment: (attachmentId: string) => void;
  onRetryAttachment: (attachmentId: string) => void;
  disabled: boolean;
  streaming: boolean;
  autoFocus?: boolean;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const blocked = hasBlockingAttachment(attachments);

  React.useEffect(() => {
    if (!autoFocus) return;
    if (disabled || streaming) return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus, disabled, streaming]);

  const canSend = !disabled && !streaming && !blocked && value.trim().length > 0;
  const canStop = streaming;

  const helperText = React.useMemo(() => {
    if (attachments.some((a) => a.upload_status === 'failed')) return 'Remove or retry failed attachments to send.';
    if (attachments.some((a) => a.upload_status === 'uploading' || a.upload_status === 'processing')) return 'Attachments are still preparing…';
    return '';
  }, [attachments]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSend();
        textareaRef.current?.focus({ preventScroll: true });
      }
    }
  };

  return (
    <div
      className="border-t border-subtle bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85"
      data-testid="chat__composer"
    >
      {mode === 'edit' && (
        <div className="mx-auto w-full max-w-[980px] px-4 pt-3 flex items-center justify-between">
          <div className="text-xs text-tertiary">Editing message</div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={disabled || streaming}>
            Cancel
          </Button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="mx-auto w-full max-w-[980px] px-4 pt-3 flex flex-wrap gap-2">
          {attachments.map((a) => {
            const status = a.upload_status;
            return (
              <div
                key={a.id}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-sm border border-subtle bg-surface-high',
                )}
              >
                <div className="min-w-0">
                  <div className="text-xs text-primary truncate max-w-[260px]">{a.file_name}</div>
                  {status !== 'ready' && (
                    <div className={cn('text-[11px]', status === 'failed' ? 'text-error' : 'text-tertiary')}>
                      {status === 'uploading' ? 'Uploading…' : status === 'processing' ? 'Processing…' : 'Failed'}
                    </div>
                  )}
                </div>
                {status === 'failed' && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRetryAttachment(a.id)}>
                    Retry
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveAttachment(a.id)}>
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="mx-auto w-full max-w-[980px] px-4 py-4">
        <div className="flex items-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onPickFiles}
            disabled={disabled || streaming}
            aria-label="Attach files"
            title="Attach files"
          >
            <Paperclip className="w-4 h-4" />
          </Button>

          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              placeholder={mode === 'edit' ? 'Edit message…' : 'Message…'}
              className={cn(
                'w-full resize-none rounded-md border border-subtle bg-surface-high px-3 py-2 text-sm text-primary',
                'placeholder:text-tertiary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              )}
            />
            {helperText && <div className="mt-2 text-xs text-tertiary">{helperText}</div>}
          </div>

          {canStop ? (
            <Button type="button" variant="outline" onClick={onStop} className="gap-2">
              <Square className="w-4 h-4" />
              Stop
            </Button>
          ) : (
            <Button type="button" variant="action" onClick={onSend} disabled={!canSend} className="gap-2" data-testid="chat__send-btn">
              <Send className="w-4 h-4" />
              {mode === 'edit' ? 'Save' : 'Send'}
            </Button>
          )}
        </div>

        <div className="mt-3 text-xs text-tertiary">
          {mode === 'edit' ? 'Enter to save · Shift+Enter for newline' : 'Enter to send · Shift+Enter for newline'}
        </div>
      </div>
    </div>
  );
}
