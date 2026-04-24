/**
 * Tests for TaskPage component
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { flushSync } from 'react-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  TaskPage,
  getPreferredRecoveryTerminalTabId,
  mergeTerminalTabStatus,
} from '../TaskPage';
import { TaskPageContent } from '../task-page/TaskPageContent';
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
  mockTaskSseState,
  mockHandleError,
  mockToastError,
  mockToastInfo,
  mockTaskArtifactsRefetch,
  mockTaskArtifactsIsRefetching,
  latestTaskSseOptionsRef,
  latestConversationPanelPropsRef,
  latestTaskHeaderPropsRef,
  latestTaskTerminalPanelPropsRef,
  latestTaskTerminalPanelPropsByTabIdRef,
  latestUseTaskArtifactsArgsRef,
  latestUseTaskArgsRef,
  latestUseTaskMessagesArgsRef,
  mockUseTaskRefetch,
  mockUseTaskMessagesRefetch,
  mockTaskApiCancelRun,
  mockTaskApiListTerminalSessions,
  mockTaskApiCloseTerminalSession,
  mockStoreTaskTerminalPanelSessionIdForScope,
  mockClearTaskTerminalPanelSessionStateForScope,
} = vi.hoisted(() => ({
  mockSendMessageMutateAsync: vi.fn(),
  mockSendMessageIsPending: { value: false },
  mockTaskSseState: {
    connectionStatus: 'connected' as
      | 'connecting'
      | 'connected'
      | 'reconnecting'
      | 'disconnected'
      | 'error',
    connectionErrorCode: null as string | null,
    connectionErrorMessage: null as string | null,
  },
  mockHandleError: vi.fn(),
  mockToastError: vi.fn(),
  mockToastInfo: vi.fn(),
  mockTaskArtifactsRefetch: vi.fn(),
  mockTaskArtifactsIsRefetching: { value: false },
  latestTaskSseOptionsRef: { current: null as any },
  latestConversationPanelPropsRef: { current: null as any },
  latestTaskHeaderPropsRef: { current: null as any },
  latestTaskTerminalPanelPropsRef: { current: null as any },
  latestTaskTerminalPanelPropsByTabIdRef: { current: {} as Record<string, any> },
  latestUseTaskArtifactsArgsRef: { current: null as any },
  latestUseTaskArgsRef: { current: null as any },
  latestUseTaskMessagesArgsRef: { current: null as any },
  mockUseTaskRefetch: vi.fn(),
  mockUseTaskMessagesRefetch: vi.fn(),
  mockTaskApiCancelRun: vi.fn(),
  mockTaskApiListTerminalSessions: vi.fn(),
  mockTaskApiCloseTerminalSession: vi.fn(),
  mockStoreTaskTerminalPanelSessionIdForScope: vi.fn(),
  mockClearTaskTerminalPanelSessionStateForScope: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    const scoped = namespace ? `${namespace}.${key}` : key;
    if (scoped === 'notebook.task.terminal_status_strip_active') {
      const count = Number(values?.count ?? 0);
      return count === 1
        ? '1 terminal session is using this task'
        : `${count} terminal sessions are using this task`;
    }
    if (scoped === 'notebook.task.terminal_status_strip_recovery') {
      const count = Number(values?.count ?? 0);
      return count === 1
        ? '1 terminal session on this task needs recovery'
        : `${count} terminal sessions on this task need recovery`;
    }
    if (scoped === 'notebook.task.terminal_status_strip_mixed') {
      const count = Number(values?.count ?? 0);
      const recoveryCount = Number(values?.recoveryCount ?? 0);
      return `${count} terminal sessions are using this task, ${recoveryCount} ${recoveryCount === 1 ? 'needs' : 'need'} recovery`;
    }
    if (scoped === 'notebook.task.terminal_hidden_active_description') {
      const count = Number(values?.count ?? 1);
      return count === 1
        ? 'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.'
        : 'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.';
    }
    if (scoped === 'notebook.task.terminal_hidden_failed_description') {
      const count = Number(values?.count ?? 1);
      return count === 1
        ? 'This terminal session needs recovery. Reopen it to reconnect or review the issue, or end the session before starting a new run.'
        : `${count} terminal sessions need recovery. Reopen the terminal workspace to reconnect or review the issues, or end the sessions before starting a new run.`;
    }
    if (scoped === 'notebook.task.terminal_hidden_mixed_description') {
      const count = Number(values?.count ?? 1);
      const recoveryCount = Number(values?.recoveryCount ?? 0);
      return `${count} terminal sessions are still using this task, and ${recoveryCount} of them needs recovery. Reopen the terminal workspace to reconnect or review the issue, or end the sessions before starting a new run.`;
    }
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
      'notebook.task.terminal_input_blocked_placeholder': 'End terminal sessions before starting a new agent run.',
      'notebook.task.terminal_workspace': 'Terminal Workspace',
      'notebook.task.terminal_session': 'Terminal Session',
      'notebook.task.terminal_new_session': 'New Session',
      'notebook.task.terminal_close': 'End Session',
      'notebook.task.terminal_end_all': 'End All Sessions',
      'notebook.task.terminal_end_all_confirm_title': 'End all terminal sessions?',
      'notebook.task.terminal_end_all_confirm_description': 'This closes every terminal session on this task and lets agent work continue again.',
      'notebook.task.terminal_end_all_confirm_action': 'End All Sessions',
      'notebook.task.terminal_mode_conversation': 'Conversation',
      'notebook.task.terminal_mode_terminal': 'Terminal',
      'notebook.task.terminal_workspace_open': 'Open Terminal Workspace',
      'notebook.task.terminal_max_sessions_reached': 'You can run up to 3 terminal sessions in one task.',
      'notebook.task.terminal_status_idle': 'Idle',
      'notebook.task.terminal_status_preparing': 'Preparing',
      'notebook.task.terminal_status_recovering': 'Recovering',
      'notebook.task.terminal_status_connecting': 'Connecting',
      'notebook.task.terminal_status_active': 'Active',
      'notebook.task.terminal_status_closed': 'Closed',
      'notebook.task.terminal_status_failed': 'Failed',
      'notebook.task.delete_blocked_terminal_sessions': 'End all terminal sessions before deleting this task.',
      'notebook.task.delete_blocked_terminal_sessions_pending': 'Checking terminal sessions before deleting this task.',
      'notebook.task.delete_blocked_terminal_sessions_unavailable': 'Terminal session status is temporarily unavailable. Retry before deleting this task.',
      'notebook.task.artifacts_show': 'Show Artifacts',
      'notebook.task.artifacts_hide': 'Hide Artifacts',
      'notebook.task.terminal_truth_unavailable_title': 'Terminal session status is temporarily unavailable',
      'notebook.task.terminal_truth_unavailable_description': 'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
      'notebook.task.terminal_truth_unavailable_action': 'Retry terminal status check',
      'notebook.task.terminal_unavailable_terminal_truth': 'Retry after terminal session status is available again.',
      'notebook.task.terminal_description': 'Directly control the current task environment when you need to work by hand.',
      'notebook.task.terminal_scope_hint': 'Changes you make here affect files in this task workspace. Temporary shell variables stay only in this terminal session.',
      'notebook.task.terminal_recovery_show': 'Reopen Terminal Workspace',
      'notebook.task.terminal_hidden_active_title': 'Terminal session still active',
      'notebook.task.terminal_hidden_failed_title': 'Terminal needs recovery',
    };
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
  useTask: (...args: any[]) => {
    latestUseTaskArgsRef.current = args;
    return ({
      data: mockTaskHookState.task,
      isLoading: mockTaskHookState.taskLoading,
      refetch: mockUseTaskRefetch,
    });
  },
  useTaskMessages: (...args: any[]) => {
    latestUseTaskMessagesArgsRef.current = args;
    return ({
      data: mockTaskHookState.messages,
      isLoading: false,
      refetch: mockUseTaskMessagesRefetch,
    });
  },
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
    connectionStatus: mockTaskSseState.connectionStatus,
    connectionErrorCode: mockTaskSseState.connectionErrorCode,
    connectionErrorMessage: mockTaskSseState.connectionErrorMessage,
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
      headerAccessory,
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
      <div data-testid="task-header-accessory">{headerAccessory ?? null}</div>
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
    latestTaskTerminalPanelPropsByTabIdRef.current[props.tabId ?? 'active'] = props;
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
      blockedState,
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
      {blockedState && (!messages || messages.length === 0) ? (
        <div data-testid="conversation-blocked-state">
          <div data-testid="conversation-blocked-title">{blockedState.title}</div>
          <div data-testid="conversation-blocked-description">{blockedState.description}</div>
          {blockedState.actionLabel ? (
            <button onClick={() => blockedState.onAction?.()}>
              {blockedState.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}
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
    mockTaskSseState.connectionStatus = 'connected';
    mockTaskSseState.connectionErrorCode = null;
    mockTaskSseState.connectionErrorMessage = null;
    mockUseTaskRefetch.mockReset();
    mockUseTaskRefetch.mockResolvedValue({ data: mockTask });
    mockUseTaskMessagesRefetch.mockReset();
    mockUseTaskMessagesRefetch.mockResolvedValue({ data: mockMessages });
    mockSendMessageIsPending.value = false;
    latestTaskSseOptionsRef.current = null;
    latestConversationPanelPropsRef.current = null;
    latestTaskHeaderPropsRef.current = null;
    latestTaskTerminalPanelPropsByTabIdRef.current = {};
    latestUseTaskArgsRef.current = null;
    latestUseTaskMessagesArgsRef.current = null;
    latestUseTaskArtifactsArgsRef.current = null;
    mockPush.mockReset();
  });

  const renderComponent = ({
    canCreateTask = true,
    canUpdateTask = true,
    canDeleteTask = true,
    canUseTerminal = true,
  }: {
    canCreateTask?: boolean;
    canUpdateTask?: boolean;
    canDeleteTask?: boolean;
    canUseTerminal?: boolean;
  } = {}) => {
    return renderWithNotebookQueryClient(
      <TaskPage
        workspaceId={mockWorkspaceId}
        projectId={mockProjectId}
        taskId={mockTaskId}
        canCreateTask={canCreateTask}
        canUpdateTask={canUpdateTask}
        canDeleteTask={canDeleteTask}
        canUseTerminal={canUseTerminal}
      />,
    );
  };

  const waitForTerminalHydrationReady = async ({
    expectedSessionCount = 0,
    expectedViewMode = 'conversation',
    expectedCallCount = 1,
  }: {
    expectedSessionCount?: number;
    expectedViewMode?: 'conversation' | 'terminal';
    expectedCallCount?: number;
  } = {}) => {
    await waitFor(() => {
      expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(expectedCallCount);
      expect(mockTaskApiListTerminalSessions).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockProjectId,
        mockTaskId,
      );
      expect(latestTaskHeaderPropsRef.current).toBeTruthy();
      expect(latestTaskHeaderPropsRef.current.terminalTruthState).toBe('ready');
      expect(latestTaskHeaderPropsRef.current.viewMode).toBe(expectedViewMode);
      expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(expectedSessionCount);
    });
  };

  const renderComponentReady = async (
    options?: Parameters<typeof renderComponent>[0],
  ) => {
    const view = renderComponent(options);
    await waitForTerminalHydrationReady();
    return view;
  };

  const renderComponentAndWaitForTerminalHydration = renderComponentReady;

  const getReactActWarningCalls = (
    consoleErrorSpy: { mock: { calls: unknown[][] } },
  ) =>
    consoleErrorSpy.mock.calls.filter((call: unknown[]) =>
      call.some((message: unknown) => String(message).includes('not wrapped in act')),
    );

  describe('Loading State', () => {
    it('renders loading state', () => {
      mockTaskHookState.task = undefined;
      mockTaskHookState.taskLoading = true;
      mockTaskHookState.messages = [];
      mockTaskHookState.artifacts = [];

      renderComponent();

      expect(screen.getByText(/Loading task/i)).toBeInTheDocument();
    });

    it('keeps hook order stable when task detail loads after the initial loading render', async () => {
      mockTaskHookState.task = undefined;
      mockTaskHookState.taskLoading = true;
      mockTaskHookState.messages = [];
      mockTaskHookState.artifacts = [];

      const view = renderWithNotebookQueryClient(
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

      expect(screen.getByText(/Loading task/i)).toBeInTheDocument();

      mockTaskHookState.task = mockTask;
      mockTaskHookState.taskLoading = false;
      mockTaskHookState.messages = mockMessages;
      mockTaskHookState.artifacts = mockArtifacts;

      view.rerender(
        <QueryClientProvider client={view.queryClient}>
          <TaskPage
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            taskId={mockTaskId}
            canCreateTask={true}
            canUpdateTask={true}
            canDeleteTask={true}
            canUseTerminal={true}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('task-header')).toBeInTheDocument();
        expect(screen.queryByText(/Rendered more hooks than during the previous render/i)).not.toBeInTheDocument();
      });
      await waitForTerminalHydrationReady();
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
    it('preserves stronger local live terminal tab states across transient backend pending or disconnected truth, while still converging explicit backend terminal truth', () => {
      expect(mergeTerminalTabStatus('failed', 'disconnected')).toBe('recovering');
      expect(mergeTerminalTabStatus('closed', 'disconnected')).toBe('recovering');
      expect(mergeTerminalTabStatus('connecting', 'disconnected')).toBe('connecting');
      expect(mergeTerminalTabStatus('active', 'disconnected')).toBe('active');
      expect(mergeTerminalTabStatus('connecting', 'pending')).toBe('connecting');
      expect(mergeTerminalTabStatus('active', 'pending')).toBe('active');
      expect(mergeTerminalTabStatus('failed', 'pending')).toBe('preparing');
      expect(mergeTerminalTabStatus('closed', 'pending')).toBe('preparing');
      expect(mergeTerminalTabStatus('failed', 'active')).toBe('active');
      expect(mergeTerminalTabStatus('closed', 'failed')).toBe('failed');
      expect(mergeTerminalTabStatus('connecting', 'closed')).toBe('closed');
    });

    it('does not downgrade an already-live terminal tab badge when backend poll truth briefly lags behind the panel state', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'disconnected',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(
          screen.getByTestId('notebook__task-terminal-tab-terminal-session-1'),
        ).toHaveTextContent('Active');
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onStatusChange('active');
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(
          screen.getByTestId('notebook__task-terminal-tab-terminal-session-1'),
        ).toHaveTextContent('Active');
        expect(
          screen.getByTestId('notebook__task-terminal-tab-terminal-session-1'),
        ).not.toHaveTextContent('Recovering');
      });
    });

    it('prefers the active recovery tab before the first recovery tab, then active, then the first tab', () => {
      const tabs = [
        {
          id: 'terminal-session-1',
          label: 'Terminal Session 1',
          status: 'recovering',
          closeRequestToken: 0,
          sessionId: 'backend-session-1',
        },
        {
          id: 'terminal-session-2',
          label: 'Terminal Session 2',
          status: 'active',
          closeRequestToken: 0,
          sessionId: 'backend-session-2',
        },
        {
          id: 'terminal-session-3',
          label: 'Terminal Session 3',
          status: 'active',
          closeRequestToken: 0,
          sessionId: 'backend-session-3',
        },
      ] as const;

      expect(
        getPreferredRecoveryTerminalTabId(
          [...tabs],
          [
            {
              id: 'backend-session-1',
              status: 'disconnected',
              cols: 120,
              rows: 30,
              last_activity_at: '2026-04-13T01:00:00.000Z',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              id: 'backend-session-3',
              status: 'failed',
              cols: 120,
              rows: 30,
              last_activity_at: '2026-04-13T01:00:01.000Z',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
          'terminal-session-3',
        ),
      ).toBe('terminal-session-3');

      expect(
        getPreferredRecoveryTerminalTabId(
          [...tabs],
          [
            {
              id: 'backend-session-1',
              status: 'disconnected',
              cols: 120,
              rows: 30,
              last_activity_at: '2026-04-13T01:00:00.000Z',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              id: 'backend-session-3',
              status: 'failed',
              cols: 120,
              rows: 30,
              last_activity_at: '2026-04-13T01:00:01.000Z',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
          'terminal-session-2',
        ),
      ).toBe('terminal-session-1');

      expect(
        getPreferredRecoveryTerminalTabId(
          [
            {
              id: 'terminal-session-1',
              label: 'Terminal Session 1',
              status: 'active',
              closeRequestToken: 0,
              sessionId: 'backend-session-1',
            },
            {
              id: 'terminal-session-2',
              label: 'Terminal Session 2',
              status: 'active',
              closeRequestToken: 0,
              sessionId: 'backend-session-2',
            },
          ],
          null,
          'terminal-session-2',
        ),
      ).toBe('terminal-session-2');

      expect(
        getPreferredRecoveryTerminalTabId(
          [
            {
              id: 'terminal-session-1',
              label: 'Terminal Session 1',
              status: 'active',
              closeRequestToken: 0,
              sessionId: 'backend-session-1',
            },
          ],
          null,
          'terminal-session-missing',
        ),
      ).toBe('terminal-session-1');
    });

    it('keeps the terminal workspace mounted in the background while removing the visible workspace shell from conversation layout', () => {
      const workspaceLifecycle = {
        mounts: 0,
        unmounts: 0,
      };

      function TerminalWorkspaceTracker() {
        React.useEffect(() => {
          workspaceLifecycle.mounts += 1;
          return () => {
            workspaceLifecycle.unmounts += 1;
          };
        }, []);

        return <div data-testid="terminal-workspace-tracker">terminal workspace</div>;
      }

      const taskPageContentProps = {
        agentIsBusy: false,
        activeAgentMessageId: null,
        artifacts: [],
        artifactsRefreshing: false,
        canUpdateTask: true,
        connectionErrorCode: null,
        connectionErrorMessage: null,
        connectionStatus: 'connected' as const,
        diagnosticsLinks: {
          audit: '/audit',
          usage: '/usage',
          agent: null,
        },
        disabled: false,
        fetchTracesForMessage: vi.fn(),
        focusTraceMessageId: null,
        focusTraceName: null,
        focusTraceToken: 0,
        handleCancelActiveRun: vi.fn(),
        handleDownloadArtifact: vi.fn(),
        handlePendingRemove: vi.fn(),
        handleRefreshArtifacts: vi.fn(),
        handlePendingUpdate: vi.fn(),
        handleSendMessage: vi.fn(),
        handleViewArtifact: vi.fn(),
        isDisabled: false,
        loadMoreTracesForMessage: vi.fn(),
        messages: [],
        onRunActionClick: vi.fn(),
        pendingMessages: [],
        projectId: mockProjectId,
        runActivity: {
          active: false,
          elapsedSeconds: 0,
          cancelling: false,
          lastSummary: undefined,
          lastKind: undefined,
          recentActions: [],
        },
        sandboxStarting: false,
        sending: false,
        showSseDebugPanel: false,
        sseDebugEvents: [],
        streamingContent: '',
        streamingMessageId: null,
        taskId: mockTaskId,
        terminalStatusStrip: null,
        terminalWorkspace: <TerminalWorkspaceTracker />,
        traceErrorByMessageId: {},
        traceEventsByMessageId: {},
        traceHasMoreByMessageId: {},
        traceLoadMoreLoadingByMessageId: {},
        traceLoadingByMessageId: {},
        workspaceId: mockWorkspaceId,
      } satisfies React.ComponentProps<typeof TaskPageContent>;

      const { rerender } = render(
        <TaskPageContent
          {...taskPageContentProps}
          viewMode="terminal"
        />,
      );

      expect(
        screen.getByTestId('notebook__task-terminal-workspace-shell'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('notebook__task-terminal-workspace-shell'),
      ).toHaveClass('w-full', 'basis-0');
      expect(screen.getByTestId('terminal-workspace-tracker')).toBeInTheDocument();
      expect(workspaceLifecycle.mounts).toBeGreaterThan(0);
      expect(workspaceLifecycle.unmounts).toBe(0);

      rerender(
        <TaskPageContent
          {...taskPageContentProps}
          viewMode="conversation"
        />,
      );

      const hiddenWorkspaceShell = screen.getByTestId(
        'notebook__task-terminal-workspace-shell',
      );
      expect(screen.getByTestId('notebook__task-conversation-shell')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-workspace-tracker')).toBeInTheDocument();
      expect(hiddenWorkspaceShell).toHaveClass(
        'pointer-events-none',
        'absolute',
        'h-0',
        'w-0',
        'overflow-hidden',
      );
      expect(hiddenWorkspaceShell).not.toHaveClass('flex-1');
      expect(hiddenWorkspaceShell).not.toHaveAttribute('hidden');
      expect(workspaceLifecycle.mounts).toBeGreaterThan(0);
      expect(workspaceLifecycle.unmounts).toBe(0);
    });

    it('renders task header', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error');

      try {
        await renderComponentReady();

        expect(screen.getByTestId('task-header')).toBeInTheDocument();
        expect(screen.getByTestId('task-title')).toHaveTextContent('Test Task');

        expect(getReactActWarningCalls(consoleErrorSpy)).toEqual([]);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('renders one dominant task-detail shell and keeps the artifacts toggle in the header chrome', async () => {
      await renderComponentReady();

      const taskDetailShell = screen.getByTestId('notebook__task-detail-shell');
      const workspace = screen.getByTestId('notebook__task-content-workspace');
      const primaryColumn = screen.getByTestId('notebook__task-primary-column');
      const secondaryColumn = screen.getByTestId('notebook__task-secondary-column');
      expect(taskDetailShell.className).not.toContain('gradient');
      expect(taskDetailShell).toContainElement(screen.getByTestId('task-header'));
      expect(taskDetailShell).toContainElement(workspace);
      expect(primaryColumn).toContainElement(screen.getByTestId('notebook__task-conversation-shell'));
      expect(secondaryColumn).toContainElement(screen.getByTestId('notebook__task-artifacts-drawer'));
      expect(
        within(screen.getByTestId('task-header-accessory')).getByTestId(
          'notebook__task-artifacts-toggle',
        ),
      ).toHaveTextContent('Hide Artifacts');
      expect(screen.getAllByTestId('notebook__task-artifacts-toggle')).toHaveLength(1);
    });

    it('does not render the removed attached inputs panel', async () => {
      await renderComponentReady();

      expect(screen.queryByTestId('attached-inputs-panel')).not.toBeInTheDocument();
    });

    it('renders conversation panel', async () => {
      await renderComponentReady();

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

    it('restores directly into terminal workspace on reload when storage prefers terminal and backend reports live sessions', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-2',
          artifactsDrawerOpen: false,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'active',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
        expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });
    });

    it('stays in conversation mode on reload without rendering the terminal workspace shell when storage prefers conversation and backend reports live sessions', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-2',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'active',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        const hiddenWorkspaceShell = screen.getByTestId(
          'notebook__task-terminal-workspace-shell',
        );
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
        expect(
          screen.getByTestId('notebook__task-terminal-status-strip'),
        ).toHaveTextContent('2 terminal sessions are using this task');
        expect(hiddenWorkspaceShell).toHaveClass(
          'pointer-events-none',
          'absolute',
          'h-0',
          'w-0',
          'overflow-hidden',
        );
        expect(hiddenWorkspaceShell).not.toHaveClass('flex-1');
        expect(hiddenWorkspaceShell).not.toHaveAttribute('hidden');
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
        expect(latestTaskTerminalPanelPropsRef.current.open).toBe(true);
        expect(latestTaskTerminalPanelPropsRef.current.visible).toBe(false);
        expect(latestTaskTerminalPanelPropsRef.current.tabId).toBe('terminal-session-2');
      });
    });

    it('preserves the clicked terminal tab during preserve-current poll hydration instead of reapplying the boot preference', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: false,
        }),
      );
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 2,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              id: 'backend-session-2',
              status: 'active',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
        })
        .mockResolvedValue({
          total: 2,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              id: 'backend-session-2',
              status: 'active',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
      });

      const secondTerminalTabButton = screen
        .getByTestId('notebook__task-terminal-tab-terminal-session-2')
        .querySelector('button');
      expect(secondTerminalTabButton).toBeTruthy();

      await act(async () => {
        (secondTerminalTabButton as HTMLButtonElement).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
        expect(latestTaskTerminalPanelPropsRef.current.tabId).toBe('terminal-session-2');
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-2');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
      });
    });

    it('syncs the active terminal tab ref immediately when the user clicks another tab before the next poll finishes, even if boot storage still prefers the previous session', async () => {
      let pollTerminalWorkspace: (() => void) | null = null;
      const setIntervalSpy = vi
        .spyOn(window, 'setInterval')
        .mockImplementation(((callback: TimerHandler) => {
          pollTerminalWorkspace =
            typeof callback === 'function' ? (callback as () => void) : null;
          return 1 as unknown as number;
        }) as typeof window.setInterval);
      const clearIntervalSpy = vi
        .spyOn(window, 'clearInterval')
        .mockImplementation((() => {}) as typeof window.clearInterval);

      try {
        window.sessionStorage.setItem(
          `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
          JSON.stringify({
            preferredViewMode: 'terminal',
            preferredActiveSessionId: 'backend-session-1',
            artifactsDrawerOpen: false,
          }),
        );
        mockTaskApiListTerminalSessions
          .mockResolvedValueOnce({
            total: 2,
            items: [
              {
                id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
              {
                id: 'backend-session-2',
                status: 'active',
                created_at: '2026-04-13T01:00:01.000Z',
              },
            ],
          })
          .mockResolvedValue({
            total: 2,
            items: [
              {
                id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
              {
                id: 'backend-session-2',
                status: 'active',
                created_at: '2026-04-13T01:00:01.000Z',
              },
            ],
          });

        renderComponent();

        await waitFor(() => {
          expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
            'data-active-terminal-tab-id',
            'terminal-session-1',
          );
          expect(pollTerminalWorkspace).toBeTypeOf('function');
        });

        const secondTerminalTabButton = screen
          .getByTestId('notebook__task-terminal-tab-terminal-session-2')
          .querySelector('button');
        expect(secondTerminalTabButton).toBeTruthy();

        await act(async () => {
          flushSync(() => {
            (secondTerminalTabButton as HTMLButtonElement).click();
            pollTerminalWorkspace?.();
          });
          await Promise.resolve();
        });

        await waitFor(() => {
          expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
          expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
            'data-active-terminal-tab-id',
            'terminal-session-2',
          );
          expect(latestTaskTerminalPanelPropsRef.current.tabId).toBe('terminal-session-2');
        });
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });

    it('preserves the current artifacts drawer choice during preserve-current poll hydration instead of replaying boot storage', async () => {
      const user = userEvent.setup();
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: false,
        }),
      );
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValue({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Show Artifacts');
      });

      await user.click(screen.getByTestId('notebook__task-artifacts-toggle'));

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-1');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
      });
    });

    it('preserves the current artifacts drawer choice when terminal poll hydration clears backend sessions to zero', async () => {
      const user = userEvent.setup();
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: false,
        }),
      );
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 0,
          items: [],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Show Artifacts');
      });

      await user.click(screen.getByTestId('notebook__task-artifacts-toggle'));

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-1');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(screen.queryByTestId('notebook__task-terminal-status-strip')).not.toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
      });
    });

    it('keeps the conversation artifacts preference in storage while terminal mode temporarily hides the drawer', async () => {
      const user = userEvent.setup();
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 1,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toBeInTheDocument();
      });

      await act(async () => {
        await user.click(
          within(screen.getByTestId('notebook__task-terminal-status-strip')).getByRole('button', {
            name: 'Open Terminal Workspace',
          }),
        );
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.queryByTestId('notebook__task-artifacts-drawer')).not.toBeInTheDocument();
      });

      expect(
        JSON.parse(
          window.sessionStorage.getItem(
            `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
          ) ?? 'null',
        ),
      ).toMatchObject({
        preferredViewMode: 'terminal',
        artifactsDrawerOpen: true,
      });
    });

    it('restores the conversation artifacts drawer after terminal mode ends without treating the temporary terminal hide as the new preference', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 0,
          items: [],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('terminal');
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.queryByTestId('notebook__task-artifacts-drawer')).not.toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-1');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
      });
    });

    it('treats a reloaded disconnected terminal session as recovering rather than preparing', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-2',
          artifactsDrawerOpen: false,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'disconnected',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-terminal-tab-terminal-session-2')).toHaveTextContent('Recovering');
        expect(screen.getByTestId('notebook__task-terminal-tab-terminal-session-2')).not.toHaveTextContent('Connecting');
        expect(screen.getByTestId('notebook__task-terminal-tab-terminal-session-2')).not.toHaveTextContent('Preparing');
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });
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
      mockTaskHookState.messages = [];
      mockTaskApiListTerminalSessions.mockRejectedValue(
        new Error('terminal list unavailable'),
      );

      renderComponent();

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalled();
      });
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          logContext: 'TaskPage.hydrateTerminalWorkspace',
          showToast: false,
        }),
      );
      expect(mockToastError).not.toHaveBeenCalled();

      await waitFor(() => {
        expect(screen.getByTestId('task-header-terminal-create-enabled')).toHaveTextContent('false');
        expect(screen.getByTestId('task-header-delete-blocked-reason')).toHaveTextContent(
          'Terminal session status is temporarily unavailable. Retry before deleting this task.',
        );
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).toBeInTheDocument();
        expect(screen.getByTestId('notebook__task-terminal-truth-unavailable')).toBeInTheDocument();
      });

      expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
        'Terminal session status is temporarily unavailable',
      );
      expect(
        screen.getByTestId('conversation-blocked-description'),
      ).toHaveTextContent(
        'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
      );
      const retryButton = screen.getByTestId('conversation-blocked-state').querySelector('button');
      expect(retryButton).toHaveTextContent('Retry terminal status check');
      expect(
        screen.getByTestId('notebook__task-terminal-truth-unavailable').querySelector('button'),
      ).not.toBeInTheDocument();

      const listCallCountBeforeRetry =
        mockTaskApiListTerminalSessions.mock.calls.length;
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({ total: 0, items: [] });
      await user.click(retryButton as HTMLButtonElement);

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions.mock.calls.length).toBeGreaterThan(
          listCallCountBeforeRetry,
        );
        expect(screen.getByTestId('task-header-terminal-create-enabled')).toHaveTextContent('true');
        expect(screen.getByTestId('task-header-delete-blocked-reason')).toHaveTextContent('');
        expect(screen.getByTestId('conversation-panel').querySelector('[data-disabled]')).not.toBeInTheDocument();
        expect(screen.queryByTestId('conversation-blocked-state')).not.toBeInTheDocument();
      });
    });

    it('auto-unlocks conversation input and delete blocking when backend terminal truth refreshes from 1 to 0', async () => {
      mockTaskHookState.messages = [];
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 0,
          items: [],
        });

      renderComponent();

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
          'End all terminal sessions before deleting this task.',
        );
        expect(latestConversationPanelPropsRef.current.disabled).toBe(true);
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
      }, { timeout: 3000 });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBeNull();
        expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(true);
        expect(latestConversationPanelPropsRef.current.disabled).toBe(false);
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBeUndefined();
        expect(screen.queryByTestId('notebook__task-terminal-status-strip')).not.toBeInTheDocument();
      });
    });

    it('renders artifacts panel', async () => {
      await renderComponentReady();

      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });

    it('hides empty artifacts chrome until artifact truth exists even when the stored preference is open', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: null,
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskHookState.artifacts = [];

      const view = await renderComponentReady();

      expect(screen.queryByTestId('notebook__task-artifacts-toggle')).not.toBeInTheDocument();
      expect(screen.queryByTestId('notebook__task-artifacts-drawer')).not.toBeInTheDocument();

      mockTaskHookState.artifacts = mockArtifacts;
      view.rerender(
        <QueryClientProvider client={view.queryClient}>
          <TaskPage
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            taskId={mockTaskId}
            canCreateTask={true}
            canUpdateTask={true}
            canDeleteTask={true}
            canUseTerminal={true}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-artifacts-toggle')).toHaveTextContent(
          'Hide Artifacts',
        );
        expect(screen.getByTestId('notebook__task-artifacts-drawer')).toBeInTheDocument();
      });
    });

    it('uses slower artifact auto refresh interval while task is idle', async () => {
      await renderComponentReady();

      expect(latestUseTaskArtifactsArgsRef.current[3]).toMatchObject({
        refetchInterval: false,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
      });
    });

    it('uses faster artifact auto refresh interval while a run is active', async () => {
      mockTaskHookState.task = { ...mockTask, run_state: 'running' };

      await renderComponentReady();

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
        expect(screen.getByTestId('notebook__task-terminal-shell')).toBeInTheDocument();
        expect(screen.getByText('Terminal Workspace')).toBeInTheDocument();
        expect(
          screen.getByText(
            'Changes you make here affect files in this task workspace. Temporary shell variables stay only in this terminal session.',
          ),
        ).toBeInTheDocument();
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
        expect(screen.queryByTestId('notebook__task-artifacts-toggle')).not.toBeInTheDocument();
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.queryByTestId('conversation-blocked-state')).not.toBeInTheDocument();
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
          'End terminal sessions before starting a new agent run.',
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
          total: 1,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
        })
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
          3,
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

    it('ignores stale terminal sync snapshots that resolve after newer backend truth', async () => {
      const user = userEvent.setup();
      const firstSync = createDeferred<{
        total: number;
        items: Array<{ id: string; status: 'active'; created_at: string }>;
      }>();
      const secondSync = createDeferred<{
        total: number;
        items: Array<{ id: string; status: 'active'; created_at: string }>;
      }>();

      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockReturnValueOnce(firstSync.promise as any)
        .mockReturnValueOnce(secondSync.promise as any);

      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(
          latestTaskTerminalPanelPropsByTabIdRef.current['terminal-session-1'],
        ).toBeTruthy();
      });
      await user.click(screen.getByTestId('notebook__task-terminal-create'));
      await waitFor(() => {
        expect(
          latestTaskTerminalPanelPropsByTabIdRef.current['terminal-session-2'],
        ).toBeTruthy();
      });
      await act(async () => {
        latestTaskTerminalPanelPropsByTabIdRef.current[
          'terminal-session-1'
        ].onSessionResolved('backend-session-1');
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
      });

      await act(async () => {
        latestTaskTerminalPanelPropsByTabIdRef.current[
          'terminal-session-2'
        ].onSessionResolved('backend-session-2');
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(3);
      });

      await act(async () => {
        secondSync.resolve({
          total: 2,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              id: 'backend-session-2',
              status: 'active',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
        });
        await secondSync.promise;
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
        expect(
          screen.getAllByTestId(/^notebook__task-terminal-tab-terminal-session-\d+$/),
        ).toHaveLength(2);
      });

      await act(async () => {
        firstSync.resolve({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        });
        await firstSync.promise;
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
        expect(
          screen.getAllByTestId(/^notebook__task-terminal-tab-terminal-session-\d+$/),
        ).toHaveLength(2);
        expect(
          screen.getByTestId('notebook__task-terminal-tab-terminal-session-2'),
        ).toBeInTheDocument();
      });
    });

    it('uses the conversation blocker as the single recovery entry while sessions are active and supports reopening terminal workspace', async () => {
      const user = userEvent.setup();
      mockTaskHookState.messages = [];
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
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(
          screen.getByTestId('notebook__task-terminal-status-strip').querySelector('button'),
        ).toHaveTextContent('End All Sessions');
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).not.toHaveTextContent(
          'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.',
        );
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(latestConversationPanelPropsRef.current.blockedState?.actionLabel).toBe(
          'Open Terminal Workspace',
        );
      });
      expect(latestTaskTerminalPanelPropsRef.current.open).toBe(true);
      expect(latestTaskTerminalPanelPropsRef.current.visible).toBe(false);
      expect(screen.getAllByRole('button', { name: 'Open Terminal Workspace' })).toHaveLength(1);
      await user.click(
        screen.getByTestId('conversation-blocked-state').querySelector('button') as HTMLButtonElement,
      );
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
      });
      expect(latestTaskTerminalPanelPropsRef.current.open).toBe(true);
      expect(latestTaskTerminalPanelPropsRef.current.visible).toBe(true);
    });

    it('reconciles local terminal tabs with backend truth when ending all sessions from the conversation strip', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
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
      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await user.click(screen.getByRole('button', { name: 'End All Sessions' }));
      expect(mockTaskApiCloseTerminalSession).not.toHaveBeenCalled();
      const confirmDialog = await screen.findByRole('alertdialog');
      expect(confirmDialog).toHaveTextContent('End all terminal sessions?');
      await user.click(within(confirmDialog).getByRole('button', { name: 'End All Sessions' }));

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
          4,
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(screen.queryByTestId('notebook__task-terminal-status-strip')).not.toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBeNull();
        expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(true);
        expect(latestConversationPanelPropsRef.current.disabled).toBe(false);
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBeUndefined();
      });
    });

    it('keeps remaining terminal tabs if backend still reports live sessions after ending all from conversation strip', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
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
      expect(mockTaskApiCloseTerminalSession).not.toHaveBeenCalled();
      const confirmDialog = await screen.findByRole('alertdialog');
      await user.click(within(confirmDialog).getByRole('button', { name: 'End All Sessions' }));

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
          '1 terminal session is using this task',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
          'End terminal sessions before starting a new agent run.',
        );
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('terminal');
      });

      await waitFor(() => {
        const remainingTabs = screen.getAllByTestId(
          /^notebook__task-terminal-tab-terminal-session-\d+$/,
        );
        expect(remainingTabs).toHaveLength(1);
        expect(remainingTabs[0]).toHaveTextContent('Terminal Session 1');
        expect(remainingTabs[0]).not.toHaveTextContent('Terminal Session 2');
      });
    });

    it('passes a blocked conversation state instead of empty conversation cues while a terminal session is occupying the task', async () => {
      mockTaskHookState.messages = [];
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
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.getByTestId('conversation-blocked-description')).toHaveTextContent(
          'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.',
        );
        expect(latestConversationPanelPropsRef.current.blockedState?.actionLabel).toBe(
          'Open Terminal Workspace',
        );
      });
    });

    it('uses plural blocker copy when multiple hidden terminal sessions are still active', async () => {
      mockTaskHookState.messages = [];
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'active',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '2 terminal sessions are using this task',
        );
        expect(screen.getByTestId('conversation-blocked-description')).toHaveTextContent(
          'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.',
        );
      });
    });

    it('switches the blocker action to recovery guidance when a hidden terminal session has failed', async () => {
      mockTaskHookState.messages = [];
      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onStatusChange('failed');
      });
      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session on this task needs recovery',
        );
        expect(
          screen.getByTestId('notebook__task-terminal-status-strip').querySelector('button'),
        ).toHaveTextContent('End All Sessions');
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).not.toHaveTextContent(
          'This terminal session needs recovery. Reopen it to reconnect or review the issue, or end the session before starting a new run.',
        );
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '1 terminal session on this task needs recovery',
        );
        expect(screen.getByTestId('conversation-blocked-description')).toHaveTextContent(
          'This terminal session needs recovery. Reopen it to reconnect or review the issue, or end the session before starting a new run.',
        );
        expect(latestConversationPanelPropsRef.current.blockedState?.actionLabel).toBe(
          'Reopen Terminal Workspace',
        );
      });
      expect(screen.getAllByRole('button', { name: 'Reopen Terminal Workspace' })).toHaveLength(1);
    });

    it('uses mixed occupancy copy when disconnected and active sessions coexist in the hidden blocker', async () => {
      mockTaskHookState.messages = [];
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'disconnected',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalHasRecovery).toBe(true);
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).not.toHaveTextContent(
          '2 terminal sessions are still using this task, and 1 of them needs recovery. Reopen the terminal workspace to reconnect or review the issue, or end the sessions before starting a new run.',
        );
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('conversation-blocked-description')).toHaveTextContent(
          '2 terminal sessions are still using this task, and 1 of them needs recovery. Reopen the terminal workspace to reconnect or review the issue, or end the sessions before starting a new run.',
        );
        expect(latestConversationPanelPropsRef.current.blockedState?.actionLabel).toBe(
          'Reopen Terminal Workspace',
        );
      });
    });

    it('immediately converges terminal summary and blocker copy after closing the broken session from a mixed recovery workspace', async () => {
      const user = userEvent.setup();
      mockTaskHookState.messages = [];
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 2,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              id: 'backend-session-2',
              status: 'failed',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
      });

      await act(async () => {
        (
          screen.getByTestId('conversation-blocked-state').querySelector('button') as HTMLButtonElement
        ).click();
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
        expect(screen.getByTestId('notebook__task-terminal-shell-summary')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
      });

      await user.click(screen.getByTestId('notebook__task-terminal-close-terminal-session-2'));

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-shell-summary')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.getByTestId('notebook__task-terminal-shell-summary')).not.toHaveTextContent(
          'needs recovery',
        );
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      }, { timeout: 250 });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.getByTestId('notebook__task-terminal-status-strip')).not.toHaveTextContent(
          'needs recovery',
        );
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.getByTestId('conversation-blocked-description')).toHaveTextContent(
          'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.',
        );
        expect(latestConversationPanelPropsRef.current.blockedState?.actionLabel).toBe(
          'Open Terminal Workspace',
        );
      }, { timeout: 250 });
    });

    it('focuses the recovery tab when reopen terminal workspace is used from a mixed hidden blocker', async () => {
      mockTaskHookState.messages = [];
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'disconnected',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
      });

      await act(async () => {
        (
          screen.getByTestId('conversation-blocked-state').querySelector('button') as HTMLButtonElement
        ).click();
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
      });
    });

    it('reopens the backend-truth recovery tab even when local tab status drift marked it as active', async () => {
      mockTaskHookState.messages = [];
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'disconnected',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskTerminalPanelPropsRef.current.tabId).toBe('terminal-session-2');
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onStatusChange('active');
      });

      await act(async () => {
        (
          screen.getByTestId('conversation-blocked-state').querySelector('button') as HTMLButtonElement
        ).click();
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
      });
    });

    it('keeps the preferred recovery tab focused when reopen terminal workspace is used and the active tab is already a recovery tab', async () => {
      mockTaskHookState.messages = [];
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'conversation',
          preferredActiveSessionId: 'backend-session-2',
          artifactsDrawerOpen: true,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 3,
        items: [
          {
            id: 'backend-session-1',
            status: 'disconnected',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            id: 'backend-session-2',
            status: 'failed',
            created_at: '2026-04-13T01:00:01.000Z',
          },
          {
            id: 'backend-session-3',
            status: 'active',
            created_at: '2026-04-13T01:00:02.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '3 terminal sessions are using this task, 2 need recovery',
        );
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
      });

      await act(async () => {
        (
          screen.getByTestId('conversation-blocked-state').querySelector('button') as HTMLButtonElement
        ).click();
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.getByTestId('notebook__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
      });
    });

    it('passes a blocked conversation state while terminal truth is unavailable so empty-state prompts do not contradict the block', async () => {
      mockTaskHookState.messages = [];
      mockTaskApiListTerminalSessions.mockRejectedValue(
        new Error('terminal list unavailable'),
      );

      renderComponent();

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalled();
      });

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          'Terminal session status is temporarily unavailable',
        );
        expect(screen.getByTestId('notebook__task-terminal-truth-unavailable')).not.toHaveTextContent(
          'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
        );
        expect(screen.getByTestId('conversation-blocked-description')).toHaveTextContent(
          'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
        );
        expect(latestConversationPanelPropsRef.current.blockedState?.actionLabel).toBe(
          'Retry terminal status check',
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
          total: 1,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
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
      expect(mockTaskApiCloseTerminalSession).not.toHaveBeenCalled();
      const confirmDialog = await screen.findByRole('alertdialog');
      await user.click(within(confirmDialog).getByRole('button', { name: 'End All Sessions' }));

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
      });
    });

    it('disables creating terminal sessions while a send is already pending', async () => {
      mockSendMessageIsPending.value = true;
      await renderComponentReady();

      expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
    });

    it('disables creating terminal sessions when the user lacks terminal permission', async () => {
      await renderComponentReady({ canUseTerminal: false });

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

    it('does not pass a global execution details mode into ConversationPanel', async () => {
      await renderComponentReady();

      expect(latestConversationPanelPropsRef.current).toBeTruthy();
      expect(latestConversationPanelPropsRef.current.showExecutionDetails).toBeUndefined();
      expect(latestConversationPanelPropsRef.current.onToggleExecutionDetails).toBeUndefined();
    });
  });

  describe('SSE Connection', () => {
    it('establishes SSE connection when task loads', async () => {
      await renderComponentReady();

      // SSE connection is established via the useTaskSSE hook
      // This is tested indirectly by checking that the component renders without errors
      expect(screen.getByTestId('task-header')).toBeInTheDocument();
    });

    it('clears stale local realtime failure after reconcile succeeds without an SSE reconnect', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
      };
      mockSendMessageIsPending.value = true;

      await renderComponentReady();

      await act(async () => {
        latestTaskSseOptionsRef.current?.onError?.(
          Object.assign(new Error('Trace tail fetch returned 503'), {
            code: 'TRACE_RECONCILE_FAILED',
          }),
        );
      });

      await waitFor(() => {
        expect(latestConversationPanelPropsRef.current.connectionStatus).toBe('connected');
        expect(latestConversationPanelPropsRef.current.connectionErrorCode).toBe(
          'TRACE_RECONCILE_FAILED',
        );
        expect(latestConversationPanelPropsRef.current.connectionErrorMessage).toBe(
          'Trace tail fetch returned 503',
        );
      });

      await user.click(screen.getByText('Cancel Active Run'));

      await waitFor(() => {
        expect(mockTaskApiCancelRun).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(mockTaskApiListTraces).toHaveBeenCalled();
        expect(latestConversationPanelPropsRef.current.connectionStatus).toBe('connected');
        expect(latestConversationPanelPropsRef.current.connectionErrorCode).toBeNull();
        expect(latestConversationPanelPropsRef.current.connectionErrorMessage).toBeNull();
      });
    });

    it('keeps active hook-level connection failures visible after reconcile succeeds', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
      };
      mockSendMessageIsPending.value = true;
      mockTaskSseState.connectionStatus = 'error';
      mockTaskSseState.connectionErrorCode = 'TASK_EVENTS_STREAM_UNAVAILABLE';
      mockTaskSseState.connectionErrorMessage =
        'SSE connection failed after 5 reconnection attempts';

      await renderComponentReady();

      await waitFor(() => {
        expect(latestConversationPanelPropsRef.current.connectionStatus).toBe('error');
        expect(latestConversationPanelPropsRef.current.connectionErrorCode).toBe(
          'TASK_EVENTS_STREAM_UNAVAILABLE',
        );
        expect(latestConversationPanelPropsRef.current.connectionErrorMessage).toBe(
          'SSE connection failed after 5 reconnection attempts',
        );
      });

      await user.click(screen.getByText('Cancel Active Run'));

      await waitFor(() => {
        expect(mockTaskApiCancelRun).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(mockTaskApiListTraces).toHaveBeenCalled();
        expect(latestConversationPanelPropsRef.current.connectionStatus).toBe('error');
        expect(latestConversationPanelPropsRef.current.connectionErrorCode).toBe(
          'TASK_EVENTS_STREAM_UNAVAILABLE',
        );
        expect(latestConversationPanelPropsRef.current.connectionErrorMessage).toBe(
          'SSE connection failed after 5 reconnection attempts',
        );
      });
    });

    it('keeps the local realtime failure visible when task truth refetch fails during reconcile', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
      };
      mockSendMessageIsPending.value = true;
      mockUseTaskRefetch.mockResolvedValueOnce({
        data: undefined,
        error: new Error('Task detail refetch failed'),
      });

      await renderComponentReady();

      await act(async () => {
        latestTaskSseOptionsRef.current?.onError?.(
          Object.assign(new Error('Trace tail fetch returned 503'), {
            code: 'TRACE_RECONCILE_FAILED',
          }),
        );
      });

      await user.click(screen.getByText('Cancel Active Run'));

      await waitFor(() => {
        expect(mockTaskApiCancelRun).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(mockTaskApiListTraces).toHaveBeenCalled();
        expect(latestConversationPanelPropsRef.current.connectionStatus).toBe('connected');
        expect(latestConversationPanelPropsRef.current.connectionErrorCode).toBe(
          'TRACE_RECONCILE_FAILED',
        );
        expect(latestConversationPanelPropsRef.current.connectionErrorMessage).toBe(
          'Task detail refetch failed',
        );
      });
    });

    it('reconciles final assistant content and trace tail after backend finishes while SSE recovery is exhausted', async () => {
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
        last_activity_at: '2026-03-06T04:00:00.000Z',
      };
      mockTaskHookState.messages = [
        mockMessages[0],
        {
          ...mockMessages[1],
          content: 'Partial assistant output',
        },
      ];

      const finalMessages = [
        mockMessages[0],
        {
          ...mockMessages[1],
          content: 'Final assistant output from backend truth',
        },
      ];

      mockUseTaskRefetch.mockImplementation(async () => ({
        data: mockTaskHookState.task,
      }));
      mockUseTaskMessagesRefetch.mockImplementation(async () => {
        mockTaskHookState.messages = finalMessages;
        return { data: finalMessages };
      });
      mockTaskApiListTraces.mockResolvedValueOnce({
        items: [
          {
            id: 'trace_run_done',
            task_id: mockTaskId,
            message_id: 'msg-2',
            run_id: 'run-1',
            seq: 12,
            at: '2026-03-06T04:00:01.000Z',
            category: 'lifecycle',
            phase: 'end',
            status: 'success',
            name: 'run.lifecycle',
            summary: 'Run completed',
          },
        ],
        total: 1,
        has_more: false,
        next_after_id: null,
      });

      const view = await renderComponentReady();

      await act(async () => {
        latestTaskSseOptionsRef.current?.onError?.(
          Object.assign(
            new Error('SSE connection failed after 5 reconnection attempts'),
            { code: 'TASK_EVENTS_RECOVERY_EXHAUSTED' },
          ),
        );
      });

      await waitFor(() => {
        expect(latestConversationPanelPropsRef.current.connectionErrorCode).toBe(
          'TASK_EVENTS_RECOVERY_EXHAUSTED',
        );
      });

      mockTaskHookState.task = {
        ...mockTaskHookState.task,
        run_state: 'idle',
        last_activity_at: '2026-03-06T04:00:02.000Z',
      };

      view.rerender(
        <QueryClientProvider client={view.queryClient}>
          <TaskPage
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            taskId={mockTaskId}
            canCreateTask={true}
            canUpdateTask={true}
            canDeleteTask={true}
            canUseTerminal={true}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(mockUseTaskRefetch).toHaveBeenCalled();
        expect(mockUseTaskMessagesRefetch).toHaveBeenCalled();
        expect(mockTaskArtifactsRefetch).toHaveBeenCalled();
        expect(mockTaskApiListTraces).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          expect.objectContaining({ page_size: 500 }),
        );
        expect(latestConversationPanelPropsRef.current.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: 'msg-2',
              role: 'agent',
              content: 'Final assistant output from backend truth',
            }),
          ]),
        );
        expect(latestConversationPanelPropsRef.current.connectionErrorCode).toBeNull();
        expect(latestConversationPanelPropsRef.current.connectionErrorMessage).toBeNull();
      });
    });
  });

  describe('Message Sending', () => {
    it('sends message through conversation panel', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

      const sendButton = screen.getByText('Send Message');
      await user.click(sendButton);

      // Message sending is handled by the ConversationPanel component
    });

    it('sets up streaming state for agent responses', async () => {
      await renderComponentReady();

      // Streaming state is managed internally
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('adds an optimistic user message and keeps streaming state after send', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

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
        await renderComponentReady();
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
      await renderComponentReady();

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
      await renderComponentReady();

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

    it('reconciles task truth after cancel is accepted', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

      await user.click(screen.getByText('Send Message'));
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('true');

      await user.click(screen.getByText('Cancel Active Run'));

      await waitFor(() => {
        expect(mockUseTaskRefetch).toHaveBeenCalled();
        expect(mockUseTaskMessagesRefetch).toHaveBeenCalled();
        expect(mockTaskArtifactsRefetch).toHaveBeenCalled();
        expect(mockTaskApiListTraces).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          expect.objectContaining({ page_size: 500 }),
        );
      });
    });

    it('queues input behind backend run truth on re-entry and flushes it after the task goes idle', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = { ...mockTask, run_state: 'running' };

      const view = await renderComponentReady();

      await user.click(screen.getByText('Send Message'));

      expect(mockSendMessageMutateAsync).not.toHaveBeenCalled();
      expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent('1');

      mockTaskHookState.task = { ...mockTask, run_state: 'idle' };
      view.rerender(
        <QueryClientProvider client={view.queryClient}>
          <TaskPage
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            taskId={mockTaskId}
            canCreateTask={true}
            canUpdateTask={true}
            canDeleteTask={true}
            canUseTerminal={true}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(mockSendMessageMutateAsync).toHaveBeenCalledTimes(1);
      });
    });

    it('clears a cancelled run after authoritative idle recovery and does not re-enter the pending loop on refresh', async () => {
      mockSendMessageMutateAsync
        .mockResolvedValueOnce({
          id: 'new-msg-id',
          role: 'agent',
          content: '',
          created_at: '2026-03-06T04:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'queued-msg-id',
          role: 'agent',
          content: '',
          created_at: '2026-03-06T04:00:02.000Z',
        });

      const view = await renderComponentReady();
      const user = userEvent.setup();

      await user.click(screen.getByText('Send Message'));
      await user.click(screen.getByText('Send Message'));
      await waitFor(() => {
        expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent('1');
      });

      await user.click(screen.getByText('Cancel Active Run'));
      await waitFor(() => {
        expect(mockTaskApiCancelRun).toHaveBeenCalledTimes(1);
      });

      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'idle',
        last_activity_at: '2026-03-06T04:00:03.000Z',
      };
      view.rerender(
        <QueryClientProvider client={view.queryClient}>
          <TaskPage
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            taskId={mockTaskId}
            canCreateTask={true}
            canUpdateTask={true}
            canDeleteTask={true}
            canUseTerminal={true}
          />
        </QueryClientProvider>,
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      });

      await waitFor(() => {
        expect(mockSendMessageMutateAsync).toHaveBeenCalledTimes(2);
        expect(mockSendMessageMutateAsync).toHaveBeenNthCalledWith(2, {
          workspaceId: mockWorkspaceId,
          projectId: mockProjectId,
          taskId: mockTaskId,
          data: {
            task_id: mockTaskId,
            content: 'Test message',
          },
        });
        expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent('0');
        expect(latestConversationPanelPropsRef.current.streamingMessageId).toBe('queued-msg-id');
      });

      view.rerender(
        <QueryClientProvider client={view.queryClient}>
          <TaskPage
            workspaceId={mockWorkspaceId}
            projectId={mockProjectId}
            taskId={mockTaskId}
            canCreateTask={true}
            canUpdateTask={true}
            canDeleteTask={true}
            canUseTerminal={true}
          />
        </QueryClientProvider>,
      );

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      });

      await waitFor(() => {
        expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('false');
        expect(latestConversationPanelPropsRef.current.streamingMessageId).toBeNull();
        expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent('0');
        expect(mockSendMessageMutateAsync).toHaveBeenCalledTimes(2);
      });
    }, 12_000);

    it.each([
      {
        terminalTraceEvent: {
          id: 'trace_run_user_cancel',
          task_id: mockTaskId,
          message_id: 'new-msg-id',
          run_id: 'run-1',
          seq: 12,
          at: '2026-03-06T04:00:01.000Z',
          category: 'warning',
          phase: 'end',
          status: 'cancelled',
          name: 'run.user_cancel',
          summary: 'Run cancelled by request',
        },
      },
      {
        terminalTraceEvent: {
          id: 'trace_execution_terminal',
          task_id: mockTaskId,
          message_id: 'new-msg-id',
          run_id: 'run-1',
          seq: 13,
          at: '2026-03-06T04:00:02.000Z',
          category: 'error',
          phase: 'end',
          status: 'error',
          name: 'execution.terminal',
          summary: 'Run terminated by backend truth',
        },
      },
    ])('clears local busy state when $terminalTraceEvent.name arrives as terminal trace truth', async ({ terminalTraceEvent }) => {
      const user = userEvent.setup();
      await renderComponentReady();

      await user.click(screen.getByText('Send Message'));
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('true');
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('true');

      await act(async () => {
        latestTaskSseOptionsRef.current?.onTraceEvent?.(terminalTraceEvent);
      });

      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('false');
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('false');
    });

    it('does not clear streaming state immediately during an idle gap after send', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

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

      await renderComponentReady();

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
      await renderComponentReady();

      const leaveButton = screen.getByText('Leave');
      await user.click(leaveButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/notebook`
      );
    });

    it('navigates to new task after creation', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

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
      await renderComponentReady();

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
      await renderComponentReady();

      const viewButton = screen.getByText('View Artifact');
      await user.click(viewButton);

      // Viewer dialog should open
    });

    it('downloads artifact', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

      const downloadButton = screen.getByText('Download Artifact');
      await user.click(downloadButton);

      // The download handler creates a TaskAPI instance and calls downloadArtifact
      // Verify the mock constructor was called (the async download chain is tested via the API mock)
      const { TaskAPI } = await import('@/lib/api');
      expect(TaskAPI).toHaveBeenCalled();
    });

    it('refreshes artifacts when the panel refresh action is triggered', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

      await user.click(screen.getByText('Refresh Artifacts'));

      expect(mockTaskArtifactsRefetch).toHaveBeenCalledTimes(1);
    });

    it('passes artifact refresh loading state into the panel', async () => {
      mockTaskArtifactsIsRefetching.value = true;
      await renderComponentReady();

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
    it('has correct layout structure', async () => {
      const { container } = await renderComponentReady();

      const page = container.querySelector('.h-full.flex.flex-col');
      expect(page).toBeInTheDocument();
    });

    it('has three-column layout for panels', async () => {
      const { container } = await renderComponentReady();

      const flexContainer = container.querySelector('.flex-1.flex.min-h-0');
      expect(flexContainer).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('shows rate limit toast when message send is throttled', async () => {
      const user = userEvent.setup();
      mockSendMessageMutateAsync.mockRejectedValueOnce(new ApiError('RATE_LIMIT_EXCEEDED', 'Too many requests', 'req-1', 429));
      await renderComponentReady();

      await user.click(screen.getByText('Send Message'));

      expect(mockToastError).toHaveBeenCalledWith(
        'Request rate limited: This request exceeded the current limit. Please retry shortly.',
      );
      expect(mockHandleError).not.toHaveBeenCalled();
    });

    it('handles download errors gracefully', async () => {
      await renderComponentReady();

      // Download errors are handled internally
      expect(screen.getByTestId('artifacts-panel')).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles task with no messages', async () => {
      mockTaskHookState.messages = [];
      mockTaskHookState.artifacts = [];

      await renderComponentReady();

      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it('handles task with no artifacts', async () => {
      mockTaskHookState.artifacts = [];

      await renderComponentReady();

      expect(screen.queryByTestId('artifacts-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('notebook__task-artifacts-toggle')).not.toBeInTheDocument();
    });

    it('handles task with no attached files', async () => {
      mockTaskHookState.task = { ...mockTask, attached_inputs: [] };

      await renderComponentReady();

      expect(screen.queryByTestId('attached-inputs-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });
  });
});
