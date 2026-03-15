'use client';

import * as React from 'react';
import { FolderOpen, Link2, Paperclip, Send, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { Attachment } from '@/lib/api/types';
import { getChatContentWidthClass, type ChatLayoutMode } from '@/lib/chat/layout';
import { getChatAttachmentInputRefLabel } from '@/lib/utils/input-ref-display';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { InputRefBadge } from '@/components/inputs/InputRefBadge';

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
  onPickFromLibrary,
  onPickUrl,
  onAttachFiles,
  attachments,
  onRemoveAttachment,
  onRetryAttachment,
  disabled,
  streaming,
  attachmentEnabled = true,
  attachmentDisabledReason = '',
  autoFocus,
  layoutMode = 'standard',
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  mode?: 'compose' | 'edit';
  onCancelEdit?: () => void;
  onPickFiles: () => void;
  onPickFromLibrary: () => void;
  onPickUrl: () => void;
  onAttachFiles?: (files: File[]) => Promise<void> | void;
  attachments: Attachment[];
  onRemoveAttachment: (attachmentId: string) => void;
  onRetryAttachment: (attachmentId: string) => void;
  disabled: boolean;
  streaming: boolean;
  attachmentEnabled?: boolean;
  attachmentDisabledReason?: string;
  autoFocus?: boolean;
  layoutMode?: ChatLayoutMode;
}) {
  const t = useTranslations('chat');
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [dragActive, setDragActive] = React.useState(false);
  const blocked = hasBlockingAttachment(attachments);

  React.useEffect(() => {
    if (!autoFocus) return;
    if (disabled || streaming) return;
    textareaRef.current?.focus({ preventScroll: true });
  }, [autoFocus, disabled, streaming]);

  const canSend = !disabled && !streaming && !blocked && value.trim().length > 0;
  const canStop = streaming;
  const contentWidthClass = getChatContentWidthClass(layoutMode);

  const hotkeyText = mode === 'edit' ? t('composer.hotkey_edit') : t('composer.hotkey_compose');
  const helperText = React.useMemo(() => {
    if (attachments.some((a) => a.upload_status === 'failed')) return t('composer.helper_failed_attachments');
    if (attachments.some((a) => a.upload_status === 'uploading' || a.upload_status === 'processing')) {
      return t('composer.helper_attachments_preparing');
    }
    return '';
  }, [attachments, t]);
  const footerHint = helperText || (attachmentEnabled ? t('composer.helper_attach_hint') : attachmentDisabledReason || '');

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (canSend) {
        onSend();
        textareaRef.current?.focus({ preventScroll: true });
      }
    }
  };

  const canAcceptAttachments = attachmentEnabled && !disabled && !streaming;

  const onDropFiles = async (files: File[]) => {
    if (!canAcceptAttachments || !onAttachFiles || files.length === 0) return;
    await onAttachFiles(files);
  };

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAcceptAttachments) return;
    const hasFiles = Array.from(e.dataTransfer.types).includes('Files');
    if (!hasFiles) return;
    e.preventDefault();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAcceptAttachments) return;
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragActive(false);
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!canAcceptAttachments) return;
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    await onDropFiles(files);
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!canAcceptAttachments) return;
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    await onDropFiles(files);
  };

  return (
    <div
      className="border-t border-white/6 bg-transparent"
      data-testid="chat__composer"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={cn('mx-auto w-full px-4 py-2.5', contentWidthClass)}>
        <div
          className={cn(
            'rounded-[18px] bg-surface/55 px-3 py-2.5 sm:px-4 sm:py-3 transition-colors',
            dragActive && 'bg-surface-high/80 ring-1 ring-accent/40',
          )}
        >
          {mode === 'edit' ? (
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs text-tertiary">{t('composer.editing_message')}</div>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={disabled || streaming}>
                {t('composer.cancel')}
              </Button>
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-2">
              {attachments.map((a) => {
                const status = a.upload_status;
                const hasImagePreview =
                  typeof a.preview_url === 'string' &&
                  a.preview_url.length > 0 &&
                  (a.file_type.startsWith('image/') || a.preview_url.startsWith('data:image/'));
                const inputRefLabel = getChatAttachmentInputRefLabel(a);
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-md border border-subtle bg-surface-high',
                    )}
                  >
                    {hasImagePreview ? (
                      <img
                        src={a.preview_url}
                        alt={a.file_name}
                        className="h-8 w-8 rounded-sm border border-subtle object-cover"
                      />
                    ) : null}
                    <div className="min-w-0">
                      <div className="text-xs text-primary truncate max-w-[260px]">{a.file_name}</div>
                      {status !== 'ready' ? (
                        <div className={cn('text-[11px]', status === 'failed' ? 'text-error' : 'text-tertiary')}>
                          {status === 'uploading'
                            ? t('composer.attachment_status_uploading')
                            : status === 'processing'
                              ? t('composer.attachment_status_processing')
                              : t('composer.attachment_status_failed')}
                        </div>
                      ) : inputRefLabel ? (
                        <div className="mt-0.5">
                          <InputRefBadge label={inputRefLabel} />
                        </div>
                      ) : null}
                    </div>
                    {status === 'failed' ? (
                      <Button type="button" variant="ghost" size="sm" onClick={() => onRetryAttachment(a.id)}>
                        {t('composer.retry')}
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveAttachment(a.id)}>
                      {t('composer.remove')}
                    </Button>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex items-end gap-2">
            {attachmentEnabled ? (
              <div className="flex h-10 items-center gap-1 rounded-xl bg-surface-high/70 px-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg"
                  data-testid="chat__attach-local-btn"
                  onClick={onPickFiles}
                  disabled={disabled || streaming}
                  aria-label={t('composer.attach_files')}
                  title={t('composer.attach_files')}
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg"
                  data-testid="chat__attach-library-btn"
                  onClick={onPickFromLibrary}
                  disabled={disabled || streaming}
                  aria-label={t('composer.attach_from_library')}
                  title={t('composer.attach_from_library')}
                >
                  <FolderOpen className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 rounded-lg"
                  data-testid="chat__attach-url-btn"
                  onClick={onPickUrl}
                  disabled={disabled || streaming}
                  aria-label={t('composer.add_url')}
                  title={t('composer.add_url')}
                >
                  <Link2 className="w-4 h-4" />
                </Button>
              </div>
            ) : null}

            <div className="flex-1 rounded-xl bg-surface-high/80 px-3 py-2 focus-within:ring-2 focus-within:ring-accent/35">
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                rows={2}
                placeholder={mode === 'edit' ? t('composer.placeholder_edit') : t('composer.placeholder_compose')}
                disabled={disabled || streaming}
                className={cn(
                  'min-h-[44px] w-full resize-none border-0 bg-transparent text-sm text-primary outline-none appearance-none',
                  'placeholder:text-tertiary',
                  'ring-0 focus:ring-0 focus:outline-none focus-visible:outline-none',
                )}
              />
            </div>

            {canStop ? (
              <Button type="button" variant="outline" onClick={onStop} className="h-10 gap-2">
                <Square className="w-4 h-4" />
                {t('composer.stop')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={onSend}
                disabled={!canSend}
                className="h-11 gap-2 px-4"
                data-testid="chat__send-btn"
              >
                <Send className="w-4 h-4" />
                {mode === 'edit' ? t('composer.save') : t('composer.send')}
              </Button>
            )}
          </div>

          <div className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-tertiary">
            <div className="min-w-0 truncate">{footerHint}</div>
            <div className="flex-shrink-0">{hotkeyText}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
