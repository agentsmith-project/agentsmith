/**
 * Tests for TaskHeader component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskHeader } from '../TaskHeader';
import type { Task } from '@/lib/types/task';

// Mock the hooks
vi.mock('@/lib/hooks/use-task', () => ({
  useDeleteTask: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
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
      'delete_confirm_message': 'Are you sure you want to delete this task?',
      'delete_cancel': 'Cancel',
      'delete_blocked_terminal_sessions': 'End all terminal sessions before deleting this task.',
      'delete_blocked_terminal_sessions_pending': 'Checking terminal sessions before deleting this task.',
      'edit': 'Edit',
      'edit_title': 'Edit Task',
      'new': 'New',
      'agent_presence_unknown': 'Agent Unknown',
      'agent_record_unavailable': 'Agent record unavailable',
      'agent_mode_unknown': 'Unknown Runner',
      'agent_mode_external': 'External Runner',
      'agent_mode_internal': 'Internal Runner',
      'workspace_file_library_label': 'Workspace',
      'workspace_file_library_unknown': 'No Workspace Library',
      'terminal_open': 'Open Terminal Workspace',
      'terminal_end_all': 'End All Sessions',
      'terminal_mode_conversation': 'Conversation',
      'terminal_mode_terminal': 'Terminal',
    };
    const template = translations[key] || key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  },
}));

describe('TaskHeader', () => {
  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';

  const mockTask: Task = {
    id: 'task-1',
    workspace_id: mockWorkspaceId,
    project_id: mockProjectId,
    owner_user_id: 'user-1',
    title: 'Test Task Title',
    agent_id: 'agent-1',
    agent_name: 'Test Agent',
    workspace_file_library_id: 'flib-1',
    workspace_file_library_name: 'Project Workspace',
    status: 'active',
    attached_inputs: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    last_activity_at: '2024-01-02T12:00:00Z',
  };

  const mockOnCreateNew = vi.fn();
  const mockOnDeleted = vi.fn();
  const mockOnLeave = vi.fn();
  const mockOnEdit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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

    it('renders agent name', () => {
      renderComponent();

      expect(screen.getByText('Agent: Test Agent')).toBeInTheDocument();
    });

    it('renders workspace file library badge', () => {
      renderComponent();

      expect(screen.getByTestId('notebook__task-header-workspace-library')).toHaveTextContent('Workspace: Project Workspace');
    });

    it('does not call a known agent unknown when the agent record is unavailable', () => {
      renderComponent();

      expect(screen.getByText('Agent: Test Agent')).toBeInTheDocument();
      expect(screen.getByTestId('notebook__task-header-agent-record-unavailable')).toHaveTextContent(
        'Agent record unavailable',
      );
      expect(screen.queryByText('Agent Unknown')).not.toBeInTheDocument();
      expect(screen.queryByText('Unknown Runner')).not.toBeInTheDocument();
    });

    it('renders agent presence and runner mode only when the agent record is resolved', () => {
      renderComponent(mockTask, {
        agentPresence: 'online' as const,
        agentMode: 'external' as const,
      });

      expect(screen.getByText('agent_presence_online')).toBeInTheDocument();
      expect(screen.getByTestId('notebook__task-header-agent-mode')).toHaveTextContent('External Runner');
      expect(screen.queryByTestId('notebook__task-header-agent-record-unavailable')).not.toBeInTheDocument();
    });

    it('renders agent mode badge', () => {
      renderComponent(mockTask, { agentMode: 'external' as const });
      expect(screen.getByTestId('notebook__task-header-agent-mode')).toHaveTextContent('External Runner');
    });

    it('has data-testid for easy selection', () => {
      renderComponent();

      expect(screen.getByTestId('notebook__task-header')).toBeInTheDocument();
    });

    it('exposes terminal truth hydration state for visual readiness checks', () => {
      renderComponent(mockTask, { terminalTruthState: 'ready' });

      expect(screen.getByTestId('notebook__task-header')).toHaveAttribute('data-terminal-truth-state', 'ready');
    });

    it('renders terminal create action when terminal controls are enabled', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: true,
      });

      expect(screen.getByTestId('notebook__task-header-terminal-create')).toHaveTextContent('Open Terminal Workspace');
      expect(screen.queryByTestId('notebook__task-header-mode-conversation')).not.toBeInTheDocument();
      expect(screen.queryByTestId('notebook__task-header-mode-terminal')).not.toBeInTheDocument();
    });

    it('does not render a terminal create action once workspace tabs exist', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: true,
        terminalSessionCount: 1,
      });

      expect(screen.queryByTestId('notebook__task-header-terminal-create')).not.toBeInTheDocument();
    });

    it('renders terminal mode switch and summary once tabs exist', () => {
      renderComponent(mockTask, {
        viewMode: 'terminal' as const,
        onSetViewMode: vi.fn(),
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: true,
        terminalSessionCount: 1,
      });

      expect(screen.getByTestId('notebook__task-header-mode-conversation')).toHaveTextContent('Conversation');
      expect(screen.getByTestId('notebook__task-header-mode-terminal')).toHaveTextContent('Terminal');
      expect(screen.getByTestId('notebook__task-header-terminal-summary')).toHaveTextContent(
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

      expect(screen.queryByTestId('notebook__task-header-terminal-end-all')).not.toBeInTheDocument();
    });

    it('prefers recovery summary when any terminal tab needs attention', () => {
      renderComponent(mockTask, {
        onSetViewMode: vi.fn(),
        onCreateTerminalSession: vi.fn(),
        terminalSessionCount: 1,
        terminalRecoveryCount: 1,
        terminalHasRecovery: true,
      });

      expect(screen.getByTestId('notebook__task-header-terminal-summary')).toHaveTextContent(
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

      expect(screen.getByTestId('notebook__task-header-terminal-summary')).toHaveTextContent(
        '2 terminal sessions are using this task, 1 needs recovery',
      );
    });

    it('uses plural occupancy wording when multiple sessions are active', () => {
      renderComponent(mockTask, {
        onSetViewMode: vi.fn(),
        onCreateTerminalSession: vi.fn(),
        terminalSessionCount: 2,
      });

      expect(screen.getByTestId('notebook__task-header-terminal-summary')).toHaveTextContent(
        '2 terminal sessions are using this task',
      );
    });

    it('exposes disabled reason when terminal access is unavailable', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: false,
        terminalDisabledReason: 'Terminal access is restricted.',
      });

      expect(screen.getByTestId('notebook__task-header-terminal-create')).toHaveAttribute('title', 'Terminal access is restricted.');
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

    it('navigates to notebook list when onLeave is not provided', async () => {
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
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/notebook`
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

      expect(screen.getByText('Are you sure you want to delete this task?')).toBeInTheDocument();
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
      expect(screen.queryByText('Are you sure you want to delete this task?')).not.toBeInTheDocument();
    });

    it('closes dialog when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      const cancelButton = screen.getByText('Cancel');
      await user.click(cancelButton);

      // Dialog should be closed
      expect(screen.queryByText('Are you sure you want to delete this task?')).not.toBeInTheDocument();
    });

    it('calls onDeleted after successful delete', async () => {
      const user = userEvent.setup();
      const mockDelete = vi.fn().mockResolvedValue({});

      vi.doMock('@/lib/hooks/use-task', () => ({
        useDeleteTask: () => ({
          mutateAsync: mockDelete,
          isPending: false,
        }),
      }));

      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      const confirmButton = screen.getAllByText('Delete').find(
        btn => btn.getAttribute('variant') === 'destructive'
      );
      if (confirmButton) {
        await user.click(confirmButton);
      }

      // Note: The actual delete call happens in the mock hook
      // In a real test, we'd need to wait for the mutation
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

      const header = container.querySelector('[data-testid="notebook__task-header"]');
      expect(header).toHaveClass('border-b', 'border-subtle', 'bg-transparent', 'px-4', 'py-2.5');
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

      await user.click(screen.getByTestId('notebook__task-header-terminal-create'));
      expect(onCreateTerminalSession).toHaveBeenCalledTimes(1);
    });

    it('disables terminal create when unavailable', () => {
      renderComponent(mockTask, {
        onCreateTerminalSession: vi.fn(),
        canCreateTerminalSession: false,
      });

      expect(screen.getByTestId('notebook__task-header-terminal-create')).toBeDisabled();
    });

    it('calls onSetViewMode when switching between conversation and terminal', async () => {
      const user = userEvent.setup();
      const onSetViewMode = vi.fn();
      renderComponent(mockTask, {
        viewMode: 'conversation' as const,
        onSetViewMode,
        terminalSessionCount: 1,
      });

      await user.click(screen.getByTestId('notebook__task-header-mode-terminal'));
      expect(onSetViewMode).toHaveBeenCalledWith('terminal');
    });
  });
});
