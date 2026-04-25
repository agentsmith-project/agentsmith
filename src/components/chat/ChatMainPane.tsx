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
  streamErrorRecoveryCapacityTitle: string;
  streamErrorRecoveryCapacityDescription: string;
  streamErrorRecoveryUpstreamTitle: string;
  streamErrorRecoveryUpstreamDescription: string;
  streamErrorRecoveryMessageLabel: string;
  streamErrorRecoverySameThreadHint: string;
  streamErrorRecoveryEndpointHint: string;
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
  activeStreamErrorCode: string | null;
  activeStreamErrorMessage: string | null;
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

function isRetryableProviderCapacityError(errorCode: string | null, errorMessage: string | null) {
  const normalizedCode = errorCode?.trim().toUpperCase() ?? '';
  const normalizedMessage = errorMessage?.trim().toLowerCase() ?? '';

  if (normalizedCode === 'UPSTREAM_RATE_LIMIT' || normalizedCode === 'RATE_LIMIT_EXCEEDED') {
    return true;
  }

  return (
    normalizedMessage.includes('capacity')
    || normalizedMessage.includes('rate limit')
    || normalizedMessage.includes('rate limited')
    || normalizedMessage.includes('retry shortly')
    || normalizedMessage.includes('retry later')
  );
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
    activeStreamErrorCode,
    activeStreamErrorMessage,
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
    activeStreamingAssistant
    && activeStreamingAssistant.mode === 'append'
    && (
      !activeStreamingAssistant.messageId
      || !messages.some((message) => message.id === activeStreamingAssistant.messageId)
    ),
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
  const composerStreaming =
    disabled
    || activeStreamStatus === 'connecting'
    || activeStreamStatus === 'recovering'
    || activeStreamStatus === 'streaming'
    || activeStreamStatus === 'terminating';
  const composerDisabled = composerState !== 'ready';
  const composerDisabledReason =
    composerState === 'no_thread'
      ? labels.noActiveThreadHint
      : composerState === 'need_endpoint'
        ? labels.noEndpointHint
        : (!canAttachFiles ? labels.attachmentsDisabledReason : '');
  const showEndpointRecovery = currentSessionId !== null && composerState === 'need_endpoint';
  const normalizedStreamErrorMessage = activeStreamErrorMessage?.trim() ?? '';
  const showStreamErrorRecovery =
    currentSessionId !== null
    && normalizedStreamErrorMessage.length > 0;
  const canChangeExecutionTarget = !disabled;
  const streamErrorLooksRetryable = isRetryableProviderCapacityError(
    activeStreamErrorCode,
    normalizedStreamErrorMessage,
  );
  const recoveryTitle = streamErrorLooksRetryable
    ? labels.streamErrorRecoveryCapacityTitle
    : labels.streamErrorRecoveryUpstreamTitle;
  const recoveryDescription = streamErrorLooksRetryable
    ? labels.streamErrorRecoveryCapacityDescription
    : labels.streamErrorRecoveryUpstreamDescription;
  const selectableRecoveryEndpoints = endpoints.filter((endpoint) => endpoint.status !== 'disabled');
  const recoveryEndpoints = showStreamErrorRecovery
    ? selectableRecoveryEndpoints.filter((endpoint) => endpoint.id !== activeSession?.endpoint_id).slice(0, 4)
    : selectableRecoveryEndpoints.slice(0, 4);
  const showComposerRecovery = showEndpointRecovery || showStreamErrorRecovery;

  return (
    <section
      className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background/40"
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

      {showComposerRecovery ? (
        <div className="border-t border-subtle px-4 py-3" data-testid="chat__composer-recovery">
          <div
            className="mx-auto w-full"
            data-testid="chat__composer-recovery-inline"
          >
            <div
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-subtle bg-background/95 px-4 py-3 shadow-ambient"
              data-testid="chat__composer-recovery-shell"
            >
              {showStreamErrorRecovery ? (
                <>
                  <div className="min-w-0 flex-1 space-y-3" data-testid="chat__stream-error-recovery">
                    <div className="space-y-1">
                      <div className="text-sm font-medium text-foreground">{recoveryTitle}</div>
                      <div className="text-sm text-secondary">{recoveryDescription}</div>
                    </div>
                    <div className="rounded-lg border border-subtle/80 bg-surface/90 px-3 py-2">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-tertiary">
                        {labels.streamErrorRecoveryMessageLabel}
                      </div>
                      <div className="mt-1 text-sm text-secondary" data-testid="chat__stream-error-message">
                        {normalizedStreamErrorMessage}
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-tertiary">
                      <div>{labels.streamErrorRecoverySameThreadHint}</div>
                      {canChangeExecutionTarget && recoveryEndpoints.length > 0 ? (
                        <div>{labels.streamErrorRecoveryEndpointHint}</div>
                      ) : null}
                    </div>
                  </div>
                  {canChangeExecutionTarget && recoveryEndpoints.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {recoveryEndpoints.map((endpoint) => (
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
                </>
              ) : (
                <>
                    <div className="min-w-0 space-y-1">
                      <div className="text-sm font-medium text-foreground">{labels.noEndpointRecoveryTitle}</div>
                      <div className="text-sm text-secondary">{labels.noEndpointRecoveryDescription}</div>
                    {selectableRecoveryEndpoints.length === 0 ? (
                      <div className="text-xs text-tertiary">{labels.noEndpointRecoveryHint}</div>
                    ) : null}
                  </div>
                  {recoveryEndpoints.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {recoveryEndpoints.map((endpoint) => (
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
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {!currentSessionId ? (
          <ChatEmptyState
            labels={labels}
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
        disabled={composerDisabled || composerStreaming || !canUseChat}
        streaming={composerStreaming}
        attachmentEnabled={Boolean(currentSessionId && canAttachFiles && composerState !== 'need_endpoint')}
        attachmentDisabledReason={composerDisabledReason}
        layoutMode={layoutMode}
      />
    </section>
  );
}
