import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ChatHeader } from '../ChatHeader';
import type { ChatSession, Endpoint } from '@/lib/api/types';
import {
  CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT,
  CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT,
  type ChatStreamEscalationConfirmationResponseDetail,
} from '@/lib/chat/stream-state';

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const translations: Record<string, Record<string, string>> = {
      chat: {
        'header.execution_target': 'Execution target',
        'header.select_execution_target': 'Select execution target',
        'header.execution_targets': 'Execution targets',
        'header.endpoints': 'Endpoints',
        'header.agents': 'Agents',
        'header.no_execution_targets': 'No execution targets',
        'header.agent_execution_target_hint': 'Runner-managed execution target',
        'header.external_agent': 'External Agent',
        'header.disabled': 'Disabled',
        'header.default_title': 'Chat',
        'header.rename_thread': 'Rename thread',
        'header.no_active_thread_hint': 'Create or select a thread first, then choose an execution target and send messages',
        'header.status_generating': 'Generating…',
        'header.status_recovering': 'Recovering stream...',
        'composer.stop': 'Stop',
        'header.status_stopped': 'Stopped',
        'header.status_error': 'Interrupted',
        'header.status_terminating': 'Force stopping…',
        'header.stop_escalation_title': 'Force stop this generation?',
        'header.stop_escalation_description': 'The generation is still stopping. You can force stop the execution environment before continuing.',
        'header.stop_escalation_reason': 'Backend reason: {reason}',
        'header.stop_escalation_confirm': 'Force stop',
        'header.stop_escalation_cancel': 'Keep waiting',
        'new_thread': 'New Thread',
      },
    };
    const template = translations[namespace]?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => name);
  },
}));

const mockSession: ChatSession = {
  id: 'session-1',
  project_id: 'project-1',
  title: 'Test Chat Session',
  model: 'gpt-4',
  endpoint_id: 'endpoint-1',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T01:00:00Z',
  message_count: 5,
  total_tokens: 100,
};

