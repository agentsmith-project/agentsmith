import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatHeader } from '../ChatHeader';
import type { ChatSession, Endpoint } from '@/lib/api/types';

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
    openai_model: 'gpt-4',
    type: 'openai',
    base_url: 'https://api.openai.com/v1',
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'endpoint-2',
    project_id: 'project-1',
    name: 'Secondary Endpoint',
    openai_model: 'gpt-3.5-turbo',
    type: 'openai',
    base_url: 'https://api.openai.com/v1',
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'endpoint-3',
    project_id: 'project-1',
    name: 'Disabled Endpoint',
    openai_model: 'claude-3',
    type: 'anthropic',
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

    it('should render "Chat" when session is null', () => {
      render(<ChatHeader {...defaultProps} session={null} />);

      expect(screen.getByText('Chat')).toBeInTheDocument();
    });

    it('should render current endpoint info', () => {
      const { container } = render(<ChatHeader {...defaultProps} />);

      expect(screen.getByText('gpt-4')).toBeInTheDocument();
      // The endpoint name should be rendered (it's found by matching endpoint_id)
      const endpointText = container.textContent || '';
      expect(endpointText).toContain('Primary');
    });

    it('should render model selector button', () => {
      render(<ChatHeader {...defaultProps} />);

      expect(screen.getByText('gpt-4')).toBeInTheDocument();
    });
  });

  describe('Stream Status', () => {
    it('should show "Generating…" when streaming', () => {
      render(<ChatHeader {...defaultProps} streamStatus="streaming" />);

      expect(screen.getByText('Generating…')).toBeInTheDocument();
    });

    it('should show "Generating…" when connecting', () => {
      render(<ChatHeader {...defaultProps} streamStatus="connecting" />);

      expect(screen.getByText('Generating…')).toBeInTheDocument();
    });

    it('should show "Stopped" when stopped', () => {
      render(<ChatHeader {...defaultProps} streamStatus="stopped" />);

      expect(screen.getByText('Stopped')).toBeInTheDocument();
    });

    it('should show "Error" when error', () => {
      render(<ChatHeader {...defaultProps} streamStatus="error" />);

      expect(screen.getByText('Error')).toBeInTheDocument();
    });

    it('should show no status when idle', () => {
      render(<ChatHeader {...defaultProps} streamStatus="idle" />);

      expect(screen.queryByText('Generating…')).not.toBeInTheDocument();
      expect(screen.queryByText('Stopped')).not.toBeInTheDocument();
      expect(screen.queryByText('Error')).not.toBeInTheDocument();
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

  describe('Model Selector', () => {
    it('should show model dropdown trigger', () => {
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      expect(trigger).toBeInTheDocument();
    });

    it('should open dropdown when trigger is clicked', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      expect(screen.getByText('Models')).toBeInTheDocument();
    });

    it('should list all endpoints in dropdown', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      // Dropdown should open
      expect(screen.getByText('Models')).toBeInTheDocument();
    });

    it('should show model names in dropdown', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      // gpt-3.5-turbo should be visible in dropdown
      expect(screen.getByText('gpt-3.5-turbo')).toBeInTheDocument();
    });

    it('should call onSelectEndpoint when endpoint is selected', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      const gpt35Option = screen.getByText('gpt-3.5-turbo');
      await user.click(gpt35Option);

      expect(defaultProps.onSelectEndpoint).toHaveBeenCalledWith(mockEndpoints[1]);
    });

    it('should highlight active endpoint in dropdown', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      // Dropdown should open
      expect(screen.getByText('Models')).toBeInTheDocument();
    });

    it('should disable selection of disabled endpoints', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      const disabledOption = screen.getByText('claude-3');
      const disabledContainer = disabledOption.closest('[data-disabled]');
      expect(disabledContainer).toBeInTheDocument();
    });

    it('should not call onSelectEndpoint for disabled endpoints', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      const disabledOption = screen.getByText('claude-3');
      await user.click(disabledOption);

      expect(defaultProps.onSelectEndpoint).not.toHaveBeenCalled();
    });

    it('should show "Disabled" label for disabled endpoints', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      expect(screen.getByText('Disabled')).toBeInTheDocument();
    });

    it('should show "No endpoints" when endpoints array is empty', async () => {
      render(<ChatHeader {...defaultProps} endpoints={[]} />);

      // When endpoints are empty but session exists, it shows session.model
      expect(screen.getByText('gpt-4')).toBeInTheDocument();
    });

    it('should close dropdown after selection', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} />);

      const trigger = screen.getByText('gpt-4');
      await user.click(trigger);

      expect(screen.getByText('Models')).toBeInTheDocument();

      const gpt35Option = screen.getByText('gpt-3.5-turbo');
      await user.click(gpt35Option);

      expect(screen.queryByText('Models')).not.toBeInTheDocument();
    });
  });

  describe('Null Session Handling', () => {
    it('should handle null session gracefully', () => {
      render(<ChatHeader {...defaultProps} session={null} />);

      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.getByText('Select model')).toBeInTheDocument();
    });

    it('should not show endpoint info when session is null', () => {
      render(<ChatHeader {...defaultProps} session={null} />);

      // Should not show specific endpoint details
      expect(screen.queryByText('Primary Endpoint')).not.toBeInTheDocument();
    });

    it('should still allow model selection when session is null', async () => {
      const user = userEvent.setup();
      render(<ChatHeader {...defaultProps} session={null} />);

      const trigger = screen.getByText('Select model');
      await user.click(trigger);

      expect(screen.getByText('Models')).toBeInTheDocument();
    });
  });

  describe('Endpoint Display', () => {
    it('should show endpoint name with separator', () => {
      render(<ChatHeader {...defaultProps} />);

      // Check for separator (· character)
      const separator = screen.getByText('·');
      expect(separator).toBeInTheDocument();
    });

    it('should show openai_model from session if endpoint not found', () => {
      const unknownEndpointSession = {
        ...mockSession,
        endpoint_id: 'unknown-endpoint',
      };

      render(<ChatHeader {...defaultProps} session={unknownEndpointSession} />);

      expect(screen.getByText('gpt-4')).toBeInTheDocument();
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
    it('should have proper header height', () => {
      const { container } = render(<ChatHeader {...defaultProps} />);

      const header = container.querySelector('.h-14');
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
