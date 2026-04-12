'use client';

import * as React from 'react';

import type { Agent, Attachment, ChatMessage, ChatSession, Endpoint } from '@/lib/api/types';
import { deriveChatComposerState } from '@/lib/chat/composer-state';
import type { SessionStreamStatus, SessionStreamingAssistant } from '@/lib/chat/stream-state';

import { ChatHeader } from '@/components/chat/ChatHeader';
import { Composer } from '@/components/chat/Composer';
import { Button } from '@/components/ui/button';
import { MessageList } from '@/components/chat/MessageList';
import { ChatEmptyState } from '@/components/chat/chat-main-pane/ChatEmptyState';
import { ChatLoadingState } from '@/components/chat/chat-main-pane/ChatLoadingState';
import { StreamingAppendFooter } from '@/components/chat/chat-main-pane/StreamingAppendFooter';

export interface ChatMainPaneLabels {
  loading: string;
  noActiveThreadTitle: string;
  noActiveThreadDescription: string;
  noActiveThreadHint: string;
  noEndpointHint: string;
  noEndpointRecoveryTitle: string;
  noEndpointRecoveryDescription: string;
  noEndpointRecoveryHint: string;
  newThread: string;
  selectThreadHint: string;
  attachmentsDisabledReason: string;
  assistant: string;
}

export interface ChatMainPaneProps {
  currentSessionId: string | null;
  activeSession: ChatSession | null;
  endpoints: Endpoint[];
  externalAgents?: Agent[];
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
  onSelectExternalAgent?: (agent: Agent) => void;
  onSelectVariant: (groupId: string, nextIndex: number) => void;
  onEditMessage: (message: ChatMessage) => void;
  onEditCommit: (message: ChatMessage, nextContent: string) => void;
  onRegenerate: (message: ChatMessage) => void;
  onComposerChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onPickFiles: () => void;
  onPickFromLibrary: () => void;
  onPickUrl: () => void;
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
    externalAgents = [],
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
    onSelectExternalAgent = () => {},
    onSelectVariant,
    onEditMessage,
    onEditCommit,
    onRegenerate,
    onComposerChange,
    onSend,
    onStop,
    onPickFiles,
    onPickFromLibrary,
    onPickUrl,
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
    streamStatus: activeStreamStatus,
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
  const showEndpointRecovery = currentSessionId !== null && composerState === 'need_endpoint';

  return (
    <section
      className="flex min-w-0 flex-1 flex-col overflow-hidden"
      data-testid="chat__main-pane"
    >
      <ChatHeader
        session={activeSession}
        endpoints={endpoints}
        externalAgents={externalAgents}
        streamStatus={activeStreamStatus}
        onRename={onRenameActiveSession}
        onSelectEndpoint={onSelectActiveEndpoint}
        onSelectExternalAgent={onSelectExternalAgent}
        onCreateThread={onCreateThread}
        canCreateThread={canUseChat}
        createPending={createPending}
        layoutMode={layoutMode}
      />

      {showEndpointRecovery ? (
        <div className="px-4 py-3" data-testid="chat__composer-recovery">
          <div
            className="flex flex-wrap items-start justify-between gap-3"
            data-testid="chat__composer-recovery-inline"
          >
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-foreground">{labels.noEndpointRecoveryTitle}</div>
              <div className="text-sm text-secondary">{labels.noEndpointRecoveryDescription}</div>
              {endpoints.length === 0 ? (
                <div className="text-xs text-tertiary">{labels.noEndpointRecoveryHint}</div>
              ) : null}
            </div>
            {endpoints.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {endpoints.slice(0, 4).map((endpoint) => (
                  <Button
                    key={endpoint.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => onSelectActiveEndpoint(endpoint)}
                    data-testid={`chat__composer-recovery-endpoint--${endpoint.id}`}
                  >
                    {endpoint.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {!currentSessionId ? (
          <ChatEmptyState
            canUseChat={canUseChat}
            createPending={createPending}
            labels={labels}
            onCreateThread={onCreateThread}
          />
        ) : messagesLoading ? (
          <ChatLoadingState loading={labels.loading} />
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
                <StreamingAppendFooter
                  assistant={labels.assistant}
                  content={activeStreamingAssistant?.content || '...'}
                />
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
        onPickUrl={onPickUrl}
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
