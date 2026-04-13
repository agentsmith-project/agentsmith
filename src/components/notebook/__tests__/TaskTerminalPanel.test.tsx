import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TaskTerminalPanel, resetTaskTerminalPanelSessionHandleCacheForTests } from '../TaskTerminalPanel';

const terminalWritelnMock = vi.fn();
const terminalWriteMock = vi.fn();
const terminalDisposeMock = vi.fn();
const terminalLoadAddonMock = vi.fn();
const terminalOpenMock = vi.fn();
const terminalOnDataMock = vi.fn(() => ({ dispose: vi.fn() }));
const terminalFocusMock = vi.fn();
const fitMock = vi.fn();
const fitDisposeMock = vi.fn();

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    writeln = terminalWritelnMock;
    write = terminalWriteMock;
    dispose = terminalDisposeMock;
    loadAddon = terminalLoadAddonMock;
    open = terminalOpenMock;
    onData = terminalOnDataMock;
    focus = terminalFocusMock;
  },
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = fitMock;
    dispose = fitDisposeMock;
  },
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const map: Record<string, string> = {
      terminal_title: 'Task Terminal',
      terminal_description: 'Directly control the current runner environment for this task.',
      terminal_scope_hint: 'Changes you make here affect files in this task workspace. Temporary shell variables stay only in this terminal session.',
      terminal_connecting: 'Connecting to runner...',
      terminal_preparing_environment: 'Preparing the task environment before opening the terminal...',
      terminal_preparing_run_busy: 'Waiting for the current agent run to finish before opening the terminal...',
      terminal_status_idle: 'Idle',
      terminal_status_preparing: 'Preparing',
      terminal_status_connecting: 'Connecting',
      terminal_status_active: 'Active',
      terminal_status_closed: 'Closed',
      terminal_status_failed: 'Failed',
      terminal_close: 'End Session',
      terminal_error_hint: `Terminal unavailable: ${values?.reason ?? ''}`,
      terminal_banner: `Terminal ready for ${values?.title ?? 'task'}`,
      terminal_closed: 'Terminal closed',
      terminal_failed: `Terminal failed: ${values?.reason ?? ''}`,
      terminal_reconnecting: 'Reconnecting to the previous terminal session...',
      terminal_error_runner_offline: 'The runner is still getting ready for this task. Retry in a moment.',
      terminal_error_agent_unavailable: "This task's runner is not available right now.",
      terminal_error_connection_failed: 'The terminal connection could not be opened. Please retry.',
      terminal_error_taken_over: 'This terminal was opened in another browser tab. Reopen it here if you want to continue.',
      terminal_recovery_hint: 'End this terminal session, then reopen it from the task header when you are ready to retry.',
      terminal_max_sessions_reached: 'You can run up to 3 terminal sessions in one task.',
    };
    return map[key] ?? key;
  },
}));

vi.mock('@/components/ui/toast', () => ({
  toast: {
    error: vi.fn(),
  },
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { reason: string }) => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({ reason: '' });
  });
  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }
}

