'use client';
import * as React from 'react';
import type { TaskMessage } from '@/lib/types/task';
import { MessageItem } from './MessageItem';
import { EmptyState } from '@/components/ui/loading';

export interface MessageListProps {
  messages: TaskMessage[];
  streamingMessageId?: string | null;
  streamingContent?: string | null;
  disabled?: boolean;
}

export function MessageList({
  messages,
  streamingMessageId,
  streamingContent,
  disabled = false,
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
    <div ref={containerRef} className="h-full overflow-y-auto px-4 py-4 space-y-4">
      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          streamingContent={
            streamingMessageId === message.id ? streamingContent : null
          }
          disabled={disabled}
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
          streamingContent={streamingContent}
          disabled={disabled}
        />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
