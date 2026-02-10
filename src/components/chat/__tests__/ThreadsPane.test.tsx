import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadsPane } from '../ThreadsPane';
import type { ChatSession } from '@/lib/api/types';

// Mock react-virtuoso
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: {
    data: unknown[];
    itemContent: (index: number, item: unknown) => React.ReactNode;
  }) => (
    <div data-testid="virtuoso-list">
      {data.map((item, index) => (
        <div key={index} data-testid={`virtuoso-item-${index}`}>
          {itemContent(index, item)}
        </div>
      ))}
    </div>
  ),
}));

const mockSessions: ChatSession[] = [
  {
    id: 'session-1',
    project_id: 'project-1',
    title: 'Thread 1',
    model: 'gpt-4',
    endpoint_id: 'endpoint-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T01:00:00Z',
    message_count: 5,
    total_tokens: 100,
  },
  {
    id: 'session-2',
    project_id: 'project-1',
    title: 'Thread 2',
    model: 'gpt-4',
    endpoint_id: 'endpoint-1',
    created_at: '2024-01-01T02:00:00Z',
    updated_at: '2024-01-01T03:00:00Z',
    message_count: 3,
    total_tokens: 50,
    starred: true,
  },
  {
    id: 'session-3',
    project_id: 'project-1',
    title: 'Another Thread',
    model: 'gpt-4',
    endpoint_id: 'endpoint-1',
    created_at: '2024-01-01T04:00:00Z',
    updated_at: '2024-01-01T05:00:00Z',
    message_count: 7,
    total_tokens: 150,
    pinned: true,
  },
];

const defaultProps = {
  sessions: mockSessions,
  activeSessionId: null,
  searchQuery: '',
  onSearchQueryChange: vi.fn(),
  onSelect: vi.fn(),
  onRename: vi.fn(),
  onToggleStar: vi.fn(),
  onTogglePin: vi.fn(),
  onDelete: vi.fn(),
  onCreate: vi.fn(),
  streamingSessionIds: [],
  canCreate: true,
  createPending: false,
  isLoading: false,
};

