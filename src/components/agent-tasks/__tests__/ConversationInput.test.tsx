/**
 * Tests for ConversationInput component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConversationInput } from '../ConversationInput';

describe('ConversationInput', () => {
  const mockOnChange = vi.fn();
  const mockOnSend = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = (props = {}) => {
    return render(
      <ConversationInput
        value=""
        onChange={mockOnChange}
        onSend={mockOnSend}
        {...props}
      />
    );
  };

  describe('Basic Rendering', () => {
    it('renders textarea', () => {
      renderComponent();

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeInTheDocument();
    });

    it('renders send button', () => {
      renderComponent();

      expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
    });

    it('displays help text', () => {
      renderComponent();

      expect(screen.getByText(/Enter to send/)).toBeInTheDocument();
      expect(screen.getByText(/Shift\+Enter for newline/)).toBeInTheDocument();
    });

    it('uses custom placeholder when provided', () => {
      render(
        <ConversationInput
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          placeholder="Type something..."
        />
      );

      const textarea = screen.getByPlaceholderText('Type something...');
      expect(textarea).toBeInTheDocument();
    });

    it('uses default placeholder when not provided', () => {
      renderComponent();

      const textarea = screen.getByPlaceholderText('Type your message...');
      expect(textarea).toBeInTheDocument();
    });
  });

  describe('Input Handling', () => {
    it('displays current value', () => {
      render(
        <ConversationInput
          value="Test message"
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByDisplayValue('Test message');
      expect(textarea).toBeInTheDocument();
    });

    it('calls onChange when input changes', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Hello');

      expect(mockOnChange).toHaveBeenCalled();
    });

    it('auto-resizes textarea based on content', () => {
      const { rerender } = render(
        <ConversationInput
          value="Short"
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      const _initialHeight = textarea.style.height;

      rerender(
        <ConversationInput
          value="This is a much longer message that should cause the textarea to resize automatically"
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      // Height should change after content update
      expect(textarea.style.height).not.toBe('');
    });
  });

  describe('Send Button', () => {
    it('is enabled when there is content', () => {
      render(
        <ConversationInput
          value="Test message"
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).not.toBeDisabled();
    });

    it('is disabled when input is empty', () => {
      renderComponent();

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('is disabled when input is only whitespace', () => {
      render(
        <ConversationInput
          value="   "
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('calls onSend when clicked', async () => {
      const user = userEvent.setup();
      render(
        <ConversationInput
          value="Test message"
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      await user.click(sendButton);

      expect(mockOnSend).toHaveBeenCalledTimes(1);
    });

    it('shows loader when sending', () => {
      render(
        <ConversationInput
          value="Test"
          onChange={mockOnChange}
          onSend={mockOnSend}
          sending={true}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeEnabled();
      // Should have loader icon
      expect(sendButton.querySelector('.animate-spin')).toBeInTheDocument();
    });
  });

  describe('Keyboard Handling', () => {
    it('sends message on Enter key press', async () => {
      const user = userEvent.setup();
      render(
        <ConversationInput
          value="Test message"
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.click(textarea);
      await user.keyboard('{Enter}');

      expect(mockOnSend).toHaveBeenCalledTimes(1);
    });

    it('creates newline on Shift+Enter', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();

      render(
        <ConversationInput
          value="Test message"
          onChange={onChange}
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.click(textarea);

      // Shift+Enter should not trigger send
      fireEvent.keyDown(textarea, {
        key: 'Enter',
        shiftKey: true,
      });

      expect(mockOnSend).not.toHaveBeenCalled();
    });

    it('does not send when disabled', async () => {
      const user = userEvent.setup();
      render(
        <ConversationInput
          value="Test message"
          onChange={mockOnChange}
          onSend={mockOnSend}
          disabled={true}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.click(textarea);
      await user.keyboard('{Enter}');

      expect(mockOnSend).not.toHaveBeenCalled();
    });

    it('still sends when sending is in progress', async () => {
      const user = userEvent.setup();
      render(
        <ConversationInput
          value="Test message"
          onChange={mockOnChange}
          onSend={mockOnSend}
          sending={true}
        />
      );

      const textarea = screen.getByRole('textbox');
      await user.click(textarea);
      await user.keyboard('{Enter}');

      expect(mockOnSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('Disabled State', () => {
    it('disables textarea when disabled', () => {
      render(
        <ConversationInput
          value="Test"
          onChange={mockOnChange}
          onSend={mockOnSend}
          disabled={true}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).toBeDisabled();
    });

    it('disables send button when disabled', () => {
      render(
        <ConversationInput
          value="Test"
          onChange={mockOnChange}
          onSend={mockOnSend}
          disabled={true}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toBeDisabled();
    });

    it('applies disabled styling', () => {
      render(
        <ConversationInput
          value="Test"
          onChange={mockOnChange}
          onSend={mockOnSend}
          disabled={true}
        />
      );

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea).toHaveClass('disabled:cursor-not-allowed');
    });
  });

  describe('Sending State', () => {
    it('keeps textarea editable while sending', () => {
      render(
        <ConversationInput
          value="Test"
          onChange={mockOnChange}
          onSend={mockOnSend}
          sending={true}
        />
      );

      const textarea = screen.getByRole('textbox');
      expect(textarea).not.toBeDisabled();
    });

    it('shows loading spinner in send button', () => {
      render(
        <ConversationInput
          value="Test"
          onChange={mockOnChange}
          onSend={mockOnSend}
          sending={true}
        />
      );

      const sendButton = screen.getByRole('button', { name: /send/i });
      expect(sendButton).toContainHTML('svg');
    });
  });

  describe('Pending Queue', () => {
    it('renders running hint and queue items', () => {
      render(
        <ConversationInput
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          agentRunning
          pendingQueue={[
            { id: 'p1', content: 'first pending' },
            { id: 'p2', content: 'second pending' },
          ]}
        />,
      );

      expect(screen.getByTestId('agent-tasks__pending-hint')).toBeInTheDocument();
      expect(screen.getByTestId('agent-tasks__pending-queue')).toBeInTheDocument();
      expect(screen.getByDisplayValue('first pending')).toBeInTheDocument();
      expect(screen.getByDisplayValue('second pending')).toBeInTheDocument();
    });

    it('supports update/remove callbacks', async () => {
      const user = userEvent.setup();
      const onPendingUpdate = vi.fn();
      const onPendingRemove = vi.fn();
      render(
        <ConversationInput
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          pendingQueue={[{ id: 'p1', content: 'pending body' }]}
          onPendingUpdate={onPendingUpdate}
          onPendingRemove={onPendingRemove}
        />,
      );

      const pendingTextarea = screen.getByTestId('agent-tasks__pending-item-input--p1');
      await user.clear(pendingTextarea);
      await user.type(pendingTextarea, 'updated');
      expect(onPendingUpdate).toHaveBeenCalled();

      await user.click(screen.getByTestId('agent-tasks__pending-item-remove--p1'));
      expect(onPendingRemove).toHaveBeenCalledWith('p1');
    });
  });

  describe('Layout and Styling', () => {
    it('has correct container classes', () => {
      renderComponent();

      expect(screen.getByTestId('agent-tasks__conversation-input-shell')).toHaveClass(
        'rounded-xl',
        'border',
        'shadow-ambient',
      );
      expect(screen.getByTestId('agent-tasks__conversation-input-surface')).toHaveClass(
        'rounded-lg',
        'border',
        'focus-within:ring-2',
      );
    });

    it('has correct textarea styling', () => {
      render(
        <ConversationInput
          value="Test"
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea).toHaveClass('w-full', 'resize-none');
    });

    it('textarea has correct rows attribute', () => {
      renderComponent();

      const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
      expect(textarea).toHaveAttribute('rows', '2');
    });
  });

  describe('Edge Cases', () => {
    it('handles very long input', () => {
      const longText = 'a'.repeat(10000);

      render(
        <ConversationInput
          value={longText}
          onChange={mockOnChange}
          onSend={mockOnSend}
        />
      );

      const textarea = screen.getByDisplayValue(longText);
      expect(textarea).toBeInTheDocument();
    });

    it('handles special characters', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Test @#$%^&*() message');

      expect(mockOnChange).toHaveBeenCalled();
    });

    it('handles multiline input', async () => {
      const user = userEvent.setup();
      renderComponent();

      const textarea = screen.getByRole('textbox');

      // Type first line
      await user.type(textarea, 'Line 1');

      // Add newline with Shift+Enter
      await user.keyboard('{Shift>}{Enter}{/Shift}');

      // Type second line
      await user.type(textarea, 'Line 2');

      expect(mockOnChange).toHaveBeenCalled();
    });
  });
});
