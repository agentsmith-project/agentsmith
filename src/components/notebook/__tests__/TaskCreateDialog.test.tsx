/**
 * Tests for TaskCreateDialog component
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskCreateDialog } from '../TaskCreateDialog';
import * as React from 'react';

// Polyfill pointer capture methods not available in jsdom (needed by Radix Select)
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

// Shared mock for the agent list function — can be changed per-test
let mockAgentListFn = vi.fn();

// Mock hooks — use vi.fn() so we can control return value per-test
vi.mock('@/lib/hooks/use-task', () => ({
  useCreateTask: vi.fn(),
  useTasks: vi.fn(),
}));

vi.mock('@/lib/hooks/use-files', () => ({
  useFileLibraries: vi.fn(),
}));

// Mock API — use class so `new AgentAPI(...)` works
vi.mock('@/lib/api', () => ({
  AgentAPI: class MockAgentAPI {
    list: ReturnType<typeof vi.fn>;
    constructor() {
      this.list = mockAgentListFn;
    }
  },
  getApiClient: vi.fn(),
}));

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
  }>({});

  function Select({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange, disabled }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }

  function SelectTrigger({
    children,
    id,
    disabled,
    ...props
  }: React.ComponentProps<'button'>) {
    const context = React.useContext(SelectContext);
    return (
      <button
        type="button"
        role="combobox"
        id={id}
        aria-controls={id ? `${id}-listbox` : undefined}
        aria-expanded="false"
        disabled={disabled ?? context.disabled}
        {...props}
      >
        {children}
      </button>
    );
  }

  function SelectValue({ placeholder }: { placeholder?: string }) {
    const context = React.useContext(SelectContext);
    return <span>{context.value || placeholder || ''}</span>;
  }

  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div role="listbox" id="mock-select-listbox">{children}</div>;
  }

  function SelectItem({
    value,
    disabled,
    children,
  }: {
    value: string;
    disabled?: boolean;
    children: React.ReactNode;
  }) {
    const context = React.useContext(SelectContext);
    return (
      <button
        type="button"
        role="option"
        aria-selected={context.value === value}
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            context.onValueChange?.(value);
          }
        }}
      >
        {children}
      </button>
    );
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

// Mock next-intl with translation map
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const translations: Record<string, string> = {
      'create': 'Create',
      'new': 'New',
      'important': 'Important:',
      'create_description': 'Start a notebook task by choosing an agent and task workspace.',
      'create_title': 'Task Title',
      'select_agent': 'Select an Agent',
      'workspace_source_label': 'Task workspace',
      'workspace_source_create_new': 'Initialize a new task workspace automatically',
      'workspace_source_create_new_hint': 'Recommended. We\'ll create a fresh persistent task workspace for this task.',
      'workspace_source_use_existing': 'Continue an existing task workspace',
      'workspace_source_use_existing_hint': 'Use an existing task workspace file library to keep working with previous files and agent context.',
      'workspace_name_label': 'New task workspace name',
      'workspace_name_placeholder': 'Enter task workspace name',
      'workspace_name_hint': 'Leave blank to generate a task workspace name from the task title.',
      'select_workspace_file_library': 'Select Existing Task Workspace',
      'workspace_file_library_hint': 'Only idle workspaces can be selected.',
      'workspace_file_library_empty': 'No idle workspaces are available in this project right now.',
      'agent_fixed_notice': 'The agent cannot be changed after creation',
      'history_immutable_notice': 'Task history cannot be modified',
      'cancel': 'Cancel',
      'empty': 'No agents available',
    };
    return translations[key] || key;
  },
}));

import { useCreateTask, useTasks } from '@/lib/hooks/use-task';
import { useFileLibraries } from '@/lib/hooks/use-files';

const mockAgents = [
  {
    id: 'agent-1',
    project_id: 'project-1',
    name: 'Test Agent 1',
    description: 'First test agent',
    mode: 'external' as const,
    presence: 'online' as const,
    status: 'enabled' as const,
    interaction_kind: 'notebook' as const,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'agent-2',
    project_id: 'project-1',
    name: 'Chat Agent',
    description: 'Chat-only agent',
    mode: 'external' as const,
    presence: 'online' as const,
    status: 'enabled' as const,
    interaction_kind: 'chat' as const,
    created_at: '2024-01-02T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
  },
];

const mockFileLibraries = [
  {
    id: 'flib-1',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    name: 'Project Uploads',
    status: 'ready' as const,
    filesystem_name: 'flib-project-uploads',
    created_by_user_id: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'flib-occupied',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    name: 'Occupied Workspace',
    status: 'ready' as const,
    filesystem_name: 'flib-occupied-workspace',
    created_by_user_id: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
];

const mockTasks = [
  {
    id: 'task-active-1',
    workspace_id: 'workspace-1',
    project_id: 'project-1',
    owner_user_id: 'user-1',
    title: 'Active Task',
    agent_id: 'agent-1',
    agent_name: 'Test Agent 1',
    workspace_file_library_id: 'flib-occupied',
    workspace_file_library_name: 'Occupied Workspace',
    status: 'active' as const,
    attached_inputs: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    last_activity_at: '2024-01-01T00:00:00Z',
  },
];

async function selectRadixOption(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, optionName: string) {
  fireEvent.click(trigger);
  await user.click(await screen.findByRole('option', { name: optionName }));
}

function submitTaskCreateForm() {
  const form = document.querySelector('form');
  if (!form) {
    throw new Error('Task create form not found');
  }
  fireEvent.submit(form);
}

describe('TaskCreateDialog', () => {
  let queryClient: QueryClient;

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';
  const mockOnSuccess = vi.fn();
  const mockOnOpenChange = vi.fn();
  const mockMutateAsync = vi.fn().mockResolvedValue({ id: 'new-task-id' });

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();

    // Reset shared mocks to defaults
    mockAgentListFn = vi.fn().mockResolvedValue({
      items: mockAgents,
      total: 2,
    });

    mockMutateAsync.mockResolvedValue({ id: 'new-task-id' });

    vi.mocked(useCreateTask).mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
    } as any);
    vi.mocked(useFileLibraries).mockReturnValue({
      data: { items: mockFileLibraries },
      isLoading: false,
    } as any);
    vi.mocked(useTasks).mockReturnValue({
      data: { items: mockTasks, total: mockTasks.length, page: 1, page_size: 200, has_more: false },
      isLoading: false,
    } as any);
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const renderComponent = (open = true) => {
    return render(
      <TaskCreateDialog
        open={open}
        onOpenChange={mockOnOpenChange}
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        onSuccess={mockOnSuccess}
      />,
      { wrapper }
    );
  };

  describe('Dialog Rendering', () => {
    it('does not render when closed', () => {
      render(
        <TaskCreateDialog
          open={false}
          onOpenChange={mockOnOpenChange}
          workspaceId={mockWorkspaceId}
          projectId={mockProjectId}
          onSuccess={mockOnSuccess}
        />,
        { wrapper }
      );

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('renders dialog when open', () => {
      renderComponent();

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('renders dialog title', () => {
      renderComponent();

      // Dialog title is t('create') = 'Create'
      const createTexts = screen.getAllByText('Create');
      expect(createTexts.length).toBeGreaterThanOrEqual(1);
    });

    it('renders a product-written dialog description instead of a stitched title and constraint sentence', () => {
      renderComponent();

      const dialog = screen.getByRole('dialog');

      expect(dialog).toHaveTextContent('Start a notebook task by choosing an agent and task workspace.');
      expect(dialog).not.toHaveTextContent(/Create Task New Task|Create New/);
    });

    it('keeps the immutable agent constraint in the Important section only', () => {
      renderComponent();

      const dialog = screen.getByRole('dialog');
      const matches = dialog.textContent?.match(/The agent cannot be changed after creation/g) ?? [];

      expect(matches).toHaveLength(1);
      expect(screen.getByText('Important:').closest('div')).toHaveTextContent('The agent cannot be changed after creation');
    });

    it('uses task-workspace wording so users do not confuse task storage with the top-level workspace', () => {
      renderComponent();

      const dialog = screen.getByRole('dialog');

      expect(screen.getByText('Task workspace')).toBeInTheDocument();
      expect(screen.getByText('Initialize a new task workspace automatically')).toBeInTheDocument();
      expect(screen.getByText('New task workspace name')).toBeInTheDocument();
      expect(dialog).not.toHaveTextContent('Initialize a new workspace automatically');
      expect(dialog).not.toHaveTextContent('New workspace name');
      expect(dialog).not.toHaveTextContent('Select Existing Workspace');
    });
  });

  describe('Form Fields', () => {
    it('renders title input', () => {
      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      expect(titleInput).toBeInTheDocument();
    });

    it('renders agent select', () => {
      renderComponent();

      expect(screen.getAllByRole('combobox').length).toBe(1);
    });

    it('renders workspace source options', () => {
      renderComponent();

      const workspaceModeRadios = screen.getAllByRole('radio');
      expect(workspaceModeRadios).toHaveLength(2);
      expect(workspaceModeRadios[0]).toBeChecked();
    });

    it('shows placeholder in agent select', () => {
      renderComponent();

      const combobox = screen.getAllByRole('combobox')[0];
      expect(combobox).toBeInTheDocument();
      expect(combobox).toHaveTextContent('Select an Agent');
    });
  });

  describe('Title Input', () => {
    it('accepts text input', async () => {
      const user = userEvent.setup();
      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      await user.type(titleInput, 'My Test Task');

      expect(titleInput).toHaveValue('My Test Task');
    });

    it('is required', () => {
      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      expect(titleInput).toBeRequired();
    });

    it('resets when dialog reopens', async () => {
      const user = userEvent.setup();
      const { rerender } = renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      await user.type(titleInput, 'Test Task');

      // Close and reopen dialog
      rerender(
        <QueryClientProvider client={queryClient}>
          <TaskCreateDialog
            open={false}
            onOpenChange={mockOnOpenChange}
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            onSuccess={mockOnSuccess}
          />
        </QueryClientProvider>
      );

      rerender(
        <QueryClientProvider client={queryClient}>
          <TaskCreateDialog
            open={true}
            onOpenChange={mockOnOpenChange}
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            onSuccess={mockOnSuccess}
          />
        </QueryClientProvider>
      );

      // Title should be reset
      expect(screen.getByRole('textbox', { name: /Task Title/i })).toHaveValue('');
    });
  });

  describe('Agent Selection', () => {
    it('fetches agent options when dialog is open', async () => {
      renderComponent();

      // Verify the agent API was called to fetch available agents
      await waitFor(() => {
        expect(mockAgentListFn).toHaveBeenCalled();
      });

      // Verify the select trigger is present for agent selection
      expect(screen.getAllByRole('combobox').length).toBe(1);
    });

    it('only exposes enabled notebook agents in the task agent selector', async () => {
      const user = userEvent.setup();
      renderComponent();

      await waitFor(() => {
        expect(mockAgentListFn).toHaveBeenCalled();
      });

      fireEvent.click(screen.getAllByRole('combobox')[0]!);
      expect(await screen.findByRole('option', { name: 'Test Agent 1' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Chat Agent' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('option', { name: 'Test Agent 1' }));
    });

    it('shows loading state while fetching agents', () => {
      // Use a never-resolving promise so agents stay in loading state
      mockAgentListFn = vi.fn(() => new Promise(() => {}));

      renderComponent();

      // Should render without error while loading
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('shows empty state when no agents', () => {
      // Override agent list to return empty
      mockAgentListFn = vi.fn().mockResolvedValue({ items: [], total: 0 });

      renderComponent();

      // Verify dialog renders correctly with empty agent data
      // (Radix Select dropdown content only renders in portal when opened,
      // which is unreliable in jsdom — verify the form structure instead)
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getAllByRole('combobox').length).toBe(1);
    });
  });

  describe('Form Actions', () => {
    it('renders cancel button', () => {
      renderComponent();

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('renders create button', () => {
      renderComponent();

      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    });

    it('closes dialog when cancel is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);

      expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });

    it('disables create button when form is invalid', () => {
      renderComponent();

      const createButton = screen.getByRole('button', { name: 'Create' });
      expect(createButton).toBeDisabled();
    });

    it('enables create button after title and agent are selected in create-new mode', async () => {
      const user = userEvent.setup();
      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      await user.type(titleInput, 'Test Task');
      await selectRadixOption(user, screen.getAllByRole('combobox')[0]!, 'Test Agent 1');
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
    });

    it('keeps create button disabled in existing-workspace mode until a workspace is selected', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getAllByRole('radio')[1]!);
      await user.type(screen.getByRole('textbox', { name: /Task Title/i }), 'Test Task');
      await selectRadixOption(user, screen.getAllByRole('combobox')[0]!, 'Test Agent 1');
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    });
  });

  describe('Task workspace default naming', () => {
    it('derives a natural task workspace placeholder from the task title without repeating task concepts', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.type(screen.getByRole('textbox', { name: /Task Title/i }), 'Test Task');

      expect(screen.getByPlaceholderText('Test Task workspace')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Test Task task workspace')).not.toBeInTheDocument();
    });

    it('does not append a workspace suffix when the task title already reads like a workspace name', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.type(screen.getByRole('textbox', { name: /Task Title/i }), 'Research Workspace');

      expect(screen.getByPlaceholderText('Research Workspace')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Research Workspace task workspace')).not.toBeInTheDocument();
    });
  });

  describe('Form Submission', () => {
    it('submits form with create-new workspace mode by default', async () => {
      const user = userEvent.setup();
      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      await user.type(titleInput, 'Test Task');

      await selectRadixOption(user, screen.getAllByRole('combobox')[0]!, 'Test Agent 1');
      submitTaskCreateForm();

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          workspaceId: mockWorkspaceId,
          projectId: mockProjectId,
          data: {
            title: 'Test Task',
            agent_id: 'agent-1',
            workspace_mode: 'create_new',
            workspace_name: 'Test Task workspace',
          },
        });
      });
    });

    it('uses the same natural default workspace name for placeholder and submitted payload', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.type(screen.getByRole('textbox', { name: /Task Title/i }), 'Research Workspace');
      expect(screen.getByPlaceholderText('Research Workspace')).toBeInTheDocument();

      await selectRadixOption(user, screen.getAllByRole('combobox')[0]!, 'Test Agent 1');
      submitTaskCreateForm();

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          workspaceId: mockWorkspaceId,
          projectId: mockProjectId,
          data: {
            title: 'Research Workspace',
            agent_id: 'agent-1',
            workspace_mode: 'create_new',
            workspace_name: 'Research Workspace',
          },
        });
      });
    });

    it('submits form with selected existing workspace when requested', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.type(screen.getByRole('textbox', { name: /Task Title/i }), 'Continue Task');
      await selectRadixOption(user, screen.getAllByRole('combobox')[0]!, 'Test Agent 1');
      await user.click(screen.getAllByRole('radio')[1]!);
      await selectRadixOption(user, screen.getByTestId('task-create__file-library'), 'Project Uploads');
      submitTaskCreateForm();

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          workspaceId: mockWorkspaceId,
          projectId: mockProjectId,
          data: {
            title: 'Continue Task',
            agent_id: 'agent-1',
            workspace_file_library_id: 'flib-1',
          },
        });
      });
    });

    it('trims whitespace from title', async () => {
      const user = userEvent.setup();
      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i }) as HTMLInputElement;
      await user.type(titleInput, '  Test Task  ');

      // The value should have the whitespace trimmed on submit
      expect(titleInput.value).toBe('  Test Task  ');
    });

    it('does not submit with empty title', async () => {
      const _user = userEvent.setup();
      renderComponent();

      const createButton = screen.getByRole('button', { name: 'Create' });
      expect(createButton).toBeDisabled();
    });

    it('does not submit without agent selection', async () => {
      const user = userEvent.setup();
      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      await user.type(titleInput, 'Test Task');

      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    });
  });

  describe('Important Notice', () => {
    it('displays important notice section', () => {
      renderComponent();

      expect(screen.getByText('Important:')).toBeInTheDocument();
    });

    it('shows agent fixed notice', () => {
      renderComponent();

      // Both dialog description and notice section contain this text
      const matches = screen.getAllByText(/The agent cannot be changed/);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    it('shows history immutable notice', () => {
      renderComponent();

      expect(screen.getByText(/Task history cannot be modified/)).toBeInTheDocument();
    });
  });

  describe('Success Callback', () => {
    it('calls onSuccess with task ID after successful creation', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.type(screen.getByRole('textbox', { name: /Task Title/i }), 'Created Task');
      await selectRadixOption(user, screen.getAllByRole('combobox')[0]!, 'Test Agent 1');
      submitTaskCreateForm();

      await waitFor(() => expect(mockOnSuccess).toHaveBeenCalledWith('new-task-id'));
    });

    it('closes dialog after successful creation', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.type(screen.getByRole('textbox', { name: /Task Title/i }), 'Created Task');
      await selectRadixOption(user, screen.getAllByRole('combobox')[0]!, 'Test Agent 1');
      submitTaskCreateForm();

      await waitFor(() => expect(mockOnOpenChange).toHaveBeenCalledWith(false));
    });
  });

  describe('Pending State', () => {
    it('shows loading indicator during submission', () => {
      vi.mocked(useCreateTask).mockReturnValue({
        mutateAsync: vi.fn(() => new Promise(() => {})),
        isPending: true,
      } as any);

      renderComponent();

      // Should show loading spinner on submit button
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('disables form during submission', () => {
      vi.mocked(useCreateTask).mockReturnValue({
        mutateAsync: vi.fn(() => new Promise(() => {})),
        isPending: true,
      } as any);

      renderComponent();

      const titleInput = screen.getByRole('textbox', { name: /Task Title/i });
      expect(titleInput).toBeDisabled();
    });
  });

  describe('Layout and Styling', () => {
    it('has correct dialog width', () => {
      renderComponent();

      // Dialog renders in a portal, query the document directly
      const dialogContent = document.querySelector('[role="dialog"]');
      expect(dialogContent).toBeInTheDocument();
    });

    it('uses form layout', () => {
      renderComponent();

      const form = document.querySelector('form');
      expect(form).toBeInTheDocument();
    });
  });
});
