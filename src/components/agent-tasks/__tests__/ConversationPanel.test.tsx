/**
 * Tests for ConversationPanel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationPanel } from '../ConversationPanel';
import type { TaskActivityItem } from '@/lib/types/task';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const dict: Record<string, string> = {
      'agent_tasks.conversation.realtime_status_connecting_title': 'Connecting realtime session',
      'agent_tasks.conversation.realtime_status_connecting_description': 'Opening the live task stream for this Agent task.',
      'agent_tasks.conversation.realtime_status_reconnecting_title': 'Recovering live task stream',
      'agent_tasks.conversation.realtime_status_reconnecting_description': 'Reconnecting and replaying recent task events.',
      'agent_tasks.conversation.realtime_status_disconnected_title': 'Live task stream disconnected',
      'agent_tasks.conversation.realtime_status_disconnected_description': 'The task stream is offline. Retry or refresh to resume updates.',
      'agent_tasks.conversation.realtime_status_error_title': 'Live task stream recovery failed',
      'agent_tasks.conversation.realtime_status_error_description': 'Recent reconnect attempts did not recover the stream. Retry or refresh to continue.',
      'agent_tasks.conversation.realtime_status_ticket_unavailable_title': 'Live updates paused',
      'agent_tasks.conversation.realtime_status_ticket_unavailable_description': 'The task is still available, but live updates could not start in this environment. Refresh if the timeline does not update.',
      'agent_tasks.conversation.realtime_status_ticket_unauthorized_title': 'Realtime ticket request denied',
      'agent_tasks.conversation.realtime_status_ticket_unauthorized_description': 'The current session is not allowed to open a realtime Agent task stream.',
      'agent_tasks.conversation.realtime_status_ticket_rate_limited_title': 'Realtime ticket request rate limited',
      'agent_tasks.conversation.realtime_status_ticket_rate_limited_description': 'Ticket issuance is temporarily throttled. Retry after the current limit window clears.',
      'agent_tasks.conversation.realtime_status_stream_unavailable_title': 'Realtime task stream unavailable',
      'agent_tasks.conversation.realtime_status_stream_unavailable_description': 'The Agent task event stream did not open in this environment. Refresh the task before retrying.',
      'agent_tasks.conversation.realtime_status_stream_interrupted_title': 'Realtime task stream interrupted',
      'agent_tasks.conversation.realtime_status_stream_interrupted_description': 'The live task stream opened earlier but is no longer delivering updates.',
      'agent_tasks.conversation.realtime_status_stream_recovery_exhausted_title': 'Realtime task recovery exhausted',
      'agent_tasks.conversation.realtime_status_stream_recovery_exhausted_description': 'The task stream could not recover after multiple reconnect attempts.',
      'agent_tasks.conversation.realtime_status_ticket_network_title': 'Realtime ticket exchange failed',
      'agent_tasks.conversation.realtime_status_ticket_network_description': 'The client could not establish the ticket needed for realtime Agent task updates.',
      'agent_tasks.conversation.realtime_status_reconcile_failed_title': 'Trace recovery needs manual refresh',
      'agent_tasks.conversation.realtime_status_reconcile_failed_description': 'The realtime stream reconnected, but trace backfill did not complete. Refresh to rebuild the task timeline.',
      'agent_tasks.conversation.sandbox_starting_title': 'Preparing managed execution environment',
      'agent_tasks.conversation.sandbox_starting_description': 'Starting the managed task environment. First response may take up to a minute.',
    };
    const scoped = namespace ? `${namespace}.${key}` : key;
    return dict[scoped] ?? scoped;
  },
}));

vi.mock('../ConversationInput', () => ({
  ConversationInput: ({
    value,
    onChange,
    onSend,
    disabled,
    sending,
  }: any) => (
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
  MessageList: ({ messages, streamingMessageId, streamingContent, activeRunView, disabled: _disabled }: any) => (
    <div data-testid="message-list">
      {messages.map((msg: TaskActivityItem) => (
        <div key={msg.id} data-testid={`message-${msg.id}`}>
          {msg.content}
        </div>
      ))}
      {streamingMessageId && (
        <div data-testid="streaming-message">{streamingContent}</div>
      )}
      {activeRunView ? (
        <div data-testid="message-list-active-run">
          {activeRunView.messageId}:{activeRunView.runState}
        </div>
      ) : null}
    </div>
  ),
}));

describe('ConversationPanel', () => {
  const mockMessages: TaskActivityItem[] = [
    {
      id: 'msg-1',
      task_id: 'task-1',
      kind: 'user_intent',
    actor: 'user',
      content: 'Hello, how are you?',
      created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'msg-2',
      task_id: 'task-1',
      kind: 'runner_output',
    actor: 'runner',
      content: 'I am doing well, thank you!',
      created_at: '2024-01-01T00:01:00Z',
    },
  ];

  const mockOnSendMessage = vi.fn();
  const createActiveRunView = (overrides = {}) => ({
    messageId: 'msg-2',
    runState: 'running' as const,
    latestAction: {
      kind: 'output' as const,
      summary: 'Writing a very long execution update that belongs inside the active AI bubble instead of the conversation status banner.',
    },
    recentActions: [],
    startedAt: '2024-01-01T00:01:00Z',
    elapsedSeconds: 125,
    cancelPending: false,
    onCancel: vi.fn(),
    realtimeHealth: { status: 'connected' as const },
    ...overrides,
  });

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

      expect(screen.getByTestId('agent-tasks__sandbox-starting')).toBeInTheDocument();
      expect(screen.getByText('Preparing managed execution environment')).toBeInTheDocument();
      expect(screen.getByTestId('agent-tasks__execution-visibility')).not.toHaveTextContent(/sandbox/i);
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
      expect(panel).toHaveClass('h-full', 'flex', 'flex-col');
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

      const status = screen.getByTestId('agent-tasks__sse-status');
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

      const status = screen.getByTestId('agent-tasks__sse-status');
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

      const status = screen.getByTestId('agent-tasks__sse-status');
      expect(status).toHaveTextContent('Live updates paused');
      expect(status).toHaveTextContent(
        'The task is still available, but live updates could not start in this environment. Refresh if the timeline does not update.',
      );
      expect(status).not.toHaveTextContent(/SSE ticket|ticket service|ticket endpoint/i);
    });

    it('shows reconcile-failed explanation without raw execution error text', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TRACE_RECONCILE_FAILED"
          connectionErrorMessage="Trace tail fetch returned 503 with internal request detail"
        />
      );

      const status = screen.getByTestId('agent-tasks__sse-status');
      expect(status).toHaveTextContent('Trace recovery needs manual refresh');
      expect(status).toHaveTextContent('The realtime stream reconnected, but trace backfill did not complete. Refresh to rebuild the task timeline.');
      expect(status).not.toHaveTextContent('Trace tail fetch returned 503 with internal request detail');
    });

    it('does not expose raw stream error messages in the ordinary SSE banner', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TASK_EVENTS_STREAM_UNAVAILABLE"
          connectionErrorMessage="EventSource failed: token=raw-secret status=502"
        />
      );

      const status = screen.getByTestId('agent-tasks__sse-status');
      expect(status).toHaveTextContent('Realtime task stream unavailable');
      expect(status).toHaveTextContent(
        'The Agent task event stream did not open in this environment. Refresh the task before retrying.',
      );
      expect(status).not.toHaveTextContent('token=raw-secret');
      expect(status).not.toHaveTextContent('EventSource failed');
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

      const status = screen.getByTestId('agent-tasks__sse-status');
      expect(status).toHaveTextContent('Realtime task stream unavailable');
      expect(status).toHaveTextContent('The Agent task event stream did not open in this environment. Refresh the task before retrying.');
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

      const status = screen.getByTestId('agent-tasks__sse-status');
      expect(status).toHaveTextContent('Realtime task recovery exhausted');
      expect(status).toHaveTextContent('The task stream could not recover after multiple reconnect attempts.');
    });

    it('does not show task diagnostics links by default even when links are supplied', () => {
      const diagnosticsLinks = {
        audit: '/audit?result=error',
        usage: '/usage?result=error',
      };

      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TASK_EVENTS_STREAM_UNAVAILABLE"
          diagnosticsLinks={diagnosticsLinks}
        />
      );

      expect(screen.queryByTestId('agent-tasks__sse-status-open-audit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__sse-status-open-usage')).not.toBeInTheDocument();
      expect(screen.queryByText(/diagnostics/i)).not.toBeInTheDocument();
    });

    it('shows task diagnostics links only when an explicit affordance is supplied', () => {
      const diagnosticsLinks = {
        audit: '/audit?result=error',
        usage: '/usage?result=error',
        runner: '/agent-runners?runner=runner_123',
      } as { audit: string; usage: string };

      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TASK_EVENTS_STREAM_UNAVAILABLE"
          diagnosticsLinks={diagnosticsLinks}
          diagnosticsLinksAffordance={{ auditUsage: true }}
        />
      );

      expect(screen.getByTestId('agent-tasks__sse-status-open-audit')).toHaveAttribute(
        'href',
        '/audit?result=error',
      );
      expect(screen.getByTestId('agent-tasks__sse-status-open-usage')).toHaveAttribute(
        'href',
        '/usage?result=error',
      );
      expect(screen.queryByTestId('agent-tasks__sse-status-open-runner')).not.toBeInTheDocument();
      expect(screen.queryByText(/Runner diagnostics/i)).not.toBeInTheDocument();
    });
  });

  describe('Active Run View', () => {
    it('passes the active run view to the message list without rendering a top active-run banner or cancel action', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          activeRunView={createActiveRunView()}
        />
      );

      expect(screen.getByTestId('message-list-active-run')).toHaveTextContent('msg-2:running');
      expect(screen.queryByTestId('agent-tasks__execution-visibility')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__run-activity-summary')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__run-active-cancel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__execution-visibility-toggle')).not.toBeInTheDocument();
    });

    it.each(['reconnecting', 'disconnected'] as const)(
      'keeps transient %s realtime status out of the top banner while an active run owns the footer state',
      (connectionStatus) => {
        render(
          <ConversationPanel
            messages={mockMessages}
            onSendMessage={mockOnSendMessage}
            connectionStatus={connectionStatus}
            activeRunView={createActiveRunView({
              realtimeHealth: { status: connectionStatus },
            })}
          />
        );

        expect(screen.getByTestId('message-list-active-run')).toHaveTextContent('msg-2:running');
        expect(screen.queryByTestId('agent-tasks__execution-visibility')).not.toBeInTheDocument();
        expect(screen.queryByTestId('agent-tasks__sse-status')).not.toBeInTheDocument();
        expect(screen.queryByText('Recovering live task stream')).not.toBeInTheDocument();
        expect(screen.queryByText('Live task stream disconnected')).not.toBeInTheDocument();
      },
    );

    it('still shows unrecoverable realtime errors above the message list when user action may be needed', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="error"
          connectionErrorCode="TASK_EVENTS_RECOVERY_EXHAUSTED"
          activeRunView={createActiveRunView({
            realtimeHealth: {
              status: 'error',
              code: 'TASK_EVENTS_RECOVERY_EXHAUSTED',
            },
          })}
        />
      );

      expect(screen.getByTestId('agent-tasks__execution-visibility')).toBeInTheDocument();
      expect(screen.getByTestId('agent-tasks__sse-status')).toHaveTextContent(
        'Realtime task recovery exhausted',
      );
      expect(screen.getByTestId('message-list-active-run')).toHaveTextContent('msg-2:running');
    });

    it('still renders real connection and sandbox notices above the message list', () => {
      render(
        <ConversationPanel
          messages={mockMessages}
          onSendMessage={mockOnSendMessage}
          connectionStatus="reconnecting"
          sandboxStarting
        />
      );

      expect(screen.getByTestId('agent-tasks__execution-visibility')).toBeInTheDocument();
      expect(screen.getAllByText('Recovering live task stream').length).toBeGreaterThan(0);
      expect(screen.getByTestId('agent-tasks__sandbox-starting')).toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__run-active-cancel')).not.toBeInTheDocument();
    });
  });

  describe('Empty Messages', () => {
    it('renders the conversation empty state when there are no messages and the task is not blocked', () => {
      render(
        <ConversationPanel
          messages={[]}
          onSendMessage={mockOnSendMessage}
        />
      );

      expect(screen.getByTestId('agent-tasks__conversation-empty-state')).toBeInTheDocument();
      expect(screen.queryByTestId('message-list')).not.toBeInTheDocument();
    });

    it('does not show empty-state audit or usage links without an explicit diagnostics affordance', () => {
      render(
        <ConversationPanel
          messages={[]}
          onSendMessage={mockOnSendMessage}
          diagnosticsLinks={{
            audit: '/audit?result=error',
            usage: '/usage?result=error',
          }}
        />
      );

      expect(screen.queryByTestId('agent-tasks__conversation-empty-open-audit')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__conversation-empty-open-usage')).not.toBeInTheDocument();
    });

    it('shows empty-state audit and usage links when the diagnostics affordance is explicit', () => {
      render(
        <ConversationPanel
          messages={[]}
          onSendMessage={mockOnSendMessage}
          diagnosticsLinks={{
            audit: '/audit?result=error',
            usage: '/usage?result=error',
          }}
          diagnosticsLinksAffordance={{ auditUsage: true }}
        />
      );

      expect(screen.getByTestId('agent-tasks__conversation-empty-open-audit')).toHaveAttribute(
        'href',
        '/audit?result=error',
      );
      expect(screen.getByTestId('agent-tasks__conversation-empty-open-usage')).toHaveAttribute(
        'href',
        '/usage?result=error',
      );
    });

    it('renders a blocked state instead of start-a-conversation cues when terminal work is blocking the task', async () => {
      const user = userEvent.setup();
      const onAction = vi.fn();

      render(
        <ConversationPanel
          messages={[]}
          onSendMessage={mockOnSendMessage}
          disabled
          blockedState={{
            title: '1 terminal session is using this task',
            description:
              'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.',
            actionLabel: 'Open Terminal Workspace',
            actionTestId: 'agent-tasks__conversation-blocked-action',
            onAction,
          }}
        />
      );

      expect(screen.getByTestId('agent-tasks__conversation-blocked-state')).toHaveTextContent(
        '1 terminal session is using this task',
      );
      expect(screen.getByTestId('agent-tasks__conversation-blocked-state')).toHaveTextContent(
        'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.',
      );
      expect(screen.queryByTestId('agent-tasks__conversation-empty-state')).not.toBeInTheDocument();

      await user.click(screen.getByTestId('agent-tasks__conversation-blocked-action'));
      expect(onAction).toHaveBeenCalledTimes(1);
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
