'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import type { NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import { classifyNotebookRealtimeFailure } from '@/lib/build-failure-explainability';

export interface ConversationPanelProps {
  messages: TaskMessage[];
  streamingMessageId?: string | null;
  streamingContent?: string | null;
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  connectionErrorCode?: string | null;
  connectionErrorMessage?: string | null;
  traceEventsByMessageId?: Record<string, TaskTraceEvent[]>;
  traceHasMoreByMessageId?: Record<string, boolean>;
  traceLoadingByMessageId?: Record<string, boolean>;
  traceLoadMoreLoadingByMessageId?: Record<string, boolean>;
  traceErrorByMessageId?: Record<string, { kind: NotebookTraceFailureKind; message: string }>;
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
  onSendMessage: (content: string) => void;
  disabled?: boolean;
  sending?: boolean;
}

export function ConversationPanel({
  messages,
  streamingMessageId,
  streamingContent,
  connectionStatus,
  connectionErrorCode,
  connectionErrorMessage,
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadingByMessageId,
  traceLoadMoreLoadingByMessageId,
  traceErrorByMessageId,
  onTraceExpand,
  onTraceLoadMore,
  onSendMessage,
  disabled = false,
  sending = false,
}: ConversationPanelProps) {
  const t = useTranslations('notebook.conversation');
  const [inputValue, setInputValue] = React.useState('');
  const connectionFailureKind = connectionStatus
    ? classifyNotebookRealtimeFailure(connectionStatus, connectionErrorCode)
    : null;

  const connectionTitle = connectionFailureKind === 'connecting'
    ? t('realtime_status_connecting_title')
    : connectionFailureKind === 'reconnecting'
      ? t('realtime_status_reconnecting_title')
      : connectionFailureKind === 'disconnected'
        ? t('realtime_status_disconnected_title')
        : connectionFailureKind === 'ticket_unavailable'
          ? t('realtime_status_ticket_unavailable_title')
          : connectionFailureKind === 'ticket_unauthorized'
            ? t('realtime_status_ticket_unauthorized_title')
            : connectionFailureKind === 'ticket_rate_limited'
              ? t('realtime_status_ticket_rate_limited_title')
              : connectionFailureKind === 'ticket_network'
                ? t('realtime_status_ticket_network_title')
                : connectionFailureKind === 'reconcile_failed'
                  ? t('realtime_status_reconcile_failed_title')
                  : connectionFailureKind === 'error'
                    ? t('realtime_status_error_title')
                    : null;

  const connectionDescription = connectionFailureKind === 'connecting'
    ? t('realtime_status_connecting_description')
    : connectionFailureKind === 'reconnecting'
      ? t('realtime_status_reconnecting_description')
      : connectionFailureKind === 'disconnected'
        ? t('realtime_status_disconnected_description')
        : connectionFailureKind === 'ticket_unavailable'
          ? t('realtime_status_ticket_unavailable_description')
          : connectionFailureKind === 'ticket_unauthorized'
            ? t('realtime_status_ticket_unauthorized_description')
            : connectionFailureKind === 'ticket_rate_limited'
              ? t('realtime_status_ticket_rate_limited_description')
              : connectionFailureKind === 'ticket_network'
                ? t('realtime_status_ticket_network_description')
                : connectionFailureKind === 'reconcile_failed'
                  ? connectionErrorMessage || t('realtime_status_reconcile_failed_description')
                  : connectionFailureKind === 'error'
                    ? connectionErrorMessage || t('realtime_status_error_description')
                    : null;

  const handleSend = () => {
    if (inputValue.trim().length === 0) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {connectionStatus && connectionStatus !== 'connected' && (
        <div className="border-b border-subtle px-4 py-2" data-testid="notebook__sse-status">
          <div className="text-xs font-medium text-primary">{connectionTitle}</div>
          <div className="mt-0.5 text-xs text-tertiary">{connectionDescription}</div>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <MessageList
          messages={messages}
          streamingMessageId={streamingMessageId}
          streamingContent={streamingContent}
          traceEventsByMessageId={traceEventsByMessageId}
          traceHasMoreByMessageId={traceHasMoreByMessageId}
          traceLoadingByMessageId={traceLoadingByMessageId}
          traceLoadMoreLoadingByMessageId={traceLoadMoreLoadingByMessageId}
          traceErrorByMessageId={traceErrorByMessageId}
          disabled={disabled}
          onTraceExpand={onTraceExpand}
          onTraceLoadMore={onTraceLoadMore}
        />
      </div>
      <ConversationInput
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        disabled={disabled}
        sending={sending}
      />
    </div>
  );
}
