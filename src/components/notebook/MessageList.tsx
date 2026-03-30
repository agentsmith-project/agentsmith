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
  focusTraceMessageId?: string | null;
  focusTraceName?: string | null;
  focusTraceToken?: number;
  traceEventsByMessageId?: Record<string, TaskTraceEvent[]>;
  traceHasMoreByMessageId?: Record<string, boolean>;
  traceLoadingByMessageId?: Record<string, boolean>;
  traceLoadMoreLoadingByMessageId?: Record<string, boolean>;
  traceErrorByMessageId?: Record<string, { kind: NotebookTraceFailureKind; message: string }>;
  disabled?: boolean;
  activeAgentMessageId?: string | null;
  onTraceExpand?: (messageId: string) => void;
  onTraceLoadMore?: (messageId: string) => void;
}

export function MessageList({
  messages,
  streamingMessageId,
  streamingContent,
  focusTraceMessageId = null,
  focusTraceName = null,
  focusTraceToken = 0,
  traceEventsByMessageId,
  traceHasMoreByMessageId,
  traceLoadingByMessageId,
  traceLoadMoreLoadingByMessageId,
  traceErrorByMessageId,
  disabled = false,
  activeAgentMessageId = null,
  onTraceExpand,
  onTraceLoadMore,
}: MessageListProps) {
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = React.useRef(true);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const traceEventCount = React.useMemo(
    () =>
      Object.values(traceEventsByMessageId ?? {}).reduce(
        (count, events) => count + events.length,
        0,
      ),
    [traceEventsByMessageId],
  );

  const updateStickyState = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const nearBottom = distanceFromBottom < 96;
    shouldStickToBottomRef.current = nearBottom;
  }, []);

  const scrollToBottom = React.useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = containerRef.current;
    if (!container) return;
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({ top: container.scrollHeight, behavior });
    } else {
      container.scrollTop = container.scrollHeight;
    }
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    updateStickyState();
    const handleScroll = () => updateStickyState();

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [updateStickyState]);

  React.useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) return;
    scrollToBottom(streamingContent != null ? 'auto' : 'smooth');
  }, [messages, streamingMessageId, streamingContent, traceEventCount, scrollToBottom]);

  React.useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (!shouldStickToBottomRef.current) return;
      requestAnimationFrame(() => scrollToBottom('auto'));
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [scrollToBottom]);

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
    <div ref={containerRef} className="h-full overflow-y-auto px-3 py-3 sm:px-4 lg:px-5">
      <div ref={contentRef} className="space-y-3">
        {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
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
          forceRunning={streamingMessageId === activeAgentMessageId}
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
          focusTraceName={focusTraceMessageId === streamingMessageId ? focusTraceName : null}
          focusTraceToken={focusTraceMessageId === streamingMessageId ? focusTraceToken : 0}
          streamingContent={streamingContent}
          traceEvents={traceEventsByMessageId?.[streamingMessageId] ?? []}
          traceHasMore={traceHasMoreByMessageId?.[streamingMessageId] ?? false}
          traceDetailsLoading={traceLoadingByMessageId?.[streamingMessageId] ?? false}
          traceLoadMoreLoading={traceLoadMoreLoadingByMessageId?.[streamingMessageId] ?? false}
          traceError={traceErrorByMessageId?.[streamingMessageId]}
          disabled={disabled}
          forceRunning={streamingMessageId === activeAgentMessageId}
          onTraceExpand={onTraceExpand}
          onTraceLoadMore={onTraceLoadMore}
        />
      )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
