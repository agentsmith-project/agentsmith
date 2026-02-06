/**
 * Tests for ConversationPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from '../ConversationPanel';
import type { RecipeMessage } from '@/lib/types/recipe';

vi.mock('../ConversationInput', () => ({
  ConversationInput: ({ value, onChange, onSend, disabled, sending }: any) => (
    <div data-testid="conversation-input">
      <textarea
        data-testid="input-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || sending}
      />
      <button
        data-testid="send-button"
        onClick={onSend}
        disabled={disabled || sending || !value.trim()}
      >
        Send
      </button>
    </div>
  ),
}));

vi.mock('../MessageList', () => ({
  MessageList: ({ messages, streamingMessageId, streamingContent, disabled }: any) => (
    <div data-testid="message-list">
      {messages.map((msg: RecipeMessage) => (
        <div key={msg.id} data-testid={`message-${msg.id}`}>
          {msg.content}
        </div>
      ))}
      {streamingMessageId && (
        <div data-testid="streaming-message">{streamingContent}</div>
      )}
    </div>
  ),
}));

describe('ConversationPanel', () => {
  const mockMessages: RecipeMessage[] = [
    {
      id: 'msg-1',
      recipe_id: 'recipe-1',
      role: 'user',
      content: 'Hello, how are you?',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'msg-2',
      recipe_id: 'recipe-1',
      role: 'agent',
      content: 'I am doing well, thank you!',
      created_at: '2024-01-01T00:01:00Z',
    },
  ];

  const mockOnSendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <ConversationPanel
        messages={mockMessages}
        onSendMessage={mockOnSendMessage}
        {...props}
      />
    );
  };

  describe('Basic Rendering', () => {
    it('renders message list', () => {
      renderComponent();

      expect(screen.getByTestId('message-list')).toBeInTheDocument();
    });

    it('renders conversation input', () => {
      renderComponent();

      expect(screen.getByTestId('conversation-input')).toBeInTheDocument();
    });

    it('passes messages to MessageList', () => {
      renderComponent();

      expect(screen.getByTestId('message-msg-1')).toHaveTextContent('Hello, how are you?');
      expect(screen.getByTestId('message-msg-2')).toHaveTextContent('I am doing well, thank you!');
    });

    it('passes streaming state to MessageList', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          streamingMessageId="msg-3"
          streamingContent="Streaming..."
          onSendMessage={mockOnSendMessage}
        />
      );

      expect(screen.getByTestId('streaming-message')).toHaveTextContent('Streaming...');
    });
  });

  describe('Input Handling', () => {
    it('manages input state internally', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByTestId('input-textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'New message');

      expect(textarea).toHaveValue('New message');
    });

    it('sends message when send button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByTestId('input-textarea');
      await user.type(textarea, 'Test message');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(mockOnSendMessage).toHaveBeenCalledWith('Test message');
    });

    it('clears input after sending message', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByTestId('input-textarea') as HTMLTextAreaElement;
      await user.type(textarea, 'Test message');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(textarea).toHaveValue('');
    });

    it('trims whitespace before sending', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByTestId('input-textarea');
      await user.type(textarea, '  Test message  ');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(mockOnSendMessage).toHaveBeenCalledWith('Test message');
    });

    it('does not send empty messages', async () => {
      const user = userEvent.setup();
      renderComponent();

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(mockOnSendMessage).not.toHaveBeenCalled();
    });

    it('does not send whitespace-only messages', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByTestId('input-textarea');
      await user.type(textarea, '   ');

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(mockOnSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('Disabled State', () => {
    it('passes disabled state to MessageList', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          disabled={true}
        />
      );

      expect(screen.getByTestId('message-list')).toBeInTheDocument();
    });

    it('passes disabled state to ConversationInput', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          disabled={true}
        />
      );

      const textarea = screen.getByTestId('input-textarea');
      expect(textarea).toBeDisabled();
    });

    it('disables input when disabled', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          disabled={true}
        />
      );

      const sendButton = screen.getByTestId('send-button');
      expect(sendButton).toBeDisabled();
    });
  });

  describe('Sending State', () => {
    it('passes sending state to ConversationInput', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          sending={true}
        />
      );

      const textarea = screen.getByTestId('input-textarea');
      expect(textarea).toBeDisabled();
    });

    it('disables send button while sending', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          sending={true}
        />
      );

      const sendButton = screen.getByTestId('send-button');
      expect(sendButton).toBeDisabled();
    });
  });

  describe('Layout', () => {
    it('has correct layout structure', () => {
      const { container } = renderComponent();

      const panel = container.firstChild as HTMLElement;
      expect(panel).toHaveClass('h-full', 'flex', 'flex-col', 'bg-background');
    });
  });

  describe('Empty Messages', () => {
    it('renders with empty messages array', () => {
      render(
        <ConversationPanel
          messages={[]}
          onSendMessage={mockOnSendMessage}
        />
      );

      expect(screen.getByTestId('message-list')).toBeInTheDocument();
    });
  });

  describe('Streaming State', () => {
    it('passes streaming message ID to MessageList', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          streamingMessageId="msg-streaming"
          streamingContent="Streaming content..."
          onSendMessage={mockOnSendMessage}
        />
      );

      expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
    });

    it('passes streaming content to MessageList', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          streamingMessageId="msg-streaming"
          streamingContent="Partial stream..."
          onSendMessage={mockOnSendMessage}
        />
      );

      expect(screen.getByTestId('streaming-message')).toHaveTextContent('Partial stream...');
    });

    it('handles null streaming content', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          streamingMessageId="msg-streaming"
          streamingContent={null}
          onSendMessage={mockOnSendMessage}
        />
      );

      expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
    });
  });
});
