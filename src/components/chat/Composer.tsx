'use client';

import * as React from 'react';
import { Paperclip, Send, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations('chat');
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
    if (attachments.some((a) => a.upload_status === 'failed')) return t('composer.helper_failed_attachments');
    if (attachments.some((a) => a.upload_status === 'uploading' || a.upload_status === 'processing')) {
      return t('composer.helper_attachments_preparing');
    }
    return '';
  }, [attachments, t]);

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
          <div className="text-xs text-tertiary">{t('composer.editing_message')}</div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={disabled || streaming}>
            {t('composer.cancel')}
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
                      {status === 'uploading'
                        ? t('composer.attachment_status_uploading')
                        : status === 'processing'
                          ? t('composer.attachment_status_processing')
                          : t('composer.attachment_status_failed')}
                    </div>
                  )}
                </div>
                {status === 'failed' && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRetryAttachment(a.id)}>
                    {t('composer.retry')}
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveAttachment(a.id)}>
                  {t('composer.remove')}
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
            aria-label={t('composer.attach_files')}
            title={t('composer.attach_files')}
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
              placeholder={mode === 'edit' ? t('composer.placeholder_edit') : t('composer.placeholder_compose')}
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
              {t('composer.stop')}
            </Button>
          ) : (
            <Button type="button" variant="primary" onClick={onSend} disabled={!canSend} className="gap-2" data-testid="chat__send-btn">
              <Send className="w-4 h-4" />
              {mode === 'edit' ? t('composer.save') : t('composer.send')}
            </Button>
          )}
        </div>

        <div className="mt-3 text-xs text-tertiary">
          {mode === 'edit' ? t('composer.hotkey_edit') : t('composer.hotkey_compose')}
        </div>
      </div>
    </div>
  );
}