const mockEndpoints: Endpoint[] = [
  {
    id: 'endpoint-1',
    project_id: 'project-1',
    name: 'Primary Endpoint',
    model: 'gpt-4',
    type: 'catalog',
    upstream_protocol: 'openai_chat_completions',
    base_url: 'https://api.openai.com/v1',
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'endpoint-2',
    project_id: 'project-1',
    name: 'Secondary Endpoint',
    model: 'gpt-3.5-turbo',
    type: 'catalog',
    upstream_protocol: 'openai_chat_completions',
    base_url: 'https://api.openai.com/v1',
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'endpoint-3',
    project_id: 'project-1',
    name: 'Disabled Endpoint',
    model: 'claude-3',
    type: 'catalog',
    upstream_protocol: 'anthropic_messages',
    base_url: 'https://api.anthropic.com/v1',
    status: 'disabled',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

const defaultProps = {
  session: mockSession,
  endpoints: mockEndpoints,
  streamStatus: 'idle' as const,
  onRename: vi.fn(),
  onSelectEndpoint: vi.fn(),
  onCreateThread: vi.fn(),
};

describe('ChatHeader', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render session title', () => {
      render(<ChatHeader {...defaultProps} />);

      expect(screen.getByText('Test Chat Session')).toBeInTheDocument();
    });

    it('keeps the header shell quiet', () => {
      render(<ChatHeader {...defaultProps} />);

      const shell = screen.getByTestId('chat__header');

      expect(shell.className).toContain('border-b');
      expect(shell.className).not.toMatch(/rounded-|shadow-/);
    });

    it('should render "Chat" when session is null', () => {
      render(<ChatHeader {...defaultProps} session={null} />);

      expect(screen.getByText('Chat')).toBeInTheDocument();
    });

    it('should render current endpoint info', () => {
      const { container } = render(<ChatHeader {...defaultProps} />);

      expect(screen.getByText('Primary Endpoint')).toBeInTheDocument();
      // The endpoint name should be rendered (it's found by matching endpoint_id)
      const endpointText = container.textContent || '';
      expect(endpointText).toContain('gpt-4');
    });

    it('should render execution target selector button', () => {
      render(<ChatHeader {...defaultProps} />);

      expect(screen.getByTestId('chat__execution-target-trigger')).toHaveTextContent('Primary Endpoint');
    });
  });

  describe('Stream Status', () => {
    it('should show "Generating…" when streaming', () => {
      render(<ChatHeader {...defaultProps} streamStatus="streaming" />);

      expect(screen.getByTestId('chat__stream-status')).toHaveTextContent('Generating…');
    });

    it('should show "Generating…" when connecting', () => {
      render(<ChatHeader {...defaultProps} streamStatus="connecting" />);

      expect(screen.getByTestId('chat__stream-status')).toHaveTextContent('Generating…');
    });

    it('should show "Recovering stream..." when recovering', () => {
      render(<ChatHeader {...defaultProps} streamStatus="recovering" />);

      expect(screen.getByTestId('chat__stream-status')).toHaveTextContent('Recovering stream...');
    });

    it('should show "Stop…" when stopping', () => {
      render(<ChatHeader {...defaultProps} streamStatus="stopping" />);

      expect(screen.getByTestId('chat__stream-status')).toHaveTextContent('Stop…');
    });

    it('should show "Stopped" when stopped', () => {
      render(<ChatHeader {...defaultProps} streamStatus="stopped" />);

      expect(screen.getByTestId('chat__stream-status')).toHaveTextContent('Stopped');
    });

    it('should show "Interrupted" when error', () => {
      render(<ChatHeader {...defaultProps} streamStatus="error" />);

      expect(screen.getByTestId('chat__stream-status')).toHaveTextContent('Interrupted');
    });

    it('should show "Force stopping…" when terminating', () => {
      render(<ChatHeader {...defaultProps} streamStatus="terminating" />);

      expect(screen.getByTestId('chat__stream-status')).toHaveTextContent('Force stopping…');
    });

    it('should show no status when idle', () => {
      render(<ChatHeader {...defaultProps} streamStatus="idle" />);

      expect(screen.queryByText('Generating…')).not.toBeInTheDocument();
      expect(screen.queryByText('Stop…')).not.toBeInTheDocument();
      expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
      expect(screen.queryByText('Recovering stream...')).not.toBeInTheDocument();
      expect(screen.queryByText('Interrupted')).not.toBeInTheDocument();
    });
  });

  describe('Stop Escalation Confirmation', () => {
    it('renders a design-system confirmation and dispatches the user decision', async () => {
      const user = userEvent.setup();
      const responses: ChatStreamEscalationConfirmationResponseDetail[] = [];
      const onResponse = (event: Event) => {
        responses.push((event as CustomEvent<ChatStreamEscalationConfirmationResponseDetail>).detail);
      };
      window.addEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT, onResponse);

      try {
        render(<ChatHeader {...defaultProps} streamStatus="stopping" />);

        fireEvent(
          window,
          new CustomEvent(CHAT_STREAM_ESCALATION_CONFIRMATION_REQUEST_EVENT, {
            detail: {
              requestId: 'req_1',
              sessionId: mockSession.id,
              reason: 'agent did not acknowledge stop',
            },
          }),
        );

        expect(await screen.findByText('Force stop this generation?')).toBeInTheDocument();
        expect(screen.getByText('Backend reason: reason')).toBeInTheDocument();

        await user.click(screen.getByTestId('chat__stop-escalation-confirm'));

        expect(responses).toEqual([{ requestId: 'req_1', confirmed: true }]);
      } finally {
        window.removeEventListener(CHAT_STREAM_ESCALATION_CONFIRMATION_RESPONSE_EVENT, onResponse);
      }
    });
  });

  describe('Rename Functionality', () => {
    it('should enter edit mode when title is clicked', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      expect(input).toBeInTheDocument();
    });

    it('should show input field in edit mode', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      expect(input).toHaveFocus();
    });

    it('should update draft title when typing', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      await user.clear(input);
      await user.type(input, 'New Title');

      expect(input).toHaveValue('New Title');
    });

    it('should commit rename on Enter key', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      await user.clear(input);
      await user.type(input, 'New Title{Enter}');

      expect(defaultProps.onRename).toHaveBeenCalledWith('New Title');
    });

    it('should cancel rename on Escape key', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      await user.clear(input);
      await user.type(input, 'New Title{Escape}');

      expect(defaultProps.onRename).not.toHaveBeenCalled();
    });

    it('should commit rename on blur', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      await user.clear(input);
      await user.type(input, 'New Title');

      fireEvent.blur(input);

      expect(defaultProps.onRename).toHaveBeenCalledWith('New Title');
    });

    it('should not commit empty title', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      await user.clear(input);
      await user.type(input, '{Enter}');

      expect(defaultProps.onRename).not.toHaveBeenCalled();
    });

    it('should not commit if title has not changed', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      await user.click(titleButton);

      const input = screen.getByDisplayValue('Test Chat Session');
      await user.type(input, '{Enter}');

      expect(defaultProps.onRename).not.toHaveBeenCalled();
    });

    it('should exit edit mode when session changes', () => {
      const { rerender } = render(<ChatHeader {...defaultProps} />);

      // Enter edit mode
      const titleButton = screen.getByText('Test Chat Session');
      fireEvent.click(titleButton);

      // Change session
      const newSession = { ...mockSession, id: 'session-2' };
      rerender(<ChatHeader {...defaultProps} session={newSession} />);

      // Should show title, not input
      expect(screen.getByText('Test Chat Session')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('Test Chat Session')).not.toBeInTheDocument();
    });
  });

  describe('Execution Target Selector', () => {
    it('should show execution target dropdown trigger', () => {
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      expect(trigger).toBeInTheDocument();
      expect(trigger).toHaveTextContent('Primary Endpoint');
    });

    it('should open dropdown when trigger is clicked', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      expect(screen.getByText('Execution target')).toBeInTheDocument();
    });

    it('should list endpoints and agents in grouped dropdown sections', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      expect(screen.getByText('Endpoints')).toBeInTheDocument();
    });

    it('should show model names in endpoint rows', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      expect(screen.getByText('gpt-3.5-turbo')).toBeInTheDocument();
    });

    it('should call onSelectEndpoint when endpoint is selected', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      const secondaryOption = screen.getByTestId('chat__execution-target-endpoint--endpoint-2');
      await user.click(secondaryOption);

      expect(defaultProps.onSelectEndpoint).toHaveBeenCalledWith(mockEndpoints[1]);
    });

    it('should highlight active endpoint in dropdown', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      expect(screen.getByTestId('chat__execution-target-endpoint--endpoint-1')).toHaveClass('bg-hover');
    });

    it('should disable selection of disabled endpoints', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      const disabledOption = screen.getByText('Disabled Endpoint');
      const disabledContainer = disabledOption.closest('[data-disabled]');
      expect(disabledContainer).toBeInTheDocument();
    });

    it('should not call onSelectEndpoint for disabled endpoints', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      const disabledOption = screen.getByText('Disabled Endpoint');
      await user.click(disabledOption);

      expect(defaultProps.onSelectEndpoint).not.toHaveBeenCalled();
    });

    it('should show "Disabled" label for disabled endpoints', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('should fall back to session endpoint id when no execution target match exists', async () => {
      render(<ChatHeader {...defaultProps} endpoints={[]} />);

      expect(screen.getByTestId('chat__execution-target-trigger')).toHaveTextContent('endpoint-1');
    });

    it('should close dropdown after selection', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByTestId('chat__execution-target-trigger');
      await user.click(trigger);

      expect(screen.getByText('Execution target')).toBeInTheDocument();

      const secondaryOption = screen.getByTestId('chat__execution-target-endpoint--endpoint-2');
      await user.click(secondaryOption);

      expect(screen.queryByText('Execution target')).not.toBeInTheDocument();
    });
  });

  describe('Null Session Handling', () => {
    it('should handle null session gracefully', () => {
      render(<ChatHeader {...defaultProps} session={null} />);

      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.getByTestId('chat__header-create-thread')).toBeInTheDocument();
    });

    it('should not show endpoint info when session is null', () => {
      render(<ChatHeader {...defaultProps} session={null} />);

      // Should not show specific endpoint details
      expect(screen.queryByText('Primary Endpoint')).not.toBeInTheDocument();
    });

    it('should allow creating a thread when session is null', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} session={null} />);

      const createButton = screen.getByTestId('chat__header-create-thread');
      await user.click(createButton);
      expect(defaultProps.onCreateThread).toHaveBeenCalledTimes(1);
    });
  });

  describe('Endpoint Display', () => {
    it('should show endpoint name with separator', () => {
      render(<ChatHeader {...defaultProps} />);

      // Check for separator (· character)
      const separator = screen.getByText('·');
      expect(separator).toBeInTheDocument();
    });

    it('should show model from session if endpoint not found', () => {
      const unknownEndpointSession = {
        ...mockSession,
        endpoint_id: 'unknown-endpoint',
      };

      const { container } = render(<ChatHeader {...defaultProps} session={unknownEndpointSession} />);
      const headerText = container.textContent ?? '';
      expect(headerText).toContain('gpt-4');
    });
  });

  describe('Edge Cases', () => {
    it('should handle session without title', () => {
      const untitledSession = { ...mockSession, title: '' };
      const { container } = render(<ChatHeader {...defaultProps} session={untitledSession} />);

      // The component should handle empty title gracefully
      const buttons = container.querySelectorAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('should handle very long titles', () => {
      const longTitleSession = {
        ...mockSession,
        title: 'This is a very long chat session title that should be truncated with ellipsis',
      };

      render(<ChatHeader {...defaultProps} session={longTitleSession} />);

      const title = screen.getByText(/This is a very long chat/);
      expect(title).toBeInTheDocument();
    });

    it('should handle session without endpoint_id', () => {
      const noEndpointSession = { ...mockSession, endpoint_id: undefined as never };

      render(<ChatHeader {...defaultProps} session={noEndpointSession} />);

      // Should not crash
      expect(screen.getByText('Test Chat Session')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should provide proper button labels', () => {
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      expect(titleButton).toHaveAttribute('title', 'Rename thread');
    });

    it('should have focus-visible styles', () => {
      render(<ChatHeader {...defaultProps} />);

      const titleButton = screen.getByText('Test Chat Session');
      expect(titleButton).toHaveClass('focus-visible:outline-none');
    });
  });

  describe('Component Layout', () => {
    it('should render a compact header shell', () => {
      const { container } = render(<ChatHeader {...defaultProps} />);

      const header = container.querySelector('.border-b');
      expect(header).toBeInTheDocument();
    });

    it('should have border bottom', () => {
      const { container } = render(<ChatHeader {...defaultProps} />);

      const header = container.querySelector('.border-b');
      expect(header).toBeInTheDocument();
    });

    it('should have proper padding', () => {
      const { container } = render(<ChatHeader {...defaultProps} />);

      const header = container.querySelector('.px-3');
      expect(header).toBeInTheDocument();
    });
  });

  // Layout toggle moved to page-level header (PageHeader actions) for global consistency.
});
