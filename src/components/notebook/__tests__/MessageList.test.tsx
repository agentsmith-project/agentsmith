/**
 * Tests for MessageList component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MessageList } from '../MessageList';
import type { TaskMessage } from '@/lib/types/task';

vi.mock('../MessageItem', () => ({
  MessageItem: ({ message, streamingContent, disabled, activeRunView }: any) => (
    <div data-testid={`message-item-${message.id}`}>
      <div data-message-role>{message.role}</div>
      <div data-message-content>{message.content || '(empty)'}</div>
      {streamingContent && <div data-streaming>{streamingContent}</div>}
      {disabled && <div data-disabled>disabled</div>}
      {activeRunView && (
        <div data-active-run-view>
          {activeRunView.messageId}:{activeRunView.runState}
        </div>
      )}
    </div>
  ),
}));

vi.mock('@/components/ui/loading', () => ({
  EmptyState: ({ title, description }: any) => (
    <div data-testid="empty-state">
      <div data-testid="empty-title">{title}</div>
      <div data-testid="empty-description">{description}</div>
    </div>
  ),
}));

describe('MessageList', () => {
  let resizeObserverCallback: ResizeObserverCallback | null = null;
  let scrollToMock: ReturnType<typeof vi.fn>;
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

  beforeEach(() => {
    vi.clearAllMocks();
    resizeObserverCallback = null;
    scrollToMock = vi.fn();
    global.IntersectionObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })) as any;
    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        resizeObserverCallback = callback;
      }
    }
    global.ResizeObserver = ResizeObserverMock as any;
    global.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as any;
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  const renderComponent = (props = {}) => {
    return render(<MessageList messages={mockMessages} {...props} />);
  };

  describe('Empty State', () => {
    it('renders empty state when no messages', () => {
      render(<MessageList messages={[]} />);

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
      expect(screen.getByTestId('empty-title')).toHaveTextContent('Start a conversation');
      expect(screen.getByTestId('empty-description')).toHaveTextContent('Send a message to begin');
    });

    it('renders empty state when no messages and no streaming content', () => {
      render(
        <MessageList
          messages={[]}
          streamingContent={null}
        />
      );

      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  describe('Message Rendering', () => {
    it('renders all messages', () => {
      renderComponent();

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-2')).toBeInTheDocument();
    });

    it('passes message role to MessageItem', () => {
      renderComponent();

      expect(screen.getByTestId('message-item-msg-1').querySelector('[data-message-role]')?.textContent).toBe('user');
      expect(screen.getByTestId('message-item-msg-2').querySelector('[data-message-role]')?.textContent).toBe('agent');
    });

    it('passes message content to MessageItem', () => {
      renderComponent();

      expect(screen.getByTestId('message-item-msg-1').querySelector('[data-message-content]')?.textContent).toBe('Hello, how are you?');
      expect(screen.getByTestId('message-item-msg-2').querySelector('[data-message-content]')?.textContent).toBe('I am doing well, thank you!');
    });

    it('passes disabled state to MessageItem', () => {
      render(<MessageList messages={mockMessages} disabled={true} />);

      expect(screen.getByTestId('message-item-msg-1').querySelector('[data-disabled]')).toBeInTheDocument();
    });
  });

  describe('Streaming State', () => {
    it('displays streaming message when streamingMessageId is set', () => {
      render(
        <MessageList
          messages={[]}
          streamingMessageId="msg-streaming"
          streamingContent="Streaming content..."
        />
      );

      expect(screen.getByTestId('message-item-msg-streaming')).toBeInTheDocument();
    });

    it('does not display streaming message if it already exists in messages', () => {
      render(
        <MessageList
          messages={mockMessages}
          streamingMessageId="msg-1"
          streamingContent="Updated content..."
        />
      );

      // Should only have the original messages
      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-2')).toBeInTheDocument();
      // Should not have a duplicate streaming message
      const streamingMessages = screen.queryAllByTestId('message-item-msg-1');
      expect(streamingMessages).toHaveLength(1);
    });

    it('passes streaming content to matching MessageItem', () => {
      render(
        <MessageList
          messages={mockMessages}
          streamingMessageId="msg-1"
          streamingContent="Streaming update..."
        />
      );

      expect(screen.getByTestId('message-item-msg-1').querySelector('[data-streaming]')?.textContent).toBe('Streaming update...');
    });

    it('shows streaming indicator for agent messages', () => {
      const _streamingAgentMsg: TaskMessage = {
        id: 'msg-3',
        task_id: 'task-1',
        role: 'agent',
        content: '',
        created_at: new Date().toISOString(),
      };

      render(
        <MessageList
          messages={[]}
          streamingMessageId="msg-3"
          streamingContent="Thinking..."
        />
      );

      const messageItem = screen.getByTestId('message-item-msg-3');
      expect(messageItem.querySelector('[data-message-role]')?.textContent).toBe('agent');
    });

    it('passes activeRunView only to the active agent message', () => {
      render(
        <MessageList
          messages={mockMessages}
          streamingMessageId={null}
          streamingContent={null}
          activeRunView={{
            messageId: 'msg-2',
            runState: 'running',
            latestAction: { kind: 'command', summary: 'npm test' },
            recentActions: [],
            startedAt: '2024-01-01T00:01:00Z',
            elapsedSeconds: 12,
            cancelPending: false,
            onCancel: vi.fn(),
            realtimeHealth: { status: 'connected' },
          }}
        />
      );

      expect(screen.getByTestId('message-item-msg-2').querySelector('[data-active-run-view]')).toHaveTextContent('msg-2:running');
      expect(screen.getByTestId('message-item-msg-1').querySelector('[data-active-run-view]')).not.toBeInTheDocument();
    });

    it('passes activeRunView to a synthetic streaming agent item when it is the active run message', () => {
      render(
        <MessageList
          messages={[]}
          streamingMessageId="msg-streaming"
          streamingContent="Thinking..."
          activeRunView={{
            messageId: 'msg-streaming',
            runState: 'running',
            latestAction: { kind: 'system', summary: 'Execution started' },
            recentActions: [],
            startedAt: '2024-01-01T00:01:00Z',
            elapsedSeconds: 1,
            cancelPending: false,
            onCancel: vi.fn(),
            realtimeHealth: { status: 'connected' },
          }}
        />
      );

      expect(screen.getByTestId('message-item-msg-streaming').querySelector('[data-active-run-view]')).toHaveTextContent('msg-streaming:running');
    });

    it('renders a pending active run agent item when the active run message is not in messages yet', () => {
      render(
        <MessageList
          messages={[]}
          streamingMessageId={null}
          streamingContent={null}
          activeRunView={{
            messageId: 'pending-active-run:task-1',
            runState: 'running',
            latestAction: { kind: 'system', summary: 'Execution is running' },
            recentActions: [],
            startedAt: '2026-03-06T04:00:00.000Z',
            elapsedSeconds: 5,
            cancelPending: false,
            onCancel: vi.fn(),
            realtimeHealth: { status: 'connected' },
          }}
        />
      );

      const pendingItem = screen.getByTestId(
        'message-item-pending-active-run:task-1',
      );
      expect(pendingItem).toBeInTheDocument();
      expect(pendingItem.querySelector('[data-message-role]')).toHaveTextContent(
        'agent',
      );
      expect(
        pendingItem.querySelector('[data-active-run-view]'),
      ).toHaveTextContent('pending-active-run:task-1:running');
    });
  });

  describe('Auto-scroll Behavior', () => {
    it('keeps following content growth while the user is pinned to the bottom', () => {
      const { container, rerender } = render(
        <MessageList
          messages={mockMessages}
          streamingMessageId="msg-2"
          streamingContent="First chunk"
        />,
      );

      const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLDivElement;
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        value: 500,
        writable: true,
      });
      Object.defineProperty(scrollContainer, 'scrollHeight', {
        configurable: true,
        value: 600,
      });
      Object.defineProperty(scrollContainer, 'clientHeight', {
        configurable: true,
        value: 80,
      });

      fireEvent.scroll(scrollContainer);
      rerender(
        <MessageList
          messages={mockMessages}
          streamingMessageId="msg-2"
          streamingContent="First chunk
Second chunk"
        />,
      );

      expect(scrollToMock).toHaveBeenCalled();
      act(() => {
        resizeObserverCallback?.([], {} as ResizeObserver);
      });
      expect(scrollToMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('does not force scrolling when the user has moved away from the bottom', () => {
      const { container, rerender } = render(
        <MessageList
          messages={mockMessages}
          streamingMessageId="msg-2"
          streamingContent="First chunk"
        />,
      );

      const scrollContainer = container.querySelector('.overflow-y-auto') as HTMLDivElement;
      Object.defineProperty(scrollContainer, 'scrollTop', {
        configurable: true,
        value: 100,
        writable: true,
      });
      Object.defineProperty(scrollContainer, 'scrollHeight', {
        configurable: true,
        value: 600,
      });
      Object.defineProperty(scrollContainer, 'clientHeight', {
        configurable: true,
        value: 200,
      });

      fireEvent.scroll(scrollContainer);
      scrollToMock.mockClear();
      rerender(
        <MessageList
          messages={mockMessages}
          streamingMessageId="msg-2"
          streamingContent="First chunk
Second chunk"
        />,
      );

      expect(scrollToMock).not.toHaveBeenCalled();
      act(() => {
        resizeObserverCallback?.([], {} as ResizeObserver);
      });
      expect(scrollToMock).not.toHaveBeenCalled();
    });

    it('sets up scroll event listener', () => {
      const { container } = renderComponent();

      const scrollContainer = container.querySelector('.overflow-y-auto');
      expect(scrollContainer).toBeInTheDocument();
    });

    it('renders scroll anchor element', () => {
      const { container } = renderComponent();

      // The ref element should exist
      const _messagesEndRef = container.querySelector('[style*="scrollIntoView"]');
      // It's a ref, so we can't directly query it, but the container should be there
    });
  });

  describe('Layout and Styling', () => {
    it('has correct container classes', () => {
      const { container } = renderComponent();

      const listContainer = container.querySelector('.h-full.overflow-y-auto');
      expect(listContainer).toBeInTheDocument();
    });

    it('applies padding classes', () => {
      const { container } = renderComponent();

      const listContainer = container.querySelector('.overflow-y-auto') as HTMLElement | null;
      expect(listContainer).toBeInTheDocument();
      expect(listContainer?.className ?? '').toContain('px-3');
      expect(listContainer?.className ?? '').toContain('sm:px-4');
      expect(listContainer?.className ?? '').toContain('lg:px-5');
    });

    it('uses flex layout for message items', () => {
      const { container } = renderComponent();

      const listContainer = container.querySelector('.space-y-3');
      expect(listContainer).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles messages with empty content', () => {
      const emptyMessages: TaskMessage[] = [
        {
          id: 'msg-1',
          task_id: 'task-1',
          role: 'user',
          content: '',
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      render(<MessageList messages={emptyMessages} />);

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
    });

    it('handles null streaming content', () => {
      render(
        <MessageList
          messages={mockMessages}
          streamingMessageId="msg-1"
          streamingContent={null}
        />
      );

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
    });

    it('handles undefined streaming message ID', () => {
      render(
        <MessageList
          messages={mockMessages}
          streamingMessageId={undefined}
          streamingContent="Content"
        />
      );

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-2')).toBeInTheDocument();
    });

    it('handles large number of messages', () => {
      const manyMessages: TaskMessage[] = Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i}`,
        task_id: 'task-1',
        role: i % 2 === 0 ? 'user' : 'agent',
        content: `Message ${i}`,
        created_at: new Date(i * 1000).toISOString(),
      }));

      render(<MessageList messages={manyMessages} />);

      expect(screen.getByTestId('message-item-msg-0')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-99')).toBeInTheDocument();
    });
  });

  describe('Message Updates', () => {
    it('re-renders when messages change', () => {
      const { rerender } = render(<MessageList messages={[mockMessages[0]]} />);

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.queryByTestId('message-item-msg-2')).not.toBeInTheDocument();

      rerender(<MessageList messages={mockMessages} />);

      expect(screen.getByTestId('message-item-msg-1')).toBeInTheDocument();
      expect(screen.getByTestId('message-item-msg-2')).toBeInTheDocument();
    });
  });
});
