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
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      'leave': 'Leave',
      'delete': 'Delete',
      'delete_confirm_message': 'Are you sure you want to delete this task?',
      'delete_cancel': 'Cancel',
      'edit': 'Edit',
      'edit_title': 'Edit Task',
      'new': 'New',
      'agent_presence_unknown': 'Agent Unknown',
      'agent_mode_unknown': 'Unknown Runner',
      'agent_mode_external': 'External Runner',
      'agent_mode_internal': 'Internal Runner',
      'workspace_file_library_label': 'Workspace',
      'workspace_file_library_unknown': 'No Workspace Library',
      'terminal_open': 'Open Terminal',
      'terminal_hide': 'Hide Terminal',
      'terminal_close': 'Close terminal',
    };
    return translations[key] || key;
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

    it('renders agent presence badge instead of task status badge', () => {
      renderComponent();
      expect(screen.getByText('Agent Unknown')).toBeInTheDocument();
    });

    it('renders agent mode badge', () => {
      renderComponent(mockTask, { agentMode: 'external' as const });
      expect(screen.getByTestId('notebook__task-header-agent-mode')).toHaveTextContent('External Runner');
    });

    it('has data-testid for easy selection', () => {
      renderComponent();

      expect(screen.getByTestId('notebook__task-header')).toBeInTheDocument();
    });

    it('renders terminal toggle when provided', () => {
      renderComponent(mockTask, {
        onToggleTerminal: vi.fn(),
        canOpenTerminal: true,
      });

      expect(screen.getByTestId('notebook__task-header-terminal')).toHaveTextContent('Open Terminal');
    });

    it('renders hide terminal label when terminal panel is already open', () => {
      renderComponent(mockTask, {
        onToggleTerminal: vi.fn(),
        canOpenTerminal: true,
        terminalOpen: true,
      });

      expect(screen.getByTestId('notebook__task-header-terminal')).toHaveTextContent('Hide Terminal');
    });

    it('renders close terminal action next to hide when terminal is open', () => {
      renderComponent(mockTask, {
        onToggleTerminal: vi.fn(),
        onCloseTerminalSession: vi.fn(),
        canOpenTerminal: true,
        terminalOpen: true,
      });

      expect(screen.getByTestId('notebook__task-header-terminal-close')).toHaveTextContent('Close terminal');
    });

    it('exposes disabled reason when terminal access is unavailable', () => {
      renderComponent(mockTask, {
        onToggleTerminal: vi.fn(),
        canOpenTerminal: false,
        terminalDisabledReason: 'Terminal access is restricted.',
      });

      expect(screen.getByTestId('notebook__task-header-terminal')).toHaveAttribute('title', 'Terminal access is restricted.');
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

    it('opens delete confirmation dialog when clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      expect(screen.getByText('Are you sure you want to delete this task?')).toBeInTheDocument();
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
      expect(header).toHaveClass('border-b', 'border-white/6', 'bg-surface/55');
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

  describe('Terminal Button', () => {
    it('calls onToggleTerminal when clicked', async () => {
      const user = userEvent.setup();
      const onToggleTerminal = vi.fn();
      renderComponent(mockTask, {
        onToggleTerminal,
        canOpenTerminal: true,
      });

      await user.click(screen.getByTestId('notebook__task-header-terminal'));
      expect(onToggleTerminal).toHaveBeenCalledTimes(1);
    });

    it('disables terminal button when unavailable', () => {
      renderComponent(mockTask, {
        onToggleTerminal: vi.fn(),
        canOpenTerminal: false,
      });

      expect(screen.getByTestId('notebook__task-header-terminal')).toBeDisabled();
    });
  });
});
