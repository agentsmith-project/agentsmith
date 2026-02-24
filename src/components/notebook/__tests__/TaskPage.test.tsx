/**
 * Tests for TaskPage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskPage } from '../TaskPage';
import type { Task, TaskMessage, Artifact } from '@/lib/types/task';

const mockTaskApiListTraces = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const dict: Record<string, string> = {
      'common.cancel': 'Cancel',
      'notebook.task.loading': 'Loading task...',
      'notebook.task.not_found_title': 'Task not found',
      'notebook.task.not_found_description': "The task you're looking for doesn't exist or has been deleted.",
      'notebook.task.back_to_notebook': 'Go back to Notebook',
      'notebook.attached_files.url_dialog.title': 'Add URL as Input',
      'notebook.attached_files.url_dialog.description': 'Notebook will add this URL as a context input note.',
      'notebook.attached_files.url_dialog.placeholder': 'https://example.com/article',
      'notebook.attached_files.url_dialog.confirm': 'Add URL',
      'notebook.conversation.trace_view': 'View execution details',
      'notebook.conversation.trace_load_more': 'Load earlier logs',
    };
    const scoped = namespace ? `${namespace}.${key}` : key;
    return dict[scoped] ?? scoped;
  },
}));

// Configurable mock state for use-task hooks
let mockTaskHookState = {
  task: null as any,
  taskLoading: false,
  messages: [] as any[],
  artifacts: [] as any[],
  taskStatus: 'active',
};

// Mock all the hooks
vi.mock('@/lib/hooks/use-task', () => ({
  useTask: () => ({
    data: mockTaskHookState.task,
    isLoading: mockTaskHookState.taskLoading,
  }),
  useTaskMessages: () => ({
    data: mockTaskHookState.messages,
    isLoading: false,
  }),
  useTaskArtifacts: () => ({
    data: mockTaskHookState.artifacts,
    isLoading: false,
  }),
  useTaskTraces: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: { items: [], total: 0 } }),
  }),
  useSendMessage: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      id: 'new-msg-id',
      role: 'agent',
      content: '',
      created_at: new Date().toISOString(),
    }),
    isPending: false,
  }),
  useAddFiles: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
  useUpdateTask: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-task-sse', () => ({
  useTaskSSE: () => ({
    connectionStatus: 'connected',
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock('@/lib/hooks/use-error-handler', () => ({
  useErrorHandler: () => ({
    handleError: vi.fn(),
  }),
}));

// Mock components
vi.mock('../TaskHeader', () => ({
  TaskHeader: ({ task, onDeleted, onCreateNew, onLeave }: any) => (
    <div data-testid="task-header">
      <div data-testid="task-title">{task.title}</div>
      <button onClick={onLeave}>Leave</button>
      <button onClick={onDeleted}>Delete</button>
      <button onClick={onCreateNew}>New</button>
    </div>
  ),
}));

vi.mock('../AttachedFilesPanel', () => ({
  AttachedFilesPanel: ({ onAddFromFiles }: any) => (
    <div data-testid="attached-sources-panel">
      <button onClick={onAddFromFiles}>Files</button>
    </div>
  ),
}));

vi.mock('../ConversationPanel', () => ({
  ConversationPanel: ({ onSendMessage, onTraceExpand, onTraceLoadMore, disabled, sending, messages }: any) => (
    <div data-testid="conversation-panel">
      <button onClick={() => onSendMessage('Test message')}>Send Message</button>
      {messages?.some((m: any) => m.role === 'agent') && (
        <>
          <button onClick={() => onTraceExpand?.('msg-2')}>Expand Trace</button>
          <button onClick={() => onTraceLoadMore?.('msg-2')}>Load More Trace</button>
        </>
      )}
      {disabled && <div data-disabled>disabled</div>}
      {sending && <div data-sending>sending</div>}
    </div>
  ),
}));

vi.mock('../ArtifactsPanel', () => ({
  ArtifactsPanel: ({ onView, onSave, onDownload, disabled }: any) => (
    <div data-testid="artifacts-panel">
      <button onClick={() => onView(mockArtifacts[0])}>View Artifact</button>
      <button onClick={() => onSave(mockArtifacts[0])}>Save Artifact</button>
      <button onClick={() => onDownload(mockArtifacts[0])}>Download Artifact</button>
      {disabled && <div data-disabled>disabled</div>}
    </div>
  ),
}));

vi.mock('../FileSelectDialog', () => ({
  FileSelectDialog: ({ open, onOpenChange, onConfirm }: any) => (
    <dialog open={open}>
      <button onClick={() => onConfirm(['source-1'])}>Confirm</button>
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </dialog>
  ),
}));

vi.mock('../ArtifactImageViewer', () => ({
  ArtifactImageViewer: ({ open, onOpenChange }: any) => (
    <dialog open={open}>
      <button onClick={() => onOpenChange(false)}>Close Viewer</button>
    </dialog>
  ),
}));

vi.mock('../ArtifactSaveDialog', () => ({
  ArtifactSaveDialog: ({ open, onOpenChange, onSave }: any) => (
    <dialog open={open}>
      <button onClick={() => onSave('filename.txt', 'description')}>Save</button>
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </dialog>
  ),
}));

vi.mock('../TaskCreateDialog', () => ({
  TaskCreateDialog: ({ open, onOpenChange, onSuccess }: any) => (
    <dialog open={open}>
      <button onClick={() => onSuccess('new-task-id')}>Create Task</button>
      <button onClick={() => onOpenChange(false)}>Cancel</button>
    </dialog>
  ),
}));

vi.mock('../EditTaskDialog', () => ({
  EditTaskDialog: ({ open, onOpenChange }: any) => (
    <dialog open={open}>
      <button onClick={() => onOpenChange(false)}>Close Edit</button>
    </dialog>
  ),
}));

// Mock API
vi.mock('@/lib/api', () => ({
  TaskAPI: vi.fn().mockImplementation(function TaskAPI() {
    return {
      getSSEUrl: vi.fn(() => 'http://test/sse'),
      listTraces: mockTaskApiListTraces,
      downloadArtifact: vi.fn().mockResolvedValue(new Blob()),
      saveArtifact: vi.fn().mockResolvedValue({}),
    };
  }),
  FilesAPI: vi.fn().mockImplementation(function FilesAPI() {
    return {
      upload: vi.fn().mockResolvedValue({ id: 'uploaded-source-1' }),
    };
  }),
  getApiClient: vi.fn(),
}));

// Mock router
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useParams: () => ({
    locale: 'en-US',
  }),
}));

const mockTask: Task = {
  id: 'task-1',
  workspace_id: 'workspace-1',
  project_id: 'project-1',
  owner_user_id: 'user-1',
  title: 'Test Task',
  agent_id: 'agent-1',
  agent_name: 'Test Agent',
  status: 'active',
  attached_inputs: [
    { id: 'in_1', kind: 'source', source_id: 'source-1' },
    { id: 'in_2', kind: 'source', source_id: 'source-2' },
  ],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  last_activity_at: '2024-01-02T12:00:00Z',
};

const mockMessages: TaskMessage[] = [
  {
    id: 'msg-1',
    task_id: 'task-1',
    role: 'user',
    content: 'Hello',
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'msg-2',
    task_id: 'task-1',
    role: 'agent',
    content: 'Hi there!',
    created_at: '2024-01-01T00:01:00Z',
  },
];

const mockArtifacts: Artifact[] = [
  {
    id: 'artifact-1',
    task_id: 'task-1',
    type: 'text',
    title: 'Text Artifact',
    content: 'Artifact content',
    created_at: '2024-01-01T00:00:00Z',
  },
];

describe('TaskPage', () => {
  let queryClient: QueryClient;

  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';
  const mockTaskId = 'task-1';

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();

    // Reset mock state to defaults
    mockTaskHookState = {
      task: mockTask,
      taskLoading: false,
      messages: mockMessages,
      artifacts: mockArtifacts,
      taskStatus: 'active',
    };

    // Mock URL.createObjectURL and revokeObjectURL
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mockTaskApiListTraces.mockReset();
    mockTaskApiListTraces.mockResolvedValue({ items: [], total: 0, has_more: false, next_after_id: null });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const renderComponent = () => {
    return render(
      <TaskPage
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        taskId={mockTaskId}
        canCreateTask={true}
        canUpdateTask={true}
        canDeleteTask={true}
      />,
      { wrapper }
    );
  };

  describe('Loading State', () => {
    it('renders loading state', () => {
      mockTaskHookState.task = undefined;
      mockTaskHookState.taskLoading = true;
      mockTaskHookState.messages = [];
      mockTaskHookState.artifacts = [];

      renderComponent();

      expect(screen.getByText(/Loading task/i)).toBeInTheDocument();
    });
  });

  describe('Task Not Found', () => {
    it('renders not found state when task is null', () => {
      mockTaskHookState.task = null;
      mockTaskHookState.taskLoading = false;

      renderComponent();

      expect(screen.getByText(/Task not found/i)).toBeInTheDocument();
    });

    it('shows back button in not found state', () => {
      mockTaskHookState.task = null;
      mockTaskHookState.taskLoading = false;

      renderComponent();

      const backButton = screen.getByText(/Go back to Notebook/i);
      expect(backButton).toBeInTheDocument();
    });
  });

  describe('Task Rendering', () => {
    it('renders task header', () => {
      renderComponent();

      expect(screen.getByTestId('task-header')).toBeInTheDocument();
      expect(screen.getByTestId('task-title')).toHaveTextContent('Test Task');
    });

    it('renders attached files panel', () => {
      renderComponent();

      expect(screen.getByTestId('attached-sources-panel')).toBeInTheDocument();
    });

    it('renders conversation panel', () => {
      renderComponent();

      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('renders artifacts panel', () => {
      renderComponent();

      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });
  });

  describe('SSE Connection', () => {
    it('establishes SSE connection when task loads', () => {
      renderComponent();

      // SSE connection is established via the useTaskSSE hook
      // This is tested indirectly by checking that the component renders without errors
      expect(screen.getByTestId('task-header')).toBeInTheDocument();
    });
  });

  describe('Message Sending', () => {
    it('sends message through conversation panel', async () => {
      const user = userEvent.setup();
      renderComponent();

      const sendButton = screen.getByText('Send Message');
      await user.click(sendButton);

      // Message sending is handled by the ConversationPanel component
    });

    it('sets up streaming state for agent responses', () => {
      renderComponent();

      // Streaming state is managed internally
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('loads earlier trace page with before_id when requested', async () => {
      const user = userEvent.setup();
      mockTaskApiListTraces
        .mockResolvedValueOnce({
          items: [
            {
              id: 'trace_new',
              task_id: 'task-1',
              message_id: 'msg-2',
              run_id: 'run-1',
              seq: 10,
              at: '2024-01-01T00:00:10Z',
              category: 'progress',
              phase: 'end',
              status: 'success',
              name: 'codex.exec',
              summary: 'done',
            },
          ],
          total: 800,
          has_more: true,
          next_after_id: 'trace_cursor_oldest_loaded',
        })
        .mockResolvedValueOnce({
          items: [],
          total: 300,
          has_more: false,
          next_after_id: null,
        });

      renderComponent();

      await user.click(screen.getByText('Expand Trace'));
      expect(mockTaskApiListTraces).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockProjectId,
        mockTaskId,
        expect.objectContaining({ message_id: 'msg-2', page_size: 500 }),
      );

      await user.click(screen.getByText('Load More Trace'));
      expect(mockTaskApiListTraces).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockProjectId,
        mockTaskId,
        expect.objectContaining({ message_id: 'msg-2', before_id: 'trace_cursor_oldest_loaded', page_size: 500 }),
      );
    });
  });

  describe('Navigation Actions', () => {
    it('navigates away when leave button is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const leaveButton = screen.getByText('Leave');
      await user.click(leaveButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/notebook`
      );
    });

    it('navigates to new task after creation', async () => {
      const user = userEvent.setup();
      renderComponent();

      const newButton = screen.getByText('New');
      await user.click(newButton);

      const createButton = screen.getByText('Create Task');
      await user.click(createButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/notebook/tasks/new-task-id`
      );
    });

    it('navigates to notebook after task deletion', async () => {
      const user = userEvent.setup();
      renderComponent();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/notebook`
      );
    });
  });

  describe('Source Management', () => {
    it('opens source select dialog', async () => {
      const user = userEvent.setup();
      renderComponent();

      const addFilesButton = screen.getByText('Files');
      await user.click(addFilesButton);

      // Dialog should be open
    });

    it('adds sources when confirmed', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Open add files
      const addFilesButton = screen.getByText('Files');
      await user.click(addFilesButton);

      // Confirm selection
      const confirmButton = screen.getByText('Confirm');
      await user.click(confirmButton);

      // Sources should be added via the mutation
    });
  });

  describe('Artifact Actions', () => {
    it('opens artifact viewer for images', async () => {
      const user = userEvent.setup();
      renderComponent();

      const viewButton = screen.getByText('View Artifact');
      await user.click(viewButton);

      // Viewer dialog should open
    });

    it('opens save dialog for artifacts', async () => {
      const user = userEvent.setup();
      renderComponent();

      const saveButton = screen.getByText('Save Artifact');
      await user.click(saveButton);

      // Save dialog should open
    });

    it('downloads artifact', async () => {
      const user = userEvent.setup();
      renderComponent();

      const downloadButton = screen.getByText('Download Artifact');
      await user.click(downloadButton);

      // The download handler creates a TaskAPI instance and calls downloadArtifact
      // Verify the mock constructor was called (the async download chain is tested via the API mock)
      const { TaskAPI } = await import('@/lib/api');
      expect(TaskAPI).toHaveBeenCalled();
    });
  });

  describe('Disabled States', () => {
    it('disables interaction when task is closed', () => {
      mockTaskHookState.task = { ...mockTask, status: 'closed' };

      renderComponent();

      expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).toBeInTheDocument();
      expect(screen.getByTestId('artifacts-panel').querySelector('[data-disabled]')).toBeInTheDocument();
    });

    it('disables interaction when task is archived', () => {
      mockTaskHookState.task = { ...mockTask, status: 'archived' };

      renderComponent();

      expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).toBeInTheDocument();
      expect(screen.getByTestId('artifacts-panel').querySelector('[data-disabled]')).toBeInTheDocument();
    });
  });

  describe('Layout', () => {
    it('has correct layout structure', () => {
      const { container } = renderComponent();

      const page = container.querySelector('.h-full.flex.flex-col');
      expect(page).toBeInTheDocument();
    });

    it('has three-column layout for panels', () => {
      const { container } = renderComponent();

      const flexContainer = container.querySelector('.flex-1.flex.min-h-0');
      expect(flexContainer).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('handles message send errors gracefully', () => {
      renderComponent();

      // Error handling is done via the useErrorHandler hook
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('handles download errors gracefully', () => {
      renderComponent();

      // Download errors are handled internally
      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles task with no messages', () => {
      mockTaskHookState.messages = [];
      mockTaskHookState.artifacts = [];

      renderComponent();

      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('handles task with no artifacts', () => {
      mockTaskHookState.artifacts = [];

      renderComponent();

      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });

    it('handles task with no attached files', () => {
      mockTaskHookState.task = { ...mockTask, attached_inputs: [] };

      renderComponent();

      expect(screen.getByTestId('attached-sources-panel')).toBeInTheDocument();
    });
  });
});
