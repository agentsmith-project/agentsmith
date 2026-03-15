'use client';
import * as React from 'react';
import type { TaskMessage, TaskTraceEvent } from '@/lib/types/task';
import type { NotebookTraceFailureKind } from '@/lib/build-failure-explainability';
import { MessageItem } from './MessageItem';
import { EmptyState } from '@/components/ui/loading';

export interface MessageListProps {
  messages: TaskMessage[];
  streamingMessageId?: string | null;
  streamingContent?: string | null;
  showExecutionDetails?: boolean;
  focusTraceMessageId?: string | null;
  focusTraceName?: string | null;
  focusTraceToken?: number;
  traceEventsByMessageId?: Record<string, TaskTraceEvent[]>;
  traceHasMoreByMessageId?: Record<string, boolean>;
  traceLoadingByMessageId?: Record<string, boolean>;
  traceLoadMoreLoadingByMessageId?: Record<string, boolean>;
  traceErrorByMessageId?: Record<string, { kind: NotebookTraceFailureKind; message: string }>;
  disabled?: boolean;
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
}

export function MessageList({
  messages,
  streamingMessageId,
  streamingContent,
  showExecutionDetails = false,
  focusTraceMessageId = null,
  focusTraceName = null,
  focusTraceToken = 0,
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadingByMessageId,
  traceLoadMoreLoadingByMessageId,
  traceErrorByMessageId,
  disabled = false,
  onTraceExpand,
  onTraceLoadMore,
}: MessageListProps) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive (only if user is near bottom)
  const [isNearBottom, setIsNearBottom] = React.useState(true);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      setIsNearBottom(distanceFromBottom < 100);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  React.useEffect(() => {
    if (isNearBottom && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent, isNearBottom]);

  if (messages.length === 0 && !streamingContent) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState
          title="Start a conversation"
          description="Send a message to begin"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-4 py-3 space-y-3">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          showExecutionDetails={showExecutionDetails}
          focusTraceName={focusTraceMessageId === message.id ? focusTraceName : null}
          focusTraceToken={focusTraceMessageId === message.id ? focusTraceToken : 0}
          streamingContent={
            streamingMessageId === message.id ? streamingContent : null
          }
          traceEvents={traceEventsByMessageId?.[message.id] ?? []}
          traceHasMore={traceHasMoreByMessageId?.[message.id] ?? false}
          traceDetailsLoading={traceLoadingByMessageId?.[message.id] ?? false}
          traceLoadMoreLoading={traceLoadMoreLoadingByMessageId?.[message.id] ?? false}
          traceError={traceErrorByMessageId?.[message.id]}
          disabled={disabled}
          onTraceExpand={onTraceExpand}
          onTraceLoadMore={onTraceLoadMore}
        />
      ))}
      {streamingMessageId && !messages.find((m) => m.id === streamingMessageId) && (
        <MessageItem
          message={{
            id: streamingMessageId,
            task_id: '',
            role: 'agent',
            content: '',
            created_at: new Date().toISOString(),
          }}
          showExecutionDetails={showExecutionDetails}
          focusTraceName={focusTraceMessageId === streamingMessageId ? focusTraceName : null}
          focusTraceToken={focusTraceMessageId === streamingMessageId ? focusTraceToken : 0}
          streamingContent={streamingContent}
          traceEvents={traceEventsByMessageId?.[streamingMessageId] ?? []}
          traceHasMore={traceHasMoreByMessageId?.[streamingMessageId] ?? false}
          traceDetailsLoading={traceLoadingByMessageId?.[streamingMessageId] ?? false}
          traceLoadMoreLoading={traceLoadMoreLoadingByMessageId?.[streamingMessageId] ?? false}
          traceError={traceErrorByMessageId?.[streamingMessageId]}
          disabled={disabled}
          onTraceExpand={onTraceExpand}
          onTraceLoadMore={onTraceLoadMore}
        />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
