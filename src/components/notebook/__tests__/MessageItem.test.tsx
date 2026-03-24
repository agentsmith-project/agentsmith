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
      'trace_error_unavailable_title': 'Trace details unavailable',
      'trace_error_forbidden_title': 'Trace access denied',
      'trace_error_network_title': 'Trace retrieval failed',
      'trace_error_failed_title': 'Trace details could not be loaded',
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

    it('does not render raw tool/execution error text as assistant bubble content', () => {
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

    it('keeps the trace toggle but removes duplicated status metadata from its text', () => {
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
      expect(toggle).toHaveTextContent(/trace_view/);
      expect(toggle).not.toHaveTextContent(/trace_status_success/);
      expect(toggle).not.toHaveTextContent(/trace_step_count/);
      expect(toggle).not.toHaveTextContent(/3s/);
    });

    it('prefers recovered success when a later end event follows an error', () => {
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
              category: 'error',
              phase: 'end',
              status: 'error',
              name: 'codex.exec',
              summary: 'Upstream timeout',
            },
            {
              id: 'trace_3',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 3,
              at: '2024-01-01T14:31:04Z',
              category: 'artifact',
              phase: 'end',
              name: 'artifact.discovered',
              summary: 'Artifact discovered: charts.png',
            },
          ]}
        />
      );

      const statusBadge = screen.getByTestId('notebook__message-run-status');
      expect(statusBadge).toHaveTextContent(/trace_status_success/);
      const toggle = screen.getByTestId('notebook__message-trace-toggle');
      expect(toggle).toHaveTextContent(/trace_view/);
      expect(toggle).not.toHaveTextContent(/trace_status_error/);
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
      expect(stats).toHaveTextContent(/trace_stats_truncated/);
      expect(stats).not.toHaveTextContent(/trace_stats_errors/);

      await user.click(screen.getByTestId('notebook__message-trace-filter-all'));
      expect(stats).toHaveTextContent(/trace_stats_errors/);
    });

    it('prefers run lifecycle and run summary events for status and duration', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_lifecycle_running',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'lifecycle',
              phase: 'update',
              status: 'running',
              name: 'run.lifecycle',
              summary: 'Run in progress',
              details: { run_phase: 'running' },
            },
            {
              id: 'trace_lifecycle_done',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:02Z',
              category: 'lifecycle',
              phase: 'end',
              status: 'success',
              name: 'run.lifecycle',
              summary: 'Run completed',
              details: { run_phase: 'completed' },
            },
            {
              id: 'trace_summary',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 3,
              at: '2024-01-01T14:31:03Z',
              category: 'progress',
              phase: 'end',
              status: 'success',
              name: 'run.summary',
              summary: 'Run success',
              details: { final_status: 'success', duration_ms: 4200 },
            },
          ]}
        />
      );

      const statusBadge = screen.getByTestId('notebook__message-run-status');
      expect(statusBadge).toHaveTextContent(/trace_status_success/);
      const toggle = screen.getByTestId('notebook__message-trace-toggle');
      expect(toggle).toHaveTextContent(/trace_view/);
      expect(toggle).not.toHaveTextContent(/4s/);
    });

    it('shows interrupted-stopped when cancelled has no later success event', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_cancel_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'lifecycle',
              phase: 'end',
              status: 'cancelled',
              name: 'run.lifecycle',
              summary: 'Run cancelled by server',
              details: { run_phase: 'cancelled' },
            },
            {
              id: 'trace_summary_cancelled',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'end',
              status: 'cancelled',
              name: 'run.summary',
              summary: 'Run cancelled',
              details: { final_status: 'cancelled', duration_ms: 1000 },
            },
          ]}
        />
      );

      const statusBadge = screen.getByTestId('notebook__message-run-status');
      expect(statusBadge).toHaveTextContent(/trace_status_cancelled/);
      expect(screen.getByTestId('notebook__message-run-reason')).toHaveTextContent(
        /trace_cancel_reason_user_stopped/,
      );
    });

    it('shows interrupted-ended when success arrives after cancelled trace', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_cancel_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'lifecycle',
              phase: 'end',
              status: 'cancelled',
              name: 'run.lifecycle',
              summary: 'Run cancelled by server',
              details: { run_phase: 'cancelled' },
            },
            {
              id: 'trace_success_2',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'end',
              status: 'success',
              name: 'run.summary',
              summary: 'Run success',
              details: { final_status: 'success', duration_ms: 1000 },
            },
          ]}
        />
      );

      const statusBadge = screen.getByTestId('notebook__message-run-status');
      expect(statusBadge).toHaveTextContent(/trace_status_cancelled/);
      expect(screen.getByTestId('notebook__message-run-reason')).toHaveTextContent(
        /trace_cancel_reason_user_ended/,
      );
    });

    it('shows cancel reason inside trace panel when expanded', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_cancel_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'lifecycle',
              phase: 'end',
              status: 'cancelled',
              name: 'run.lifecycle',
              summary: 'Run cancelled by server',
              details: { run_phase: 'cancelled' },
            },
            {
              id: 'trace_success_2',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 2,
              at: '2024-01-01T14:31:01Z',
              category: 'progress',
              phase: 'end',
              status: 'success',
              name: 'run.summary',
              summary: 'Run success',
              details: { final_status: 'success', duration_ms: 1000 },
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      expect(screen.getByTestId('notebook__message-trace-cancel-reason')).toHaveTextContent(
        /trace_cancel_reason_user_ended/,
      );
    });

    it('keeps running status before run summary arrives for cancelled lifecycle', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'trace_cancel_only',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 1,
              at: '2024-01-01T14:31:00Z',
              category: 'lifecycle',
              phase: 'end',
              status: 'cancelled',
              name: 'run.lifecycle',
              summary: 'Run cancelled by server',
              details: { run_phase: 'cancelled' },
            },
          ]}
        />
      );

      const statusBadge = screen.getByTestId('notebook__message-run-status');
      expect(statusBadge).toHaveTextContent(/trace_status_running/);
      expect(statusBadge).not.toHaveTextContent(/trace_status_cancelled/);
    });

    it('shows trace toggle for agent messages even without a global execution visibility mode', () => {
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
          ]}
        />
      );

      expect(screen.getByTestId('notebook__message-run-status')).toBeInTheDocument();
      expect(screen.getByTestId('notebook__message-trace-toggle')).toBeInTheDocument();
    });

    it('surfaces transport recovery phases in timeline view', async () => {
      const user = userEvent.setup();
      render(
        <MessageItem
          message={mockAgentMessage}
          traceEvents={[
            {
              id: 'transport_1',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'transport',
              seq: 1000001,
              at: '2024-01-01T14:31:00Z',
              category: 'debug',
              phase: 'start',
              status: 'running',
              name: 'transport.gap_fill',
              summary: 'last_event_id=evt-42',
              details: {
                transport_kind: 'gap_fill',
                transport_phase: 'start',
              },
            },
            {
              id: 'transport_2',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'transport',
              seq: 1000002,
              at: '2024-01-01T14:31:02Z',
              category: 'debug',
              phase: 'end',
              status: 'success',
              name: 'transport.reconcile',
              summary: 'items=3',
              details: {
                transport_kind: 'reconcile',
                transport_phase: 'done',
              },
            },
          ]}
        />
      );

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));
      const transportSection = screen.getByTestId('notebook__message-trace-transport');
      expect(transportSection).toBeInTheDocument();
      expect(screen.getAllByTestId('notebook__message-trace-transport-item')).toHaveLength(2);
      expect(screen.getByTestId('notebook__message-trace-toggle')).not.toHaveTextContent(/last_event_id=evt-42/);
      expect(within(transportSection).getByText(/last_event_id=evt-42/)).toBeInTheDocument();
      expect(within(transportSection).getByText(/items=3/)).toBeInTheDocument();
      expect(screen.getByTestId('notebook__message-trace-stats')).toHaveTextContent(/trace_stats_transport/);
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

  describe('Trace Failure Explainability', () => {
    it('shows unavailable trace explanation inside the trace panel', async () => {
      const user = userEvent.setup();
      renderComponent(mockAgentMessage, {
        traceError: {
          kind: 'trace_unavailable',
          message: 'Task trace stream has not been persisted for this run.',
        },
      });

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));

      const panel = screen.getByTestId('notebook__message-trace-error');
      expect(panel).toHaveTextContent('Trace details unavailable');
      expect(panel).toHaveTextContent('Task trace stream has not been persisted for this run.');
    });

    it('shows forbidden trace explanation inside the trace panel', async () => {
      const user = userEvent.setup();
      renderComponent(mockAgentMessage, {
        traceError: {
          kind: 'trace_forbidden',
          message: 'The current session cannot read task trace details.',
        },
      });

      await user.click(screen.getByTestId('notebook__message-trace-toggle'));

      const panel = screen.getByTestId('notebook__message-trace-error');
      expect(panel).toHaveTextContent('Trace access denied');
      expect(panel).toHaveTextContent('The current session cannot read task trace details.');
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
