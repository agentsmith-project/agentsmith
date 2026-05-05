import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { TaskTerminalPanel, resetTaskTerminalPanelSessionHandleCacheForTests } from '../TaskTerminalPanel';

const { mockToastError } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
}));
const terminalWritelnMock = vi.fn();
const terminalWriteMock = vi.fn();
const terminalDisposeMock = vi.fn();
const terminalLoadAddonMock = vi.fn();
const terminalOpenMock = vi.fn();
const terminalDataHandlers: Array<(data: string) => void> = [];
const terminalOnDataMock = vi.fn((handler: (data: string) => void) => {
  terminalDataHandlers.push(handler);
  return { dispose: vi.fn() };
});
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
      terminal_description: 'Directly control the current task environment when you need to work by hand.',
      terminal_scope_hint: 'Changes you make here affect files in this task workspace. Temporary shell variables stay only in this terminal session.',
      terminal_connecting: 'Connecting to task terminal...',
      terminal_preparing_environment: 'Preparing the task environment before opening the terminal...',
      terminal_preparing_run_busy: 'Waiting for the current task run to finish before opening the terminal...',
      terminal_status_idle: 'Idle',
      terminal_status_preparing: 'Preparing',
      terminal_status_recovering: 'Recovering',
      terminal_status_connecting: 'Connecting',
      terminal_status_active: 'Active',
      terminal_status_closed: 'Closed',
      terminal_status_failed: 'Failed',
      terminal_replay_partial: 'Some earlier terminal output is no longer available.',
      terminal_replay_gap: 'Some terminal output may be missing. Reconnecting to recover a continuous stream.',
      terminal_attach_unavailable: 'This terminal session cannot be attached right now.',
      terminal_close: 'End Session',
      terminal_error_hint: `Terminal unavailable: ${values?.reason ?? ''}`,
      terminal_banner: `Terminal ready for ${values?.title ?? 'task'}`,
      terminal_closed: 'Terminal closed',
      terminal_failed: `Terminal failed: ${values?.reason ?? ''}`,
      terminal_reconnecting: 'Reconnecting to the previous terminal session...',
      terminal_error_runner_offline: 'The task environment is still getting ready. Retry in a moment.',
      terminal_error_agent_unavailable: "This task's execution environment is not available right now.",
      terminal_error_invalid_shell: "This task couldn't start a terminal in the current environment.",
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
    error: mockToastError,
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
    terminalDataHandlers.length = 0;
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
        terminal_session_id: 'term_1',
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
    expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('Failed');
  }, 10000);

  it('keeps retrying while a warmup run is still in progress', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValueOnce(new Error('task_run_in_progress'))
      .mockImplementation(() => new Promise((resolve) => {
        window.setTimeout(() => {
          resolve({
            terminal_session_id: 'term_2',
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
    expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('Failed');
  }, 10000);

  it('renders as a full-height terminal surface for the dedicated terminal workspace shell', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_layout',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-layout',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_layout"
        taskTitle="terminal-layout"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    const panel = await screen.findByTestId('agent-tasks__task-terminal');
    expect(panel).toHaveClass('flex', 'min-h-0', 'w-full', 'flex-1', 'flex-col', 'overflow-hidden');
    expect(panel).not.toHaveClass('mt-3');

    const viewport = screen.getByTestId('agent-tasks__task-terminal-viewport');
    expect(viewport).toHaveClass('min-h-0', 'flex-1');
    expect(viewport).not.toHaveClass('h-[360px]');
  });

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
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent('Failed');
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
        "This task's execution environment is not available right now.",
      );
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
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
    expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('Failed');
    expect(onStatusChange).not.toHaveBeenCalledWith('failed');
  });

  it('shows the terminal session limit toast only once across StrictMode effect re-entry', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValue(new Error('task_terminal_session_limit_reached'));
    const onSessionCreateRejected = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <React.StrictMode>
        <TaskTerminalPanel
          open
          workspaceId="ws_default"
          projectId="proj_1"
          taskId="task_limit_strict"
          taskTitle="terminal-limit-strict"
          taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
          onOpenChange={onOpenChange}
          onSessionCreateRejected={onSessionCreateRejected}
        />
      </React.StrictMode>,
    );

    await waitFor(() => {
      expect(onSessionCreateRejected).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      'You can run up to 3 terminal sessions in one task.',
    );
  });

  it('reports active then failed status changes so the page can tell the truth outside the panel', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_status',
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
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.error', error_message: 'terminal_connection_failed' }),
      });
    });

    expect(onStatusChange).toHaveBeenCalledWith('active');
    expect(onStatusChange).toHaveBeenCalledWith('failed');
  });

  it('sends terminal.reconnect on websocket open and gates stdin and resize until input is enabled', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_handshake',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-handshake',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_handshake"
        taskTitle="terminal-handshake"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket?.open();
    });

    await waitFor(() => expect(socket?.send).toHaveBeenCalledTimes(1));
    const sentBeforeHandshake = socket?.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(sentBeforeHandshake).toEqual([
      expect.objectContaining({
        type: 'terminal.reconnect',
        terminal_session_id: 'term_handshake',
        view: 'agent_task.task_terminal',
        cols: 80,
        rows: 24,
      }),
    ]);

    act(() => {
      terminalDataHandlers[0]?.('echo gated\n');
      window.dispatchEvent(new Event('resize'));
    });

    expect(
      socket?.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).map((message) => message.type),
    ).toEqual(['terminal.reconnect']);

    act(() => {
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_start', terminal_session_id: 'term_handshake' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_end',
          terminal_session_id: 'term_handshake',
          input_enabled: false,
        }),
      });
      terminalDataHandlers[0]?.('echo live\n');
      window.dispatchEvent(new Event('resize'));
    });

    expect(
      socket?.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).map((message) => message.type),
    ).toEqual(['terminal.reconnect']);

    act(() => {
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.state',
          terminal_session_id: 'term_handshake',
          state: 'ready',
          input_enabled: true,
        }),
      });
      terminalDataHandlers[0]?.('echo live\n');
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      const sentTypes = socket?.send.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .map((message) => message.type);
      expect(sentTypes).toContain('terminal.stdin');
      expect(sentTypes).toContain('terminal.resize');
    });
  });

  it('allows stdin and resize directly when replay_end explicitly enables input', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_existing_runtime',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-existing-runtime',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_existing_runtime"
        taskTitle="terminal-existing-runtime"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_end',
          terminal_session_id: 'term_existing_runtime',
          input_enabled: true,
        }),
      });
      terminalDataHandlers[0]?.('echo attached\n');
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      const sentTypes = socket?.send.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .map((message) => message.type);
      expect(sentTypes).toContain('terminal.stdin');
      expect(sentTypes).toContain('terminal.resize');
    });
  });

  it('ignores a stale socket close after remount without clearing the current socket readiness', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_stale_close',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-stale-close',
    });
    const taskApi = {
      createTerminalSession,
      getTerminalSession: vi.fn(),
    } as never;
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      top: 0,
      left: 0,
      right: 640,
      bottom: 360,
      toJSON: () => ({}),
    } as DOMRect);
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stale_close"
        taskTitle="terminal-stale-close"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const staleSocket = MockWebSocket.instances[0];
    const staleClose = staleSocket?.onclose;
    if (staleSocket) {
      staleSocket.onclose = null;
    }

    rerender(
      <TaskTerminalPanel
        open={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stale_close"
        taskTitle="terminal-stale-close"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stale_close"
        taskTitle="terminal-stale-close"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const currentSocket = MockWebSocket.instances[1];
    act(() => {
      currentSocket?.open();
      currentSocket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_end',
          terminal_session_id: 'term_stale_close',
          input_enabled: true,
        }),
      });
    });
    currentSocket?.send.mockClear();

    act(() => {
      staleClose?.({ reason: '' });
      terminalDataHandlers[terminalDataHandlers.length - 1]?.('echo current\n');
      window.dispatchEvent(new Event('resize'));
    });

    await waitFor(() => {
      const sentTypes = currentSocket?.send.mock.calls
        .map(([raw]) => JSON.parse(String(raw)))
        .map((message) => message.type);
      expect(sentTypes).toContain('terminal.stdin');
      expect(sentTypes).toContain('terminal.resize');
    });
    rectSpy.mockRestore();
  });

  it('applies replay output by session sequence and keeps terminal state copy out of the xterm buffer', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_replay',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-replay',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_replay"
        taskTitle="terminal-replay"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_start', terminal_session_id: 'term_replay' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_replay',
          seq: 1,
          encoding: 'utf8',
          data: 'hello',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_replay',
          seq: 1,
          encoding: 'utf8',
          data: 'hello',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_replay',
          seq: 2,
          encoding: 'base64',
          data: 'd29ybGQ=',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_end', terminal_session_id: 'term_replay' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.state',
          terminal_session_id: 'term_replay',
          state: 'ready',
          input_enabled: true,
        }),
      });
    });

    expect(terminalWriteMock).toHaveBeenCalledTimes(2);
    expect(terminalWriteMock).toHaveBeenNthCalledWith(1, 'hello');
    expect(terminalWriteMock).toHaveBeenNthCalledWith(2, 'world');
    expect(terminalWritelnMock).not.toHaveBeenCalledWith(expect.stringContaining('Connecting'));
    expect(terminalWritelnMock).not.toHaveBeenCalledWith(expect.stringContaining('Terminal ready'));
    expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('Terminal ready');
  });

  it('decodes split multibyte UTF-8 base64 terminal output with session decoder state', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_split_utf8',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-split-utf8',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_split_utf8"
        taskTitle="terminal-split-utf8"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_start', terminal_session_id: 'term_split_utf8' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_split_utf8',
          seq: 1,
          encoding: 'base64',
          data: '5Lg=',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_split_utf8',
          seq: 2,
          encoding: 'base64',
          data: 'rQ==',
        }),
      });
    });

    const renderedOutput = terminalWriteMock.mock.calls.map(([value]) => String(value)).join('');
    expect(renderedOutput).toBe('中');
    expect(renderedOutput).not.toContain('\uFFFD');
  });

  it('preserves base64 decoder state across partial replay_end into live output', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_partial_split_utf8',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-partial-split-utf8',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_partial_split_utf8"
        taskTitle="terminal-partial-split-utf8"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_start',
          terminal_session_id: 'term_partial_split_utf8',
          status: 'partial',
          gap: true,
          earliest_seq: 1,
          latest_seq: 1,
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_partial_split_utf8',
          seq: 1,
          encoding: 'base64',
          data: '5Lg=',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_end',
          terminal_session_id: 'term_partial_split_utf8',
          status: 'partial',
          gap: true,
          latest_seq: 1,
          input_enabled: true,
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_partial_split_utf8',
          seq: 2,
          encoding: 'base64',
          data: 'rQ==',
        }),
      });
    });

    const renderedOutput = terminalWriteMock.mock.calls.map(([value]) => String(value)).join('');
    expect(renderedOutput).toBe('中');
    expect(renderedOutput).not.toContain('\uFFFD');
  });

  it('drops base64 decoder state when unavailable replay declares an unprovable byte boundary', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_unavailable_decoder',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-unavailable-decoder',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_unavailable_decoder"
        taskTitle="terminal-unavailable-decoder"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_start',
          terminal_session_id: 'term_unavailable_decoder',
          status: 'complete',
          gap: false,
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_unavailable_decoder',
          seq: 1,
          encoding: 'base64',
          data: '5Lg=',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_start',
          terminal_session_id: 'term_unavailable_decoder',
          status: 'unavailable',
          gap: true,
          latest_seq: 1,
          next_seq: 2,
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_end',
          terminal_session_id: 'term_unavailable_decoder',
          status: 'unavailable',
          gap: true,
          latest_seq: 1,
          next_seq: 2,
          input_enabled: true,
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_unavailable_decoder',
          seq: 2,
          encoding: 'base64',
          data: 'T0sK',
        }),
      });
    });

    const renderedOutput = terminalWriteMock.mock.calls.map(([value]) => String(value)).join('');
    expect(renderedOutput).toBe('OK\n');
    expect(renderedOutput).not.toContain('\uFFFD');
  });

  it('does not let duplicate base64 output mutate decoder state before seq acceptance', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_duplicate_decoder',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-duplicate-decoder',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_duplicate_decoder"
        taskTitle="terminal-duplicate-decoder"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_start', terminal_session_id: 'term_duplicate_decoder' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_duplicate_decoder',
          seq: 1,
          encoding: 'base64',
          data: '5Lg=',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_duplicate_decoder',
          seq: 1,
          encoding: 'base64',
          data: 'rQ==',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_duplicate_decoder',
          seq: 2,
          encoding: 'base64',
          data: 'rQ==',
        }),
      });
    });

    const renderedOutput = terminalWriteMock.mock.calls.map(([value]) => String(value)).join('');
    expect(renderedOutput).toBe('中');
    expect(renderedOutput).not.toContain('\uFFFD');
  });

  it('ignores stale socket messages after remount without writing xterm or advancing seq state', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_stale_message',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-stale-message',
    });
    const taskApi = {
      createTerminalSession,
      getTerminalSession: vi.fn(),
    } as never;
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stale_message"
        taskTitle="terminal-stale-message"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const staleSocket = MockWebSocket.instances[0];
    const staleMessage = staleSocket?.onmessage;
    if (staleSocket) {
      staleSocket.onclose = null;
    }

    rerender(
      <TaskTerminalPanel
        open={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stale_message"
        taskTitle="terminal-stale-message"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stale_message"
        taskTitle="terminal-stale-message"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const currentSocket = MockWebSocket.instances[1];
    act(() => {
      currentSocket?.open();
      currentSocket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_start', terminal_session_id: 'term_stale_message' }),
      });
    });
    terminalWriteMock.mockClear();

    act(() => {
      staleMessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_stale_message',
          seq: 1,
          chunk: 'stale output',
        }),
      });
    });
    expect(terminalWriteMock).not.toHaveBeenCalled();

    act(() => {
      currentSocket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_stale_message',
          seq: 1,
          encoding: 'base64',
          data: '5Lg=',
        }),
      });
      currentSocket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_stale_message',
          seq: 2,
          encoding: 'base64',
          data: 'rQ==',
        }),
      });
    });

    const renderedOutput = terminalWriteMock.mock.calls.map(([value]) => String(value)).join('');
    expect(renderedOutput).toBe('中');
    expect(renderedOutput).not.toContain('\uFFFD');
  });

  it('clears decoder state when a gapped base64 output is rejected before later accepted output', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_gap_decoder',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-gap-decoder',
    });
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_gap_decoder',
      status: 'disconnected',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:02Z',
      ws_url: 'ws://example.test/terminal-gap-decoder-recovered',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_gap_decoder"
        taskTitle="terminal-gap-decoder"
        taskApi={{ createTerminalSession, getTerminalSession } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_start', terminal_session_id: 'term_gap_decoder' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_gap_decoder',
          seq: 1,
          encoding: 'base64',
          data: '5Lg=',
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_gap_decoder',
          seq: 3,
          encoding: 'base64',
          data: '5Lg=',
        }),
      });
    });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
    const recoveredSocket = MockWebSocket.instances[1];
    act(() => {
      recoveredSocket?.open();
      recoveredSocket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_start',
          terminal_session_id: 'term_gap_decoder',
          status: 'complete',
          gap: false,
          earliest_seq: 2,
          latest_seq: 2,
        }),
      });
      recoveredSocket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_gap_decoder',
          seq: 2,
          encoding: 'base64',
          data: '5paH',
        }),
      });
    });

    const renderedOutput = terminalWriteMock.mock.calls.map(([value]) => String(value)).join('');
    expect(renderedOutput).toBe('文');
    expect(renderedOutput).not.toContain('\uFFFD');
  });

  it('surfaces a replay sequence gap outside xterm without writing synthetic recovery text into the buffer', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_gap',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-gap',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_gap"
        taskTitle="terminal-gap"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.replay_start', terminal_session_id: 'term_gap' }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_gap',
          seq: 2,
          encoding: 'utf8',
          data: 'late output',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
        'Some terminal output may be missing. Reconnecting to recover a continuous stream.',
      );
    });
    expect(terminalWriteMock).not.toHaveBeenCalledWith('late output');
    expect(terminalWritelnMock).not.toHaveBeenCalledWith(
      expect.stringContaining('Some terminal output may be missing'),
    );
  });

  it('continues live output after unavailable replay by aligning to the server continuation seq', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_unavailable',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-unavailable',
    });

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_unavailable"
        taskTitle="terminal-unavailable"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_start',
          terminal_session_id: 'term_unavailable',
          status: 'unavailable',
          gap: true,
          latest_seq: 1,
          next_seq: 2,
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_end',
          terminal_session_id: 'term_unavailable',
          status: 'unavailable',
          gap: true,
          latest_seq: 1,
          next_seq: 2,
          input_enabled: true,
        }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.output',
          terminal_session_id: 'term_unavailable',
          seq: 2,
          chunk: 'live-after-unavailable\n',
        }),
      });
    });

    expect(terminalWriteMock).toHaveBeenCalledWith('live-after-unavailable\n');
    expect(socket?.close).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
      'Some earlier terminal output is no longer available.',
    );
  });

  it('deletes a failed backend session when the user ends the failed terminal tab', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_failed_close',
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
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.error', error_message: 'terminal_connection_failed' }),
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

  it('reconnects to a stored terminal session before creating a new one and surfaces recovery state instead of preparing', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_3',
      'term_existing',
    );
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_existing',
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
    expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent('Recovering');
    expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
      'Reconnecting to the previous terminal session...',
    );
    expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('Connecting');
    expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('Preparing');
    expect(terminalWritelnMock).not.toHaveBeenCalledWith('Reconnecting to the previous terminal session...');
  });

  it('retries the same stored session after an unexpected reconnect-time websocket close instead of getting stuck closed', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_reconnect_retry',
      'term_retry_existing',
    );
    const getTerminalSession = vi
      .fn()
      .mockResolvedValue({
        terminal_session_id: 'term_retry_existing',
        status: 'disconnected',
        cols: 80,
        rows: 24,
        created_at: '2026-04-02T00:00:00Z',
        last_activity_at: '2026-04-02T00:00:01Z',
        ws_url: 'ws://example.test/terminal-retry-existing',
      })
      .mockResolvedValue({
        terminal_session_id: 'term_retry_existing',
        status: 'disconnected',
        cols: 80,
        rows: 24,
        created_at: '2026-04-02T00:00:00Z',
        last_activity_at: '2026-04-02T00:00:02Z',
        ws_url: 'ws://example.test/terminal-retry-existing',
      });
    const createTerminalSession = vi.fn();
    const onStatusChange = vi.fn();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_reconnect_retry"
        taskTitle="terminal-reconnect-retry"
        taskApi={{ createTerminalSession, getTerminalSession } as never}
        onStatusChange={onStatusChange}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(getTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_reconnect_retry',
        'term_retry_existing',
      ),
    );
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const firstSocket = MockWebSocket.instances[0];

    act(() => {
      firstSocket?.open();
      firstSocket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
      firstSocket?.onclose?.({ reason: '' });
    });

    await waitFor(() => {
      expect(getTerminalSession).toHaveBeenCalledTimes(2);
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent('Recovering');
      expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('Closed');
    });

    const secondSocket = MockWebSocket.instances[1];
    act(() => {
      secondSocket?.open();
      secondSocket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    await waitFor(() => {
      expect(onStatusChange.mock.lastCall?.[0]).toBe('active');
    });
    expect(createTerminalSession).not.toHaveBeenCalled();
  });

  it('shows a human-readable invalid shell failure without exposing raw shell details', async () => {
    const createTerminalSession = vi
      .fn()
      .mockRejectedValue(new Error('invalid_shell:/nix/store/bash'));

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_invalid_shell"
        taskTitle="terminal-invalid-shell"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent('Failed');
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
        "This task couldn't start a terminal in the current environment.",
      );
    });
    expect(screen.getByTestId('agent-tasks__task-terminal')).not.toHaveTextContent('/nix/store/bash');
    expect(mockToastError).toHaveBeenCalledWith(
      "This task couldn't start a terminal in the current environment.",
    );
  });

  it('reports the resolved id when reconnecting to an existing session', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_report',
      'term_report_existing',
    );
    const onSessionResolved = vi.fn();
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_report_existing',
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

  it('requires create-session responses to use terminal_session_id', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_typed_create',
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

  it('focuses the terminal after an explicit focus request reaches the started state', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_focus',
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
        focusRequestToken={0}
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
        focusRequestToken={1}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    await waitFor(() => expect(terminalFocusMock).toHaveBeenCalledTimes(1));
  });

  it('focuses an already live terminal only when the focus request token advances', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_focus_token',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-focus-token',
    });
    const taskApi = {
      createTerminalSession,
      getTerminalSession: vi.fn(),
    } as never;
    const onStatusChange = vi.fn();
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_focus_token"
        taskTitle="terminal-focus-token"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
        onStatusChange={onStatusChange}
        focusRequestToken={0}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith('active'));
    expect(terminalWritelnMock).not.toHaveBeenCalledWith(
      'Terminal ready for terminal-focus-token\r\n',
    );
    expect(terminalFocusMock).not.toHaveBeenCalled();

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_focus_token"
        taskTitle="terminal-focus-token"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
        onStatusChange={onStatusChange}
        focusRequestToken={1}
      />,
    );

    await waitFor(() => expect(terminalFocusMock).toHaveBeenCalledTimes(1));
  });

  it('does not steal focus when a hidden stored session becomes visible without a focus request', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_visible_restore',
      'term_visible_restore',
    );
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_visible_restore',
      status: 'active',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:01Z',
      ws_url: 'ws://example.test/terminal-visible-restore',
    });
    const taskApi = {
      createTerminalSession: vi.fn(),
      getTerminalSession,
    } as never;
    const { rerender } = render(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_visible_restore"
        taskTitle="terminal-visible-restore"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    expect(MockWebSocket.instances).toHaveLength(0);

    rerender(
      <TaskTerminalPanel
        open
        visible
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_visible_restore"
        taskTitle="terminal-visible-restore"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    await Promise.resolve();
    expect(terminalWritelnMock).not.toHaveBeenCalledWith(
      'Terminal ready for terminal-visible-restore\r\n',
    );
    expect(terminalFocusMock).not.toHaveBeenCalled();
    expect(getTerminalSession).toHaveBeenCalledWith(
      'ws_default',
      'proj_1',
      'task_visible_restore',
      'term_visible_restore',
    );
  });

  it('keeps an already connected live terminal session alive when the tab becomes hidden', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_hidden_live',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-hidden-live',
    });
    const taskApi = {
      createTerminalSession,
      getTerminalSession: vi.fn(),
    } as never;
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_live"
        taskTitle="terminal-hidden-live"
        taskApi={taskApi}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });
    await waitFor(() => {
      expect(
        window.sessionStorage.getItem(
          'agentsmith-terminal-session:ws_default:proj_1:task_hidden_live',
        ),
      ).toBe('term_hidden_live');
    });

    rerender(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_live"
        taskTitle="terminal-hidden-live"
        taskApi={taskApi}
        onOpenChange={onOpenChange}
      />,
    );

    expect(screen.getByTestId('agent-tasks__task-terminal')).toBeInTheDocument();
    expect(socket?.close).not.toHaveBeenCalled();
    expect(terminalDisposeMock).not.toHaveBeenCalled();
    const hiddenTerminal = screen.getByTestId('agent-tasks__task-terminal');
    expect(hiddenTerminal).toHaveAttribute(
      'data-visible',
      'false',
    );
    expect(hiddenTerminal).toHaveClass(
      'pointer-events-none',
      'absolute',
      'h-0',
      'w-0',
      'overflow-hidden',
    );
    expect(hiddenTerminal).not.toHaveAttribute('hidden');
  });

  it('retries a disconnected session when a previously hidden terminal is reopened', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_hidden_reopen',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-hidden-reopen',
    });
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_hidden_reopen',
      status: 'disconnected',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:02Z',
      ws_url: 'ws://example.test/terminal-hidden-reopen-recovered',
    });
    const taskApi = {
      createTerminalSession,
      getTerminalSession,
    } as never;
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_reopen"
        taskTitle="terminal-hidden-reopen"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const firstSocket = MockWebSocket.instances[0];
    act(() => {
      firstSocket?.open();
      firstSocket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    await waitFor(() => {
      expect(
        window.sessionStorage.getItem(
          'agentsmith-terminal-session:ws_default:proj_1:task_hidden_reopen',
        ),
      ).toBe('term_hidden_reopen');
    });

    rerender(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_reopen"
        taskTitle="terminal-hidden-reopen"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    act(() => {
      firstSocket?.onclose?.({ reason: '' });
    });

    expect(MockWebSocket.instances).toHaveLength(1);

    rerender(
      <TaskTerminalPanel
        open
        visible
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_reopen"
        taskTitle="terminal-hidden-reopen"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(getTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_hidden_reopen',
        'term_hidden_reopen',
      );
      expect(MockWebSocket.instances).toHaveLength(2);
    });
    expect(MockWebSocket.instances[1]?.url).toBe(
      'ws://example.test/terminal-hidden-reopen-recovered',
    );
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
  });

  it('retries the same stored session when a hidden terminal hits websocket onerror before onclose and is then reopened', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_hidden_transport_recovery',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-hidden-transport-recovery',
    });
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_hidden_transport_recovery',
      status: 'disconnected',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:02Z',
      ws_url: 'ws://example.test/terminal-hidden-transport-recovery-restored',
    });
    const taskApi = {
      createTerminalSession,
      getTerminalSession,
    } as never;
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_transport_recovery"
        taskTitle="terminal-hidden-transport-recovery"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const firstSocket = MockWebSocket.instances[0];
    act(() => {
      firstSocket?.open();
      firstSocket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    await waitFor(() => {
      expect(
        window.sessionStorage.getItem(
          'agentsmith-terminal-session:ws_default:proj_1:task_hidden_transport_recovery',
        ),
      ).toBe('term_hidden_transport_recovery');
    });

    rerender(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_transport_recovery"
        taskTitle="terminal-hidden-transport-recovery"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    act(() => {
      firstSocket?.onerror?.();
      firstSocket?.onclose?.({ reason: '' });
    });

    expect(MockWebSocket.instances).toHaveLength(1);

    rerender(
      <TaskTerminalPanel
        open
        visible
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_transport_recovery"
        taskTitle="terminal-hidden-transport-recovery"
        taskApi={taskApi}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(getTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_hidden_transport_recovery',
        'term_hidden_transport_recovery',
      );
      expect(MockWebSocket.instances).toHaveLength(2);
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent('Recovering');
    });
    expect(MockWebSocket.instances[1]?.url).toBe(
      'ws://example.test/terminal-hidden-transport-recovery-restored',
    );
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
  });

  it('does not create a replacement session when a hidden recovered tab becomes visible and its stored session lookup misses, and instead reconciles closed state', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_hidden_replacement',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-hidden-replacement',
    });
    const getTerminalSession = vi
      .fn()
      .mockRejectedValue(new Error('task_terminal_session_missing'));
    const closeTerminalSession = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_hidden_lookup_miss:terminal-session-2',
      'term_hidden_missing',
    );
    const { rerender } = render(
      <TaskTerminalPanel
        open
        visible={false}
        tabId="terminal-session-2"
        sessionStorageScope="terminal-session-2"
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_lookup_miss"
        taskTitle="terminal-hidden-lookup-miss"
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
        onOpenChange={onOpenChange}
      />,
    );

    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(getTerminalSession).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);

    rerender(
      <TaskTerminalPanel
        open
        visible
        tabId="terminal-session-2"
        sessionStorageScope="terminal-session-2"
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_lookup_miss"
        taskTitle="terminal-hidden-lookup-miss"
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => {
      expect(getTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_hidden_lookup_miss',
        'term_hidden_missing',
      );
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(closeTerminalSession).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(
      window.sessionStorage.getItem(
        'agentsmith-terminal-session:ws_default:proj_1:task_hidden_lookup_miss:terminal-session-2',
      ),
    ).toBeNull();
    expect(screen.getByTestId('agent-tasks__task-terminal-terminal-session-2')).toHaveTextContent('Closed');
  });

  it('does not steal focus when an existing session reconnects on initial mount', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_mount',
      'term_mount_existing',
    );
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_mount_existing',
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
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    await Promise.resolve();
    expect(terminalWritelnMock).not.toHaveBeenCalledWith('Terminal ready for terminal-mount\r\n');
    expect(terminalFocusMock).not.toHaveBeenCalled();
  });

  it('does not steal focus from editable controls when a pending terminal focus request completes', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_focus_guard',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-focus-guard',
    });

    const { rerender } = render(
      <>
        <input aria-label="Chat draft" />
        <TaskTerminalPanel
          open={false}
          workspaceId="ws_default"
          projectId="proj_1"
          taskId="task_focus_guard"
          taskTitle="terminal-focus-guard"
          taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
          onOpenChange={vi.fn()}
          focusRequestToken={0}
        />
      </>,
    );

    const input = screen.getByLabelText('Chat draft');
    act(() => {
      input.focus();
    });

    rerender(
      <>
        <input aria-label="Chat draft" />
        <TaskTerminalPanel
          open
          workspaceId="ws_default"
          projectId="proj_1"
          taskId="task_focus_guard"
          taskTitle="terminal-focus-guard"
          taskApi={{ createTerminalSession, getTerminalSession: vi.fn() } as never}
          onOpenChange={vi.fn()}
          focusRequestToken={1}
        />
      </>,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];

    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.replay_end',
          terminal_session_id: 'term_focus_guard',
          input_enabled: true,
        }),
      });
    });

    await Promise.resolve();
    expect(terminalFocusMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);

    act(() => {
      input.blur();
      socket?.onmessage?.({
        data: JSON.stringify({
          type: 'terminal.state',
          terminal_session_id: 'term_focus_guard',
          state: 'ready',
          input_enabled: true,
        }),
      });
    });

    await Promise.resolve();
    expect(terminalFocusMock).not.toHaveBeenCalled();
  });

  it('can close an existing hidden terminal session without rendering the panel again', async () => {
    const onOpenChange = vi.fn();
    const createTerminalSession = vi.fn();
    const getTerminalSession = vi.fn();
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
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={0}
      />,
    );

    expect(screen.queryByTestId('agent-tasks__task-terminal')).not.toBeInTheDocument();
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(getTerminalSession).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);

    rerender(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden"
        taskTitle="terminal-hidden"
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
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

  it('does not reconnect or bootstrap a stored terminal session on an initially hidden mount', async () => {
    const createTerminalSession = vi.fn();
    const getTerminalSession = vi.fn();
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_hidden_initial',
      'term_hidden_initial',
    );

    render(
      <TaskTerminalPanel
        open
        visible={false}
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_hidden_initial"
        taskTitle="terminal-hidden-initial"
        taskApi={{ createTerminalSession, getTerminalSession } as never}
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('agent-tasks__task-terminal')).not.toBeInTheDocument();
    });
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(getTerminalSession).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('waits for a stored reconnectable session to expose ws_url instead of creating a replacement session', async () => {
    let scheduledReconnect: (() => void) | null = null;
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const setTimeoutSpy = vi
      .spyOn(window, 'setTimeout')
      .mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
        if (delay === 1000 && typeof callback === 'function') {
          scheduledReconnect = () => {
            callback(...args);
          };
          return 1 as unknown as number;
        }
        return originalSetTimeout(callback, delay, ...args);
      }) as typeof window.setTimeout);
    const clearTimeoutSpy = vi
      .spyOn(window, 'clearTimeout')
      .mockImplementation(((handle?: number) => {
        if (handle === 1) {
          return;
        }
        return originalClearTimeout(handle);
      }) as typeof window.clearTimeout);

    try {
      window.sessionStorage.setItem(
        'agentsmith-terminal-session:ws_default:proj_1:task_wait_for_ws_url',
        'term_wait_for_ws_url',
      );
      const getTerminalSession = vi
        .fn()
        .mockResolvedValueOnce({
          terminal_session_id: 'term_wait_for_ws_url',
          status: 'disconnected',
          cols: 80,
          rows: 24,
          created_at: '2026-04-02T00:00:00Z',
          last_activity_at: '2026-04-02T00:00:01Z',
          ws_url: null,
        })
        .mockResolvedValueOnce({
          terminal_session_id: 'term_wait_for_ws_url',
          status: 'disconnected',
          cols: 80,
          rows: 24,
          created_at: '2026-04-02T00:00:00Z',
          last_activity_at: '2026-04-02T00:00:02Z',
          ws_url: 'ws://example.test/terminal-wait-for-ws-url',
        });
      const createTerminalSession = vi.fn();

      render(
        <TaskTerminalPanel
          open
          workspaceId="ws_default"
          projectId="proj_1"
          taskId="task_wait_for_ws_url"
          taskTitle="terminal-wait-for-ws-url"
          taskApi={{ createTerminalSession, getTerminalSession } as never}
          onOpenChange={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(getTerminalSession).toHaveBeenCalledTimes(1);
      });
      expect(createTerminalSession).not.toHaveBeenCalled();
      expect(MockWebSocket.instances).toHaveLength(0);
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent('Recovering');
      expect(scheduledReconnect).toBeTypeOf('function');

      await act(async () => {
        scheduledReconnect?.();
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(getTerminalSession).toHaveBeenCalledTimes(2);
        expect(MockWebSocket.instances).toHaveLength(1);
      });
      expect(MockWebSocket.instances[0]?.url).toBe(
        'ws://example.test/terminal-wait-for-ws-url',
      );
      expect(createTerminalSession).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it('treats a stored session lookup miss as stale and does not create a replacement session', async () => {
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_lookup_miss_default',
      'term_lookup_miss_default',
    );
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_lookup_miss_replacement',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-lookup-miss-replacement',
    });
    const getTerminalSession = vi
      .fn()
      .mockRejectedValue(new Error('task_terminal_session_missing'));
    const onOpenChange = vi.fn();

    render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_lookup_miss_default"
        taskTitle="terminal-lookup-miss-default"
        taskApi={{ createTerminalSession, getTerminalSession } as never}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => {
      expect(getTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_lookup_miss_default',
        'term_lookup_miss_default',
      );
    });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(
      window.sessionStorage.getItem(
        'agentsmith-terminal-session:ws_default:proj_1:task_lookup_miss_default',
      ),
    ).toBeNull();
  });

  it('deduplicates the first terminal session create flow across StrictMode effect re-entry', async () => {
    let resolveCreate: ((value: {
      terminal_session_id: string;
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
        terminal_session_id: 'term_strict_dedupe',
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
      terminal_session_id: 'term_remount',
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
      terminal_session_id: string;
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

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    act(() => {
      resolveCreate?.({
        terminal_session_id: 'term_pending_close',
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
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(
      window.sessionStorage.getItem('agentsmith-terminal-session:ws_default:proj_1:task_pending_close'),
    ).toBeNull();
  });

  it('keeps a stored terminal session recoverable when REST close fails', async () => {
    const createTerminalSession = vi.fn();
    const getTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_stored_close_failure',
      status: 'active',
      cols: 80,
      rows: 24,
      created_at: '2026-04-02T00:00:00Z',
      last_activity_at: '2026-04-02T00:00:01Z',
      ws_url: 'ws://example.test/terminal-stored-close-failure',
    });
    const closeTerminalSession = vi.fn().mockRejectedValue(new Error('close rejected'));
    const onOpenChange = vi.fn();
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_stored_close_failure',
      'term_stored_close_failure',
    );
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stored_close_failure"
        taskTitle="terminal-stored-close-failure"
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={0}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_stored_close_failure"
        taskTitle="terminal-stored-close-failure"
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={1}
      />,
    );

    await waitFor(() => {
      expect(closeTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_stored_close_failure',
        'term_stored_close_failure',
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent('Failed');
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
        'Terminal unavailable: close rejected',
      );
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        'agentsmith-terminal-session:ws_default:proj_1:task_stored_close_failure',
      ),
    ).toBe('term_stored_close_failure');
  });

  it('keeps a pending terminal session recoverable when REST close fails after it resolves', async () => {
    let resolveCreate: ((value: {
      terminal_session_id: string;
      status: 'pending';
      ws_url: string;
    }) => void) | null = null;
    const createTerminalSession = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    const closeTerminalSession = vi.fn().mockRejectedValue(new Error('pending close rejected'));
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_pending_close_failure"
        taskTitle="terminal-pending-close-failure"
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
        taskId="task_pending_close_failure"
        taskTitle="terminal-pending-close-failure"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={1}
      />,
    );

    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    act(() => {
      resolveCreate?.({
        terminal_session_id: 'term_pending_close_failure',
        status: 'pending',
        ws_url: 'ws://example.test/terminal-pending-close-failure',
      });
    });

    await waitFor(() => {
      expect(closeTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_pending_close_failure',
        'term_pending_close_failure',
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId('agent-tasks__task-terminal')).toHaveTextContent(
        'Terminal unavailable: pending close rejected',
      );
    });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(
      window.sessionStorage.getItem(
        'agentsmith-terminal-session:ws_default:proj_1:task_pending_close_failure',
      ),
    ).toBe('term_pending_close_failure');
  });

  it('uses REST close for an active close request instead of treating websocket close as authoritative', async () => {
    const createTerminalSession = vi.fn().mockResolvedValue({
      terminal_session_id: 'term_active_rest_close',
      status: 'pending',
      ws_url: 'ws://example.test/terminal-active-rest-close',
    });
    const closeTerminalSession = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_active_rest_close"
        taskTitle="terminal-active-rest-close"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={0}
      />,
    );

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket?.open();
      socket?.onmessage?.({
        data: JSON.stringify({ type: 'terminal.state', state: 'ready', input_enabled: true }),
      });
    });

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_active_rest_close"
        taskTitle="terminal-active-rest-close"
        taskApi={{ createTerminalSession, getTerminalSession: vi.fn(), closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={1}
      />,
    );

    await waitFor(() => {
      expect(closeTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_active_rest_close',
        'term_active_rest_close',
      );
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
    expect(socket?.send).not.toHaveBeenCalledWith(JSON.stringify({ type: 'terminal.close' }));
    expect(
      window.sessionStorage.getItem(
        'agentsmith-terminal-session:ws_default:proj_1:task_active_rest_close',
      ),
    ).toBeNull();
  });

  it('closes the backend session when closeRequestToken lands during a pending stored-session resolution that is still awaiting reconnect', async () => {
    let resolveStoredLookup: ((value: {
      terminal_session_id: string;
      status: 'disconnected';
      cols: number;
      rows: number;
      created_at: string;
      last_activity_at: string;
        ws_url: null;
    }) => void) | null = null;
    const createTerminalSession = vi.fn();
    const getTerminalSession = vi.fn().mockImplementation(
      () => new Promise((resolve) => {
        resolveStoredLookup = resolve;
      }),
    );
    const closeTerminalSession = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    window.sessionStorage.setItem(
      'agentsmith-terminal-session:ws_default:proj_1:task_pending_reconnect_close',
      'term_pending_reconnect_close',
    );
    const { rerender } = render(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_pending_reconnect_close"
        taskTitle="terminal-pending-reconnect-close"
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={0}
      />,
    );

    await waitFor(() => {
      expect(getTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_pending_reconnect_close',
        'term_pending_reconnect_close',
      );
    });

    rerender(
      <TaskTerminalPanel
        open
        workspaceId="ws_default"
        projectId="proj_1"
        taskId="task_pending_reconnect_close"
        taskTitle="terminal-pending-reconnect-close"
        taskApi={{ createTerminalSession, getTerminalSession, closeTerminalSession } as never}
        onOpenChange={onOpenChange}
        closeRequestToken={1}
      />,
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    act(() => {
      resolveStoredLookup?.({
        terminal_session_id: 'term_pending_reconnect_close',
        status: 'disconnected',
        cols: 80,
        rows: 24,
        created_at: '2026-04-02T00:00:00Z',
        last_activity_at: '2026-04-02T00:00:01Z',
        ws_url: null,
      });
    });

    await waitFor(() => {
      expect(closeTerminalSession).toHaveBeenCalledWith(
        'ws_default',
        'proj_1',
        'task_pending_reconnect_close',
        'term_pending_reconnect_close',
      );
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(createTerminalSession).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(
        'agentsmith-terminal-session:ws_default:proj_1:task_pending_reconnect_close',
      ),
    ).toBeNull();
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('does not create duplicate sessions when parent inline callbacks rerender during the initial connect phase', async () => {
    let resolveCreate: ((value: {
      terminal_session_id: string;
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
        terminal_session_id: 'term_callback_churn',
        status: 'pending',
        ws_url: 'ws://example.test/terminal-callback-churn',
      });
    });

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    expect(createTerminalSession).toHaveBeenCalledTimes(1);
  });

});
