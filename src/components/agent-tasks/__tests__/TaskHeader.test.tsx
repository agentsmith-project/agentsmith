/**
 * Tests for TaskHeader component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskHeader } from '../TaskHeader';
import type { Task } from '@/lib/types/task';

const mockDeleteMutateAsync = vi.hoisted(() => vi.fn());
const mockUseDeleteTask = vi.hoisted(() => vi.fn());

// Mock the hooks
vi.mock('@/lib/hooks/use-task', () => ({
  useDeleteTask: mockUseDeleteTask,
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

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (key === 'terminal_status_strip_active') {
      const count = Number(values?.count ?? 0);
      return count === 1
        ? '1 terminal session is using this task'
        : `${count} terminal sessions are using this task`;
    }
    if (key === 'terminal_status_strip_recovery') {
      const count = Number(values?.count ?? 0);
      return count === 1
        ? '1 terminal session on this task needs recovery'
        : `${count} terminal sessions on this task need recovery`;
    }
    if (key === 'terminal_status_strip_mixed') {
      const count = Number(values?.count ?? 0);
      const recoveryCount = Number(values?.recoveryCount ?? 0);
      return `${count} terminal sessions are using this task, ${recoveryCount} ${recoveryCount === 1 ? 'needs' : 'need'} recovery`;
    }
    const translations: Record<string, string> = {
      'leave': 'Leave',
      'delete': 'Delete',
      'delete_confirm_message': 'Deleting this task removes task history, conversation, trace, artifact metadata, runner links, and terminal links. The task workspace and files remain in Files and can be selected by a new task after deletion.',
      'delete_cancel': 'Cancel',
      'delete_blocked_terminal_sessions': 'End all terminal sessions before deleting this task.',
      'delete_blocked_terminal_sessions_pending': 'Checking terminal sessions before deleting this task.',
      'edit': 'Edit',
      'edit_title': 'Edit Task',
      'new': 'New',
      'workspace_file_library_label': 'Workspace',
      'workspace_file_library_unknown': 'No Workspace Library',
      'runner_binding_managed': 'Managed execution',
      'runner_binding_managed_source': 'Deployment-managed execution',
      'runner_binding_developer': 'Developer runner',
      'runner_binding_explicit': 'Explicit binding',
      'runner_binding_runner_id': 'Runner ID',
      'runner_binding_issue_action': 'Create new task with managed execution',
      'terminal_open': 'Open Terminal Workspace',
      'terminal_end_all': 'End All Sessions',
      'terminal_mode_conversation': 'Conversation',
      'terminal_mode_terminal': 'Terminal',
      'runner_test_badge': 'runner_test',
      'runner_test_source_value': 'Developer runner test',
    };
    const template = translations[key] || key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  },
}));

describe('TaskHeader', () => {
  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';

  const mockTask = {
    id: 'task-1',
    workspace_id: mockWorkspaceId,
    project_id: mockProjectId,
    owner_user_id: 'user-1',
    title: 'Test Task Title',
    active_run: {
      id: 'run-1',
      status: 'running',
      runner_id: 'runner-1',
    },
    workspace_file_library_id: 'flib-1',
    workspace_file_library_name: 'Project Workspace',
    bound_runner_id: 'managed-default',
    bound_runner_kind: 'managed',
    runner_binding_source: 'default_managed',
    status: 'active',
    attached_inputs: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    last_activity_at: '2024-01-02T12:00:00Z',
  } as Task;

  const mockOnCreateNew = vi.fn();
  const mockOnDeleted = vi.fn();
  const mockOnLeave = vi.fn();
  const mockOnEdit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteMutateAsync.mockResolvedValue({});
    mockUseDeleteTask.mockImplementation(() => ({
      mutateAsync: mockDeleteMutateAsync,
      isPending: false,
    }));
  });

  const renderComponent = (task: Task = mockTask, props = {}) => {
    return render(
      <TaskHeader
        task={task}
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        onCreateNew={mockOnCreateNew}
        onDeleted={mockOnDeleted}
        onLeave={mockOnLeave}
        onEdit={mockOnEdit}
        {...props}
      />
    );
  };

  describe('Basic Rendering', () => {
    it('renders task title', () => {
      renderComponent();

      expect(screen.getByText('Test Task Title')).toBeInTheDocument();
    });

    it('does not expose the active run runner id in the task header', () => {
      renderComponent();

      expect(screen.queryByText(/runner-1/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Runner:/)).not.toBeInTheDocument();
    });

    it('renders workspace file library badge', () => {
      renderComponent();

      expect(screen.getByTestId('agent-task__task-header-workspace-library')).toHaveTextContent('Workspace: Project Workspace');
    });

    it('shows managed execution metadata without project-level configuration or system-managed wording', () => {
      renderComponent();

      expect(screen.getByTestId('agent-task__task-header-runner-binding')).toHaveTextContent(
        'Managed execution',
      );
      expect(screen.getByTestId('agent-task__task-header-runner-binding')).toHaveTextContent(
        'Deployment-managed execution',
      );
      expect(screen.getByTestId('agent-task__task-header-runner-binding')).not.toHaveTextContent(
        /Configured for this project|Project default|System managed|sandbox/i,
      );
    });

    it('shows explicit developer runner binding metadata when the task is bound to a Developer runner', () => {
      renderComponent({
        ...mockTask,
        bound_runner_id: 'runner-dev-1',
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
      } as Task);

      expect(screen.getByTestId('agent-task__task-header-runner-binding')).toHaveTextContent(
        'Developer runner',
      );
      expect(screen.getByTestId('agent-task__task-header-runner-binding')).toHaveTextContent(
        'Explicit binding',
      );
      expect(screen.getByTestId('agent-task__task-header-runner-binding')).toHaveTextContent(
        'Runner ID: runner-dev-1',
      );
    });

    it('surfaces runner_test tasks in the task header', () => {
      renderComponent({
        ...mockTask,
        source: 'runner_test',
        runner_test: true,
        active_run: {
          id: 'run-runner-test',
          status: 'running',
          runner_id: 'runner-1',
          source: 'runner_test',
          runner_test: true,
        },
      } as Task);

      const badge = screen.getByTestId('agent-tasks__runner-test-badge');
      expect(badge).toHaveTextContent('runner_test');
      expect(badge).toHaveAttribute('title', 'Developer runner test');
    });

    it('keeps the header task-focused when no backend run is active yet', () => {
      renderComponent({
        ...mockTask,
        active_run: undefined,
      } as Task);

      expect(screen.queryByText(/^Runner:/)).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-task__task-header-agent-mode')).not.toBeInTheDocument();
    });

    it('does not display legacy task agent or top-level runner fallback fields', () => {
      renderComponent({
        ...mockTask,
        active_run: undefined,
        agent_name: 'Legacy Agent Name',
        runner_id: 'top-level-runner-id',
        runner_name: 'Top-level Runner Name',
      } as unknown as Task);

      expect(screen.queryByText(/Legacy Agent Name/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Top-level Runner Name/)).not.toBeInTheDocument();
      expect(screen.queryByText(/top-level-runner-id/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Runner:/)).not.toBeInTheDocument();
    });

    it('has data-testid for easy selection', () => {
      renderComponent();

      expect(screen.getByTestId('agent-task__task-header')).toBeInTheDocument();
    });

    it('exposes terminal truth hydration state for visual readiness checks', () => {
      renderComponent(mockTask, { terminalTruthState: 'ready' });

      expect(screen.getByTestId('agent-task__task-header')).toHaveAttribute('data-terminal-truth-state', 'ready');
    });

    it('renders terminal create action when terminal controls are enabled', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: true,
      });

      expect(screen.getByTestId('agent-task__task-header-terminal-create')).toHaveTextContent('Open Terminal Workspace');
      expect(screen.queryByTestId('agent-task__task-header-mode-conversation')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-task__task-header-mode-terminal')).not.toBeInTheDocument();
    });

    it('does not render a terminal create action once workspace tabs exist', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: true,
        terminalSessionCount: 1,
      });

      expect(screen.queryByTestId('agent-task__task-header-terminal-create')).not.toBeInTheDocument();
    });

    it('renders a managed-runner recovery action for unavailable Developer-bound tasks', async () => {
      const user = userEvent.setup();
      const onCreateBoundRunnerRecoveryTask = vi.fn();

      renderComponent(
        {
          ...mockTask,
          bound_runner_id: 'runner-dev-1',
          bound_runner_kind: 'developer',
          runner_binding_source: 'explicit',
        } as Task,
        {
          onCreateBoundRunnerRecoveryTask,
          boundRunnerRecoveryActionLabel: 'Create new task with managed execution',
        },
      );

      await user.click(screen.getByTestId('agent-task__task-header-bound-runner-recovery'));
      expect(onCreateBoundRunnerRecoveryTask).toHaveBeenCalledTimes(1);
    });

    it('renders terminal mode switch and summary once tabs exist', () => {
      renderComponent(mockTask, {
        viewMode: 'terminal' as const,
        onSetViewMode: vi.fn(),
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: true,
        terminalSessionCount: 1,
      });

      expect(screen.getByTestId('agent-task__task-header-mode-conversation')).toHaveTextContent('Conversation');
      expect(screen.getByTestId('agent-task__task-header-mode-terminal')).toHaveTextContent('Terminal');
      expect(screen.getByTestId('agent-task__task-header-terminal-summary')).toHaveTextContent(
        '1 terminal session is using this task',
      );
    });

    it('does not render end-all action in the header when tabs exist', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        onCloseAllTerminalSessions: vi.fn(),
        canCreateTerminalSession: true,
        terminalSessionCount: 1,
      });

      expect(screen.queryByTestId('agent-task__task-header-terminal-end-all')).not.toBeInTheDocument();
    });

    it('prefers recovery summary when any terminal tab needs attention', () => {
      renderComponent(mockTask, {
        onSetViewMode: vi.fn(),
        onCreateTerminalSession: vi.fn(),
        terminalSessionCount: 1,
        terminalRecoveryCount: 1,
        terminalHasRecovery: true,
      });

      expect(screen.getByTestId('agent-task__task-header-terminal-summary')).toHaveTextContent(
        '1 terminal session on this task needs recovery',
      );
    });

    it('shows mixed occupancy wording when active and recovery sessions coexist', () => {
      renderComponent(mockTask, {
        onSetViewMode: vi.fn(),
        onCreateTerminalSession: vi.fn(),
        terminalSessionCount: 2,
        terminalRecoveryCount: 1,
        terminalHasRecovery: true,
      });

      expect(screen.getByTestId('agent-task__task-header-terminal-summary')).toHaveTextContent(
        '2 terminal sessions are using this task, 1 needs recovery',
      );
    });

    it('uses plural occupancy wording when multiple sessions are active', () => {
      renderComponent(mockTask, {
        onSetViewMode: vi.fn(),
        onCreateTerminalSession: vi.fn(),
        terminalSessionCount: 2,
      });

      expect(screen.getByTestId('agent-task__task-header-terminal-summary')).toHaveTextContent(
        '2 terminal sessions are using this task',
      );
    });

    it('exposes disabled reason when terminal access is unavailable', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: false,
        terminalDisabledReason: 'Terminal access is restricted.',
      });

      expect(screen.getByTestId('agent-task__task-header-terminal-create')).toHaveAttribute('title', 'Terminal access is restricted.');
    });
  });

  describe('Leave Button', () => {
    it('renders leave button', () => {
      renderComponent();

      const leaveButton = document.querySelector('button[aria-label="Leave"]');
      expect(leaveButton).toBeInTheDocument();
    });

    it('calls onLeave when leave button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const leaveButton = document.querySelector('button[aria-label="Leave"]') as HTMLButtonElement;
      await user.click(leaveButton);

      expect(mockOnLeave).toHaveBeenCalledTimes(1);
    });

    it('navigates to agent task list when onLeave is not provided', async () => {
      const user = userEvent.setup();
      render(
        <TaskHeader
          task={mockTask}
          workspaceId={mockWorkspaceId}
          projectId={mockProjectId}
        />
      );

      const leaveButton = document.querySelector('button[aria-label="Leave"]') as HTMLButtonElement;
      await user.click(leaveButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/agent-tasks`
      );
    });

    it('shows tooltip on hover', () => {
      renderComponent();

      // The Tooltip component should render
      const leaveButton = document.querySelector('button[aria-label="Leave"]');
      expect(leaveButton).toBeInTheDocument();
    });
  });

  describe('Delete Button', () => {
    it('renders delete button', () => {
      renderComponent();

      expect(screen.getByText('Delete')).toBeInTheDocument();
    });

    it('renders a disabled delete action when delete is blocked by terminal truth before hydration finishes', () => {
      renderComponent(mockTask, {
        canDeleteTask: true,
        deleteBlockedReason: 'Checking terminal sessions before deleting this task.',
      });

      const deleteButton = screen.getByText('Delete').closest('button');
      expect(deleteButton).toBeDisabled();
      expect(deleteButton).toHaveAttribute(
        'title',
        'Checking terminal sessions before deleting this task.',
      );
      expect(screen.queryByText('Are you sure you want to delete this task?')).not.toBeInTheDocument();
    });

    it('opens delete confirmation dialog when clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      expect(screen.getByText(/The task workspace and files remain in Files/)).toBeInTheDocument();
    });

    it('disables delete while terminal sessions are still active', async () => {
      const user = userEvent.setup();
      renderComponent(mockTask, {
        terminalSessionCount: 1,
      });

      const deleteButton = screen.getByText('Delete');
      expect(deleteButton).toBeDisabled();
      expect(deleteButton).toHaveAttribute('title', 'End all terminal sessions before deleting this task.');

      await user.click(deleteButton);
      expect(screen.queryByText(/The task workspace and files remain in Files/)).not.toBeInTheDocument();
    });

    it('closes dialog when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      // Dialog should be closed
      expect(screen.queryByText(/The task workspace and files remain in Files/)).not.toBeInTheDocument();
    });

    it('keeps the dialog open and shows inline i18n copy when backend rejects delete blockers', async () => {
      const user = userEvent.setup();
      mockUseDeleteTask.mockImplementation((options?: {
        onDeleteBlocked?: (message: string, error: unknown) => void;
      }) => ({
        mutateAsync: vi.fn(async () => {
          options?.onDeleteBlocked?.(
            'Delete is blocked because this task still has an active run, terminal session, or task workspace in use. Finish those blockers and try again.',
            new Error('AGENT_TASK_DELETE_BLOCKED'),
          );
          throw new Error('AGENT_TASK_DELETE_BLOCKED');
        }),
        isPending: false,
      }));

      renderComponent();

      await user.click(screen.getByText('Delete'));
      const dialog = screen.getByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(screen.getByTestId('agent-task__delete-blocked-error')).toHaveTextContent(
        'Delete is blocked because this task still has an active run, terminal session, or task workspace in use. Finish those blockers and try again.',
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(mockOnDeleted).not.toHaveBeenCalled();
    });

    it('calls onDeleted after successful delete', async () => {
      const user = userEvent.setup();

      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      const dialog = screen.getByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(mockDeleteMutateAsync).toHaveBeenCalledWith({
        workspaceId: mockWorkspaceId,
        projectId: mockProjectId,
        taskId: mockTask.id,
      });
      expect(mockOnDeleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edit Button', () => {
    it('renders edit button', () => {
      renderComponent();
      expect(screen.getByText('Edit')).toBeInTheDocument();
    });

    it('calls onEdit when edit button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const editButton = screen.getByText('Edit');
      await user.click(editButton);

      expect(mockOnEdit).toHaveBeenCalledTimes(1);
    });
  });

  describe('New Task Button', () => {
    it('renders new task button when onCreateNew is provided', () => {
      renderComponent();

      expect(screen.getByText('New')).toBeInTheDocument();
    });

    it('does not render new task button when onCreateNew is not provided', () => {
      render(
        <TaskHeader
          task={mockTask}
          workspaceId={mockWorkspaceId}
          projectId={mockProjectId}
        />
      );

      expect(screen.queryByText('New')).not.toBeInTheDocument();
    });

    it('calls onCreateNew when new task button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const newButton = screen.getByText('New');
      await user.click(newButton);

      expect(mockOnCreateNew).toHaveBeenCalledTimes(1);
    });
  });

  describe('Long Title Handling', () => {
    it('truncates long titles', () => {
      const longTitleTask: Task = {
        ...mockTask,
        title: 'This is a very long task title that should be truncated because it exceeds the available space in the header component',
      };

      renderComponent(longTitleTask);

      const titleElement = screen.getByText(/This is a very long task title/);
      expect(titleElement).toHaveClass('truncate');
    });
  });

  describe('Layout and Styling', () => {
    it('has correct styling classes', () => {
      const { container } = renderComponent();

      const header = container.querySelector('[data-testid="agent-task__task-header"]');
      expect(header).toHaveClass('rounded-xl', 'border', 'px-4', 'py-3', 'shadow-ambient');
    });

    it('renders distinct summary, meta, and action regions to keep header density legible', () => {
      renderComponent();

      expect(screen.getByTestId('agent-task__task-header-summary')).toBeInTheDocument();
      expect(screen.getByTestId('agent-task__task-header-meta')).toBeInTheDocument();
      expect(screen.getByTestId('agent-task__task-header-actions')).toBeInTheDocument();
    });

    it('renders action buttons in correct order', () => {
      renderComponent();

      const buttons = screen.getAllByRole('button');
      const buttonTexts = buttons.map(btn => btn.textContent?.trim()).filter(Boolean);

      // Delete should come before New
      const deleteIndex = buttonTexts.indexOf('Delete');
      const newIndex = buttonTexts.indexOf('New');

      expect(deleteIndex).toBeLessThan(newIndex);
    });
  });

  describe('Terminal Controls', () => {
    it('calls onCreateTerminalSession when clicked', async () => {
      const user = userEvent.setup();
      const onCreateTerminalSession = vi.fn();
      renderComponent(mockTask, {
        onCreateTerminalSession,
        canCreateTerminalSession: true,
      });

      await user.click(screen.getByTestId('agent-task__task-header-terminal-create'));
      expect(onCreateTerminalSession).toHaveBeenCalledTimes(1);
    });

    it('disables terminal create when unavailable', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: false,
      });

      expect(screen.getByTestId('agent-task__task-header-terminal-create')).toBeDisabled();
    });

    it('calls onSetViewMode when switching between conversation and terminal', async () => {
      const user = userEvent.setup();
      const onSetViewMode = vi.fn();
      renderComponent(mockTask, {
        viewMode: 'conversation' as const,
        onSetViewMode,
        terminalSessionCount: 1,
      });

      await user.click(screen.getByTestId('agent-task__task-header-mode-terminal'));
      expect(onSetViewMode).toHaveBeenCalledWith('terminal');
    });
  });
});
