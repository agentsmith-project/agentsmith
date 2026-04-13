/**
 * Tests for TaskPage component
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskPage } from '../TaskPage';
import { ApiError } from '@/lib/api/client';
import {
  mockArtifacts,
  mockMessages,
  mockTask,
  renderWithNotebookQueryClient,
} from './taskPageTestUtils';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
  mockTaskApiListTerminalSessions,
  mockTaskApiCloseTerminalSession,
  mockStoreTaskTerminalPanelSessionIdForScope,
  mockClearTaskTerminalPanelSessionStateForScope,
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
  mockTaskApiListTerminalSessions: vi.fn(),
  mockTaskApiCloseTerminalSession: vi.fn(),
  mockStoreTaskTerminalPanelSessionIdForScope: vi.fn(),
  mockClearTaskTerminalPanelSessionStateForScope: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    const dict: Record<string, string> = {
      'common.cancel': 'Cancel',
      'common.retry': 'Retry',
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
      'notebook.task.terminal_workspace': 'Terminal Workspace',
      'notebook.task.terminal_session': 'Terminal Session',
      'notebook.task.terminal_new_session': 'New Session',
      'notebook.task.terminal_close': 'End Session',
      'notebook.task.terminal_end_all': 'End All Sessions',
      'notebook.task.terminal_mode_conversation': 'Conversation',
      'notebook.task.terminal_mode_terminal': 'Terminal',
      'notebook.task.terminal_status_strip_active': '{count} terminal sessions active',
      'notebook.task.terminal_status_strip_recovery': '{count} sessions need recovery',
      'notebook.task.terminal_workspace_open': 'Open Terminal Workspace',
      'notebook.task.terminal_max_sessions_reached': 'You can run up to 3 terminal sessions in one task.',
      'notebook.task.delete_blocked_terminal_sessions': 'End all terminal sessions before deleting this task.',
      'notebook.task.delete_blocked_terminal_sessions_pending': 'Checking terminal sessions before deleting this task.',
      'notebook.task.delete_blocked_terminal_sessions_unavailable': 'Terminal session status is temporarily unavailable. Retry before deleting this task.',
      'notebook.task.artifacts_show': 'Show Artifacts',
      'notebook.task.artifacts_hide': 'Hide Artifacts',
      'notebook.task.terminal_truth_unavailable_title': 'Terminal session status is temporarily unavailable',
      'notebook.task.terminal_truth_unavailable_description': 'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
      'notebook.task.terminal_truth_unavailable_action': 'Retry terminal status check',
      'notebook.task.terminal_unavailable_terminal_truth': 'Retry after terminal session status is available again.',
    };
    const scoped = namespace ? `${namespace}.${key}` : key;
    const template = dict[scoped];
    if (!template) return scoped;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
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
    const {
      task,
      onDeleted,
      onCreateNew,
      onLeave,
      agentRunActivity,
      canCreateTerminalSession,
      deleteBlockedReason,
    } = props;
    return (
      <div data-testid="task-header">
      <div data-testid="task-title">{task.title}</div>
      <div data-testid="task-header-busy">{String(!!agentRunActivity?.active)}</div>
      <div data-testid="task-header-terminal-create-enabled">
        {String(!!canCreateTerminalSession)}
      </div>
      <div data-testid="task-header-delete-blocked-reason">
        {deleteBlockedReason ?? ''}
      </div>
      <button onClick={onLeave}>Leave</button>
      <button onClick={onDeleted}>Delete</button>
      <button onClick={onCreateNew}>New</button>
    </div>
    );
  },
}));

vi.mock('../TaskTerminalPanel', () => ({
  storeTaskTerminalPanelSessionIdForScope: mockStoreTaskTerminalPanelSessionIdForScope,
  clearTaskTerminalPanelSessionStateForScope: mockClearTaskTerminalPanelSessionStateForScope,
  TaskTerminalPanel: (props: any) => {
    latestTaskTerminalPanelPropsRef.current = props;
    const { closeRequestToken, onOpenChange, open, visible, tabId } = props;
    React.useEffect(() => {
      if (open && closeRequestToken > 0) {
        onOpenChange(false);
      }
    }, [closeRequestToken, onOpenChange, open]);
    const panelVisible = visible ?? open;
    return (open && panelVisible) ? (
      <div data-testid="task-terminal-panel-active">
        <div data-testid={`task-terminal-panel-${tabId ?? 'active'}`} />
        <button onClick={() => onOpenChange(false)}>Close Terminal</button>
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
      listTerminalSessions: mockTaskApiListTerminalSessions,
      closeTerminalSession: mockTaskApiCloseTerminalSession,
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
    window.sessionStorage.clear();
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
    mockTaskApiListTerminalSessions.mockReset();
    mockTaskApiListTerminalSessions.mockResolvedValue({ total: 0, items: [] });
    mockTaskApiCloseTerminalSession.mockReset();
    mockTaskApiCloseTerminalSession.mockResolvedValue(undefined);
    mockStoreTaskTerminalPanelSessionIdForScope.mockReset();
    mockClearTaskTerminalPanelSessionStateForScope.mockReset();
    mockToastInfo.mockReset();
    mockTaskArtifactsRefetch.mockReset();
    mockTaskArtifactsRefetch.mockResolvedValue({ data: mockArtifacts });
    mockTaskArtifactsIsRefetching.value = false;
    mockSendMessageIsPending.value = false;
    latestTaskSseOptionsRef.current = null;
    latestConversationPanelPropsRef.current = null;
    latestTaskHeaderPropsRef.current = null;
    latestUseTaskArtifactsArgsRef.current = null;
    mockPush.mockReset();
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

  const renderComponentAndWaitForTerminalHydration = async () => {
    renderComponent();
    await waitFor(() => {
      expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(1);
      expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
      expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
    });
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

    it('stays conversation-first when storage prefers terminal but backend reports no live terminal sessions', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'stale-session-id',
          artifactsDrawerOpen: false,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({ total: 0, items: [] });

      renderComponent();

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
      });
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('notebook__task-terminal-workspace')).not.toBeInTheDocument();
      expect(screen.queryByTestId('notebook__task-terminal-status-strip')).not.toBeInTheDocument();
      expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
      expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
    });

    it('keeps terminal bootstrap blocked until backend terminal truth returns on reload', async () => {
      const deferredSessions = createDeferred<{ total: number; items: Array<{ id: string; status: string; created_at: string }> }>();
      mockTaskApiListTerminalSessions.mockReset();
      mockTaskApiListTerminalSessions.mockReturnValueOnce(deferredSessions.promise as any);

      renderComponent();

      expect(latestTaskHeaderPropsRef.current.onCreateTerminalSession).toBeUndefined();
      expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
      expect(latestTaskHeaderPropsRef.current.canDeleteTask).toBe(true);
      expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
        'Checking terminal sessions before deleting this task.',
      );
      expect(latestConversationPanelPropsRef.current.disabled).toBe(true);

      deferredSessions.resolve({
        total: 0,
        items: [],
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(true);
        expect(latestTaskHeaderPropsRef.current.canDeleteTask).toBe(true);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBeNull();
        expect(latestTaskHeaderPropsRef.current.onCreateTerminalSession).toBeTypeOf('function');
        expect(latestConversationPanelPropsRef.current.disabled).toBe(false);
      });
    });

    it('keeps run and delete blocked when terminal hydration fails until backend truth is retried successfully', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions.mockRejectedValue(
        new Error('terminal list unavailable'),
      );

      renderComponent();

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByTestId('task-header-terminal-create-enabled')).toHaveTextContent('false');
        expect(screen.getByTestId('task-header-delete-blocked-reason')).toHaveTextContent(
          'Terminal session status is temporarily unavailable. Retry before deleting this task.',
        );
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).toBeInTheDocument();
      });

      expect(
        await screen.findByTestId('notebook__task-terminal-truth-unavailable'),
      ).toHaveTextContent('Terminal session status is temporarily unavailable');
      expect(
        screen.getByRole('button', { name: 'Retry terminal status check' }),
      ).toBeInTheDocument();

      const listCallCountBeforeRetry =
        mockTaskApiListTerminalSessions.mock.calls.length;
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({ total: 0, items: [] });
      await user.click(
        screen.getByRole('button', { name: 'Retry terminal status check' }),
      );

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions.mock.calls.length).toBeGreaterThan(
          listCallCountBeforeRetry,
        );
        expect(screen.getByTestId('task-header-terminal-create-enabled')).toHaveTextContent('true');
        expect(screen.getByTestId('task-header-delete-blocked-reason')).toHaveTextContent('');
        expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).not.toBeInTheDocument();
      });
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

    it('opens terminal workspace in terminal mode and blocks conversation input', async () => {
      await renderComponentAndWaitForTerminalHydration();

      expect(screen.queryByTestId('task-terminal-panel-active')).not.toBeInTheDocument();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });

      await waitFor(() => {
        expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
        expect(screen.getAllByTestId('notebook__task-terminal-workspace')).toHaveLength(1);
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.onCreateTerminalSession).toBeUndefined();
        expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
        expect(screen.queryByTestId('notebook__task-terminal-status-strip')).not.toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Show Artifacts');
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal sessions active',
        );
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
          'End Terminal Session before starting a new agent run...',
        );
      });
    });

    it('creates up to three terminal tabs and blocks a fourth creation', async () => {
      const user = userEvent.setup();
      await renderComponentAndWaitForTerminalHydration();
      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-create')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('notebook__task-terminal-create'));
      await user.click(screen.getByTestId('notebook__task-terminal-create'));

      expect(screen.getAllByTestId(/^notebook__task-terminal-tab-terminal-session-\d+$/)).toHaveLength(3);
      expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
      expect(screen.getByTestId('notebook__task-terminal-create')).toBeDisabled();
      expect(screen.getByTestId('notebook__task-terminal-create')).toHaveAttribute(
        'title',
        'You can run up to 3 terminal sessions in one task.',
      );
    });

    it('reconciles optimistic terminal tabs back to backend truth when create is rejected at the session limit', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockResolvedValueOnce({
          total: 3,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
            { id: 'backend-session-3', status: 'active', created_at: '2026-04-13T01:00:02.000Z' },
          ],
        });

      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
      });
      await user.click(screen.getByTestId('notebook__task-terminal-create'));
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-2');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });

      await user.click(screen.getByTestId('notebook__task-terminal-create'));
      expect(screen.getAllByTestId(/^notebook__task-terminal-tab-terminal-session-\d+$/)).toHaveLength(3);

      await act(async () => {
        await latestTaskTerminalPanelPropsRef.current.onSessionCreateRejected?.();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenNthCalledWith(
          2,
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(3);
        expect(screen.getAllByTestId(/^notebook__task-terminal-tab-terminal-session-\d+$/)).toHaveLength(3);
        expect(screen.queryByTestId('notebook__task-terminal-tab-terminal-session-3')).not.toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
      });
    });

    it('shows a conversation status strip while sessions are active and supports reopening terminal workspace', async () => {
      const user = userEvent.setup();
      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
      });
      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent('1 terminal sessions active');
      });
      await user.click(screen.getByRole('button', { name: 'Open Terminal Workspace' }));
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
      });
    });

    it('reconciles local terminal tabs with backend truth when ending all sessions from the conversation strip', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockResolvedValueOnce({ total: 1, items: [{ id: 'backend-session-1' }] })
        .mockResolvedValueOnce({ total: 0, items: [] });

      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      });
      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await user.click(screen.getByRole('button', { name: 'End All Sessions' }));

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenNthCalledWith(
          2,
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          'backend-session-1',
        );
        expect(mockTaskApiListTerminalSessions).toHaveBeenNthCalledWith(
          3,
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(screen.queryByTestId('notebook__task-terminal-status-strip')).not.toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBeUndefined();
      });
    });

    it('keeps remaining terminal tabs if backend still reports live sessions after ending all from conversation strip', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { id: 'backend-session-1' },
            { id: 'backend-session-2' },
          ],
        })
        .mockResolvedValueOnce({ total: 1, items: [{ id: 'backend-session-2' }] });

      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      });
      await user.click(screen.getByTestId('notebook__task-terminal-create'));
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-2');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });
      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await user.click(screen.getByRole('button', { name: 'End All Sessions' }));

      await waitFor(() => {
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledTimes(2);
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          'backend-session-1',
        );
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          'backend-session-2',
        );
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal sessions active',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
          'End Terminal Session before starting a new agent run...',
        );
      });
    });

    it('returns to conversation mode when the last terminal tab closes', async () => {
      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onOpenChange(false);
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBeUndefined();
      });
    });

    it('allows ending all sessions from the terminal workspace toolbar', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockResolvedValueOnce({
          total: 2,
          items: [{ id: 'backend-session-1' }, { id: 'backend-session-2' }],
        })
        .mockResolvedValueOnce({ total: 0, items: [] });
      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      });
      await user.click(screen.getByTestId('notebook__task-terminal-create'));
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-2');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });
      await user.click(screen.getByTestId('notebook__task-terminal-end-all'));

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
      });
    });

    it('disables creating terminal sessions while a send is already pending', () => {
      mockSendMessageIsPending.value = true;
      renderComponent();

      expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
    });

    it('disables creating terminal sessions when the user lacks terminal permission', () => {
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

      expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
    });

    it('still hydrates backend terminal truth and keeps run/delete blocked when terminal permission is lost', async () => {
      const deferredSessions = createDeferred<{
        total: number;
        items: Array<{ id: string; status: string; created_at: string }>;
      }>();
      mockTaskApiListTerminalSessions.mockReset();
      mockTaskApiListTerminalSessions.mockReturnValueOnce(deferredSessions.promise as any);

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

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
      });

      expect(latestConversationPanelPropsRef.current.disabled).toBe(true);
      expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
      expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
        'Checking terminal sessions before deleting this task.',
      );

      deferredSessions.resolve({
        total: 1,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T00:00:00.000Z',
          },
        ],
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
          'End all terminal sessions before deleting this task.',
        );
        expect(latestConversationPanelPropsRef.current.disabled).toBe(true);
      });
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
    it('keeps interaction enabled when task is active after terminal bootstrap resolves', async () => {
      mockTaskHookState.task = { ...mockTask, status: 'active' };

      await renderComponentAndWaitForTerminalHydration();

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
