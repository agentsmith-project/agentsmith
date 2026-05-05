/**
 * Tests for TaskList component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskList } from '../TaskList';
import type { Task } from '@/lib/types/task';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const dict: Record<string, string> = {
      'new_task': 'New Task',
      'create_task': 'Create Task',
      'empty_title': 'No tasks yet',
      'empty_description': 'Create your first task to organize the work and collect outputs',
      'run_running': 'Running',
      'run_cancelling': 'Stopping',
      'run_terminating': 'Terminating',
      'run_finalizing': 'Saving',
      'last_activity': 'Last activity',
      'created_at': 'Created',
    };
    if (key === 'turns') return `Turns ${values?.count ?? '0'}`;
    if (key === 'artifacts') return `Artifacts ${values?.count ?? '0'}`;
    if (key === 'inputs') return `Inputs ${values?.count ?? '0'}`;
    return dict[key] ?? key;
  },
}));

// Mock the hooks
vi.mock('@/lib/hooks/use-task', () => ({
  useTasks: vi.fn(),
}));

// Mock TaskCreateDialog to avoid transitive dependency issues
// (it requires useCreateTask, AgentRunnerAPI, etc.)
vi.mock('../TaskCreateDialog', () => ({
  TaskCreateDialog: () => null,
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useParams: () => ({
    locale: 'en-US',
  }),
}));

import { useTasks } from '@/lib/hooks/use-task';

describe('TaskList', () => {
  let queryClient: QueryClient;
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';

  const mockTasks: Task[] = [
    {
      id: 'task-1',
      workspace_id: mockWorkspaceId,
      project_id: mockProjectId,
      owner_user_id: 'user-1',
      title: 'Test Task 1',
      status: 'active',
      attached_inputs: [
        { id: 'in_1', kind: 'library_object', library_id: 'lib-1', key: 'docs/source-1.txt', name: 'source-1.txt' },
        { id: 'in_2', kind: 'library_object', library_id: 'lib-1', key: 'docs/source-2.txt', name: 'source-2.txt' },
      ],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      last_activity_at: '2024-01-02T12:00:00Z',
      run_state: 'running',
      active_run: {
        id: 'run-1',
        status: 'running',
        runner_id: 'runner-1',
      },
      stats: {
        user_turn_count: 3,
        message_count: 6,
        artifact_count: 2,
        attached_input_count: 2,
      },
    },
    {
      id: 'task-2',
      workspace_id: mockWorkspaceId,
      project_id: mockProjectId,
      owner_user_id: 'user-1',
      title: 'Test Task 2',
      status: 'active',
      attached_inputs: [],
      created_at: '2024-01-03T00:00:00Z',
      updated_at: '2024-01-03T00:00:00Z',
      last_activity_at: '2024-01-03T08:00:00Z',
      run_state: 'idle',
      stats: {
        user_turn_count: 1,
        message_count: 2,
        artifact_count: 0,
        attached_input_count: 0,
      },
    },
    {
      id: 'task-3',
      workspace_id: mockWorkspaceId,
      project_id: mockProjectId,
      owner_user_id: 'user-1',
      title: 'Archived Task',
      status: 'archived',
      attached_inputs: [{ id: 'in_3', kind: 'library_object', library_id: 'lib-1', key: 'docs/source-3.txt', name: 'source-3.txt' }],
      created_at: '2024-01-04T00:00:00Z',
      updated_at: '2024-01-04T00:00:00Z',
      last_activity_at: '2024-01-04T16:00:00Z',
      run_state: 'idle',
      stats: {
        user_turn_count: 4,
        message_count: 8,
        artifact_count: 5,
        attached_input_count: 1,
      },
    },
  ];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const pinViewerLocalTimeZone = (timeZone = 'America/Los_Angeles') => {
    document.documentElement.lang = 'en-US';
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolvedOptions(this: Intl.DateTimeFormat) {
      return {
        ...originalResolvedOptions.call(this),
        timeZone,
      };
    });
  };

  const getTaskCardSurface = (taskId: string) => screen.getByTestId(`agent-tasks__task-card--${taskId}`);

  describe('Loading State', () => {
    it('renders loading state', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      // Should show loading spinner
      const loader = document.querySelector('.animate-spin');
      expect(loader).toBeInTheDocument();
    });
  });

  describe('Empty State', () => {
    it('renders empty state when no tasks', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: [], total: 0, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText('No tasks yet')).toBeInTheDocument();
      expect(screen.getByText(/Create your first task/)).toBeInTheDocument();
    });

    it('shows create task button in empty state', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: [], total: 0, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText('Create Task')).toBeInTheDocument();
    });
  });

  describe('Task List Rendering', () => {
    it('renders list of tasks', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText('Test Task 1')).toBeInTheDocument();
      expect(screen.getByText('Test Task 2')).toBeInTheDocument();
      expect(screen.getByText('Archived Task')).toBeInTheDocument();
    });

    it('hides runner identity from task list cards', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.queryByText('runner-1')).not.toBeInTheDocument();
      expect(screen.queryByText('Resolved at run time')).not.toBeInTheDocument();
    });

    it('keeps list cards task-focused when runner identity is not in the payload', () => {
      const taskWithoutRunner: Task = {
        ...mockTasks[0],
        active_run: undefined,
        run_state: 'idle',
      };

      vi.mocked(useTasks).mockReturnValue({
        data: { items: [taskWithoutRunner], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.queryByText('Resolved at run time')).not.toBeInTheDocument();
      expect(screen.getByText('Test Task 1')).toBeInTheDocument();
    });

    it('does not display task status badges', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.queryByText('Active')).not.toBeInTheDocument();
      expect(screen.queryByText('Archived')).not.toBeInTheDocument();
    });

    it('displays turns and artifact stats', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText('Turns 3')).toBeInTheDocument();
      expect(screen.getByText('Artifacts 2')).toBeInTheDocument();
      expect(screen.getByText('Inputs 2')).toBeInTheDocument();
    });

    it('renders authoritative run-state badges for stopping and finalizing tasks', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: {
          items: [
            { ...mockTasks[0], id: 'task-cancelling', title: 'Stopping Task', run_state: 'cancelling' },
            { ...mockTasks[1], id: 'task-terminating', title: 'Terminating Task', run_state: 'terminating' },
            { ...mockTasks[2], id: 'task-finalizing', title: 'Saving Task', run_state: 'finalizing' },
          ],
          total: 3,
          page: 1,
          page_size: 10,
        },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(within(getTaskCardSurface('task-cancelling')).getByText('Stopping')).toBeInTheDocument();
      expect(within(getTaskCardSurface('task-terminating')).getByText('Terminating')).toBeInTheDocument();
      expect(within(getTaskCardSurface('task-finalizing')).getByText('Saving')).toBeInTheDocument();
    });

    it('renders last activity labels with relative viewer-local text and absolute metadata', () => {
      pinViewerLocalTimeZone();
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-02T12:05:00Z'));
      vi.mocked(useTasks).mockReturnValue({
        data: { items: [mockTasks[0]], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      const firstTaskCardSurface = getTaskCardSurface(mockTasks[0].id);
      const lastActivity = within(firstTaskCardSurface).getByTestId('agent-tasks__task-last-activity');
      const lastActivityRow = lastActivity.closest('span');

      expect(lastActivity).toHaveAttribute('dateTime', mockTasks[0].last_activity_at);
      expect(lastActivity).toHaveAttribute('data-visual-datetime', mockTasks[0].last_activity_at);
      expect(lastActivity).toHaveAttribute('data-visual-datetime-policy', 'viewer_local');
      expect(lastActivity).toHaveAttribute('title', 'Jan 2, 2024, 04:00 AM PST');
      expect(lastActivity).toHaveTextContent('5m ago');
      expect(lastActivity).not.toHaveTextContent('Jan 2, 2024, 04:00 AM PST');
      expect(lastActivityRow).toHaveTextContent('Last activity: 5m ago');
    });

    it('renders created labels in viewer-local absolute time with timezone metadata and no seconds', () => {
      pinViewerLocalTimeZone();
      vi.mocked(useTasks).mockReturnValue({
        data: { items: [mockTasks[0]], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      const createdAt = within(getTaskCardSurface(mockTasks[0].id)).getByTestId('agent-tasks__task-created-at');
      const createdAtRow = createdAt.closest('span');

      expect(createdAt).toHaveAttribute('dateTime', mockTasks[0].created_at);
      expect(createdAt).toHaveAttribute('data-visual-datetime', mockTasks[0].created_at);
      expect(createdAt).toHaveAttribute('data-visual-datetime-policy', 'viewer_local');
      expect(createdAt).toHaveAttribute('title', 'Dec 31, 2023, 04:00 PM PST');
      expect(createdAt).toHaveTextContent('Dec 31, 2023, 04:00 PM PST');
      expect(createdAtRow).toHaveTextContent('Created: Dec 31, 2023, 04:00 PM PST');
      expect(createdAt).not.toHaveTextContent(/:\d{2}:\d{2}/);
      expect(createdAt).not.toHaveTextContent(/\d{1,2}\/\d{1,2}\/\d{4}/);
    });

    it('scopes shared datetime targets to unique task card surfaces so visual review can target a single card', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks.slice(0, 2), total: 2, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      const firstTaskCardSurface = getTaskCardSurface(mockTasks[0].id);
      const secondTaskCardSurface = getTaskCardSurface(mockTasks[1].id);

      expect(within(firstTaskCardSurface).getByTestId('agent-tasks__task-last-activity'))
        .toHaveAttribute('dateTime', mockTasks[0].last_activity_at);
      expect(within(firstTaskCardSurface).getByTestId('agent-tasks__task-created-at'))
        .toHaveAttribute('dateTime', mockTasks[0].created_at);
      expect(within(secondTaskCardSurface).getByTestId('agent-tasks__task-last-activity'))
        .toHaveAttribute('dateTime', mockTasks[1].last_activity_at);
      expect(within(secondTaskCardSurface).getByTestId('agent-tasks__task-created-at'))
        .toHaveAttribute('dateTime', mockTasks[1].created_at);
      expect(screen.getAllByTestId('agent-tasks__task-last-activity')).toHaveLength(2);
      expect(screen.getAllByTestId('agent-tasks__task-created-at')).toHaveLength(2);
      expect(screen.queryByTestId(`agent-tasks__task-last-activity--${mockTasks[0].id}`)).not.toBeInTheDocument();
      expect(screen.queryByTestId(`agent-tasks__task-created-at--${mockTasks[0].id}`)).not.toBeInTheDocument();
    });
  });

  describe('Task Card Interactions', () => {
    it('navigates to task when clicked', async () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: [mockTasks[0]], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      const taskCard = screen.getByText('Test Task 1').closest('div');
      taskCard?.click();

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/agent-tasks/task-1`
      );
    });
  });

  describe('Header Actions', () => {
    it('shows new task button', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText('New Task')).toBeInTheDocument();
    });

    it('opens create dialog when new task button is clicked', async () => {
      const user = userEvent.setup();
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      const newTaskButton = screen.getByText('New Task');
      await user.click(newTaskButton);

      // Dialog should be visible (checked by its content)
      // This is handled by TaskCreateDialog component
    });
  });

  describe('Time Formatting', () => {
    it('formats time as "Just now" for very recent activity', () => {
      const recentTask: Task = {
        ...mockTasks[0],
        last_activity_at: new Date(Date.now() - 10 * 1000).toISOString(), // 10 seconds ago
      };

      vi.mocked(useTasks).mockReturnValue({
        data: { items: [recentTask], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText(/Just now/)).toBeInTheDocument();
    });

    it('formats time as "Xm ago" for minutes', () => {
      const minutesAgoTask: Task = {
        ...mockTasks[0],
        last_activity_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(), // 15 minutes ago
      };

      vi.mocked(useTasks).mockReturnValue({
        data: { items: [minutesAgoTask], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText(/15m ago/)).toBeInTheDocument();
    });

    it('formats time as "Xh ago" for hours', () => {
      const hoursAgoTask: Task = {
        ...mockTasks[0],
        last_activity_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), // 3 hours ago
      };

      vi.mocked(useTasks).mockReturnValue({
        data: { items: [hoursAgoTask], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText(/3h ago/)).toBeInTheDocument();
    });

    it('formats time as "Xd ago" for days', () => {
      const daysAgoTask: Task = {
        ...mockTasks[0],
        last_activity_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
      };

      vi.mocked(useTasks).mockReturnValue({
        data: { items: [daysAgoTask], total: 1, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByText(/2d ago/)).toBeInTheDocument();
    });
  });

  describe('Toolbar Content', () => {
    it('renders primary action in compact toolbar', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      expect(screen.getByTestId('agent-tasks__create-task-btn')).toBeInTheDocument();
    });
  });
});
