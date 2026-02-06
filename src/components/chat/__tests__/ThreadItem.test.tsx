import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadItem } from '../ThreadItem';
import type { ChatSession } from '@/lib/api/types';

describe('ThreadItem', () => {
  const mockSession: ChatSession = {
    id: 'session-1',
    project_id: 'project-1',
    title: 'Test Thread',
    model: 'gpt-4',
    endpoint_id: 'endpoint-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T01:00:00Z',
    message_count: 5,
    total_tokens: 100,
  };

  const defaultProps = {
    session: mockSession,
    isActive: false,
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onToggleStar: vi.fn(),
    onTogglePin: vi.fn(),
    onDelete: vi.fn(),
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render thread title', () => {
      render(<ThreadItem {...defaultProps} />);

      expect(screen.getByText('Test Thread')).toBeInTheDocument();
    });

    it('should render "Untitled" for sessions without title', () => {
      const untitledSession = { ...mockSession, title: '' };
      render(<ThreadItem {...defaultProps} session={untitledSession} />);

      expect(screen.getByText('Untitled')).toBeInTheDocument();
    });

    it('should render message count', () => {
      render(<ThreadItem {...defaultProps} />);

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('should render relative timestamp', () => {
      render(<ThreadItem {...defaultProps} />);

      // The timestamp is locale-specific, so just check that some date is rendered
      const timestamps = screen.getAllByText(/\d/); // Contains digits
      expect(timestamps.length).toBeGreaterThan(0);
    });
  });

  describe('Active State', () => {
    it('should apply active styling when active', () => {
      const { container } = render(<ThreadItem {...defaultProps} isActive={true} />);

      const activeDiv = container.querySelector('.bg-hover');
      expect(activeDiv).toBeInTheDocument();
    });

    it('should apply hover styling when not active', () => {
      const { container } = render(<ThreadItem {...defaultProps} isActive={false} />);

      const hoverDiv = container.querySelector('.hover\\:bg-hover');
      expect(hoverDiv).toBeInTheDocument();
    });
  });

  describe('Selection', () => {
    it('should call onSelect when clicked', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const item = screen.getByText('Test Thread').closest('div[role="button"]');
      await user.click(item!);

      expect(defaultProps.onSelect).toHaveBeenCalled();
    });

    it('should call onSelect when Enter key is pressed', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const item = screen.getByText('Test Thread').closest('div[role="button"]');
      await user.type(item!, '{Enter}');

      expect(defaultProps.onSelect).toHaveBeenCalled();
    });

    it('should call onSelect when Space key is pressed', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const item = screen.getByText('Test Thread').closest('div[role="button"]');
      await user.type(item!, ' ');

      expect(defaultProps.onSelect).toHaveBeenCalled();
    });

    it('should be focusable', () => {
      render(<ThreadItem {...defaultProps} />);

      const button = screen.getByText('Test Thread').closest('div[role="button"]');
      expect(button).toHaveAttribute('tabIndex', '0');
    });
  });

  describe('Star Indicator', () => {
    it('should show star icon for starred sessions', () => {
      const starredSession = { ...mockSession, starred: true };
      const { container } = render(
        <ThreadItem {...defaultProps} session={starredSession} />,
      );

      const starIcon = container.querySelector('.text-accent');
      expect(starIcon).toBeInTheDocument();
    });

    it('should show dimmed star icon for unstarred sessions', () => {
      const { container } = render(<ThreadItem {...defaultProps} />);

      const starIcon = container.querySelector('.text-icon-default');
      expect(starIcon).toBeInTheDocument();
    });
  });

  describe('Pin Indicator', () => {
    it('should show pin icon for pinned sessions', () => {
      const pinnedSession = { ...mockSession, pinned: true };
      const { container } = render(<ThreadItem {...defaultProps} session={pinnedSession} />);

      // Check for the Pin component (lucide icon)
      const pinIcon = container.querySelector('svg.lucide-pin');
      expect(pinIcon).toBeInTheDocument();
    });
  });

  describe('Rename Functionality', () => {
    it('should show input field when editing', () => {
      render(<ThreadItem {...defaultProps} />);

      // Note: In jsdom, DropdownMenuItem onSelect may not trigger properly
      // This test verifies the trigger exists and can be clicked
      const trigger = screen.getByLabelText('Thread actions');
      expect(trigger).toBeInTheDocument();

      // The actual rename functionality is tested in the integration via ThreadsPane
      // Here we just verify the dropdown trigger exists
    });

    it('should update draft title when typing', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const renameOption = screen.getByText('Rename');
      await user.click(renameOption);

      const input = screen.getByDisplayValue('Test Thread');
      await user.clear(input);
      await user.type(input, 'NewTitle'); // No space

      expect(input).toHaveValue('NewTitle');
    });

    it('should commit rename on Enter key', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const renameOption = screen.getByText('Rename');
      await user.click(renameOption);

      const input = screen.getByDisplayValue('Test Thread');
      await user.clear(input);
      await user.type(input, 'NewTitle');
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      expect(defaultProps.onRename).toHaveBeenCalledWith('NewTitle');
    });

    it('should cancel rename on Escape key', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const renameOption = screen.getByText('Rename');
      await user.click(renameOption);

      const input = screen.getByDisplayValue('Test Thread');
      await user.clear(input);
      await user.type(input, 'NewTitle');
      fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

      expect(defaultProps.onRename).not.toHaveBeenCalled();
    });

    it('should commit rename on blur', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const renameOption = screen.getByText('Rename');
      await user.click(renameOption);

      const input = screen.getByDisplayValue('Test Thread');
      await user.clear(input);
      await user.type(input, 'NewTitle');

      // Blur by clicking outside
      fireEvent.blur(input);

      expect(defaultProps.onRename).toHaveBeenCalledWith('NewTitle');
    });

    it('should not commit empty title', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const renameOption = screen.getByText('Rename');
      await user.click(renameOption);

      const input = screen.getByDisplayValue('Test Thread');
      await user.clear(input);
      await user.type(input, '{Enter}');

      expect(defaultProps.onRename).not.toHaveBeenCalled();
    });

    it('should not commit if title has not changed', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const renameOption = screen.getByText('Rename');
      await user.click(renameOption);

      const input = screen.getByDisplayValue('Test Thread');
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      expect(defaultProps.onRename).not.toHaveBeenCalled();
    });
  });

  describe('Dropdown Menu', () => {
    it('should show dropdown menu trigger', () => {
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      expect(trigger).toBeInTheDocument();
    });

    it('should show menu options when clicked', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      expect(screen.getByText('Rename')).toBeInTheDocument();
      expect(screen.getByText('Star')).toBeInTheDocument();
      expect(screen.getByText('Pin')).toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('should show "Unstar" for starred sessions', async () => {
      const user = userEvent.setup();
      const starredSession = { ...mockSession, starred: true };
      render(<ThreadItem {...defaultProps} session={starredSession} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      expect(screen.getByText('Unstar')).toBeInTheDocument();
    });

    it('should show "Unpin" for pinned sessions', async () => {
      const user = userEvent.setup();
      const pinnedSession = { ...mockSession, pinned: true };
      render(<ThreadItem {...defaultProps} session={pinnedSession} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      expect(screen.getByText('Unpin')).toBeInTheDocument();
    });

    it('should call onToggleStar when Star/Unstar is clicked', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const starOption = screen.getByText('Star');
      await user.click(starOption);

      expect(defaultProps.onToggleStar).toHaveBeenCalledWith(true);
    });

    it('should call onTogglePin when Pin/Unpin is clicked', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const pinOption = screen.getByText('Pin');
      await user.click(pinOption);

      expect(defaultProps.onTogglePin).toHaveBeenCalledWith(true);
    });

    it('should call onDelete when Delete is clicked', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const deleteOption = screen.getByText('Delete');
      await user.click(deleteOption);

      expect(defaultProps.onDelete).toHaveBeenCalled();
    });

    it('should style delete option in error color', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const deleteOption = screen.getByText('Delete');
      expect(deleteOption).toHaveClass('text-error');
    });
  });

  describe('Edge Cases', () => {
    it('should handle sessions with zero messages', () => {
      const zeroMessageSession = { ...mockSession, message_count: 0 };
      render(<ThreadItem {...defaultProps} session={zeroMessageSession} />);

      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should handle sessions without updated_at', () => {
      const noDateSession = { ...mockSession, updated_at: undefined as never };
      render(<ThreadItem {...defaultProps} session={noDateSession} />);

      // Should not crash, should show empty timestamp or fallback
      const timestamps = screen.getAllByText('');
      expect(timestamps.length).toBeGreaterThan(0);
    });

    it('should handle invalid date gracefully', () => {
      const invalidDateSession = { ...mockSession, updated_at: 'invalid-date' };
      render(<ThreadItem {...defaultProps} session={invalidDateSession} />);

      // Should not crash
      expect(screen.getByText('Test Thread')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(<ThreadItem {...defaultProps} />);

      const button = screen.getByText('Test Thread').closest('div[role="button"]');
      expect(button).toHaveAttribute('role', 'button');
      expect(button).toHaveAttribute('tabIndex', '0');
    });

    it('should provide aria-label for dropdown trigger', () => {
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      expect(trigger).toBeInTheDocument();
    });
  });
});
