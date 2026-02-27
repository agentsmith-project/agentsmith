/**
 * Tests for MessageItem component
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageItem } from '../MessageItem';
import type { TaskMessage } from '@/lib/types/task';

// Mock toast
vi.mock('@/components/ui/toast', () => ({
  toast: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock Markdown component
vi.mock('@/components/chat/Markdown', () => ({
  Markdown: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      'copied': 'Copied!',
      'copy_failed': 'Failed to copy',
      'copy': 'Copy',
    };
    return translations[key] || key;
  },
}));

describe('MessageItem', () => {
  const mockUserMessage: TaskMessage = {
    id: 'msg-1',
    task_id: 'task-1',
    role: 'user',
    content: 'Hello, this is a user message',
    created_at: '2024-01-01T14:30:00Z',
  };

  const mockAgentMessage: TaskMessage = {
    id: 'msg-2',
    task_id: 'task-1',
    role: 'agent',
    content: 'Hello, this is an agent response with **markdown** support',
    created_at: '2024-01-01T14:31:00Z',
  };

  const writeTextMock = vi.fn().mockResolvedValue(undefined);

  beforeAll(() => {
    // Mock clipboard API once (navigator.clipboard is read-only, use defineProperty)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock, readText: vi.fn() },
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock.mockResolvedValue(undefined);
    (navigator.clipboard as any).writeText = writeTextMock;
  });

  const renderComponent = (message: TaskMessage, props = {}) => {
    return render(<MessageItem message={message} {...props} />);
  };

  describe('User Message Rendering', () => {
    it('renders user message with correct alignment', () => {
      renderComponent(mockUserMessage);

      const messageContainer = screen.getByTestId('markdown-content').closest('.flex');
      expect(messageContainer).toHaveClass('justify-end');
    });

    it('displays user message content', () => {
      renderComponent(mockUserMessage);

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Hello, this is a user message');
    });

    it('applies user message styling', () => {
      const { container } = renderComponent(mockUserMessage);

      const messageBubble = container.querySelector('.bg-hover');
      expect(messageBubble).toBeInTheDocument();
    });
  });

  describe('Agent Message Rendering', () => {
    it('renders agent message with correct alignment', () => {
      renderComponent(mockAgentMessage);

      const messageContainer = screen.getByTestId('markdown-content').closest('.flex');
      expect(messageContainer).toHaveClass('justify-start');
    });

    it('displays agent message content', () => {
      renderComponent(mockAgentMessage);

      expect(screen.getByTestId('markdown-content')).toHaveTextContent(/Hello, this is an agent response/);
    });

    it('applies agent message styling', () => {
      const { container } = renderComponent(mockAgentMessage);

      const messageBubble = container.querySelector('.bg-surface-high');
      expect(messageBubble).toBeInTheDocument();
    });

    it('does not render raw tool/runtime error text as assistant bubble content', () => {
      const errorOnlyMessage: TaskMessage = {
        ...mockAgentMessage,
        content: '{"type":"error","message":"工具调用错误"}{"type":"turn.failed","error":{"message":"upstream error"}}',
      };

      renderComponent(errorOnlyMessage);

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('');
      expect(screen.queryByText('工具调用错误')).not.toBeInTheDocument();
      expect(screen.queryByText('upstream error')).not.toBeInTheDocument();
    });

    it('renders expandable execution details when trace events are provided', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
          ]}
        />
      );

      expect(screen.getByTestId('notebook__message-trace-toggle')).toBeInTheDocument();
      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      expect(screen.getByTestId('notebook__message-trace-panel')).toBeInTheDocument();
      expect(screen.getByTestId('notebook__message-trace-view-timeline')).toBeInTheDocument();
      expect(screen.getByTestId('notebook__message-trace-view-raw')).toBeInTheDocument();
      expect(screen.getByTestId('notebook__message-trace-copy')).toBeInTheDocument();
      expect(screen.queryByTestId('notebook__trace-step-details')).not.toBeInTheDocument();
      await user.click(screen.getByTestId('notebook__trace-step-toggle'));
      expect(screen.getByTestId('notebook__trace-step-details')).toBeInTheDocument();
      expect(screen.getAllByText('Starting Codex execution').length).toBeGreaterThan(0);
    });

    it('switches to raw trace view and renders raw events', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
              details: { source: 'stdout', type: 'turn.started' },
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      await user.click(screen.getByTestId('notebook__message-trace-view-raw'));
      expect(screen.getByTestId('notebook__message-trace-raw')).toBeInTheDocument();
      expect(screen.getByText(/codex.exec/)).toBeInTheDocument();
      expect(screen.getByText(/turn.started/)).toBeInTheDocument();
    });

    it('copies trace logs as JSON from trace panel', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      await user.click(screen.getByTestId('notebook__message-trace-copy'));

      expect(writeTextMock).toHaveBeenCalled();
      const copied = String(writeTextMock.mock.calls.at(-1)?.[0] ?? '');
      expect(copied).toContain('"name": "codex.exec"');
      expect(copied).toContain('"summary": "Starting Codex execution"');
    });

    it('filters raw trace events by category group', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_p',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
            {
              id: 'trace_w',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:02Z',
              category: 'warning',
              phase: 'update',
              name: 'codex.retry',
              summary: 'Retrying after upstream error',
            },
            {
              id: 'trace_e',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 3,
              at: '2024-01-01T14:31:03Z',
              category: 'error',
              phase: 'end',
              status: 'error',
              name: 'codex.exec',
              summary: 'Execution failed',
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      await user.click(screen.getByTestId('notebook__message-trace-view-raw'));
      await user.click(screen.getByTestId('notebook__message-trace-filter-alerts'));

      const rawPanel = screen.getByTestId('notebook__message-trace-raw');
      expect(within(rawPanel).getByText(/Retrying after upstream error/)).toBeInTheDocument();
      expect(within(rawPanel).getByText(/Execution failed/)).toBeInTheDocument();
      expect(within(rawPanel).queryByText(/Starting Codex execution/)).not.toBeInTheDocument();
    });

    it('aggregates related trace events into step cards', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
            {
              id: 'trace_2',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:02Z',
              category: 'progress',
              phase: 'end',
              status: 'success',
              name: 'codex.exec',
              summary: 'Codex execution completed',
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      expect(screen.getAllByTestId('notebook__trace-step')).toHaveLength(1);
      await user.click(screen.getByTestId('notebook__trace-step-toggle'));
      expect(screen.getAllByText('Codex execution completed').length).toBeGreaterThan(0);
    });

    it('shows trace summary with status and duration in toggle text', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
            {
              id: 'trace_2',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:03Z',
              category: 'progress',
              phase: 'end',
              status: 'success',
              name: 'codex.exec',
              summary: 'Codex execution completed',
            },
          ]}
        />
      );

      const toggle = screen.getByTestId('notebook__message-trace-toggle');
      expect(toggle).toHaveTextContent(/trace_status_success/);
      expect(toggle).toHaveTextContent(/trace_step_count/);
      expect(toggle).toHaveTextContent(/3s/);
    });

    it('shows trace panel stats (events/errors/truncated)', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceHasMore
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
            {
              id: 'trace_2',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:02Z',
              category: 'error',
              phase: 'end',
              status: 'error',
              name: 'codex.exec',
              summary: 'Execution failed',
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      const stats = screen.getByTestId('notebook__message-trace-stats');
      expect(stats).toHaveTextContent(/trace_stats_events/);
      expect(stats).toHaveTextContent(/trace_stats_errors/);
      expect(stats).toHaveTextContent(/trace_stats_truncated/);
    });

    it('shows loading state when execution details are being fetched', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceDetailsLoading
        />
      );

      const toggle = screen.getByTestId('notebook__message-trace-toggle');
      expect(toggle).toHaveTextContent(/trace_details_loading/);
      await user.click(toggle);
      expect(screen.getByTestId('notebook__message-trace-loading')).toBeInTheDocument();
    });

    it('shows empty execution details state when no traces are available', async () => {
      const user = userEvent.setup();
      render(<MessageItem message={mockAgentMessage} />);

      const toggle = screen.getByTestId('notebook__message-trace-toggle');
      expect(toggle).toHaveTextContent(/trace_no_details/);
      await user.click(toggle);
      expect(screen.getByTestId('notebook__message-trace-empty')).toBeInTheDocument();
    });

    it('shows truncated hint and load-more action when traceHasMore is true', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceHasMore
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      expect(screen.getByTestId('notebook__message-trace-truncated')).toBeInTheDocument();
      expect(screen.getByTestId('notebook__message-trace-load-more')).toBeInTheDocument();
    });

    it('shows load-more loading label when traceLoadMoreLoading is true', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceHasMore
          traceLoadMoreLoading
          traceEvents={[
            {
              id: 'trace_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'start',
              status: 'running',
              name: 'codex.exec',
              summary: 'Starting Codex execution',
            },
          ]}
        />
      );
      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      expect(screen.getByTestId('notebook__message-trace-load-more')).toHaveTextContent(/trace_load_more_loading/);
    });
  });

  describe('Streaming State', () => {
    it('displays streaming content when provided', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          streamingContent="Streaming..."
        />
      );

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('Streaming...');
    });

    it('shows loading skeleton when streaming content is empty', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          streamingContent=""
        />
      );

      // Should show loading pulse elements
      const skeletonElements = document.querySelectorAll('.animate-pulse');
      expect(skeletonElements.length).toBeGreaterThan(0);
    });

    it('shows loading skeleton when streaming content is whitespace-only', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          streamingContent="   "
        />
      );

      // Whitespace-only trims to empty, so skeleton is shown
      const skeletonElements = document.querySelectorAll('.animate-pulse');
      expect(skeletonElements.length).toBeGreaterThan(0);
    });

    it('does not show loading state when not streaming', () => {
      renderComponent(mockAgentMessage);

      const skeletonElements = document.querySelectorAll('.animate-pulse');
      expect(skeletonElements.length).toBe(0);
    });
  });

  describe('Copy Functionality', () => {
    it('renders copy button', () => {
      renderComponent(mockUserMessage);

      const copyButton = screen.getByTitle('Copy');
      expect(copyButton).toBeInTheDocument();
    });

    it('copies message content to clipboard', async () => {
      const user = userEvent.setup();
      renderComponent(mockUserMessage);

      const copyButton = screen.getByTitle('Copy');
      await user.click(copyButton);

      await waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith('Hello, this is a user message');
      });
    });

    it('shows success toast after successful copy', async () => {
      const user = userEvent.setup();
      const { toast } = await import('@/components/ui/toast');

      renderComponent(mockUserMessage);

      const copyButton = screen.getByTitle('Copy');
      await user.click(copyButton);

      expect(toast.info).toHaveBeenCalledWith('Copied!');
    });

    it('shows error toast when copy fails', async () => {
      const user = userEvent.setup();
      const { toast } = await import('@/components/ui/toast');

      // Replace writeText with a rejecting mock directly on the clipboard object
      const failingWriteText = vi.fn().mockRejectedValue(new Error('Copy failed'));
      (navigator.clipboard as any).writeText = failingWriteText;

      renderComponent(mockUserMessage);

      const copyButton = screen.getByTitle('Copy');
      await user.click(copyButton);

      expect(toast.error).toHaveBeenCalledWith('Failed to copy');

      // Restore the original mock
      (navigator.clipboard as any).writeText = writeTextMock;
    });

    it('disables copy button when disabled', () => {
      render(
        <MessageItem
          message={mockUserMessage}
          disabled={true}
        />
      );

      const copyButton = screen.getByTitle('Copy');
      expect(copyButton).toBeDisabled();
    });
  });

  describe('Timestamp Display', () => {
    // Helper: compute expected time using the same logic as the component
    const expectedTime = (iso: string) =>
      new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    it('displays formatted time for message', () => {
      renderComponent(mockUserMessage);

      const expected = expectedTime(mockUserMessage.created_at);
      const timeElement = screen.getByText(expected);
      expect(timeElement).toBeInTheDocument();
    });

    it('formats time correctly', () => {
      const message: TaskMessage = {
        ...mockUserMessage,
        created_at: '2024-01-01T09:05:00Z',
      };

      renderComponent(message);

      const expected = expectedTime(message.created_at);
      const timeElement = screen.getByText(expected);
      expect(timeElement).toBeInTheDocument();
    });

    it('handles different time formats', () => {
      const message: TaskMessage = {
        ...mockUserMessage,
        created_at: '2024-12-31T23:59:00Z',
      };

      renderComponent(message);

      const expected = expectedTime(message.created_at);
      const timeElement = screen.getByText(expected);
      expect(timeElement).toBeInTheDocument();
    });
  });

  describe('Layout and Styling', () => {
    it('applies correct message bubble classes', () => {
      const { container } = renderComponent(mockUserMessage);

      const bubble = container.querySelector('.max-w-\\[80\\%\\]');
      expect(bubble).toBeInTheDocument();
    });

    it('applies border classes', () => {
      const { container } = renderComponent(mockUserMessage);

      const bubble = container.querySelector('.border');
      expect(bubble).toBeInTheDocument();
    });

    it('applies rounded corners', () => {
      const { container } = renderComponent(mockUserMessage);

      const bubble = container.querySelector('.rounded-md');
      expect(bubble).toBeInTheDocument();
    });

    it('positions timestamp and actions at bottom right', () => {
      const { container } = renderComponent(mockUserMessage);

      const actionsContainer = container.querySelector('.justify-end');
      expect(actionsContainer).toBeInTheDocument();
    });
  });

  describe('Markdown Rendering', () => {
    it('passes content to Markdown component', () => {
      renderComponent(mockAgentMessage);

      expect(screen.getByTestId('markdown-content')).toHaveTextContent(/\*\*markdown\*\* support/);
    });

    it('renders markdown content correctly', () => {
      const messageWithMarkdown: TaskMessage = {
        ...mockAgentMessage,
        content: '## Header\n\n- Item 1\n- Item 2\n\n**Bold** text',
      };

      renderComponent(messageWithMarkdown);

      expect(screen.getByTestId('markdown-content')).toHaveTextContent(/Header/);
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(/Item 1/);
      expect(screen.getByTestId('markdown-content')).toHaveTextContent(/Bold/);
    });
  });

  describe('Accessibility', () => {
    it('has proper aria-label on copy button', () => {
      renderComponent(mockUserMessage);

      const copyButton = screen.getByLabelText('Copy');
      expect(copyButton).toBeInTheDocument();
    });

    it('has title attribute on copy button', () => {
      renderComponent(mockUserMessage);

      const copyButton = screen.getByTitle('Copy');
      expect(copyButton).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty message content', () => {
      const emptyMessage: TaskMessage = {
        ...mockUserMessage,
        content: '',
      };

      renderComponent(emptyMessage);

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    });

    it('handles very long messages', () => {
      const longContent = 'a'.repeat(10000);
      const longMessage: TaskMessage = {
        ...mockUserMessage,
        content: longContent,
      };

      renderComponent(longMessage);

      expect(screen.getByTestId('markdown-content')).toHaveTextContent(longContent.substring(0, 100));
    });

    it('handles special characters in content', () => {
      const specialMessage: TaskMessage = {
        ...mockUserMessage,
        content: 'Special chars: < > & " \' \n\t',
      };

      renderComponent(specialMessage);

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    });
  });
});
