'use client';
import * as React from 'react';
import { MessageList } from './MessageList';
import { ConversationInput } from './ConversationInput';
import type { TaskMessage } from '@/lib/types/task';

export interface ConversationPanelProps {
  messages: TaskMessage[];
  streamingMessageId?: string | null;
  streamingContent?: string | null;
  onSendMessage: (content: string) => void;
  disabled?: boolean;
  sending?: boolean;
}

export function ConversationPanel({
  messages,
  streamingMessageId,
  streamingContent,
  onSendMessage,
  disabled = false,
  sending = false,
}: ConversationPanelProps) {
  const [inputValue, setInputValue] = React.useState('');

  const handleSend = () => {
    if (inputValue.trim().length === 0) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="flex-1 min-h-0">
        <MessageList
          messages={messages}
          streamingMessageId={streamingMessageId}
          streamingContent={streamingContent}
          disabled={disabled}
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
