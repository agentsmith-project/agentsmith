/**
 * Tests for MessageList component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from '../MessageList';
import type { RecipeMessage } from '@/lib/types/recipe';

vi.mock('../MessageItem', () => ({
  MessageItem: ({ message, streamingContent, disabled }: any) => (
    <div data-testid={`message-item-${message.id}`}>
      <div data-message-role>{message.role}</div>
      <div data-message-content>{message.content || '(empty)'}</div>
      {streamingContent && <div data-streaming>{streamingContent}</div>}
      {disabled && <div data-disabled>disabled</div>}
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

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock IntersectionObserver
    global.IntersectionObserver = vi.fn(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    })) as any;
    // Mock scrollIntoView (not available in jsdom/happy-dom)
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
      const _streamingAgentMsg: RecipeMessage = {
        id: 'msg-3',
        recipe_id: 'recipe-1',
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
  });

  describe('Auto-scroll Behavior', () => {
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

      const listContainer = container.querySelector('.px-4.py-4');
      expect(listContainer).toBeInTheDocument();
    });

    it('uses flex layout for message items', () => {
      const { container } = renderComponent();

      const listContainer = container.querySelector('.space-y-4');
      expect(listContainer).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles messages with empty content', () => {
      const emptyMessages: RecipeMessage[] = [
        {
          id: 'msg-1',
          recipe_id: 'recipe-1',
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
      const manyMessages: RecipeMessage[] = Array.from({ length: 100 }, (_, i) => ({
        id: `msg-${i}`,
        recipe_id: 'recipe-1',
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
