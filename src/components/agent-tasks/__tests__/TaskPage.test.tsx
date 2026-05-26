/**
 * Tests for TaskPage component
 */

import * as React from 'react';
import { readFileSync } from 'node:fs';
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
import {
  collectRecentRunActions,
  deriveRunAction,
} from '../task-page/run-activity';
import { ApiError } from '@/lib/api/client';
import type {
  Task,
  TaskTerminalLifecycleStatus,
  TaskTerminalSessionStatusValue,
  TaskTraceEvent,
} from '@/lib/types/task';
import {
  mockArtifacts,
  mockMessages,
  mockTask,
  renderWithAgentTaskQueryClient,
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
  latestUseTaskActivityArgsRef,
  mockUseTaskRefetch,
  mockUseTaskActivityRefetch,
  mockCreateTaskMutateAsync,
  mockCreateTaskIsPending,
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
  latestUseTaskActivityArgsRef: { current: null as any },
  mockUseTaskRefetch: vi.fn(),
  mockUseTaskActivityRefetch: vi.fn(),
  mockCreateTaskMutateAsync: vi.fn(),
  mockCreateTaskIsPending: { value: false },
  mockTaskApiCancelRun: vi.fn(),
  mockTaskApiListTerminalSessions: vi.fn(),
  mockTaskApiCloseTerminalSession: vi.fn(),
  mockStoreTaskTerminalPanelSessionIdForScope: vi.fn(),
  mockClearTaskTerminalPanelSessionStateForScope: vi.fn(),
}));

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string, values?: Record<string, string | number>) => {
    const scoped = namespace ? `${namespace}.${key}` : key;
    if (scoped === 'agent_tasks.task.terminal_status_strip_active') {
      const count = Number(values?.count ?? 0);
      return count === 1
        ? '1 terminal session is using this task'
        : `${count} terminal sessions are using this task`;
    }
    if (scoped === 'agent_tasks.task.terminal_status_strip_recovery') {
      const count = Number(values?.count ?? 0);
      return count === 1
        ? '1 terminal session on this task needs recovery'
        : `${count} terminal sessions on this task need recovery`;
    }
    if (scoped === 'agent_tasks.task.terminal_status_strip_mixed') {
      const count = Number(values?.count ?? 0);
      const recoveryCount = Number(values?.recoveryCount ?? 0);
      return `${count} terminal sessions are using this task, ${recoveryCount} ${recoveryCount === 1 ? 'needs' : 'need'} recovery`;
    }
    if (scoped === 'agent_tasks.task.terminal_hidden_active_description') {
      const count = Number(values?.count ?? 1);
      return count === 1
        ? 'The terminal workspace is hidden, but this session still blocks new agent runs until you open the terminal workspace or end the session.'
        : 'The terminal workspace is hidden, but these sessions still block new agent runs until you open the terminal workspace or end the sessions.';
    }
    if (scoped === 'agent_tasks.task.terminal_hidden_failed_description') {
      const count = Number(values?.count ?? 1);
      return count === 1
        ? 'This terminal session needs recovery. Reopen it to reconnect or review the issue, or end the session before starting a new run.'
        : `${count} terminal sessions need recovery. Reopen the terminal workspace to reconnect or review the issues, or end the sessions before starting a new run.`;
    }
    if (scoped === 'agent_tasks.task.terminal_hidden_mixed_description') {
      const count = Number(values?.count ?? 1);
      const recoveryCount = Number(values?.recoveryCount ?? 0);
      return `${count} terminal sessions are still using this task, and ${recoveryCount} of them needs recovery. Reopen the terminal workspace to reconnect or review the issue, or end the sessions before starting a new run.`;
    }
    const dict: Record<string, string> = {
      'common.cancel': 'Cancel',
      'common.retry': 'Retry',
      'common.open_chat': 'Open Chat',
      'common.open_files': 'Open Files',
      'agent_tasks.task.loading': 'Loading task...',
      'agent_tasks.task.not_found_title': 'Task not found',
      'agent_tasks.task.not_found_description': "The task you're looking for doesn't exist or has been deleted.",
      'agent_tasks.task.back_to_agent_tasks': 'Go back to Agent tasks',
      'agent_tasks.conversation.process_load_more': 'Load older steps',
      'agent_tasks.conversation.send_rate_limited_title': 'Request rate limited',
      'agent_tasks.conversation.send_rate_limited_description': 'This request exceeded the current limit. Please retry shortly.',
      'agent_tasks.conversation.send_conflict_title': 'Task run still in progress',
      'agent_tasks.conversation.send_conflict_description': 'The previous turn has not finished yet. Wait for it to complete before sending.',
      'agent_tasks.conversation.agent_offline_send_blocked': 'Agent is offline. Start/reconnect the external agent execution channel before sending.',
      'agent_tasks.conversation.pending_enqueued': 'Queued for sending. It will be sent after the current run finishes.',
      'agent_tasks.task.terminal_agent_run_blocked': 'End the terminal session before starting a new agent run.',
      'agent_tasks.task.terminal_input_blocked_placeholder': 'End terminal sessions before starting a new agent run.',
      'agent_tasks.task.terminal_workspace': 'Terminal Workspace',
      'agent_tasks.task.terminal_session': 'Terminal Session',
      'agent_tasks.task.terminal_new_session': 'New Session',
      'agent_tasks.task.terminal_close': 'End Session',
      'agent_tasks.task.terminal_end_all': 'End All Sessions',
      'agent_tasks.task.terminal_end_all_confirm_title': 'End all terminal sessions?',
      'agent_tasks.task.terminal_end_all_confirm_description': 'This closes every terminal session on this task and lets agent work continue again.',
      'agent_tasks.task.terminal_end_all_confirm_action': 'End All Sessions',
      'agent_tasks.task.terminal_mode_conversation': 'Conversation',
      'agent_tasks.task.terminal_mode_terminal': 'Terminal',
      'agent_tasks.task.terminal_workspace_open': 'Open Terminal Workspace',
      'agent_tasks.task.terminal_max_sessions_reached': 'You can run up to 3 terminal sessions in one task.',
      'agent_tasks.task.terminal_status_idle': 'Idle',
      'agent_tasks.task.terminal_status_preparing': 'Preparing',
      'agent_tasks.task.terminal_status_disconnected': 'Disconnected',
      'agent_tasks.task.terminal_status_recovering': 'Recovering',
      'agent_tasks.task.terminal_status_connecting': 'Connecting',
      'agent_tasks.task.terminal_status_active': 'Active',
      'agent_tasks.task.terminal_status_closing': 'Closing',
      'agent_tasks.task.terminal_status_closed': 'Closed',
      'agent_tasks.task.terminal_status_failed': 'Failed',
      'agent_tasks.task.delete_blocked_terminal_sessions': 'End all terminal sessions before deleting this task.',
      'agent_tasks.task.delete_blocked_terminal_sessions_pending': 'Checking terminal sessions before deleting this task.',
      'agent_tasks.task.delete_blocked_terminal_sessions_unavailable': 'Terminal session status is temporarily unavailable. Retry before deleting this task.',
      'agent_tasks.task.artifacts_show': 'Show Artifacts',
      'agent_tasks.task.artifacts_hide': 'Hide Artifacts',
      'agent_tasks.task.terminal_truth_unavailable_title': 'Terminal session status is temporarily unavailable',
      'agent_tasks.task.terminal_truth_unavailable_description': 'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
      'agent_tasks.task.terminal_truth_unavailable_action': 'Retry terminal status check',
      'agent_tasks.task.terminal_unavailable_terminal_truth': 'Retry after terminal session status is available again.',
      'agent_tasks.task.terminal_description': 'Directly control the current task environment when you need to work by hand.',
      'agent_tasks.task.terminal_scope_hint': 'Changes you make here affect files in this task workspace. Temporary shell variables stay only in this terminal session.',
      'agent_tasks.task.terminal_recovery_show': 'Reopen Terminal Workspace',
      'agent_tasks.task.terminal_hidden_active_title': 'Terminal session still active',
      'agent_tasks.task.terminal_hidden_failed_title': 'Terminal needs recovery',
      'agent_tasks.task.runner_binding_managed': 'Managed execution',
      'agent_tasks.task.runner_binding_managed_source': 'Deployment-managed execution',
      'agent_tasks.task.runner_binding_developer': 'Developer runner',
      'agent_tasks.task.runner_binding_explicit': 'Explicit binding',
      'agent_tasks.task.runner_binding_runner_id': 'Runner ID',
      'agent_tasks.task.runner_binding_issue_title': 'This task is bound to a Developer runner that is not available right now',
      'agent_tasks.task.runner_binding_issue_description': 'This task keeps using its original Developer runner. Create a new task with managed execution to keep working.',
      'agent_tasks.task.runner_binding_issue_action': 'Create new task with managed execution',
      'agent_tasks.conversation.run_cancel_requested': 'Cancel requested. Waiting for the agent to stop the current run.',
      'agent_tasks.conversation.run_cancelling_title': 'Stop requested',
      'agent_tasks.conversation.run_cancelling_description': 'Waiting for the agent to stop the current run.',
      'agent_tasks.conversation.run_terminating_title': 'Stopping execution',
      'agent_tasks.conversation.run_terminating_description': 'Ending the current execution environment before the next action can start.',
      'agent_tasks.conversation.run_finalizing_title': 'Saving final results',
      'agent_tasks.conversation.run_finalizing_description': 'The run has ended. Saving the final answer and artifacts.',
      'agent_tasks.conversation.run_escalation_title': 'Force stop this run?',
      'agent_tasks.conversation.run_escalation_description': 'The run is still cancelling after backend confirmation. Force stop the execution environment before continuing.',
      'agent_tasks.conversation.run_escalation_reason': 'Backend reason: {reason}',
      'agent_tasks.conversation.run_escalation_confirm': 'Force stop',
      'agent_tasks.conversation.run_escalation_cancel': 'Keep waiting',
      'agent_tasks.conversation.input_placeholder_cancelling': 'Wait for the current run to stop before sending another message.',
      'agent_tasks.conversation.input_placeholder_terminating': 'Wait for the current execution environment to finish stopping before sending another message.',
      'agent_tasks.conversation.input_placeholder_finalizing': 'Wait for the final results to finish saving before sending another message.',
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
  useTaskActivity: (...args: any[]) => {
    latestUseTaskActivityArgsRef.current = args;
    return ({
      data: mockTaskHookState.messages,
      isLoading: false,
      refetch: mockUseTaskActivityRefetch,
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
  useStartTaskRun: () => ({
    mutateAsync: mockSendMessageMutateAsync,
    isPending: mockSendMessageIsPending.value,
  }),
  useCreateTask: () => ({
    mutateAsync: mockCreateTaskMutateAsync,
    isPending: mockCreateTaskIsPending.value,
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
      onCreateBoundRunnerRecoveryTask,
      boundRunnerRecoveryActionLabel,
      onLeave,
      canCreateTerminalSession,
      deleteBlockedReason,
      headerAccessory,
    } = props;
    return (
      <div data-testid="task-header">
      <div data-testid="task-title">{task.title}</div>
      <div data-testid="task-header-busy">{String(!!props.agentRunActivity?.active)}</div>
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
      {boundRunnerRecoveryActionLabel ? (
        <button
          data-testid="task-header-bound-runner-recovery"
          onClick={onCreateBoundRunnerRecoveryTask}
        >
          {boundRunnerRecoveryActionLabel}
        </button>
      ) : null}
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
      activeRunView,
      pendingQueue,
      disabled,
      sending,
      messages,
      blockedState,
    } = props;
    return (
      <div data-testid="conversation-panel">
      <button onClick={() => onSendMessage('Test message')}>Send Message</button>
      <button onClick={() => activeRunView?.onCancel?.()}>Cancel Active Run</button>
      {messages?.some((m: any) => m.actor === 'runner') && (
        <>
          <button onClick={() => onTraceExpand?.('msg-2')}>Expand Trace</button>
          <button onClick={() => onTraceLoadMore?.('msg-2')}>Load More Trace</button>
        </>
      )}
      <div data-testid="conversation-run-active">{String(!!activeRunView)}</div>
      <div data-testid="conversation-active-run-message">{activeRunView?.messageId ?? ''}</div>
      <div data-testid="conversation-active-run-state">{activeRunView?.runState ?? ''}</div>
      <div data-testid="conversation-active-run-elapsed">{String(activeRunView?.elapsedSeconds ?? '')}</div>
      <div data-testid="conversation-pending-count">{String((pendingQueue ?? []).length)}</div>
      {blockedState && (!messages || messages.length === 0) ? (
        <div data-testid="conversation-blocked-state">
          <div data-testid="conversation-blocked-title">{blockedState.title}</div>
          <div data-testid="conversation-blocked-description">{blockedState.description}</div>
          {blockedState.actionLabel ? (
            <button
              onClick={() => blockedState.onAction?.()}
              data-testid={blockedState.actionTestId}
            >
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
  deriveDefaultTaskWorkspaceName: (title: string) => {
    const normalizedTitle = title.trim().replace(/\s+/g, ' ');
    if (!normalizedTitle) {
      return '';
    }
    if (/\bworkspace$/i.test(normalizedTitle)) {
      return normalizedTitle;
    }
    return `${normalizedTitle} workspace`;
  },
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
      kind: 'runner_output',
      actor: 'runner',
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
    mockCreateTaskMutateAsync.mockReset();
    mockCreateTaskMutateAsync.mockResolvedValue({ id: 'recovered-task-id' });
    mockCreateTaskIsPending.value = false;
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
    mockUseTaskActivityRefetch.mockReset();
    mockUseTaskActivityRefetch.mockResolvedValue({ data: mockMessages });
    mockSendMessageIsPending.value = false;
    latestTaskSseOptionsRef.current = null;
    latestConversationPanelPropsRef.current = null;
    latestTaskHeaderPropsRef.current = null;
    latestTaskTerminalPanelPropsByTabIdRef.current = {};
    latestUseTaskArgsRef.current = null;
    latestUseTaskActivityArgsRef.current = null;
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
    return renderWithAgentTaskQueryClient(
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

  describe('Task Contract', () => {
    it('reads active run start time through the Task contract instead of probing unknown payload fields', () => {
      const source = readFileSync('src/components/agent-tasks/TaskPage.tsx', 'utf8');

      expect(source).toContain('task.active_run_started_at');
      expect(source).not.toContain('as unknown as Record<string, unknown>');
      expect(source).not.toContain('"run_started_at"');
      expect(source).not.toContain('"current_run_started_at"');
    });

    it('keeps terminal session status and lifecycle status aligned to the OpenAPI boundary', () => {
      const pendingStatus: TaskTerminalSessionStatusValue = 'pending';
      const disconnectedStatus: TaskTerminalSessionStatusValue = 'disconnected';
      const startingLifecycle: TaskTerminalLifecycleStatus = 'starting';
      const typesSource = readFileSync('src/lib/types/task.ts', 'utf8');
      const statusDefinition =
        typesSource.match(/export type TaskTerminalSessionStatusValue =([\s\S]*?);/)?.[1] ??
        '';
      const lifecycleDefinition =
        typesSource.match(/export type TaskTerminalLifecycleStatus =([\s\S]*?);/)?.[1] ??
        '';

      // @ts-expect-error starting is a lifecycle_status, not a session status.
      const startingStatus: TaskTerminalSessionStatusValue = 'starting';
      // @ts-expect-error disconnected is a session/browser state, not a lifecycle_status.
      const disconnectedLifecycle: TaskTerminalLifecycleStatus = 'disconnected';

      expect(statusDefinition).not.toContain("'starting'");
      expect(lifecycleDefinition).toContain("'starting'");
      expect(lifecycleDefinition).not.toContain("'disconnected'");
      expect(pendingStatus).toBe('pending');
      expect(disconnectedStatus).toBe('disconnected');
      expect(startingLifecycle).toBe('starting');
      expect(startingStatus).toBe('starting');
      expect(disconnectedLifecycle).toBe('disconnected');
    });
  });

  describe('Run Activity Classification', () => {
    const baseTrace = {
      task_id: mockTaskId,
      message_id: 'msg-2',
      run_id: 'run-1',
      phase: 'end',
      status: 'success',
      summary: 'Trace completed',
    } satisfies Partial<TaskTraceEvent>;

    it('does not treat workspace file changes as artifact activity', () => {
      const action = deriveRunAction({
        event: {
          ...baseTrace,
          id: 'trace-files-changed',
          seq: 1,
          at: '2026-03-06T04:00:01.000Z',
          category: 'artifact',
          name: 'workspace.files_changed',
          details: {
            added: ['reports/result.md'],
            modified: ['src/agent-tasks.ts'],
            deleted: [],
          },
        } as TaskTraceEvent,
        fallbackSummary: 'Working',
      });

      expect(action).toEqual({
        kind: 'system',
        summary: '1 added · 1 modified · 0 deleted',
      });
      expect(action.kind).not.toBe('artifact');
    });

    it('uses output semantics for runner artifact events in recent run activity', () => {
      const runnerArtifactTrace: TaskTraceEvent = {
        ...baseTrace,
        id: 'trace-runner-artifact',
        seq: 2,
        at: '2026-03-06T04:00:02.000Z',
        category: 'artifact',
        name: 'runner.artifact',
        details: { filename: 'reports/result.md' },
      } as TaskTraceEvent;
      const filesChangedTrace: TaskTraceEvent = {
        ...baseTrace,
        id: 'trace-files-changed',
        seq: 1,
        at: '2026-03-06T04:00:01.000Z',
        category: 'artifact',
        name: 'workspace.files_changed',
        details: {
          added: ['reports/result.md'],
          modified: [],
          deleted: [],
        },
      } as TaskTraceEvent;

      expect(
        deriveRunAction({
          event: runnerArtifactTrace,
          fallbackSummary: 'Working',
        }),
      ).toEqual({
        kind: 'output',
        summary: 'Generated output',
      });

      const recentActions = collectRecentRunActions({
        sortedActions: [runnerArtifactTrace, filesChangedTrace],
        fallbackSummary: 'Working',
        now: Date.parse('2026-03-06T04:00:03.000Z'),
      });

      expect(recentActions).toEqual([
        expect.objectContaining({
          kind: 'output',
          summary: 'Generated output',
          traceName: 'runner.artifact',
        }),
        expect.objectContaining({
          kind: 'system',
          summary: '1 added · 0 modified · 0 deleted',
          traceName: 'workspace.files_changed',
        }),
      ]);
      expect(recentActions.map((item) => item.kind)).not.toContain('artifact');
    });

    it('keeps latest run activity free of raw command details and raw summaries', () => {
      const action = deriveRunAction({
        event: {
          ...baseTrace,
          id: 'trace-malicious-command',
          seq: 3,
          at: '2026-03-06T04:00:03.000Z',
          category: 'tool',
          name: 'codex.command',
          summary:
            'raw event TOKEN=abc secret required_permissions reason_code raw diagnostics /internal/diagnostic_entrypoint',
          details: {
            command: 'TOKEN=abc secret /internal/diagnostic_entrypoint',
            tool_name: 'diagnostic_entrypoint',
            required_permissions: ['project:agent_runner:read'],
            reason_code: 'agent_runner_unavailable',
            diagnostics: 'raw diagnostics',
          },
        } as TaskTraceEvent,
        fallbackSummary: 'Working',
      });

      expect(action).toEqual({
        kind: 'command',
        summary: 'Running command',
      });
      for (const denied of [
        'TOKEN=abc',
        'secret',
        'required_permissions',
        'reason_code',
        'raw event',
        'raw diagnostics',
        '/internal/',
        'diagnostic_entrypoint',
      ]) {
        expect(action.summary).not.toContain(denied);
      }
    });
  });

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

      const view = renderWithAgentTaskQueryClient(
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

    it('shows agent task list, files, and chat recovery actions in not found state', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = null;
      mockTaskHookState.taskLoading = false;

      renderComponent();

      expect(screen.getByTestId('agent-task__open-list')).toBeInTheDocument();
      expect(screen.getByTestId('agent-task__open-files')).toBeInTheDocument();
      expect(screen.getByTestId('agent-task__open-chat')).toBeInTheDocument();

      await user.click(screen.getByTestId('agent-task__open-files'));
      expect(mockPush).toHaveBeenCalledWith('/en-US/workspaces/workspace-1/projects/project-1/files');

      await user.click(screen.getByTestId('agent-task__open-chat'));
      expect(mockPush).toHaveBeenCalledWith('/en-US/workspaces/workspace-1/projects/project-1/chat');
    });
  });

  describe('Task Rendering', () => {
    it('preserves stronger local live terminal tab states across transient backend pending or disconnected truth, while still converging explicit backend terminal truth', () => {
      expect(mergeTerminalTabStatus('failed', 'disconnected')).toBe('disconnected');
      expect(mergeTerminalTabStatus('closed', 'disconnected')).toBe('disconnected');
      expect(mergeTerminalTabStatus('connecting', 'disconnected')).toBe('connecting');
      expect(mergeTerminalTabStatus('active', 'disconnected')).toBe('active');
      expect(mergeTerminalTabStatus('closed', 'recovering')).toBe('recovering');
      expect(mergeTerminalTabStatus('closed', 'closing')).toBe('closing');
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
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              terminal_session_id: 'backend-session-1',
              status: 'disconnected',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(
          screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1'),
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
          screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1'),
        ).toHaveTextContent('Active');
        expect(
          screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1'),
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
              terminal_session_id: 'backend-session-1',
              status: 'recovering',
              cols: 120,
              rows: 30,
              last_activity_at: '2026-04-13T01:00:00.000Z',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              terminal_session_id: 'backend-session-3',
              status: 'recovering',
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
              terminal_session_id: 'backend-session-1',
              status: 'recovering',
              cols: 120,
              rows: 30,
              last_activity_at: '2026-04-13T01:00:00.000Z',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              terminal_session_id: 'backend-session-3',
              status: 'recovering',
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
        activeRunView: null,
        artifacts: [],
        artifactsRefreshing: false,
        canUpdateTask: true,
        connectionErrorCode: null,
        connectionErrorMessage: null,
        connectionStatus: 'connected' as const,
        diagnosticsLinks: {
          audit: '/audit',
          usage: '/usage',
        },
        disabled: false,
        fetchTracesForMessage: vi.fn(),
        focusTraceMessageId: null,
        focusTraceName: null,
        focusTraceToken: 0,
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
        screen.getByTestId('agent-tasks__task-terminal-workspace-shell'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('agent-tasks__task-terminal-workspace-shell'),
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
        'agent-tasks__task-terminal-workspace-shell',
      );
      expect(screen.getByTestId('agent-tasks__task-conversation-shell')).toBeInTheDocument();
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

      const taskDetailShell = screen.getByTestId('agent-tasks__task-detail-shell');
      const workspace = screen.getByTestId('agent-tasks__task-content-workspace');
      const primaryColumn = screen.getByTestId('agent-tasks__task-primary-column');
      const secondaryColumn = screen.getByTestId('agent-tasks__task-secondary-column');
      expect(taskDetailShell.className).not.toContain('gradient');
      expect(taskDetailShell).toContainElement(screen.getByTestId('task-header'));
      expect(taskDetailShell).toContainElement(workspace);
      expect(primaryColumn).toContainElement(screen.getByTestId('agent-tasks__task-conversation-shell'));
      expect(secondaryColumn).toContainElement(screen.getByTestId('agent-tasks__task-artifacts-drawer'));
      expect(
        within(screen.getByTestId('task-header-accessory')).getByTestId(
          'agent-tasks__task-artifacts-toggle',
        ),
      ).toHaveTextContent('Hide Artifacts');
      expect(screen.getAllByTestId('agent-tasks__task-artifacts-toggle')).toHaveLength(1);
    });

    it('does not render the removed attached inputs panel', async () => {
      await renderComponentReady();

      expect(screen.queryByTestId('attached-inputs-panel')).not.toBeInTheDocument();
    });

    it('renders conversation panel', async () => {
      await renderComponentReady();

      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });

    it.each([
      {
        runState: 'cancelling',
        expectedPlaceholder:
          'Wait for the current run to stop before sending another message.',
      },
      {
        runState: 'terminating',
        expectedPlaceholder:
          'Wait for the current execution environment to finish stopping before sending another message.',
      },
      {
        runState: 'finalizing',
        expectedPlaceholder:
          'Wait for the final results to finish saving before sending another message.',
      },
    ] as const)(
      'treats authoritative %s task truth as a busy, input-blocking state',
      async ({ runState, expectedPlaceholder }) => {
        mockTaskHookState.task = { ...mockTask, run_state: runState };

        await renderComponentReady();

        expect(latestConversationPanelPropsRef.current.disabled).toBe(true);
        expect(latestConversationPanelPropsRef.current.activeRunView).toMatchObject({
          messageId: 'pending-active-run:task-1',
          runState,
          cancelPending: false,
        });
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
          expectedPlaceholder,
        );
        expect(latestTaskHeaderPropsRef.current.agentRunActivity).toBeUndefined();
        expect(screen.getByTestId('task-header-busy')).toHaveTextContent('false');
      },
    );

    it('uses a pending active run message instead of the stale latest agent message when backend run truth is active', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
        last_activity_at: '2026-03-06T04:00:10.000Z',
      };
      mockTaskHookState.messages = [
        mockMessages[0],
        {
          ...mockMessages[1],
          id: 'msg-old-agent',
          content: 'Previous run answer',
          created_at: '2026-03-06T03:59:00.000Z',
        },
      ];

      await renderComponentReady();

      expect(latestConversationPanelPropsRef.current.activeRunView).toMatchObject({
        messageId: 'pending-active-run:task-1',
        runState: 'running',
        cancelPending: false,
      });
      expect(latestConversationPanelPropsRef.current.activeRunView?.messageId).not.toBe(
        'msg-old-agent',
      );

      await user.click(screen.getByText('Cancel Active Run'));

      await waitFor(() => {
        expect(mockTaskApiCancelRun).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(mockUseTaskRefetch).toHaveBeenCalled();
        expect(mockUseTaskActivityRefetch).toHaveBeenCalled();
        expect(mockTaskApiListTraces).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          expect.objectContaining({ page_size: 500 }),
        );
      });
    });

    it('uses the active trace message_id over the stale latest agent message and starts elapsed from trace time', async () => {
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
        last_activity_at: '2026-03-06T04:00:10.000Z',
      };
      mockTaskHookState.messages = [
        mockMessages[0],
        {
          ...mockMessages[1],
          id: 'msg-old-agent',
          content: 'Previous run answer',
          created_at: '2026-03-06T03:59:00.000Z',
        },
      ];

      await renderComponentReady();

      await act(async () => {
        latestTaskSseOptionsRef.current?.onTraceEvent?.({
          id: 'trace_current_run_start',
          task_id: mockTaskId,
          message_id: 'msg-current-run',
          run_id: 'run-current',
          seq: 1,
          at: '2026-03-06T04:00:00.000Z',
          category: 'lifecycle',
          phase: 'start',
          status: 'running',
          name: 'run.lifecycle',
          summary: 'Run started',
        } satisfies TaskTraceEvent);
      });

      await waitFor(() => {
        expect(latestConversationPanelPropsRef.current.activeRunView).toMatchObject({
          messageId: 'msg-current-run',
          runState: 'running',
          startedAt: '2026-03-06T04:00:00.000Z',
        });
      });
      expect(latestConversationPanelPropsRef.current.activeRunView?.messageId).not.toBe(
        'msg-old-agent',
      );
      expect(latestConversationPanelPropsRef.current.activeRunView?.startedAt).not.toBe(
        '2026-03-06T04:00:10.000Z',
      );
    });

    it('uses the server-created active run message timestamp for elapsed recovery on refresh', async () => {
      const dateNowSpy = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse('2026-03-06T04:00:10.000Z'));
      try {
        mockTaskHookState.task = {
          ...mockTask,
          run_state: 'running',
          last_activity_at: '2026-03-06T04:00:10.000Z',
        };
        mockTaskHookState.messages = [
          {
            ...mockMessages[0],
            id: 'msg-old-user',
            content: 'Previous request',
            created_at: '2026-03-06T03:58:50.000Z',
          },
          {
            ...mockMessages[1],
            id: 'msg-old-agent',
            content: 'Previous run answer',
            created_at: '2026-03-06T03:59:00.000Z',
          },
          {
            ...mockMessages[0],
            id: 'msg-current-user',
            content: 'Current request',
            created_at: '2026-03-06T03:59:58.000Z',
          },
          {
            ...mockMessages[1],
            id: 'msg-current-run',
            content: '',
            created_at: '2026-03-06T04:00:00.000Z',
          },
        ];

        await renderComponentReady();

        expect(latestConversationPanelPropsRef.current.activeRunView).toMatchObject({
          messageId: 'msg-current-run',
          runState: 'running',
          startedAt: '2026-03-06T04:00:00.000Z',
          elapsedSeconds: 10,
        });
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('uses the formal task active run start timestamp without resetting elapsed to the message timestamp', async () => {
      const dateNowSpy = vi
        .spyOn(Date, 'now')
        .mockReturnValue(Date.parse('2026-03-06T04:00:10.000Z'));
      try {
        const activeTask: Task = {
          ...mockTask,
          run_state: 'running',
          active_run_started_at: '2026-03-06T04:00:00.000Z',
          last_activity_at: '2026-03-06T04:00:10.000Z',
        };
        mockTaskHookState.task = activeTask;
        mockTaskHookState.messages = [
          {
            ...mockMessages[0],
            id: 'msg-current-user',
            content: 'Current request',
            created_at: '2026-03-06T04:00:01.000Z',
          },
          {
            ...mockMessages[1],
            id: 'msg-current-run',
            content: '',
            created_at: '2026-03-06T04:00:05.000Z',
          },
        ];

        await renderComponentReady();

        expect(latestConversationPanelPropsRef.current.activeRunView).toMatchObject({
          messageId: 'msg-current-run',
          runState: 'running',
          startedAt: '2026-03-06T04:00:00.000Z',
          elapsedSeconds: 10,
        });
        expect(latestConversationPanelPropsRef.current.activeRunView?.startedAt).not.toBe(
          '2026-03-06T04:00:05.000Z',
        );
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('focuses the active run message when a latest action is clicked', async () => {
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
        last_activity_at: '2026-03-06T04:00:10.000Z',
      };
      mockTaskHookState.messages = [
        {
          ...mockMessages[0],
          id: 'msg-current-user',
          content: 'Current request',
          created_at: '2026-03-06T03:59:58.000Z',
        },
        {
          ...mockMessages[1],
          id: 'msg-current-run',
          content: '',
          created_at: '2026-03-06T04:00:00.000Z',
        },
      ];

      await renderComponentReady();

      expect(latestConversationPanelPropsRef.current.activeRunView?.messageId).toBe(
        'msg-current-run',
      );
      const initialFocusToken =
        latestConversationPanelPropsRef.current.focusTraceToken;

      await act(async () => {
        latestConversationPanelPropsRef.current.onRunActionClick({
          id: 'trace-current-tool',
          kind: 'tool',
          summary: 'Read files',
          ageSeconds: 0,
          traceName: 'codex.tool',
        });
      });

      await waitFor(() => {
        expect(latestConversationPanelPropsRef.current.focusTraceMessageId).toBe(
          'msg-current-run',
        );
        expect(latestConversationPanelPropsRef.current.focusTraceName).toBe(
          'codex.tool',
        );
        expect(latestConversationPanelPropsRef.current.focusTraceToken).toBeGreaterThan(
          initialFocusToken,
        );
      });
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
      expect(screen.queryByTestId('agent-tasks__task-terminal-workspace')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__task-terminal-status-strip')).not.toBeInTheDocument();
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
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
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
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
        expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
        expect(latestTaskTerminalPanelPropsRef.current.tabId).toBe('terminal-session-2');
        expect(latestTaskTerminalPanelPropsRef.current.focusRequestToken).toBeGreaterThan(0);
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
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
            status: 'active',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        const hiddenWorkspaceShell = screen.getByTestId(
          'agent-tasks__task-terminal-workspace-shell',
        );
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
        expect(
          screen.getByTestId('agent-tasks__task-terminal-status-strip'),
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
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              terminal_session_id: 'backend-session-2',
              status: 'active',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
        })
        .mockResolvedValue({
          total: 2,
          items: [
            {
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              terminal_session_id: 'backend-session-2',
              status: 'active',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
      });
      const initialSecondTabFocusToken =
        latestTaskTerminalPanelPropsByTabIdRef.current['terminal-session-2']
          ?.focusRequestToken ?? 0;

      const secondTerminalTabButton = screen
        .getByTestId('agent-tasks__task-terminal-tab-terminal-session-2')
        .querySelector('button');
      expect(secondTerminalTabButton).toBeTruthy();

      await act(async () => {
        (secondTerminalTabButton as HTMLButtonElement).click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
        expect(latestTaskTerminalPanelPropsRef.current.tabId).toBe('terminal-session-2');
        expect(
          latestTaskTerminalPanelPropsByTabIdRef.current['terminal-session-2']
            .focusRequestToken,
        ).toBeGreaterThan(initialSecondTabFocusToken);
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-2');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
      });
    });

    it('syncs the active terminal tab ref immediately when the user clicks another tab before the next poll finishes, even if boot storage still prefers the previous session', async () => {
      let pollTerminalWorkspace: (() => void) | null = null;
      const setIntervalSpy = vi
        .spyOn(window, 'setInterval')
        .mockImplementation(((callback: TimerHandler, timeout?: number) => {
          if (timeout === 1000 && typeof callback === 'function') {
            pollTerminalWorkspace = callback as () => void;
          }
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
                terminal_session_id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
              {
                terminal_session_id: 'backend-session-2',
                status: 'active',
                created_at: '2026-04-13T01:00:01.000Z',
              },
            ],
          })
          .mockResolvedValue({
            total: 2,
            items: [
              {
                terminal_session_id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
              {
                terminal_session_id: 'backend-session-2',
                status: 'active',
                created_at: '2026-04-13T01:00:01.000Z',
              },
            ],
          });

        renderComponent();

        await waitFor(() => {
          expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
            'data-active-terminal-tab-id',
            'terminal-session-1',
          );
          expect(pollTerminalWorkspace).toBeTypeOf('function');
        });

        const secondTerminalTabButton = screen
          .getByTestId('agent-tasks__task-terminal-tab-terminal-session-2')
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
          expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValue({
          total: 1,
          items: [
            {
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent('Show Artifacts');
      });

      await user.click(screen.getByTestId('agent-tasks__task-artifacts-toggle'));

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-1');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
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
              terminal_session_id: 'backend-session-1',
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
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent('Show Artifacts');
      });

      await user.click(screen.getByTestId('agent-tasks__task-artifacts-toggle'));

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-1');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(screen.queryByTestId('agent-tasks__task-terminal-status-strip')).not.toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
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
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toBeInTheDocument();
      });

      await act(async () => {
        await user.click(
          within(screen.getByTestId('agent-tasks__task-terminal-status-strip')).getByRole('button', {
            name: 'Open Terminal Workspace',
          }),
        );
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.queryByTestId('agent-tasks__task-artifacts-drawer')).not.toBeInTheDocument();
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
              terminal_session_id: 'backend-session-1',
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
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('terminal');
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.queryByTestId('agent-tasks__task-artifacts-drawer')).not.toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved?.('backend-session-1');
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent('Hide Artifacts');
      });
    });

    it('treats a reloaded browser-disconnected terminal session as disconnected rather than runtime recovering', async () => {
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
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
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
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-2')).toHaveTextContent('Disconnected');
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-2')).not.toHaveTextContent('Recovering');
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-2')).not.toHaveTextContent('Connecting');
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-2')).not.toHaveTextContent('Preparing');
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });
    });

    it('hydrates recovering and closing terminal sessions as distinct tab states', async () => {
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-recovering',
          artifactsDrawerOpen: false,
        }),
      );
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 3,
        items: [
          {
            terminal_session_id: 'backend-session-disconnected',
            status: 'disconnected',
            created_at: '2026-05-08T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-recovering',
            status: 'recovering',
            lifecycle_status: 'recovering',
            input_enabled: false,
            created_at: '2026-05-08T01:00:01.000Z',
          },
          {
            terminal_session_id: 'backend-session-closing',
            status: 'closing',
            lifecycle_status: 'closing',
            input_enabled: false,
            created_at: '2026-05-08T01:00:02.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toHaveTextContent('Disconnected');
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-2')).toHaveTextContent('Recovering');
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-3')).toHaveTextContent('Closing');
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
        expect(latestTaskHeaderPropsRef.current.terminalRecoveryCount).toBe(1);
      });
    });

    it('does not treat failed backend terminal sessions as task occupancy or recovery blockers', async () => {
      mockTaskHookState.messages = [];
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 1,
        items: [
          {
            terminal_session_id: 'backend-session-failed',
            status: 'failed',
            lifecycle_status: 'failed',
            created_at: '2026-05-08T01:00:00.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalTruthState).toBe('ready');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(latestTaskHeaderPropsRef.current.terminalRecoveryCount).toBe(0);
        expect(latestTaskHeaderPropsRef.current.terminalHasRecovery).toBe(false);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBeNull();
        expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(true);
        expect(latestConversationPanelPropsRef.current.disabled).toBe(false);
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBeUndefined();
      });
      expect(screen.queryByTestId('agent-tasks__task-terminal-status-strip')).not.toBeInTheDocument();
      expect(screen.queryByTestId('conversation-blocked-state')).not.toBeInTheDocument();
    });

    it('keeps terminal bootstrap blocked until backend terminal truth returns on reload', async () => {
      const deferredSessions = createDeferred<{
        total: number;
        items: Array<{ terminal_session_id: string; status: string; created_at: string }>;
      }>();
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
        expect(screen.getByTestId('agent-tasks__task-terminal-truth-unavailable')).toBeInTheDocument();
      });

      expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
        'Terminal session status is temporarily unavailable',
      );
      expect(
        screen.getByTestId('conversation-blocked-description'),
      ).toHaveTextContent(
        'We could not confirm live terminal sessions for this task. Retry to refresh backend terminal truth before running or deleting.',
      );
      const retryButton = screen.getByTestId('agent-tasks__conversation-blocked-action');
      expect(retryButton).toHaveTextContent('Retry terminal status check');
      expect(
        screen.queryByTestId('agent-tasks__task-terminal-truth-unavailable-retry'),
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
              terminal_session_id: 'backend-session-1',
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
        expect(screen.queryByTestId('agent-tasks__task-terminal-status-strip')).not.toBeInTheDocument();
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

      expect(screen.queryByTestId('agent-tasks__task-artifacts-toggle')).not.toBeInTheDocument();
      expect(screen.queryByTestId('agent-tasks__task-artifacts-drawer')).not.toBeInTheDocument();

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
        expect(screen.getByTestId('agent-tasks__task-artifacts-toggle')).toHaveTextContent(
          'Hide Artifacts',
        );
        expect(screen.getByTestId('agent-tasks__task-artifacts-drawer')).toBeInTheDocument();
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
        expect(screen.getByTestId('agent-tasks__task-terminal-shell')).toBeInTheDocument();
        expect(screen.getByText('Terminal Workspace')).toBeInTheDocument();
        expect(
          screen.getByText(
            'Changes you make here affect files in this task workspace. Temporary shell variables stay only in this terminal session.',
          ),
        ).toBeInTheDocument();
        expect(screen.getAllByTestId('agent-tasks__task-terminal-workspace')).toHaveLength(1);
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskTerminalPanelPropsRef.current.focusRequestToken).toBeGreaterThan(0);
        expect(latestTaskHeaderPropsRef.current.onCreateTerminalSession).toBeUndefined();
        expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
        expect(screen.queryByTestId('agent-tasks__task-terminal-status-strip')).not.toBeInTheDocument();
        expect(screen.queryByTestId('agent-tasks__task-artifacts-toggle')).not.toBeInTheDocument();
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.queryByTestId('conversation-blocked-state')).not.toBeInTheDocument();
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
          'End terminal sessions before starting a new agent run.',
        );
      });
    });

    it('uses the next terminal poll after a stale empty preserve to converge to conversation when backend remains empty', async () => {
      let pollTerminalWorkspace: (() => void) | null = null;
      const setIntervalSpy = vi
        .spyOn(window, 'setInterval')
        .mockImplementation(((callback: TimerHandler, timeout?: number) => {
          if (timeout === 1000 && typeof callback === 'function') {
            pollTerminalWorkspace = callback as () => void;
          }
          return 1 as unknown as number;
        }) as typeof window.setInterval);
      const clearIntervalSpy = vi
        .spyOn(window, 'clearInterval')
        .mockImplementation((() => {}) as typeof window.clearInterval);

      try {
        mockTaskApiListTerminalSessions
          .mockResolvedValueOnce({ total: 0, items: [] })
          .mockResolvedValueOnce({ total: 0, items: [] })
          .mockResolvedValueOnce({ total: 0, items: [] });

        await renderComponentAndWaitForTerminalHydration();

        await act(async () => {
          latestTaskHeaderPropsRef.current.onCreateTerminalSession();
        });

        await waitFor(() => {
          expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
          expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
          expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
        });

        await act(async () => {
          latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
          await Promise.resolve();
        });

        await waitFor(() => {
          expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
          expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
          expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
          expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
        });
        expect(mockClearTaskTerminalPanelSessionStateForScope).not.toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          'terminal-session-1',
        );

        await waitFor(() => {
          expect(pollTerminalWorkspace).toBeTypeOf('function');
        });

        await act(async () => {
          pollTerminalWorkspace?.();
          await Promise.resolve();
        });

        await waitFor(() => {
          expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(3);
          expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
          expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
          expect(screen.queryByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).not.toBeInTheDocument();
          expect(screen.queryByTestId('agent-tasks__task-terminal-shell')).not.toBeInTheDocument();
          expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
        });
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });

    it('uses the next terminal poll after a stale empty preserve to reconcile when backend lists the resolved session', async () => {
      let pollTerminalWorkspace: (() => void) | null = null;
      const setIntervalSpy = vi
        .spyOn(window, 'setInterval')
        .mockImplementation(((callback: TimerHandler, timeout?: number) => {
          if (timeout === 1000 && typeof callback === 'function') {
            pollTerminalWorkspace = callback as () => void;
          }
          return 1 as unknown as number;
        }) as typeof window.setInterval);
      const clearIntervalSpy = vi
        .spyOn(window, 'clearInterval')
        .mockImplementation((() => {}) as typeof window.clearInterval);

      try {
        mockTaskApiListTerminalSessions
          .mockResolvedValueOnce({ total: 0, items: [] })
          .mockResolvedValueOnce({ total: 0, items: [] })
          .mockResolvedValueOnce({
            total: 1,
            items: [
              {
                terminal_session_id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
            ],
          });

        await renderComponentAndWaitForTerminalHydration();

        await act(async () => {
          latestTaskHeaderPropsRef.current.onCreateTerminalSession();
        });

        await waitFor(() => {
          expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
          expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
          expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
        });

        await act(async () => {
          latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
          await Promise.resolve();
        });

        await waitFor(() => {
          expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
          expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
          expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
          expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
        });

        await waitFor(() => {
          expect(pollTerminalWorkspace).toBeTypeOf('function');
        });

        await act(async () => {
          pollTerminalWorkspace?.();
          await Promise.resolve();
        });

        await waitFor(() => {
          expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(3);
          expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
          expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
          expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
          expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toHaveTextContent(
            'Active',
          );
        });
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });

    it('does not preserve a resolved terminal tab after the user closes it before the stale empty sync returns', async () => {
      const user = userEvent.setup();
      const resolvedSessionSync = createDeferred<{ total: number; items: [] }>();
      const closeSession = createDeferred<void>();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockReturnValueOnce(resolvedSessionSync.promise as any);
      mockTaskApiCloseTerminalSession.mockReturnValueOnce(closeSession.promise);

      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
      });
      await waitFor(() => {
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
      });

      await user.click(screen.getByTestId('agent-tasks__task-terminal-close-terminal-session-1'));
      expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledWith(
        mockWorkspaceId,
        mockProjectId,
        mockTaskId,
        'backend-session-1',
      );

      await act(async () => {
        resolvedSessionSync.resolve({ total: 0, items: [] });
        await resolvedSessionSync.promise;
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(screen.queryByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
      });

      await act(async () => {
        closeSession.resolve();
        await closeSession.promise;
      });
    });

    it('does not count a local closed terminal tab as occupying a session slot', async () => {
      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onStatusChange('closed');
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
        expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(true);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBeNull();
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBeUndefined();
        expect(screen.queryByTestId('agent-tasks__task-terminal-shell')).not.toBeInTheDocument();
      });
    });

    it('does not bring back a locally closed terminal tab when creating another terminal', async () => {
      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
      });

      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onStatusChange('closed');
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(0);
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(screen.getAllByTestId(/^agent-tasks__task-terminal-tab-terminal-session-\d+$/)).toHaveLength(1);
        expect(screen.getByTestId(/^agent-tasks__task-terminal-tab-terminal-session-\d+$/)).not.toHaveTextContent(
          'Closed',
        );
        expect(
          screen
            .getByTestId('agent-tasks__task-terminal-workspace')
            .getAttribute('data-active-terminal-tab-id'),
        ).toMatch(/^terminal-session-\d+$/);
      });
    });

    it('keeps terminal mode when preserve-current sync returns immediately after opening a hidden terminal workspace', async () => {
      let pollTerminalWorkspace: (() => void) | null = null;
      const setIntervalSpy = vi
        .spyOn(window, 'setInterval')
        .mockImplementation(((callback: TimerHandler, timeout?: number) => {
          if (timeout === 1000 && typeof callback === 'function') {
            pollTerminalWorkspace = callback as () => void;
          }
          return 1 as unknown as number;
        }) as typeof window.setInterval);
      const clearIntervalSpy = vi
        .spyOn(window, 'clearInterval')
        .mockImplementation((() => {}) as typeof window.clearInterval);

      try {
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
                terminal_session_id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
            ],
          })
          .mockResolvedValue({
            total: 1,
            items: [
              {
                terminal_session_id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
            ],
          });

        renderComponent();

        await waitFor(() => {
          expect(screen.getByTestId('agent-tasks__task-terminal-status-action')).toBeInTheDocument();
          expect(latestTaskHeaderPropsRef.current.viewMode).toBe('conversation');
          expect(pollTerminalWorkspace).toBeTypeOf('function');
        });

        await act(async () => {
          latestTaskHeaderPropsRef.current.onSetViewMode('terminal');
          pollTerminalWorkspace?.();
          await Promise.resolve();
        });

        await waitFor(() => {
          expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        });
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(screen.getByTestId('task-terminal-panel-active')).toBeInTheDocument();
        expect(latestTaskTerminalPanelPropsRef.current.visible).toBe(true);
        expect(screen.queryByTestId('conversation-panel')).not.toBeInTheDocument();
      } finally {
        setIntervalSpy.mockRestore();
        clearIntervalSpy.mockRestore();
      }
    });

    it('creates up to three terminal tabs and blocks a fourth creation', async () => {
      const user = userEvent.setup();
      await renderComponentAndWaitForTerminalHydration();
      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-create')).toBeInTheDocument();
      });
      await user.click(screen.getByTestId('agent-tasks__task-terminal-create'));
      await user.click(screen.getByTestId('agent-tasks__task-terminal-create'));

      expect(screen.getAllByTestId(/^agent-tasks__task-terminal-tab-terminal-session-\d+$/)).toHaveLength(3);
      expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
      expect(screen.getByTestId('agent-tasks__task-terminal-create')).toBeDisabled();
      expect(screen.getByTestId('agent-tasks__task-terminal-create')).toHaveAttribute(
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
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { terminal_session_id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 3,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { terminal_session_id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
            { terminal_session_id: 'backend-session-3', status: 'active', created_at: '2026-04-13T01:00:02.000Z' },
          ],
        });

      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-1');
      });
      await user.click(screen.getByTestId('agent-tasks__task-terminal-create'));
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-2');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });

      await user.click(screen.getByTestId('agent-tasks__task-terminal-create'));
      expect(screen.getAllByTestId(/^agent-tasks__task-terminal-tab-terminal-session-\d+$/)).toHaveLength(3);

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
        expect(screen.getAllByTestId(/^agent-tasks__task-terminal-tab-terminal-session-\d+$/)).toHaveLength(3);
        expect(screen.queryByTestId('agent-tasks__task-terminal-tab-terminal-session-3')).not.toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.canCreateTerminalSession).toBe(false);
      });
    });

    it('ignores stale terminal sync snapshots that resolve after newer backend truth', async () => {
      const user = userEvent.setup();
      const firstSync = createDeferred<{
        total: number;
        items: Array<{ terminal_session_id: string; status: 'active'; created_at: string }>;
      }>();
      const secondSync = createDeferred<{
        total: number;
        items: Array<{ terminal_session_id: string; status: 'active'; created_at: string }>;
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
      await user.click(screen.getByTestId('agent-tasks__task-terminal-create'));
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
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              terminal_session_id: 'backend-session-2',
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
          screen.getAllByTestId(/^agent-tasks__task-terminal-tab-terminal-session-\d+$/),
        ).toHaveLength(2);
      });

      await act(async () => {
        firstSync.resolve({
          total: 1,
          items: [
            {
              terminal_session_id: 'backend-session-1',
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
          screen.getAllByTestId(/^agent-tasks__task-terminal-tab-terminal-session-\d+$/),
        ).toHaveLength(2);
        expect(
          screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-2'),
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
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-status-end-all')).toHaveTextContent('End All Sessions');
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).not.toHaveTextContent(
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
      const hiddenTerminalFocusToken =
        latestTaskTerminalPanelPropsRef.current.focusRequestToken ?? 0;
      expect(screen.getByTestId('agent-tasks__conversation-blocked-action')).toHaveTextContent(
        'Open Terminal Workspace',
      );
      await user.click(screen.getByTestId('agent-tasks__conversation-blocked-action'));
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
      });
      expect(latestTaskTerminalPanelPropsRef.current.open).toBe(true);
      expect(latestTaskTerminalPanelPropsRef.current.visible).toBe(true);
      expect(latestTaskTerminalPanelPropsRef.current.focusRequestToken).toBeGreaterThan(
        hiddenTerminalFocusToken,
      );
    });

    it('reconciles local terminal tabs with backend truth when ending all sessions from the conversation strip', async () => {
      const user = userEvent.setup();
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({ total: 0, items: [] })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
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
        expect(screen.queryByTestId('agent-tasks__task-terminal-status-strip')).not.toBeInTheDocument();
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
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { terminal_session_id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { terminal_session_id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
        })
        .mockResolvedValueOnce({ total: 1, items: [{ terminal_session_id: 'backend-session-2' }] });

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
      await user.click(screen.getByTestId('agent-tasks__task-terminal-create'));
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
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toHaveTextContent(
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
          /^agent-tasks__task-terminal-tab-terminal-session-\d+$/,
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
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
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

    it('switches the blocker action to recovery guidance when a hidden terminal session is recovering', async () => {
      mockTaskHookState.messages = [];
      await renderComponentAndWaitForTerminalHydration();

      await act(async () => {
        latestTaskHeaderPropsRef.current.onCreateTerminalSession();
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.viewMode).toBe('terminal');
      });
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onStatusChange('recovering');
      });
      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session on this task needs recovery',
        );
        expect(
          screen.getByTestId('agent-tasks__task-terminal-status-strip').querySelector('button'),
        ).toHaveTextContent('End All Sessions');
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).not.toHaveTextContent(
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

    it('uses mixed occupancy copy when recovering and active sessions coexist in the hidden blocker', async () => {
      mockTaskHookState.messages = [];
      mockTaskApiListTerminalSessions.mockResolvedValueOnce({
        total: 2,
        items: [
          {
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
            status: 'recovering',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalHasRecovery).toBe(true);
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).not.toHaveTextContent(
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
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
            {
              terminal_session_id: 'backend-session-2',
              status: 'recovering',
              created_at: '2026-04-13T01:00:01.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              terminal_session_id: 'backend-session-1',
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
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-2',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-shell-summary')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
      });

      await user.click(screen.getByTestId('agent-tasks__task-terminal-close-terminal-session-2'));

      await waitFor(() => {
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          'backend-session-2',
        );
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('agent-tasks__task-terminal-shell-summary')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-shell-summary')).not.toHaveTextContent(
          'needs recovery',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      }, { timeout: 250 });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-status-strip')).not.toHaveTextContent(
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

    it('keeps a terminal tab visible and blocking when DELETE succeeds but backend still lists the session', async () => {
      const user = userEvent.setup();
      mockTaskHookState.messages = [];
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      const listedSession = {
        terminal_session_id: 'backend-session-1',
        status: 'active' as const,
        created_at: '2026-04-13T01:00:00.000Z',
      };
      mockTaskApiListTerminalSessions
        .mockResolvedValue({
          total: 1,
          items: [listedSession],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [listedSession],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [listedSession],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      });

      await user.click(screen.getByTestId('agent-tasks__task-terminal-close-terminal-session-1'));

      await waitFor(() => {
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          'backend-session-1',
        );
        expect(mockTaskApiListTerminalSessions).toHaveBeenNthCalledWith(
          2,
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
          'End all terminal sessions before deleting this task.',
        );
      });

      await act(async () => {
        latestTaskHeaderPropsRef.current.onSetViewMode('conversation');
      });

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '1 terminal session is using this task',
        );
        expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
          'End terminal sessions before starting a new agent run.',
        );
      });
    });

    it('keeps the terminal tab recoverable when DELETE succeeds but backend truth hydration fails', async () => {
      const user = userEvent.setup();
      mockTaskHookState.messages = [];
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      let listTerminalSessionsCallCount = 0;
      mockTaskApiListTerminalSessions.mockImplementation(() => {
        listTerminalSessionsCallCount += 1;
        if (listTerminalSessionsCallCount === 1) {
          return Promise.resolve({
            total: 1,
            items: [
              {
                terminal_session_id: 'backend-session-1',
                status: 'active',
                created_at: '2026-04-13T01:00:00.000Z',
              },
            ],
          });
        }
        return Promise.reject(new Error('terminal truth unavailable after close'));
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      });

      await user.click(screen.getByTestId('agent-tasks__task-terminal-close-terminal-session-1'));

      await waitFor(() => {
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          'backend-session-1',
        );
        expect(mockTaskApiCloseTerminalSession).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.terminalTruthState).toBe('unavailable');
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
          'Terminal session status is temporarily unavailable. Retry before deleting this task.',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-truth-unavailable')).toHaveTextContent(
          'Terminal session status is temporarily unavailable',
        );
      });
      expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          logContext: 'TaskPage.closeTerminalTab.hydrate',
        }),
      );
    });

    it('keeps a terminal tab visible when panel-internal close succeeds but backend list still returns the session', async () => {
      mockTaskHookState.messages = [];
      window.sessionStorage.setItem(
        `agentsmith-terminal-workspace:${mockWorkspaceId}:${mockProjectId}:${mockTaskId}`,
        JSON.stringify({
          preferredViewMode: 'terminal',
          preferredActiveSessionId: 'backend-session-1',
          artifactsDrawerOpen: true,
        }),
      );
      const listedSession = {
        terminal_session_id: 'backend-session-1',
        status: 'active' as const,
        created_at: '2026-04-13T01:00:00.000Z',
      };
      mockTaskApiListTerminalSessions
        .mockResolvedValueOnce({
          total: 1,
          items: [listedSession],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [listedSession],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskTerminalPanelPropsRef.current.sessionStorageScope).toBe(
          'terminal-session-1',
        );
      });

      let reconcileResult: unknown = null;
      await act(async () => {
        reconcileResult = await latestTaskTerminalPanelPropsRef.current.onSessionCloseReconcile(
          'backend-session-1',
        );
      });

      await waitFor(() => {
        expect(reconcileResult).toEqual({
          status: 'retained',
          retainedStatus: 'active',
        });
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
          'End all terminal sessions before deleting this task.',
        );
      });
    });

    it('returns retained close reconciliation with the concrete backend closing status', async () => {
      mockTaskHookState.messages = [];
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
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockResolvedValueOnce({
          total: 1,
          items: [
            {
              terminal_session_id: 'backend-session-1',
              status: 'closing',
              lifecycle_status: 'closing',
              close_state: 'requested',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskTerminalPanelPropsRef.current.sessionStorageScope).toBe(
          'terminal-session-1',
        );
      });

      let reconcileResult: unknown = null;
      await act(async () => {
        reconcileResult = await latestTaskTerminalPanelPropsRef.current.onSessionCloseReconcile(
          'backend-session-1',
        );
      });

      await waitFor(() => {
        expect(reconcileResult).toEqual({
          status: 'retained',
          retainedStatus: 'closing',
        });
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toHaveTextContent(
          'Closing',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).not.toHaveTextContent(
          'Recovering',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.terminalRecoveryCount).toBe(0);
      });
    });

    it('keeps a terminal tab and marks terminal truth unavailable when panel-internal close succeeds but relist fails', async () => {
      mockTaskHookState.messages = [];
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
              terminal_session_id: 'backend-session-1',
              status: 'active',
              created_at: '2026-04-13T01:00:00.000Z',
            },
          ],
        })
        .mockRejectedValueOnce(new Error('terminal truth unavailable after panel close'));

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
          'data-active-terminal-tab-id',
          'terminal-session-1',
        );
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
      });

      let reconcileResult: unknown = null;
      await act(async () => {
        reconcileResult = await latestTaskTerminalPanelPropsRef.current.onSessionCloseReconcile(
          'backend-session-1',
        );
      });

      await waitFor(() => {
        expect(reconcileResult).toEqual({ status: 'unavailable' });
        expect(mockTaskApiListTerminalSessions).toHaveBeenCalledTimes(2);
        expect(screen.getByTestId('agent-tasks__task-terminal-tab-terminal-session-1')).toBeInTheDocument();
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(1);
        expect(latestTaskHeaderPropsRef.current.terminalTruthState).toBe('unavailable');
        expect(latestTaskHeaderPropsRef.current.deleteBlockedReason).toBe(
          'Terminal session status is temporarily unavailable. Retry before deleting this task.',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-truth-unavailable')).toHaveTextContent(
          'Terminal session status is temporarily unavailable',
        );
      });
      expect(mockHandleError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          logContext: 'TaskPage.panelInternalTerminalClose.hydrate',
        }),
      );
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
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
            status: 'recovering',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
            terminal_session_id: 'backend-session-1',
            status: 'active',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
            status: 'recovering',
            created_at: '2026-04-13T01:00:01.000Z',
          },
        ],
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('conversation-blocked-title')).toHaveTextContent(
          '2 terminal sessions are using this task, 1 needs recovery',
        );
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
            terminal_session_id: 'backend-session-1',
            status: 'recovering',
            created_at: '2026-04-13T01:00:00.000Z',
          },
          {
            terminal_session_id: 'backend-session-2',
            status: 'recovering',
            created_at: '2026-04-13T01:00:01.000Z',
          },
          {
            terminal_session_id: 'backend-session-3',
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
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
        expect(screen.getByTestId('agent-tasks__task-terminal-workspace')).toHaveAttribute(
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
        expect(screen.getByTestId('agent-tasks__task-terminal-truth-unavailable')).not.toHaveTextContent(
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
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { terminal_session_id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
          ],
        })
        .mockResolvedValueOnce({
          total: 2,
          items: [
            { terminal_session_id: 'backend-session-1', status: 'active', created_at: '2026-04-13T01:00:00.000Z' },
            { terminal_session_id: 'backend-session-2', status: 'active', created_at: '2026-04-13T01:00:01.000Z' },
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
      await user.click(screen.getByTestId('agent-tasks__task-terminal-create'));
      await act(async () => {
        latestTaskTerminalPanelPropsRef.current.onSessionResolved('backend-session-2');
      });
      await waitFor(() => {
        expect(latestTaskHeaderPropsRef.current.terminalSessionCount).toBe(2);
      });
      await user.click(screen.getByTestId('agent-tasks__task-terminal-end-all'));
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
        items: Array<{ terminal_session_id: string; status: string; created_at: string }>;
      }>();
      mockTaskApiListTerminalSessions.mockReset();
      mockTaskApiListTerminalSessions.mockReturnValueOnce(deferredSessions.promise as any);

      renderWithAgentTaskQueryClient(
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
            terminal_session_id: 'backend-session-1',
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

    it('forces the SSE debug panel off in production even when the runtime flag is enabled', async () => {
      const previousRuntimeConfig = window.__MBOS_PUBLIC_RUNTIME_CONFIG__;
      vi.stubEnv('NODE_ENV', 'production');
      window.__MBOS_PUBLIC_RUNTIME_CONFIG__ = {
        apiBase: '',
        keycloakUrl: '',
        keycloakRealm: '',
        keycloakClientId: '',
        desktopDownloadUrlMacos: '',
        desktopDownloadUrlWindows: '',
        desktopDownloadUrlLinux: '',
        useMsw: false,
        mswStrictReady: false,
        sseTicketEnabled: false,
        sseTicketPercentage: 0,
        sseAllowJwtFallback: false,
        trustedImageDomains: [],
        bypassAuth: false,
        agentTaskSseDebugPanel: true,
        docFixtures: false,
      };

      try {
        await renderComponentReady();

        await act(async () => {
          latestTaskSseOptionsRef.current?.onDebug?.({
            at: '2026-05-05T10:00:00.000Z',
            phase: 'error',
            summary: 'raw EventSource error detail',
          });
        });

        expect(screen.queryByTestId('agent-tasks__sse-debug-panel')).not.toBeInTheDocument();
      } finally {
        vi.unstubAllEnvs();
        if (previousRuntimeConfig) {
          window.__MBOS_PUBLIC_RUNTIME_CONFIG__ = previousRuntimeConfig;
        } else {
          delete window.__MBOS_PUBLIC_RUNTIME_CONFIG__;
        }
      }
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
      mockUseTaskActivityRefetch.mockImplementation(async () => {
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
        expect(mockUseTaskActivityRefetch).toHaveBeenCalled();
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
              kind: 'runner_output',
              actor: 'runner',
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
            kind: 'user_intent',
            actor: 'user',
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
            intent: 'Test message',
          },
        });
        expect(latestConversationPanelPropsRef.current.messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'user_intent',
              actor: 'user',
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

    it('does not expose run-scoped execution settings or sendBlockReason on the conversation surface', async () => {
      await renderComponentReady();

      expect(latestConversationPanelPropsRef.current.executionSettings).toBeUndefined();
      expect(latestConversationPanelPropsRef.current.sendBlockReason).toBeUndefined();
    });

    it('sends task runs without the legacy selection field', async () => {
      await renderComponentReady();

      await act(async () => {
        await latestConversationPanelPropsRef.current.onSendMessage('Use task bound runner');
      });

      expect(mockSendMessageMutateAsync).toHaveBeenCalledWith({
        workspaceId: mockWorkspaceId,
        projectId: mockProjectId,
        taskId: mockTaskId,
        data: {
          intent: 'Use task bound runner',
        },
      });
    });

    it('queues follow-up sends while a task run is already active instead of blocking on runner switching', async () => {
      mockTaskHookState.task = { ...mockTask, run_state: 'running' };

      await renderComponentReady();

      await act(async () => {
        await latestConversationPanelPropsRef.current.onSendMessage('Queue behind current run');
      });

      expect(mockSendMessageMutateAsync).not.toHaveBeenCalled();
      expect(latestConversationPanelPropsRef.current.pendingQueue).toHaveLength(1);
      expect(mockToastInfo).toHaveBeenCalledWith(
        'Queued for sending. It will be sent after the current run finishes.',
      );
    });

    it('shows Developer-runner recovery affordances when the bound runner is unavailable and task creation is allowed', async () => {
      mockTaskHookState.task = {
        ...mockTask,
        bound_runner_id: 'runner-dev',
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
        agent_presence: 'offline',
      };
      mockTaskHookState.messages = [];

      await renderComponentReady();

      expect(latestTaskHeaderPropsRef.current.boundRunnerRecoveryActionLabel).toBe(
        'Create new task with managed execution',
      );
      expect(latestConversationPanelPropsRef.current.blockedState).toMatchObject({
        title: 'This task is bound to a Developer runner that is not available right now',
        description:
          'This task keeps using its original Developer runner. Create a new task with managed execution to keep working.',
      });
    });

    it('creates a new managed-bound task from reusable inputs and prompt only from the Developer-runner recovery action', async () => {
      mockTaskHookState.task = {
        ...mockTask,
        title: 'Recover me',
        prompt: 'Reuse this original task instruction only.',
        attached_inputs: [
          {
            id: 'input-library',
            kind: 'library_object',
            library_id: 'lib-1',
            key: 'docs/source.md',
            name: 'source.md',
            content_type: 'text/markdown',
            size_bytes: 128,
          },
          {
            id: 'input-url',
            kind: 'url',
            url: 'https://example.com/reference',
            name: 'Reference',
            imported_library_id: 'lib-imported',
            imported_key: 'imports/reference.html',
            content_type: 'text/html',
            size_bytes: 4096,
          },
          {
            id: 'input-artifact',
            kind: 'artifact',
            task_id: 'task-previous',
            artifact_id: 'artifact-previous',
            task_relative_path: 'artifacts/previous.txt',
            name: 'previous.txt',
            content_type: 'text/plain',
            size_bytes: 256,
          },
        ],
        bound_runner_id: 'runner-dev',
        bound_runner_kind: 'developer',
        runner_binding_source: 'explicit',
        bound_at: '2026-05-06T09:00:00.000Z',
        bound_by_user_id: 'user-dev',
        active_run: {
          id: 'run-active',
          status: 'running',
          runner_id: 'runner-dev',
          started_at: '2026-05-06T09:05:00.000Z',
        },
        active_run_started_at: '2026-05-06T09:05:00.000Z',
        agent_presence: 'offline',
      } as unknown as Task;
      mockTaskHookState.messages = [];

      await renderComponentReady();

      await act(async () => {
        await latestTaskHeaderPropsRef.current.onCreateBoundRunnerRecoveryTask();
      });

      await waitFor(() => {
        expect(mockCreateTaskMutateAsync).toHaveBeenCalledWith({
          workspaceId: mockWorkspaceId,
          projectId: mockProjectId,
          data: expect.objectContaining({
            title: 'Recover me',
            prompt: 'Reuse this original task instruction only.',
            workspace_mode: 'create_new',
            workspace_name: 'Recover me workspace',
            input_refs: [
              {
                kind: 'library_object',
                library_id: 'lib-1',
                key: 'docs/source.md',
                name: 'source.md',
                content_type: 'text/markdown',
                size_bytes: 128,
              },
              {
                kind: 'url',
                url: 'https://example.com/reference',
                name: 'Reference',
                imported_library_id: 'lib-imported',
                imported_key: 'imports/reference.html',
                content_type: 'text/html',
                size_bytes: 4096,
              },
            ],
          }),
        });
      });
      const recoveryPayload = mockCreateTaskMutateAsync.mock.calls[0][0].data;
      for (const deniedField of [
        'bound_runner_id',
        'bound_runner_kind',
        'runner_binding_source',
        'bound_at',
        'bound_by_user_id',
        'active_run',
        'active_run_started_at',
        'terminal_session_id',
        'session_id',
        'artifacts',
        'runtime_metadata',
      ]) {
        expect(recoveryPayload).not.toHaveProperty(deniedField);
      }
      expect(recoveryPayload.input_refs).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'artifact',
          }),
        ]),
      );
      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/agent-tasks/recovered-task-id`,
      );
    });

    it('keeps busy state during non-terminal step success and clears on run terminal', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

      await user.click(screen.getByText('Send Message'));
      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('true');
      expect(screen.getByTestId('conversation-active-run-message')).toHaveTextContent('new-msg-id');
      expect(screen.getByTestId('conversation-active-run-state')).toHaveTextContent('running');
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('false');

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
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('false');

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
      expect(latestConversationPanelPropsRef.current.activeRunView).toMatchObject({
        messageId: 'new-msg-id',
        runState: 'running',
        cancelPending: false,
      });

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
      expect(latestConversationPanelPropsRef.current.activeRunView?.onCancel).toEqual(expect.any(Function));

      await user.click(screen.getByText('Cancel Active Run'));

      await waitFor(() => {
        expect(mockUseTaskRefetch).toHaveBeenCalled();
        expect(mockUseTaskActivityRefetch).toHaveBeenCalled();
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

    it.each([
      'cancelling',
      'terminating',
      'finalizing',
    ] as const)(
      'does not send or enqueue new messages while the authoritative run state is %s',
      async (runState) => {
        const user = userEvent.setup();
        mockTaskHookState.task = { ...mockTask, run_state: runState };

        await renderComponentReady();
        await user.click(screen.getByText('Send Message'));

        expect(mockSendMessageMutateAsync).not.toHaveBeenCalled();
        expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent(
          '0',
        );
      },
    );

    it('does not requeue after backend conflict refetch exposes terminating hard teardown debt', async () => {
      const user = userEvent.setup();
      mockSendMessageMutateAsync.mockRejectedValueOnce(
        new ApiError(
          'TASK_STREAM_CONFLICT',
          'Task run is waiting for hard teardown release.',
          'req-hard-teardown',
          409,
          {
            reason: 'hard_teardown_pending',
            hard_teardown_status: 'failed',
          },
        ),
      );
      mockUseTaskRefetch.mockImplementationOnce(async () => {
        const terminatingTask = {
          ...mockTask,
          run_state: 'terminating' as const,
          stop_mode: 'terminate' as const,
          can_escalate: false,
          escalation_reason: 'Terminal hard teardown release failed.',
        };
        mockTaskHookState.task = terminatingTask;
        return { data: terminatingTask };
      });

      const view = await renderComponentReady();

      await user.click(screen.getByText('Send Message'));

      await waitFor(() => {
        expect(mockUseTaskRefetch).toHaveBeenCalled();
        expect(mockToastInfo).toHaveBeenCalledWith(
          'Wait for the current execution environment to finish stopping before sending another message.',
        );
        expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent(
          '0',
        );
      });
      expect(mockSendMessageMutateAsync).toHaveBeenCalledTimes(1);
      expect(latestConversationPanelPropsRef.current.inputPlaceholder).toBe(
        'Wait for the current execution environment to finish stopping before sending another message.',
      );

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

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1_100));
      });

      expect(screen.getByTestId('conversation-pending-count')).toHaveTextContent(
        '0',
      );
      expect(mockSendMessageMutateAsync).toHaveBeenCalledTimes(1);
    });

    it('refetches authoritative cancelling truth before showing escalation confirmation and sends terminate once', async () => {
      vi.useFakeTimers();
      const terminateDeferred = createDeferred<{
        status: 'terminating';
        task_id: string;
        run_id: string;
        request_id: string;
      }>();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'cancelling',
        can_escalate: false,
      };
      mockUseTaskRefetch.mockResolvedValueOnce({
        data: {
          ...mockTask,
          run_state: 'cancelling',
          can_escalate: true,
          escalation_reason: 'agent did not acknowledge cancel',
        },
      });
      mockTaskApiCancelRun.mockReturnValueOnce(terminateDeferred.promise);

      try {
        renderComponent();

        await act(async () => {
          await vi.runOnlyPendingTimersAsync();
          await Promise.resolve();
        });

        expect(mockUseTaskRefetch).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('agent-tasks__cancel-escalation-dialog')).toBeInTheDocument();
        expect(screen.getByTestId('agent-tasks__cancel-escalation-cancel')).toBeInTheDocument();
        expect(screen.getByText('Force stop this run?')).toBeInTheDocument();
        expect(screen.getByText('Backend reason: agent did not acknowledge cancel')).toBeInTheDocument();
        vi.useRealTimers();

        const clickUser = userEvent.setup();
        const confirm = screen.getByTestId('agent-tasks__cancel-escalation-confirm');
        await clickUser.click(confirm);
        await clickUser.click(confirm);

        expect(mockTaskApiCancelRun).toHaveBeenCalledTimes(1);
        expect(mockTaskApiCancelRun).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          { mode: 'terminate' },
        );

        terminateDeferred.resolve({
          status: 'terminating',
          task_id: mockTaskId,
          run_id: 'run-1',
          request_id: 'req-terminate',
        });
        await act(async () => {
          await terminateDeferred.promise;
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not use previously known cancel capability when refetched truth omits capability fields', async () => {
      vi.useFakeTimers();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'cancelling',
        can_escalate: true,
        escalation_reason: 'cancel request exceeded the grace period',
      };
      mockUseTaskRefetch.mockResolvedValueOnce({
        data: {
          ...mockTask,
          run_state: 'cancelling',
        },
      });

      try {
        renderComponent();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });

        expect(mockUseTaskRefetch).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('agent-tasks__cancel-escalation-dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('Force stop this run?')).not.toBeInTheDocument();
        expect(mockTaskApiCancelRun).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not retain cancel response escalation capability when authoritative refetch drops optional fields', async () => {
      const user = userEvent.setup();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
      };
      mockTaskApiCancelRun.mockResolvedValueOnce({
        status: 'cancelling',
        task_id: mockTaskId,
        run_id: 'run-1',
        request_id: 'req-cancel',
        can_escalate: true,
        escalation_reason: 'cancel request exceeded the grace period',
      });

      const view = renderComponent();

      await user.click(screen.getByText('Cancel Active Run'));
      await waitFor(() => {
        expect(mockTaskApiCancelRun).toHaveBeenCalledTimes(1);
        expect(mockUseTaskRefetch).toHaveBeenCalled();
      });

      mockUseTaskRefetch.mockClear();
      mockUseTaskRefetch.mockResolvedValueOnce({
        data: {
          ...mockTask,
          run_state: 'cancelling',
        },
      });

      vi.useFakeTimers();
      try {
        mockTaskHookState.task = {
          ...mockTask,
          run_state: 'cancelling',
        };
        await act(async () => {
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
        });

        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });

        expect(mockUseTaskRefetch).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('agent-tasks__cancel-escalation-dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('Force stop this run?')).not.toBeInTheDocument();
        expect(mockTaskApiCancelRun).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not show escalation confirmation when refetched cancelling truth explicitly forbids escalation', async () => {
      vi.useFakeTimers();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'cancelling',
        can_escalate: true,
        escalation_reason: 'cancel request exceeded the grace period',
      };
      mockUseTaskRefetch.mockResolvedValueOnce({
        data: {
          ...mockTask,
          run_state: 'cancelling',
          can_escalate: false,
          escalation_reason: 'unsupported_runner',
        },
      });

      try {
        renderComponent();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });

        expect(mockUseTaskRefetch).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('agent-tasks__cancel-escalation-dialog')).not.toBeInTheDocument();
        expect(screen.queryByText('Force stop this run?')).not.toBeInTheDocument();
        expect(mockTaskApiCancelRun).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not show escalation confirmation when refetched task truth is no longer cancelling', async () => {
      vi.useFakeTimers();
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'cancelling',
        can_escalate: true,
      };
      mockUseTaskRefetch.mockResolvedValueOnce({
        data: {
          ...mockTask,
          run_state: 'idle',
          can_escalate: true,
        },
      });

      try {
        renderComponent();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(30_000);
        });

        expect(mockUseTaskRefetch).toHaveBeenCalledTimes(1);
        expect(screen.queryByText('Force stop this run?')).not.toBeInTheDocument();
        expect(mockTaskApiCancelRun).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears a cancelled run after authoritative idle recovery and does not re-enter the pending loop on refresh', async () => {
      mockSendMessageMutateAsync
        .mockResolvedValueOnce({
          id: 'new-msg-id',
          kind: 'runner_output',
          actor: 'runner',
          content: '',
          created_at: '2026-03-06T04:00:00.000Z',
        })
        .mockResolvedValueOnce({
          id: 'queued-msg-id',
          kind: 'runner_output',
          actor: 'runner',
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
            intent: 'Test message',
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
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('false');

      await act(async () => {
        latestTaskSseOptionsRef.current?.onTraceEvent?.(terminalTraceEvent);
      });

      expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('false');
      expect(screen.getByTestId('task-header-busy')).toHaveTextContent('false');
    });

    it('reconciles a re-entry active run without streamingMessageId when its terminal completion trace arrives', async () => {
      mockTaskHookState.task = {
        ...mockTask,
        run_state: 'running',
        last_activity_at: '2026-03-06T04:00:10.000Z',
      };
      mockTaskHookState.messages = [
        {
          ...mockMessages[0],
          id: 'msg-current-user',
          content: 'Current request',
          created_at: '2026-03-06T04:00:00.000Z',
        },
        {
          ...mockMessages[1],
          id: 'msg-current-run',
          content: '',
          created_at: '2026-03-06T04:00:01.000Z',
        },
      ];
      mockUseTaskRefetch.mockImplementation(async () => ({
        data: mockTaskHookState.task,
      }));

      const view = await renderComponentReady();

      await waitFor(() => {
        expect(latestConversationPanelPropsRef.current.streamingMessageId).toBeNull();
        expect(latestConversationPanelPropsRef.current.activeRunView).toMatchObject({
          messageId: 'msg-current-run',
          runState: 'running',
        });
      });

      await waitFor(() => {
        expect(mockUseTaskRefetch).toHaveBeenCalled();
      });
      mockUseTaskRefetch.mockClear();
      mockUseTaskActivityRefetch.mockClear();
      mockTaskArtifactsRefetch.mockClear();
      mockTaskApiListTraces.mockClear();
      mockUseTaskRefetch.mockImplementation(async () => {
        mockTaskHookState.task = {
          ...mockTask,
          run_state: 'idle',
          last_activity_at: '2026-03-06T04:00:12.000Z',
        };
        return { data: mockTaskHookState.task };
      });

      await act(async () => {
        latestTaskSseOptionsRef.current?.onTraceEvent?.({
          id: 'trace_reentry_terminal_done',
          task_id: mockTaskId,
          message_id: 'msg-current-run',
          run_id: 'run-current',
          seq: 12,
          at: '2026-03-06T04:00:12.000Z',
          category: 'lifecycle',
          phase: 'end',
          status: 'success',
          name: 'execution.terminal',
          summary: 'Run completed',
        } satisfies TaskTraceEvent);
      });

      await waitFor(() => {
        expect(mockUseTaskRefetch).toHaveBeenCalled();
        expect(mockUseTaskActivityRefetch).toHaveBeenCalled();
        expect(mockTaskArtifactsRefetch).toHaveBeenCalled();
        expect(mockTaskApiListTraces).toHaveBeenCalledWith(
          mockWorkspaceId,
          mockProjectId,
          mockTaskId,
          expect.objectContaining({ page_size: 500 }),
        );
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

      await waitFor(() => {
        expect(latestConversationPanelPropsRef.current.activeRunView).toBeNull();
        expect(screen.getByTestId('conversation-run-active')).toHaveTextContent('false');
      });
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
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/agent-tasks`
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
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/agent-tasks/new-task-id`
      );
    });

    it('navigates to agent tasks after task deletion', async () => {
      const user = userEvent.setup();
      await renderComponentReady();

      const deleteButton = screen.getByText('Delete');
      await user.click(deleteButton);

      expect(mockPush).toHaveBeenCalledWith(
        `/en-US/workspaces/${mockWorkspaceId}/projects/${mockProjectId}/agent-tasks`
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
      expect(screen.queryByTestId('agent-tasks__task-artifacts-toggle')).not.toBeInTheDocument();
    });

    it('handles task with no attached files', async () => {
      mockTaskHookState.task = { ...mockTask, attached_inputs: [] };

      await renderComponentReady();

      expect(screen.queryByTestId('attached-inputs-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('conversation-panel')).toBeInTheDocument();
    });
  });
});
