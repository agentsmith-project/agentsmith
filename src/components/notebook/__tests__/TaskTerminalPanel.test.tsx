import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TaskTerminalPanel } from '../TaskTerminalPanel';

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
      terminal_close: 'Close terminal',
      terminal_error_hint: `Terminal unavailable: ${values?.reason ?? ''}`,
      terminal_banner: `Terminal ready for ${values?.title ?? 'task'}`,
      terminal_closed: 'Terminal closed',
      terminal_failed: `Terminal failed: ${values?.reason ?? ''}`,
      terminal_reconnecting: 'Reconnecting to the previous terminal session...',
      terminal_error_runner_offline: 'The runner is still getting ready for this task. Retry in a moment.',
      terminal_error_agent_unavailable: "This task's runner is not available right now.",
      terminal_error_connection_failed: 'The terminal connection could not be opened. Please retry.',
      terminal_error_taken_over: 'This terminal was opened in another browser tab. Reopen it here if you want to continue.',
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

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    expect(socket?.url).toBe('ws://example.test/terminal');
    await waitFor(() => {
      expect(screen.getByTestId('notebook__task-terminal')).toHaveTextContent('Connecting');
      expect(screen.getByTestId('notebook__task-terminal')).not.toHaveTextContent('Failed');
    }, { timeout: 5000 });
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

    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    await waitFor(() => {
      expect(screen.getByTestId('notebook__task-terminal')).toHaveTextContent('Connecting');
      expect(screen.getByTestId('notebook__task-terminal')).not.toHaveTextContent('Failed');
    });
  }, 10000);

  it('shows a friendly failure reason for non-retryable terminal session errors', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValue(new Error('task_agent_not_available'));

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

    await waitFor(() => {
      expect(screen.getByTestId('notebook__task-terminal')).toHaveTextContent('Failed');
      expect(screen.getByTestId('notebook__task-terminal')).toHaveTextContent("This task's runner is not available right now.");
    });
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

});