describe('ThreadsPane', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render all sessions', () => {
      render(<ThreadsPane {...defaultProps} />);

      expect(screen.getByText('Thread 1')).toBeInTheDocument();
      expect(screen.getByText('Thread 2')).toBeInTheDocument();
      expect(screen.getByText('Another Thread')).toBeInTheDocument();
    });

    it('should render search input', () => {
      render(<ThreadsPane {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('search_threads_placeholder');
      expect(searchInput).toBeInTheDocument();
    });

    it('should have data-testid attribute', () => {
      render(<ThreadsPane {...defaultProps} />);

      const pane = screen.getByTestId('chat__threads-pane');
      expect(pane).toBeInTheDocument();
    });

    it('should use a compact pane width', () => {
      render(<ThreadsPane {...defaultProps} />);

      const pane = screen.getByTestId('chat__threads-pane');
      expect(pane.className).toContain('w-[216px]');
      expect(pane.className).toContain('xl:w-[228px]');
      expect(pane.className).toContain('2xl:w-[240px]');
    });

    it('should use wider pane width in ultrawide mode', () => {
      render(<ThreadsPane {...defaultProps} layoutMode="ultrawide" />);

      const pane = screen.getByTestId('chat__threads-pane');
      expect(pane.className).toContain('w-[256px]');
      expect(pane.className).toContain('xl:w-[276px]');
      expect(pane.className).toContain('2xl:w-[296px]');
    });
  });

  describe('Loading State', () => {
    it('should show loading message when isLoading is true', () => {
      render(<ThreadsPane {...defaultProps} isLoading={true} />);

      expect(screen.getByText('loading')).toBeInTheDocument();
    });

    it('should not show sessions when loading', () => {
      render(<ThreadsPane {...defaultProps} isLoading={true} />);

      expect(screen.queryByText('Thread 1')).not.toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('should show "No threads" when sessions array is empty', () => {
      render(<ThreadsPane {...defaultProps} sessions={[]} />);

      expect(screen.getByText('no_threads')).toBeInTheDocument();
    });

    it('should show "No threads" when search returns no results', () => {
      render(<ThreadsPane {...defaultProps} searchQuery="nonexistent" />);

      expect(screen.getByText('no_threads')).toBeInTheDocument();
    });
  });

  describe('Search Functionality', () => {
    it('should filter sessions by search query', () => {
      render(<ThreadsPane {...defaultProps} searchQuery="Thread 1" />);

      expect(screen.getByText('Thread 1')).toBeInTheDocument();
      expect(screen.queryByText('Thread 2')).not.toBeInTheDocument();
      expect(screen.queryByText('Another Thread')).not.toBeInTheDocument();
    });

    it('should filter case-insensitively', () => {
      render(<ThreadsPane {...defaultProps} searchQuery="thread 2" />);

      expect(screen.getByText('Thread 2')).toBeInTheDocument();
      expect(screen.queryByText('Thread 1')).not.toBeInTheDocument();
    });

    it('should call onSearchQueryChange when typing', async () => {
      const user = userEvent.setup();
      render(<ThreadsPane {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('search_threads_placeholder');
      await user.type(searchInput, 'search');

      // Should be called for each character typed
      expect(defaultProps.onSearchQueryChange).toHaveBeenCalled();
    });

    it('should show all sessions when search is empty', () => {
      render(<ThreadsPane {...defaultProps} searchQuery="" />);

      expect(screen.getByText('Thread 1')).toBeInTheDocument();
      expect(screen.getByText('Thread 2')).toBeInTheDocument();
      expect(screen.getByText('Another Thread')).toBeInTheDocument();
    });

    it('should handle whitespace-only search', () => {
      render(<ThreadsPane {...defaultProps} searchQuery="   " />);

      // Should show all sessions since trimmed search is empty
      expect(screen.getByText('Thread 1')).toBeInTheDocument();
      expect(screen.getByText('Thread 2')).toBeInTheDocument();
      expect(screen.getByText('Another Thread')).toBeInTheDocument();
    });
  });

  describe('Sorting', () => {
    it('should sort starred sessions first', () => {
      const { container } = render(<ThreadsPane {...defaultProps} searchQuery="" />);

      // Thread 2 (starred) should appear before non-starred threads
      const items = container.querySelectorAll('[data-testid^="virtuoso-item-"]');
      const firstItemText = items[0]?.textContent || '';

      // First item should contain Thread 2 which is starred
      expect(firstItemText).toContain('Thread 2');
    });

    it('should sort pinned sessions after starred', () => {
      const { container } = render(<ThreadsPane {...defaultProps} searchQuery="" />);

      const items = container.querySelectorAll('[data-testid^="virtuoso-item-"]');

      // Thread 2 (starred) should be first
      expect(items[0]?.textContent).toContain('Thread 2');

      // Another Thread (pinned but not starred) should be second
      expect(items[1]?.textContent).toContain('Another Thread');
    });

    it('should sort by updated_at for non-starred/non-pinned', () => {
      const { container } = render(<ThreadsPane {...defaultProps} searchQuery="" />);

      const items = container.querySelectorAll('[data-testid^="virtuoso-item-"]');

      // Last item should be Thread 1 (neither starred nor pinned, oldest update)
      expect(items[2]?.textContent).toContain('Thread 1');
    });
  });

  describe('Session Selection', () => {
    it('should mark active session', () => {
      render(<ThreadsPane {...defaultProps} activeSessionId="session-2" />);

      // Check that Thread 2 is rendered (it should be marked as active via styling)
      expect(screen.getByText('Thread 2')).toBeInTheDocument();
    });

    it('should render streaming indicator for active streaming sessions', () => {
      render(<ThreadsPane {...defaultProps} streamingSessionIds={['session-2']} />);
      expect(screen.getByTestId('chat__thread-streaming-indicator')).toBeInTheDocument();
    });
  });

  describe('Thread Item Interactions', () => {
    it('should pass through onSelect handler', async () => {
      const user = userEvent.setup();
      render(<ThreadsPane {...defaultProps} />);

      // Due to sorting (starred first), Thread 2 appears first in the list
      const thread2 = screen.getAllByText('Thread 2')[0];
      await user.click(thread2);

      expect(defaultProps.onSelect).toHaveBeenCalledWith('session-2');
    });

    it('should pass through onRename handler', async () => {
      const user = userEvent.setup();
      render(<ThreadsPane {...defaultProps} />);

      // Trigger rename via dropdown menu (simulated)
      // Thread 2 is first due to sorting (starred)
      const trigger = screen.getAllByLabelText('Thread actions')[0];
      await user.click(trigger);

      const renameOption = screen.getAllByText('Rename')[0];
      await user.click(renameOption);

      const input = screen.getAllByDisplayValue('Thread 2')[0];
      await user.clear(input);
      await user.type(input, 'NewTitle'); // No space - userEvent types each character
      // Press Enter key
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      expect(defaultProps.onRename).toHaveBeenCalledWith('session-2', 'NewTitle');
    });

    it('should pass through onToggleStar handler', async () => {
      const user = userEvent.setup();
      render(<ThreadsPane {...defaultProps} />);

      const trigger = screen.getAllByLabelText('Thread actions')[0];
      await user.click(trigger);

      // First item (Thread 2) is already starred, so it will show "Unstar"
      // Let's click the second item (Another Thread) which is not starred
      const triggers = screen.getAllByLabelText('Thread actions');
      await user.click(triggers[1]);

      const starOption = screen.getAllByText('Star')[0];
      await user.click(starOption);

      expect(defaultProps.onToggleStar).toHaveBeenCalledWith('session-3', true);
    });

    it('should pass through onTogglePin handler', async () => {
      const user = userEvent.setup();
      render(<ThreadsPane {...defaultProps} />);

      // First item (Thread 2) is starred but not pinned
      const trigger = screen.getAllByLabelText('Thread actions')[0];
      await user.click(trigger);

      const pinOption = screen.getAllByText('Pin')[0];
      await user.click(pinOption);

      expect(defaultProps.onTogglePin).toHaveBeenCalledWith('session-2', true);
    });

    it('should pass through onDelete handler', async () => {
      const user = userEvent.setup();
      render(<ThreadsPane {...defaultProps} />);

      // First item is Thread 2 (starred)
      const trigger = screen.getAllByLabelText('Thread actions')[0];
      await user.click(trigger);

      const deleteOption = screen.getAllByText('Delete')[0];
      await user.click(deleteOption);

      expect(defaultProps.onDelete).toHaveBeenCalledWith('session-2');
    });
  });

  describe('Search Icon', () => {
    it('should display search icon in input', () => {
      const { container } = render(<ThreadsPane {...defaultProps} />);

      // Check for Lucide icon (Search)
      const searchIcon = container.querySelector('svg');
      expect(searchIcon).toBeInTheDocument();
    });
  });

  describe('Virtuoso Integration', () => {
    it('should use Virtuoso for rendering', () => {
      const { container } = render(<ThreadsPane {...defaultProps} />);

      const virtuosoList = container.querySelector('[data-testid="virtuoso-list"]');
      expect(virtuosoList).toBeInTheDocument();
    });

    it('should render correct number of items in Virtuoso', () => {
      const { container } = render(<ThreadsPane {...defaultProps} />);

      const items = container.querySelectorAll('[data-testid^="virtuoso-item-"]');
      expect(items).toHaveLength(3); // 3 sessions
    });
  });

  describe('Edge Cases', () => {
    it('should handle sessions without titles', () => {
      const sessionsWithoutTitles: ChatSession[] = [
        {
          ...mockSessions[0],
          title: '',
        },
      ];

      render(<ThreadsPane {...defaultProps} sessions={sessionsWithoutTitles} />);

      expect(screen.getByText('Untitled')).toBeInTheDocument();
    });

    it('should handle very long titles', () => {
      const longTitleSession: ChatSession = {
        ...mockSessions[0],
        title: 'This is a very long thread title that should be truncated',
      };

      render(<ThreadsPane {...defaultProps} sessions={[longTitleSession]} />);

      const title = screen.getByText(/This is a very long thread title/);
      expect(title).toBeInTheDocument();
    });

    it('should handle special characters in search', () => {
      render(<ThreadsPane {...defaultProps} searchQuery="Thread #1" />);

      // Should not crash and handle gracefully
      expect(screen.queryByText('Thread 1')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper input labeling', () => {
      render(<ThreadsPane {...defaultProps} />);

      const searchInput = screen.getByPlaceholderText('search_threads_placeholder');
      expect(searchInput).toBeInTheDocument();
    });

  });
});
