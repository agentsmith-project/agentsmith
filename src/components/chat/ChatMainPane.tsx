'use client';

import * as React from 'react';
import { MessageSquare, Plus } from 'lucide-react';

import type { Attachment, ChatMessage, ChatSession, Endpoint } from '@/lib/api/types';
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
  newThread: string;
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
  composerValue: string;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  labels: ChatMainPaneLabels;
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
  onFilePicked: (e: React.ChangeEvent<HTMLInputElement>) => void;
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
    composerValue,
    fileInputRef,
    labels,
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
    onFilePicked,
    onRemoveAttachment,
    onRetryAttachment,
    onCancelEdit,
  } = props;

  return (
    <section className="flex-1 flex min-w-0 flex-col bg-background overflow-hidden" data-testid="chat__main-pane">
      <ChatHeader
        session={activeSession}
        endpoints={endpoints}
        streamStatus={activeStreamStatus}
        onRename={onRenameActiveSession}
        onSelectEndpoint={onSelectActiveEndpoint}
      />

      <div className="flex-1 min-h-0">
        {!currentSessionId ? (
          <div className="h-full flex items-center justify-center px-4">
            <div className="mx-auto w-full max-w-[560px] text-center px-6">
              <MessageSquare className="w-12 h-12 mx-auto mb-4 text-tertiary" />
              <div className="text-foreground font-medium mb-1">{labels.noActiveThreadTitle}</div>
              <div className="text-tertiary text-sm">{labels.noActiveThreadDescription}</div>
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
            activeVariantIndexByGroup={activeVariantIndexByGroup}
            editingMessageId={editingMessageId}
            onSelectVariant={onSelectVariant}
            onEdit={onEditMessage}
            onEditCommit={onEditCommit}
            onEditCancel={onCancelEdit}
            onRegenerate={onRegenerate}
            disabled={disabled}
            footer={
              activeStreamingAssistant && activeStreamingAssistant.mode === 'append' ? (
                <div className="px-4 py-2">
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-md px-4 py-3 border bg-surface-high text-primary border-subtle">
                      <div className="text-xs text-tertiary mb-1">{labels.assistant}</div>
                      <div className="space-y-2">
                        <Markdown content={activeStreamingAssistant.content || '...'} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : null
            }
            streamingAssistant={activeStreamingAssistant}
            followOutput={activeStreamingAssistant?.mode !== 'replace'}
            suppressAutoScroll={suppressAutoScroll}
          />
        )}
      </div>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onFilePicked} />

      {currentSessionId && (
        <Composer
          value={composerValue}
          onChange={onComposerChange}
          onSend={onSend}
          onStop={onStop}
          mode="compose"
          autoFocus={!editingMessageId && activeStreamStatus === 'idle'}
          onPickFiles={onPickFiles}
          attachments={attachments}
          onRemoveAttachment={onRemoveAttachment}
          onRetryAttachment={onRetryAttachment}
          disabled={
            !currentSessionId ||
            !canUseChat ||
            createMessagePending ||
            editMessagePending ||
            initAttachmentPending ||
            disabled ||
            !!editingMessageId
          }
          streaming={disabled}
        />
      )}
    </section>
  );
}
