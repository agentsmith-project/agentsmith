'use client';
import * as React from 'react';
import { useTranslations } from 'next-intl';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';

export interface ConversationPanelProps {
  messages: TaskMessage[];
  streamingMessageId?: string | null;
  streamingContent?: string | null;
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  traceEventsByMessageId?: Record<string, TaskTraceEvent[]>;
  traceHasMoreByMessageId?: Record<string, boolean>;
  traceLoadingByMessageId?: Record<string, boolean>;
  traceLoadMoreLoadingByMessageId?: Record<string, boolean>;
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
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadingByMessageId,
  traceLoadMoreLoadingByMessageId,
  onTraceExpand,
  onTraceLoadMore,
  onSendMessage,
  disabled = false,
  sending = false,
}: ConversationPanelProps) {
  const t = useTranslations('notebook.conversation');
  const [inputValue, setInputValue] = React.useState('');

  const handleSend = () => {
    if (inputValue.trim().length === 0) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {connectionStatus && connectionStatus !== 'connected' && (
        <div className="border-b border-subtle px-4 py-2 text-xs text-tertiary" data-testid="notebook__sse-status">
          {connectionStatus === 'connecting' && t('realtime_connecting')}
          {connectionStatus === 'reconnecting' && t('realtime_reconnecting')}
          {connectionStatus === 'disconnected' && t('realtime_disconnected')}
          {connectionStatus === 'error' && t('realtime_error')}
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
