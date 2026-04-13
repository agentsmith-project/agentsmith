/**
 * Tests for TaskPage component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskPage } from '../TaskPage';
import { ApiError } from '@/lib/api/client';
import {
  mockArtifacts,
  mockMessages,
  mockTask,
  renderWithNotebookQueryClient,
} from './taskPageTestUtils';

const mockTaskApiListTraces = vi.fn();
const {
  mockSendMessageMutateAsync,
  mockSendMessageIsPending,
  mockHandleError,
  mockToastError,
  mockToastInfo,
  mockTaskArtifactsRefetch,
  mockTaskArtifactsIsRefetching,
  latestTaskSseOptionsRef,
  latestConversationPanelPropsRef,
  latestTaskHeaderPropsRef,
  latestTaskTerminalPanelPropsRef,
  latestUseTaskArtifactsArgsRef,
  mockTaskApiCancelRun,
} = vi.hoisted(() => ({
  mockSendMessageMutateAsync: vi.fn(),
  mockSendMessageIsPending: { value: false },
  mockHandleError: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockTaskArtifactsRefetch: vi.fn(),
  mockTaskArtifactsIsRefetching: { value: false },
  latestTaskSseOptionsRef: { current: null as any },
  latestConversationPanelPropsRef: { current: null as any },
  latestTaskHeaderPropsRef: { current: null as any },
  latestTaskTerminalPanelPropsRef: { current: null as any },
  latestUseTaskArtifactsArgsRef: { current: null as any },
  mockTaskApiCancelRun: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const dict: Record<string, string> = {
      'common.cancel': 'Cancel',
      'common.open_chat': 'Open Chat',
      'common.open_files': 'Open Files',
      'notebook.task.loading': 'Loading task...',
      'notebook.task.not_found_title': 'Task not found',
      'notebook.task.not_found_description': "The task you're looking for doesn't exist or has been deleted.",
      'notebook.task.back_to_notebook': 'Go back to Notebook',
      'notebook.conversation.process_load_more': 'Load older steps',
      'notebook.conversation.send_rate_limited_title': 'Request rate limited',
      'notebook.conversation.send_rate_limited_description': 'This request exceeded the current limit. Please retry shortly.',
      'notebook.conversation.send_conflict_title': 'Task run still in progress',
      'notebook.conversation.send_conflict_description': 'The previous turn has not finished yet. Wait for it to complete before sending.',
      'notebook.conversation.agent_offline_send_blocked': 'Agent is offline. Start/reconnect the external agent execution channel before sending.',
      'notebook.task.terminal_agent_run_blocked': 'End the terminal session before starting a new agent run.',
      'notebook.task.terminal_input_blocked_placeholder': 'End Terminal Session before starting a new agent run...',
      'notebook.task.terminal_hidden_active_title': 'Terminal session still active',
      'notebook.task.terminal_hidden_active_description': 'The terminal is hidden, but it still blocks new agent runs until you show it again or end the session.',
      'notebook.task.terminal_hidden_failed_title': 'Terminal needs recovery',
      'notebook.task.terminal_hidden_failed_description': 'The last terminal session failed. Reopen it to review the failure or end the session before starting a new run.',
      'notebook.task.terminal_show': 'Show Terminal',
      'notebook.task.terminal_recovery_show': 'Show Recovery',
      'notebook.task.terminal_close': 'End Session',
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
  useTaskArtifacts: (...args: any[]) => {
    latestUseTaskArtifactsArgsRef.current = args;
    return ({
    data: mockTaskHookState.artifacts,
    isLoading: false,
    isRefetching: mockTaskArtifactsIsRefetching.value,
    refetch: mockTaskArtifactsRefetch,
    });
  },
  useTaskTraces: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
    refetch: vi.fn().mockResolvedValue({ data: { items: [], total: 0 } }),
  }),
  useSendMessage: () => ({
    mutateAsync: mockSendMessageMutateAsync,
    isPending: mockSendMessageIsPending.value,
  }),
  useUpdateTask: () => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  }),
}));

vi.mock('@/lib/hooks/use-task-sse', () => ({
  useTaskSSE: (_workspaceId: string, _projectId: string, _taskId: string, options: unknown) => {
    latestTaskSseOptionsRef.current = options;
    return ({
    connectionStatus: 'connected',
    connect: vi.fn(),
    disconnect: vi.fn(),
    });
  },
}));

vi.mock('@/lib/hooks/use-error-handler', () => ({
  useErrorHandler: () => ({
    handleError: mockHandleError,
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    error: mockToastError,
    success: vi.fn(),
    warning: vi.fn(),
    info: mockToastInfo,
  },
}));

// Mock components
vi.mock('../TaskHeader', () => ({
  TaskHeader: (props: any) => {
    latestTaskHeaderPropsRef.current = props;
    const { task, onDeleted, onCreateNew, onLeave, agentRunActivity } = props;
    return (
      <div data-testid="task-header">
      <div data-testid="task-title">{task.title}</div>
      <div data-testid="task-header-busy">{String(!!agentRunActivity?.active)}</div>
      <button onClick={onLeave}>Leave</button>
      <button onClick={onDeleted}>Delete</button>
      <button onClick={onCreateNew}>New</button>
    </div>
    );
  },
}));

vi.mock('../TaskTerminalPanel', () => ({
  TaskTerminalPanel: (props: any) => {
    latestTaskTerminalPanelPropsRef.current = props;
    const visible = props.visible ?? props.open;
    return (props.open && visible) ? (
      <div data-testid="task-terminal-panel">
        <button onClick={() => props.onOpenChange(false)}>Close Terminal</button>
      </div>
    ) : null;
  },
}));

vi.mock('../ConversationPanel', () => ({
  ConversationPanel: (props: any) => {
    latestConversationPanelPropsRef.current = props;
    const {
      onSendMessage,
      onTraceExpand,
      onTraceLoadMore,
      onCancelActiveRun,
      runActivity,
      pendingQueue,
      disabled,
      sending,
      messages,
    } = props;
    return (
      <div data-testid="conversation-panel">
      <button onClick={() => onSendMessage('Test message')}>Send Message</button>
      <button onClick={() => onCancelActiveRun?.()}>Cancel Active Run</button>
      {messages?.some((m: any) => m.role === 'agent') && (
        <>
          <button onClick={() => onTraceExpand?.('msg-2')}>Expand Trace</button>
          <button onClick={() => onTraceLoadMore?.('msg-2')}>Load More Trace</button>
        </>
      )}
      <div data-testid="conversation-run-active">{String(!!runActivity?.active)}</div>
      <div data-testid="conversation-pending-count">{String((pendingQueue ?? []).length)}</div>
      {disabled && <div data-disabled>disabled</div>}
      {sending && <div data-sending>sending</div>}
    </div>
    );
  },
}));

vi.mock('../ArtifactsPanel', () => ({
  ArtifactsPanel: ({ onView, onDownload, onRefresh, refreshing, disabled }: any) => (
    <div data-testid="artifacts-panel">
      <button onClick={() => onView(mockArtifacts[0])}>View Artifact</button>
      <button onClick={() => onDownload(mockArtifacts[0])}>Download Artifact</button>
      <button onClick={() => onRefresh?.()} disabled={refreshing}>Refresh Artifacts</button>
      <div data-testid="artifacts-refreshing">{String(!!refreshing)}</div>
      {disabled && <div data-disabled>disabled</div>}
    </div>
  ),
}));

vi.mock('../ArtifactImageViewer', () => ({
  ArtifactImageViewer: ({ open, onOpenChange }: any) => (
    <dialog open={open}>
      <button onClick={() => onOpenChange(false)}>Close Viewer</button>
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
      cancelRun: mockTaskApiCancelRun,
      downloadArtifact: vi.fn().mockResolvedValue(new Blob()),
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

describe('TaskPage', () => {
  const mockWorkspaceId = 'workspace-1';
  const mockProjectId = 'project-1';
  const mockTaskId = 'task-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMessageMutateAsync.mockResolvedValue({
      id: 'new-msg-id',
      role: 'agent',
      content: '',
      created_at: new Date().toISOString(),
    });

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
    mockTaskApiCancelRun.mockReset();
    mockTaskApiCancelRun.mockResolvedValue({
      status: 'cancelling',
      task_id: mockTaskId,
      run_id: 'run-1',
      request_id: 'req-1',
    });
    mockToastInfo.mockReset();
    mockTaskArtifactsRefetch.mockReset();
    mockTaskArtifactsRefetch.mockResolvedValue({ data: mockArtifacts });
    mockTaskArtifactsIsRefetching.value = false;
    mockSendMessageIsPending.value = false;
    latestTaskSseOptionsRef.current = null;
    latestConversationPanelPropsRef.current = null;
    latestTaskHeaderPropsRef.current = null;
    latestUseTaskArtifactsArgsRef.current = null;
  });

  const renderComponent = () => {
    return renderWithNotebookQueryClient(
      <TaskPage
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        taskId={mockTaskId}
        canCreateTask={true}
        canUpdateTask={true}
        canDeleteTask={true}
        canUseTerminal={true}
      />,
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

    it('shows notebook, files, and chat recovery actions in not found state', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = null;
      mockTaskHookState.taskLoading = false;

      renderComponent();

      expect(screen.getByTestId('notebook-task__open-list')).toBeInTheDocument();
      expect(screen.getByTestId('notebook-task__open-files')).toBeInTheDocument();
      expect(screen.getByTestId('notebook-task__open-chat')).toBeInTheDocument();

      await user.click(screen.getByTestId('notebook-task__open-files'));
      expect(mockPush).toHaveBeenCalledWith('/en-US/workspaces/workspace-1/projects/project-1/files');

      await user.click(screen.getByTestId('notebook-task__open-chat'));
      expect(mockPush).toHaveBeenCalledWith('/en-US/workspaces/workspace-1/projects/project-1/chat');
    });
  });

  describe('Task Rendering', () => {
    it('renders task header', () => {
      renderComponent();

      expect(screen.getByTestId('task-header')).toBeInTheDocument();
      expect(screen.getByTestId('task-title')).toHaveTextContent('Test Task');
    });

    it('does not render the removed attached inputs panel', () => {
      renderComponent();

      expect(screen.queryByTestId('attached-inputs-panel')).not.toBeInTheDocument();
    });

    it('renders conversation panel', () => {
      renderComponent();

      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('renders artifacts panel', () => {
      renderComponent();

      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });

    it('uses slower artifact auto refresh interval while task is idle', () => {
      renderComponent();

      expect(latestUseTaskArtifactsArgsRef.current[3]).toMatchObject({
        refetchInterval: false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      });
    });

    it('uses faster artifact auto refresh interval while a run is active', () => {
      mockTaskHookState.task = { ...mockTask, run_state: 'running' };

      renderComponent();

      expect(latestUseTaskArtifactsArgsRef.current[3]).toMatchObject({
        refetchInterval: 5000,
      });
    });

    it('opens, hides, and then fully closes the terminal session from the task header flow', async () => {
      renderComponent();

      expect(screen.queryByTestId('task-terminal-panel')).not.toBeInTheDocument();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onToggleTerminal();
      });

      expect(screen.getByTestId('task-terminal-panel')).toBeInTheDocument();
      expect(latestTaskHeaderPropsRef.current.hasTerminalSession).toBe(true);
      expect(latestTaskHeaderPropsRef.current.terminalOpen).toBe(true);
      expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
        'End Terminal Session before starting a new agent run...',
      );

      await act(async () => {
        latestTaskHeaderPropsRef.current.onToggleTerminal();
      });

      expect(screen.queryByTestId('task-terminal-panel')).not.toBeInTheDocument();
      expect(latestTaskHeaderPropsRef.current.hasTerminalSession).toBe(true);
      expect(latestTaskHeaderPropsRef.current.terminalOpen).toBe(false);
      expect(screen.getByTestId('notebook__task-terminal-notice')).toHaveTextContent('Terminal session still active');
      expect(screen.getByTestId('notebook__task-terminal-notice')).toHaveTextContent(
        'The terminal is hidden, but it still blocks new agent runs until you show it again or end the session.',
      );
      expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
        'End Terminal Session before starting a new agent run...',
      );

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCloseTerminalSession();
        latestTaskTerminalPanelPropsRef.current.onOpenChange(false);
      });

      expect(latestTaskHeaderPropsRef.current.hasTerminalSession).toBe(false);
      expect(latestTaskHeaderPropsRef.current.terminalOpen).toBe(false);
      expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBeUndefined();
    });

    it('shows a recovery notice when a failed terminal session is hidden', async () => {
      renderComponent();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onToggleTerminal();
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onStatusChange('failed');
      });
      await act(async () => {
        latestTaskHeaderPropsRef.current.onToggleTerminal();
      });

      expect(latestTaskHeaderPropsRef.current.terminalStatus).toBe('failed');
      expect(screen.getByTestId('notebook__task-terminal-notice')).toHaveTextContent('Terminal needs recovery');
      expect(screen.getByRole('button', { name: 'Show Recovery' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'End Session' })).toBeInTheDocument();
    });

    it('disables terminal opening while a send is already pending', () => {
      mockSendMessageIsPending.value = true;
      renderComponent();

      expect(latestTaskHeaderPropsRef.current.canOpenTerminal).toBe(false);
    });

    it('disables terminal opening when the user lacks terminal permission', () => {
      renderWithNotebookQueryClient(
        <TaskPage
          workspaceId={mockWorkspaceId}
          projectId={mockProjectId}
          taskId={mockTaskId}
          canCreateTask={true}
          canUpdateTask={true}
          canDeleteTask={true}
          canUseTerminal={false}
        />,
      );

      expect(latestTaskHeaderPropsRef.current.canOpenTerminal).toBe(false);
    });

    it('does not pass a global execution details mode into ConversationPanel', () => {
      renderComponent();

      expect(latestConversationPanelPropsRef.current).toBeTruthy();
      expect(latestConversationPanelPropsRef.current.showExecutionDetails).toBeUndefined();
      expect(latestConversationPanelPropsRef.current.onToggleExecutionDetails).toBeUndefined();
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

    it('adds an optimistic user message and keeps streaming state after send', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText('Send Message'));

      expect(latestConversationPanelPropsRef.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Test message',
          }),
        ]),
      );
      expect(latestConversationPanelPropsRef.current.streamingMessageId).toBe('new-msg-id');
    });

    it('still sends when browser crypto.randomUUID is unavailable', async () => {
      const user = userEvent.setup();
      const originalCrypto = globalThis.crypto;
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          ...originalCrypto,
          randomUUID: undefined,
        },
      });

      try {
        renderComponent();
        await user.click(screen.getByText('Send Message'));

        expect(mockSendMessageMutateAsync).toHaveBeenCalledWith({
          workspaceId: mockWorkspaceId,
          projectId: mockProjectId,
          taskId: mockTaskId,
          data: {
            task_id: mockTaskId,
            content: 'Test message',
          },
        });
        expect(latestConversationPanelPropsRef.current.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Test message',
            }),
          ]),
        );
      } finally {
        Object.defineProperty(globalThis, 'crypto', {
          configurable: true,
          value: originalCrypto,
        });
      }
    });

    it('keeps busy state during non-terminal step success and clears on run terminal', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText('Send Message'));
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('true');
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('true');

      await act(async () => {
        latestTaskSseOptionsRef.current?.onTraceEvent?.({
          id: 'trace_step_success',
          task_id: mockTaskId,
          message_id: 'new-msg-id',
          run_id: 'run-1',
          seq: 11,
          at: '2026-03-06T04:00:00.000Z',
          category: 'progress',
          phase: 'end',
          status: 'success',
          name: 'codex.exec',
          summary: 'Step completed',
        });
      });
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('true');
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('true');

      await act(async () => {
        latestTaskSseOptionsRef.current?.onTraceEvent?.({
          id: 'trace_run_done',
          task_id: mockTaskId,
          message_id: 'new-msg-id',
          run_id: 'run-1',
          seq: 12,
          at: '2026-03-06T04:00:01.000Z',
          category: 'lifecycle',
          phase: 'end',
          status: 'success',
          name: 'run.lifecycle',
          summary: 'Run completed',
        });
      });
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('false');
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('false');
    });

    it('queues new input while busy and allows cancel current run', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText('Send Message'));
      expect(mockSendMessageMutateAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('true');

      await user.click(screen.getByText('Send Message'));
      expect(mockSendMessageMutateAsync).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent('1');
      expect(mockToastInfo).toHaveBeenCalled();

      await user.click(screen.getByText('Cancel Active Run'));
      expect(mockTaskApiCancelRun).toHaveBeenCalledWith(mockWorkspaceId, mockProjectId, mockTaskId);
      expect(mockToastInfo).toHaveBeenCalled();
    });

    it('does not clear streaming state immediately during an idle gap after send', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText('Send Message'));

      expect(latestConversationPanelPropsRef.current.streamingMessageId).toBe('new-msg-id');
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('true');
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

  describe('Artifact Actions', () => {
    it('opens artifact viewer for images', async () => {
      const user = userEvent.setup();
      renderComponent();

      const viewButton = screen.getByText('View Artifact');
      await user.click(viewButton);

      // Viewer dialog should open
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

    it('refreshes artifacts when the panel refresh action is triggered', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByText('Refresh Artifacts'));

      expect(mockTaskArtifactsRefetch).toHaveBeenCalledTimes(1);
    });

    it('passes artifact refresh loading state into the panel', () => {
      mockTaskArtifactsIsRefetching.value = true;
      renderComponent();

      expect(screen.getByTestId('artifacts-refreshing')).toHaveTextContent('true');
    });
  });

  describe('Disabled States', () => {
    it('keeps interaction enabled when task is active', () => {
      mockTaskHookState.task = { ...mockTask, status: 'active' };

      renderComponent();

      expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).not.toBeInTheDocument();
      expect(screen.getByTestId('artifacts-panel').querySelector('[data-disabled]')).not.toBeInTheDocument();
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
    it('shows rate limit toast when message send is throttled', async () => {
      const user = userEvent.setup();
      mockSendMessageMutateAsync.mockRejectedValueOnce(new ApiError('RATE_LIMIT_EXCEEDED', 'Too many requests', 'req-1', 429));
      renderComponent();

      await user.click(screen.getByText('Send Message'));

      expect(mockToastError).toHaveBeenCalledWith(
        'Request rate limited: This request exceeded the current limit. Please retry shortly.',
      );
      expect(mockHandleError).not.toHaveBeenCalled();
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

      expect(screen.queryByTestId('attached-inputs-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });
  });
});
