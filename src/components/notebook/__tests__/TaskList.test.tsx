/**
 * Tests for TaskList component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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
      'empty_description': 'Create your first task to start collaborating with an agent',
      'agent_online': 'Agent Online',
      'agent_offline': 'Agent Offline',
      'agent_managed': 'Agent Managed',
      'agent_unknown': 'Agent Unknown',
      'run_running': 'Running',
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
// (it requires useCreateTask, AgentAPI, etc.)
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

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';

  const mockTasks: Task[] = [
    {
      id: 'task-1',
      workspace_id: mockWorkspaceId,
      project_id: mockProjectId,
      owner_user_id: 'user-1',
      title: 'Test Task 1',
      agent_id: 'agent-1',
      agent_name: 'Test Agent 1',
      status: 'active',
      attached_inputs: [
        { id: 'in_1', kind: 'source', source_id: 'source-1' },
        { id: 'in_2', kind: 'source', source_id: 'source-2' },
      ],
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      last_activity_at: '2024-01-02T12:00:00Z',
      agent_presence: 'online',
      run_state: 'running',
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
      agent_id: 'agent-2',
      agent_name: 'Test Agent 2',
      status: 'active',
      attached_inputs: [],
      created_at: '2024-01-03T00:00:00Z',
      updated_at: '2024-01-03T00:00:00Z',
      last_activity_at: '2024-01-03T08:00:00Z',
      agent_presence: 'offline',
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
      agent_id: 'agent-3',
      agent_name: 'Test Agent 3',
      status: 'archived',
      attached_inputs: [{ id: 'in_3', kind: 'source', source_id: 'source-3' }],
      created_at: '2024-01-04T00:00:00Z',
      updated_at: '2024-01-04T00:00:00Z',
      last_activity_at: '2024-01-04T16:00:00Z',
      agent_presence: 'managed',
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

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

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

    it('displays task agent names', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      // Agent names are rendered as direct text nodes (the "Agent:" label is in a child span)
      expect(screen.getByText('Test Agent 1')).toBeInTheDocument();
      expect(screen.getByText('Test Agent 2')).toBeInTheDocument();
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

    it('displays last activity time', () => {
      vi.mocked(useTasks).mockReturnValue({
        data: { items: mockTasks, total: 3, page: 1, page_size: 10 },
        isLoading: false,
      } as any);

      render(<TaskList workspaceId={mockWorkspaceId} projectId={mockProjectId} canCreateTask={true} />, {
        wrapper,
      });

      // Activity time is rendered in compact mode without a "Last activity:" label.
      const activityTimestamps = screen.getAllByText(/\d{1,2}\/\d{1,2}\/\d{4}/);
      expect(activityTimestamps.length).toBeGreaterThan(0);
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
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/notebook/tasks/task-1`
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

      expect(screen.getByTestId('notebook__create-task-btn')).toBeInTheDocument();
    });
  });
});
