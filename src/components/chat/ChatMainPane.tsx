'use client';

import * as React from 'react';
import { MessageSquare, Plus } from 'lucide-react';

import type { Attachment, ChatMessage, ChatSession, Endpoint } from '@/lib/api/types';
import { deriveChatComposerState } from '@/lib/chat/composer-state';
import type { SessionStreamStatus, SessionStreamingAssistant } from '@/lib/chat/stream-state';

import { ChatHeader } from '@/components/chat/ChatHeader';
import { Composer } from '@/components/chat/Composer';
import { Markdown } from '@/components/chat/Markdown';
import { MessageList } from '@/components/chat/MessageList';
import { Button } from '@/components/ui/button';

export interface ChatMainPaneLabels {
  loading: string;
  noActiveThreadTitle: string;
  noActiveThreadDescription: string;
  noActiveThreadHint: string;
  noEndpointHint: string;
  newThread: string;
  selectThreadHint: string;
  attachmentsDisabledReason: string;
  assistant: string;
}

export interface ChatMainPaneProps {
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  endpoints: Endpoint[];
  messages: ChatMessage[];
  messagesLoading: boolean;
  attachments: Attachment[];
  activeVariantIndexByGroup: Record<string, number>;
  editingMessageId: string | null;
  disabled: boolean;
  activeStreamStatus: SessionStreamStatus;
  activeStreamingAssistant: SessionStreamingAssistant | null;
  suppressAutoScroll: boolean;
  createPending: boolean;
  createMessagePending: boolean;
  editMessagePending: boolean;
  initAttachmentPending: boolean;
  canUseChat: boolean;
  canAttachFiles: boolean;
  composerValue: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  labels: ChatMainPaneLabels;
  layoutMode?: 'standard' | 'ultrawide';
  onCreateThread: () => void;
  onRenameActiveSession: (title: string) => void;
  onSelectActiveEndpoint: (endpoint: Endpoint) => void;
  onSelectVariant: (groupId: string, nextIndex: number) => void;
  onEditMessage: (message: ChatMessage) => void;
  onEditCommit: (message: ChatMessage, nextContent: string) => void;
  onRegenerate: (message: ChatMessage) => void;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPickFiles: () => void;
  onPickFromLibrary: () => void;
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAttachFiles: (files: File[]) => Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void;
  onRetryAttachment: (attachmentId: string) => void;
  onCancelEdit: () => void;
}

export function ChatMainPane(props: ChatMainPaneProps) {
  const {
    currentSessionId,
    activeSession,
    endpoints,
    messages,
    messagesLoading,
    attachments,
    activeVariantIndexByGroup,
    editingMessageId,
    disabled,
    activeStreamStatus,
    activeStreamingAssistant,
    suppressAutoScroll,
    createPending,
    createMessagePending,
    editMessagePending,
    initAttachmentPending,
    canUseChat,
    canAttachFiles,
    composerValue,
    fileInputRef,
    labels,
    layoutMode = 'standard',
    onCreateThread,
    onRenameActiveSession,
    onSelectActiveEndpoint,
    onSelectVariant,
    onEditMessage,
    onEditCommit,
    onRegenerate,
    onComposerChange,
    onSend,
    onStop,
    onPickFiles,
    onPickFromLibrary,
    onFilePicked,
    onAttachFiles,
    onRemoveAttachment,
    onRetryAttachment,
    onCancelEdit,
  } = props;

  const showAppendFooter = Boolean(
    activeStreamingAssistant &&
    activeStreamingAssistant.mode === 'append' &&
    !activeStreamingAssistant.messageId,
  );
  const composerState = deriveChatComposerState({
    currentSessionId,
    activeSession,
    editingMessageId,
    streaming: disabled,
    createMessagePending: createPending || createMessagePending,
    editMessagePending,
    initAttachmentPending,
  });
  const composerDisabled = composerState !== 'ready';
  const composerDisabledReason =
    composerState === 'no_thread'
      ? labels.noActiveThreadHint
      : composerState === 'need_endpoint'
        ? labels.noEndpointHint
        : (!canAttachFiles ? labels.attachmentsDisabledReason : '');

  return (
    <section className="flex-1 flex min-w-0 flex-col bg-background overflow-hidden" data-testid="chat__main-pane">
      <ChatHeader
        session={activeSession}
        endpoints={endpoints}
        streamStatus={activeStreamStatus}
        onRename={onRenameActiveSession}
        onSelectEndpoint={onSelectActiveEndpoint}
        onCreateThread={onCreateThread}
        canCreateThread={canUseChat}
        createPending={createPending}
        layoutMode={layoutMode}
      />

      <div className="flex-1 min-h-0">
        {!currentSessionId ? (
          <div className="h-full flex items-center justify-center px-4">
            <div className="mx-auto w-full max-w-[560px] text-center px-6">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-tertiary" />
              <div className="text-foreground font-medium mb-1">{labels.noActiveThreadTitle}</div>
              <div className="text-tertiary text-sm">{labels.noActiveThreadDescription}</div>
              <div className="mt-3 text-xs text-tertiary">
                {labels.noActiveThreadHint}
                <span className="mx-1">·</span>
                {labels.selectThreadHint}
              </div>
              <Button
                className="mt-4"
                variant="outline"
                onClick={onCreateThread}
                disabled={!canUseChat || createPending}
                data-testid="chat__empty-create-btn"
              >
                <Plus className="w-4 h-4" />
                {labels.newThread}
              </Button>
            </div>
          </div>
        ) : messagesLoading ? (
          <div className="h-full flex items-center justify-center px-4">
            <div className="text-tertiary">{labels.loading}</div>
          </div>
        ) : (
          <MessageList
            messages={messages}
            attachments={attachments}
            activeVariantIndexByGroup={activeVariantIndexByGroup}
            editingMessageId={editingMessageId}
            onSelectVariant={onSelectVariant}
            onEdit={onEditMessage}
            onEditCommit={onEditCommit}
            onEditCancel={onCancelEdit}
            onRegenerate={onRegenerate}
            disabled={disabled}
            footer={
              showAppendFooter ? (
                <div className="px-4 py-2">
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-md px-4 py-3 border bg-surface-high text-primary border-subtle">
                      <div className="text-xs text-tertiary mb-1">{labels.assistant}</div>
                      <div className="space-y-2">
                        <Markdown content={activeStreamingAssistant?.content || '...'} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null
            }
            streamingAssistant={activeStreamingAssistant}
            followOutput={activeStreamingAssistant?.mode !== 'replace'}
            suppressAutoScroll={suppressAutoScroll}
            layoutMode={layoutMode}
          />
        )}
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilePicked} />

      <Composer
        value={composerValue}
        onChange={onComposerChange}
        onSend={onSend}
        onStop={onStop}
        mode="compose"
        autoFocus={!editingMessageId && activeStreamStatus === 'idle'}
        onPickFiles={onPickFiles}
        onPickFromLibrary={onPickFromLibrary}
        onAttachFiles={onAttachFiles}
        attachments={currentSessionId ? attachments : []}
        onRemoveAttachment={onRemoveAttachment}
        onRetryAttachment={onRetryAttachment}
        disabled={composerDisabled || !canUseChat}
        streaming={disabled}
        attachmentEnabled={Boolean(currentSessionId && canAttachFiles && composerState !== 'need_endpoint')}
        attachmentDisabledReason={composerDisabledReason}
        layoutMode={layoutMode}
      />
    </section>
  );
}
