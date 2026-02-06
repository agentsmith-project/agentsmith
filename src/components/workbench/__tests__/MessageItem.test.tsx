/**
 * Tests for MessageItem component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageItem } from '../MessageItem';
import type { RecipeMessage } from '@/lib/types/recipe';

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
    };
    return translations[key] || key;
  },
}));

describe('MessageItem', () => {
  const mockUserMessage: RecipeMessage = {
    id: 'msg-1',
    recipe_id: 'recipe-1',
    role: 'user',
    content: 'Hello, this is a user message',
    created_at: '2024-01-01T14:30:00Z',
  };

  const mockAgentMessage: RecipeMessage = {
    id: 'msg-2',
    recipe_id: 'recipe-1',
    role: 'agent',
    content: 'Hello, this is an agent response with **markdown** support',
    created_at: '2024-01-01T14:31:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    global.navigator.clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined),
      readText: vi.fn(),
    } as any;
  });

  const renderComponent = (message: RecipeMessage, props = {}) => {
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

    it('shows placeholder when streaming content is empty string', () => {
      render(
        <MessageItem
          message={mockAgentMessage}
          streamingContent="   "
        />
      );

      expect(screen.getByTestId('markdown-content')).toHaveTextContent('…');
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

      expect(global.navigator.clipboard.writeText).toHaveBeenCalledWith('Hello, this is a user message');
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

      global.navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('Copy failed'));

      renderComponent(mockUserMessage);

      const copyButton = screen.getByTitle('Copy');
      await user.click(copyButton);

      expect(toast.error).toHaveBeenCalledWith('Failed to copy');
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
    it('displays formatted time for message', () => {
      renderComponent(mockUserMessage);

      const timeElement = screen.getByText(/14:30/);
      expect(timeElement).toBeInTheDocument();
    });

    it('formats time correctly', () => {
      const message: RecipeMessage = {
        ...mockUserMessage,
        created_at: '2024-01-01T09:05:00Z',
      };

      renderComponent(message);

      const timeElement = screen.getByText(/09:05/);
      expect(timeElement).toBeInTheDocument();
    });

    it('handles different time formats', () => {
      const message: RecipeMessage = {
        ...mockUserMessage,
        created_at: '2024-12-31T23:59:00Z',
      };

      renderComponent(message);

      const timeElement = screen.getByText(/23:59/);
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

      expect(screen.getByTestId('markdown-content')).toHaveTextContent(/markdown support/);
    });

    it('renders markdown content correctly', () => {
      const messageWithMarkdown: RecipeMessage = {
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
      const emptyMessage: RecipeMessage = {
        ...mockUserMessage,
        content: '',
      };

      renderComponent(emptyMessage);

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    });

    it('handles very long messages', () => {
      const longContent = 'a'.repeat(10000);
      const longMessage: RecipeMessage = {
        ...mockUserMessage,
        content: longContent,
      };

      renderComponent(longMessage);

      expect(screen.getByTestId('markdown-content')).toHaveTextContent(longContent.substring(0, 100));
    });

    it('handles special characters in content', () => {
      const specialMessage: RecipeMessage = {
        ...mockUserMessage,
        content: 'Special chars: < > & " \' \n\t',
      };

      renderComponent(specialMessage);

      expect(screen.getByTestId('markdown-content')).toBeInTheDocument();
    });
  });
});
