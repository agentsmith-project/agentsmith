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
      terminal_connecting: 'Connecting to runner...',
      terminal_status_idle: 'Idle',
      terminal_status_connecting: 'Connecting',
      terminal_status_active: 'Active',
      terminal_status_closed: 'Closed',
      terminal_status_failed: 'Failed',
      terminal_close: 'Close terminal',
      terminal_error_hint: `Terminal unavailable: ${values?.reason ?? ''}`,
      terminal_banner: `Terminal ready for ${values?.title ?? 'task'}`,
      terminal_closed: 'Terminal closed',
      terminal_failed: `Terminal failed: ${values?.reason ?? ''}`,
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
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.();
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
        taskApi={{ createTerminalSession } as never}
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
});
