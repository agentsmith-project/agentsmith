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
    isStreaming: false,
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

    it('should render compact meta info (age and message count)', () => {
      render(<ThreadItem {...defaultProps} />);

      expect(screen.getByText('5')).toBeInTheDocument();
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
  });

  describe('Status Icons', () => {
    it('should show star icon for starred sessions', () => {
      const starredSession = { ...mockSession, starred: true };
      const { container } = render(<ThreadItem {...defaultProps} session={starredSession} />);

      const starIcon = container.querySelector('svg.lucide-star');
      expect(starIcon).toBeInTheDocument();
    });

    it('should hide star icon for unstarred sessions', () => {
      const { container } = render(<ThreadItem {...defaultProps} />);

      const starIcon = container.querySelector('svg.lucide-star');
      expect(starIcon).not.toBeInTheDocument();
    });

    it('should show pin icon for pinned sessions', () => {
      const pinnedSession = { ...mockSession, pinned: true };
      const { container } = render(<ThreadItem {...defaultProps} session={pinnedSession} />);

      const pinIcon = container.querySelector('svg.lucide-pin');
      expect(pinIcon).toBeInTheDocument();
    });

    it('should show streaming status icon when streaming', () => {
      render(<ThreadItem {...defaultProps} isStreaming={true} />);

      const indicator = screen.getByTestId('chat__thread-streaming-indicator');
      expect(indicator).toBeInTheDocument();
      expect(indicator).toHaveAttribute('title', 'Generating');
    });
  });

  describe('Rename Functionality', () => {
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
  });

  describe('Dropdown Menu', () => {
    it('should call onToggleStar when Star is clicked', async () => {
      const user = userEvent.setup();
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      await user.click(trigger);

      const starOption = screen.getByText('Star');
      await user.click(starOption);

      expect(defaultProps.onToggleStar).toHaveBeenCalledWith(true);
    });

    it('should call onTogglePin when Pin is clicked', async () => {
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
  });

  describe('Accessibility', () => {
    it('should provide aria-label for dropdown trigger', () => {
      render(<ThreadItem {...defaultProps} />);

      const trigger = screen.getByLabelText('Thread actions');
      expect(trigger).toBeInTheDocument();
    });
  });
});