describe('TaskTerminalPanel', () => {
  let originalWebSocket: typeof WebSocket | undefined;

  beforeAll(() => {
    originalWebSocket = globalThis.WebSocket;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as unknown as typeof WebSocket);
    window.sessionStorage.clear();
    resetTaskTerminalPanelSessionHandleCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    if (originalWebSocket) {
      vi.stubGlobal('WebSocket', originalWebSocket);
    }
  });

  it('retries transient task_runner_offline errors before connecting', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('task_runner_offline'))
      .mockResolvedValue({
        session_id: 'term_1',
        status: 'pending',
        ws_url: 'ws://example.test/terminal',
      });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_1"
        taskTitle="terminal-smoke"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(2), { timeout: 3000 });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toBe('ws://example.test/terminal');
    expect(screen.getByTestId('notebook__task-terminal')).not.toHaveTextContent('Failed');
  }, 10000);

  it('keeps retrying while a warmup run is still in progress', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('task_run_in_progress'))
      .mockImplementation(() => new Promise((resolve) => {
        window.setTimeout(() => {
          resolve({
            session_id: 'term_2',
            status: 'pending',
            ws_url: 'ws://example.test/terminal-2',
          });
        }, 200);
      }));

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_2"
        taskTitle="terminal-warmup"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(2), { timeout: 3000 });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(screen.getByTestId('notebook__task-terminal')).not.toHaveTextContent('Failed');
  }, 10000);

  it('shows a friendly failure reason for non-retryable terminal session errors', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValue(new Error('task_agent_not_available'));
    const onOpenChange = vi.fn();
    const onStatusChange = vi.fn();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_1"
        taskTitle="terminal-smoke"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={onOpenChange}
        onStatusChange={onStatusChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('notebook__task-terminal')).toHaveTextContent('Failed');
      expect(screen.getByTestId('notebook__task-terminal')).toHaveTextContent("This task's runner is not available right now.");
      expect(screen.getByTestId('notebook__task-terminal')).toHaveTextContent(
        'End this terminal session, then reopen it from the task header when you are ready to retry.',
      );
    });

    act(() => {
      screen.getByRole('button', { name: 'End Session' }).click();
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(onStatusChange).toHaveBeenCalledWith('failed');
  });

  it('reconciles pre-session limit rejections through the parent instead of leaving a failed phantom tab', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValue(new Error('task_terminal_session_limit_reached'));
    const onOpenChange = vi.fn();
    const onStatusChange = vi.fn();
    const onSessionCreateRejected = vi.fn();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_1"
        taskTitle="terminal-smoke"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={onOpenChange}
        onStatusChange={onStatusChange}
        onSessionCreateRejected={onSessionCreateRejected}
      />,
    );

    await waitFor(() => {
      expect(onSessionCreateRejected).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(screen.getByTestId('notebook__task-terminal')).not.toHaveTextContent('Failed');
    expect(onStatusChange).not.toHaveBeenCalledWith('failed');
  });

  it('reports active then failed status changes so the page can tell the truth outside the panel', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      session_id: 'term_status',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-status',
    });
    const onStatusChange = vi.fn();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_status"
        taskTitle="terminal-status"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
        onStatusChange={onStatusChange}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'started' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'error', error_message: 'terminal_connection_failed' }),
      });
    });

    expect(onStatusChange).toHaveBeenCalledWith('active');
    expect(onStatusChange).toHaveBeenCalledWith('failed');
  });

  it('deletes a failed backend session when the user ends the failed terminal tab', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      session_id: 'term_failed_close',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-failed-close',
    });
    const closeTerminalSession = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_failed_close"
        taskTitle="terminal-failed-close"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'started' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'error', error_message: 'terminal_connection_failed' }),
      });
    });

    act(() => {
      screen.getByRole('button', { name: 'End Session' }).click();
    });

    await waitFor(() => {
      expect(closeTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_failed_close',
        'term_failed_close',
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(socket?.send).not.toHaveBeenCalledWith(JSON.stringify({ type: 'terminal.close' }));
    expect(
      window.sessionStorage.getItem('agentsmith-terminal-session:ws_default:proj_1:task_failed_close'),
    ).toBeNull();
  });

  it('reconnects to a stored terminal session before creating a new one', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_3',
      'term_existing',
    );
    const getTerminalSession = vi.fn().mockResolvedValue({
      id: 'term_existing',
      status: 'disconnected',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:01Z',
      ws_url: 'ws://example.test/terminal-existing',
    });
    const createTerminalSession = vi.fn();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_3"
        taskTitle="terminal-reconnect"
        taskApi={{ createTerminalSession, getTerminalSession } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(getTerminalSession).toHaveBeenCalledWith('ws_default', 'proj_1', 'task_3', 'term_existing'));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(terminalWritelnMock).toHaveBeenCalledWith('Reconnecting to the previous terminal session...');
  });

  it('reports the resolved id when reconnecting to an existing session', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_report',
      'term_report_existing',
    );
    const onSessionResolved = vi.fn();
    const getTerminalSession = vi.fn().mockResolvedValue({
      id: 'term_report_existing',
      status: 'active',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:01Z',
      ws_url: 'ws://example.test/terminal-report-existing',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_report"
        taskTitle="terminal-report"
        taskApi={{ createTerminalSession: vi.fn(), getTerminalSession } as never}
        onSessionResolved={onSessionResolved}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(onSessionResolved).toHaveBeenCalledWith('term_report_existing');
    expect(
      window.sessionStorage.getItem('agentsmith-terminal-session:ws_default:proj_1:task_report'),
    ).toBe('term_report_existing');
  });

  it('accepts a create-session response that uses id instead of session_id', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      id: 'term_typed_create',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-typed-create',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_typed_create"
        taskTitle="terminal-typed-create"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(MockWebSocket.instances[0]?.url).toBe('ws://example.test/terminal-typed-create');
    expect(
      window.sessionStorage.getItem('agentsmith-terminal-session:ws_default:proj_1:task_typed_create'),
    ).toBe('term_typed_create');
  });

  it('focuses the terminal after a user-triggered open reaches the started state', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      session_id: 'term_focus',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-focus',
    });
    const { rerender } = render(
      <TaskTerminalPanel
        open={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_focus"
        taskTitle="terminal-focus"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_focus"
        taskTitle="terminal-focus"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'started' }),
      });
    });

    await waitFor(() => expect(terminalFocusMock).toHaveBeenCalledTimes(1));
  });

  it('does not steal focus when an existing session reconnects on initial mount', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_mount',
      'term_mount_existing',
    );
    const getTerminalSession = vi.fn().mockResolvedValue({
      id: 'term_mount_existing',
      status: 'disconnected',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:01Z',
      ws_url: 'ws://example.test/terminal-mount-existing',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_mount"
        taskTitle="terminal-mount"
        taskApi={{ createTerminalSession: vi.fn(), getTerminalSession } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'started' }),
      });
    });

    await waitFor(() => {
      expect(terminalWritelnMock).toHaveBeenCalledWith('Terminal ready for terminal-mount\r\n');
    });
    expect(terminalFocusMock).not.toHaveBeenCalled();
  });

  it('can close an existing hidden terminal session without rendering the panel again', async () => {
    const onOpenChange = vi.fn();
    const createTerminalSession = vi.fn();
    const closeTerminalSession = vi.fn().mockResolvedValue(undefined);
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_hidden',
      'term_hidden_existing',
    );
    const { rerender } = render(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden"
        taskTitle="terminal-hidden"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={0}
      />,
    );

    expect(screen.queryByTestId('notebook__task-terminal')).not.toBeInTheDocument();
    expect(createTerminalSession).not.toHaveBeenCalled();

    rerender(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden"
        taskTitle="terminal-hidden"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={1}
      />,
    );

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(closeTerminalSession).toHaveBeenCalledWith('ws_default', 'proj_1', 'task_hidden', 'term_hidden_existing');
    expect(window.sessionStorage.getItem('agentsmith-terminal-session:ws_default:proj_1:task_hidden')).toBeNull();
  });

  it('deduplicates the first terminal session create flow across StrictMode effect re-entry', async () => {
    let resolveCreate: ((value: {
      session_id: string;
      status: 'pending';
      ws_url: string;
    }) => void) | null = null;
    const createTerminalSession = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    render(
      <React.StrictMode>
        <TaskTerminalPanel
          open
          workspaceId="ws_default"
          projectId="proj_1"
          taskId="task_strict_dedupe"
          taskTitle="terminal-strict-dedupe"
          taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
          onOpenChange={vi.fn()}
        />
      </React.StrictMode>,
    );

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1));

    act(() => {
      resolveCreate?.({
        session_id: 'term_strict_dedupe',
        status: 'pending',
        ws_url: 'ws://example.test/terminal-strict-dedupe',
      });
    });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(
      window.sessionStorage.getItem('agentsmith-terminal-session:ws_default:proj_1:task_strict_dedupe'),
    ).toBe('term_strict_dedupe');
  });

  it('reuses the first resolved session across a remount instead of creating a duplicate session', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      session_id: 'term_remount',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-remount',
    });
    const getTerminalSession = vi.fn().mockRejectedValue(new Error('task_terminal_session_missing'));

    const firstRender = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_remount"
        taskTitle="terminal-remount"
        taskApi={{ createTerminalSession, getTerminalSession } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    firstRender.unmount();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_remount"
        taskTitle="terminal-remount"
        taskApi={{ createTerminalSession, getTerminalSession } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
    expect(getTerminalSession).not.toHaveBeenCalled();
  });

  it('closes a session that resolves after the tab was already asked to close, so no orphan session is left behind', async () => {
    let resolveCreate: ((value: {
      session_id: string;
      status: 'pending';
      ws_url: string;
    }) => void) | null = null;
    const createTerminalSession = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const closeTerminalSession = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_pending_close"
        taskTitle="terminal-pending-close"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={0}
      />,
    );

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1));

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_pending_close"
        taskTitle="terminal-pending-close"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={1}
      />,
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    act(() => {
      resolveCreate?.({
        session_id: 'term_pending_close',
        status: 'pending',
        ws_url: 'ws://example.test/terminal-pending-close',
      });
    });

    await waitFor(() => {
      expect(closeTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_pending_close',
        'term_pending_close',
      );
    });
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(
      window.sessionStorage.getItem('agentsmith-terminal-session:ws_default:proj_1:task_pending_close'),
    ).toBeNull();
  });

  it('does not create duplicate sessions when parent inline callbacks rerender during the initial connect phase', async () => {
    let resolveCreate: ((value: {
      session_id: string;
      status: 'pending';
      ws_url: string;
    }) => void) | null = null;
    const createTerminalSession = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    function InlineCallbackHarness() {
      const [, setStatusHistory] = React.useState<string[]>([]);
      const [, setResolvedSessionIds] = React.useState<string[]>([]);
      const [, setClosedStates] = React.useState<boolean[]>([]);
      const taskApi = React.useMemo(
        () => ({ createTerminalSession, getTerminalSession: vi.fn() } as never),
        [],
      );
      return (
        <TaskTerminalPanel
          open
          workspaceId="ws_default"
          projectId="proj_1"
          taskId="task_callback_churn"
          taskTitle="terminal-callback-churn"
          taskApi={taskApi}
          onStatusChange={(status) => setStatusHistory((current) => [...current, status])}
          onSessionResolved={(sessionId) => setResolvedSessionIds((current) => [...current, sessionId])}
          onOpenChange={(nextOpen) => setClosedStates((current) => [...current, nextOpen])}
        />
      );
    }

    render(<InlineCallbackHarness />);

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1));

    act(() => {
      resolveCreate?.({
        session_id: 'term_callback_churn',
        status: 'pending',
        ws_url: 'ws://example.test/terminal-callback-churn',
      });
    });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
  });

});
