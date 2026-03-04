/**
 * Tests for ConversationPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from '../ConversationPanel';
import type { TaskMessage } from '@/lib/types/task';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const dict: Record<string, string> = {
      'notebook.conversation.realtime_status_connecting_title': 'Connecting realtime session',
      'notebook.conversation.realtime_status_connecting_description': 'Opening the live task stream for this notebook run.',
      'notebook.conversation.realtime_status_reconnecting_title': 'Recovering live task stream',
      'notebook.conversation.realtime_status_reconnecting_description': 'Reconnecting and replaying recent task events.',
      'notebook.conversation.realtime_status_disconnected_title': 'Live task stream disconnected',
      'notebook.conversation.realtime_status_disconnected_description': 'The task stream is offline. Retry or refresh to resume updates.',
      'notebook.conversation.realtime_status_error_title': 'Live task stream recovery failed',
      'notebook.conversation.realtime_status_error_description': 'Recent reconnect attempts did not recover the stream. Retry or refresh to continue.',
      'notebook.conversation.realtime_status_ticket_unavailable_title': 'Realtime ticket service unavailable',
      'notebook.conversation.realtime_status_ticket_unavailable_description': 'This environment is not exposing the SSE ticket endpoint for notebook runs.',
      'notebook.conversation.realtime_status_ticket_unauthorized_title': 'Realtime ticket request denied',
      'notebook.conversation.realtime_status_ticket_unauthorized_description': 'The current session is not allowed to open a realtime notebook stream.',
      'notebook.conversation.realtime_status_ticket_rate_limited_title': 'Realtime ticket request rate limited',
      'notebook.conversation.realtime_status_ticket_rate_limited_description': 'Ticket issuance is temporarily throttled. Retry after the current limit window clears.',
      'notebook.conversation.realtime_status_stream_unavailable_title': 'Realtime task stream unavailable',
      'notebook.conversation.realtime_status_stream_unavailable_description': 'The notebook task event stream did not open in this environment. Check the task events endpoint before retrying.',
      'notebook.conversation.realtime_status_stream_interrupted_title': 'Realtime task stream interrupted',
      'notebook.conversation.realtime_status_stream_interrupted_description': 'The live task stream opened earlier but is no longer delivering updates.',
      'notebook.conversation.realtime_status_stream_recovery_exhausted_title': 'Realtime task recovery exhausted',
      'notebook.conversation.realtime_status_stream_recovery_exhausted_description': 'The task stream could not recover after multiple reconnect attempts.',
      'notebook.conversation.realtime_status_ticket_network_title': 'Realtime ticket exchange failed',
      'notebook.conversation.realtime_status_ticket_network_description': 'The client could not establish the ticket needed for realtime notebook updates.',
      'notebook.conversation.realtime_status_reconcile_failed_title': 'Trace recovery needs manual refresh',
      'notebook.conversation.realtime_status_reconcile_failed_description': 'The realtime stream reconnected, but trace backfill did not complete. Refresh to rebuild the task timeline.',
      'notebook.conversation.sandbox_starting_title': 'Preparing managed runtime',
      'notebook.conversation.sandbox_starting_description': 'Starting internal agent sandbox. First response may take up to a minute.',
    };
    const scoped = namespace ? `${namespace}.${key}` : key;
    return dict[scoped] ?? scoped;
  },
}));

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
  MessageList: ({ messages, streamingMessageId, streamingContent, disabled: _disabled }: any) => (
    <div data-testid="message-list">
      {messages.map((msg: TaskMessage) => (
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
  const mockMessages: TaskMessage[] = [
    {
      id: 'msg-1',
      task_id: 'task-1',
      role: 'user',
      content: 'Hello, how are you?',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'msg-2',
      task_id: 'task-1',
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

    it('renders sandbox starting hint when sandboxStarting is true', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          sandboxStarting
        />
      );

      expect(screen.getByTestId('notebook__sandbox-starting')).toBeInTheDocument();
      expect(screen.getByText('Preparing managed runtime')).toBeInTheDocument();
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

  describe('Connection Status UX', () => {
    it('shows reconnecting status when disconnected', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="disconnected"
        />
      );

      const status = screen.getByTestId('notebook__sse-status');
      expect(status).toHaveTextContent('Live task stream disconnected');
      expect(status).toHaveTextContent('The task stream is offline. Retry or refresh to resume updates.');
    });

    it('shows recovering status on connection errors', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
        />
      );

      const status = screen.getByTestId('notebook__sse-status');
      expect(status).toHaveTextContent('Live task stream recovery failed');
      expect(status).toHaveTextContent('Recent reconnect attempts did not recover the stream. Retry or refresh to continue.');
    });

    it('shows ticket-unavailable explanation when ticket exchange is missing', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="SSE_TICKET_UNAVAILABLE"
        />
      );

      const status = screen.getByTestId('notebook__sse-status');
      expect(status).toHaveTextContent('Realtime ticket service unavailable');
      expect(status).toHaveTextContent('This environment is not exposing the SSE ticket endpoint for notebook runs.');
    });

    it('shows reconcile-failed explanation with runtime message', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TRACE_RECONCILE_FAILED"
          connectionErrorMessage="Trace tail fetch returned 503"
        />
      );

      const status = screen.getByTestId('notebook__sse-status');
      expect(status).toHaveTextContent('Trace recovery needs manual refresh');
      expect(status).toHaveTextContent('Trace tail fetch returned 503');
    });

    it('shows stream-unavailable explanation when task events never open', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TASK_EVENTS_STREAM_UNAVAILABLE"
        />
      );

      const status = screen.getByTestId('notebook__sse-status');
      expect(status).toHaveTextContent('Realtime task stream unavailable');
      expect(status).toHaveTextContent('The notebook task event stream did not open in this environment. Check the task events endpoint before retrying.');
    });

    it('shows stream-recovery-exhausted explanation after reconnect budget is spent', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TASK_EVENTS_RECOVERY_EXHAUSTED"
        />
      );

      const status = screen.getByTestId('notebook__sse-status');
      expect(status).toHaveTextContent('Realtime task recovery exhausted');
      expect(status).toHaveTextContent('The task stream could not recover after multiple reconnect attempts.');
    });

    it('shows diagnostics links when connection issues are present', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TASK_EVENTS_STREAM_UNAVAILABLE"
          diagnosticsLinks={{
            runtime: '/runtime-observability?result=error',
            releaseOps: '/release-ops?result=error',
            agent: '/agents?agent=agent_123',
          }}
        />
      );

      expect(screen.getByTestId('notebook__sse-status-open-runtime')).toHaveAttribute(
        'href',
        '/runtime-observability?result=error',
      );
      expect(screen.getByTestId('notebook__sse-status-open-release-ops')).toHaveAttribute(
        'href',
        '/release-ops?result=error',
      );
      expect(screen.getByTestId('notebook__sse-status-open-agent')).toHaveAttribute(
        'href',
        '/agents?agent=agent_123',
      );
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
