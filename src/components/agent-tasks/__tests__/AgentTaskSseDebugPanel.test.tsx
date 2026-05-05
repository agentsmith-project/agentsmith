import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentTaskSseDebugPanel } from '../AgentTaskSseDebugPanel';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const dict: Record<string, string> = {
      'agent_tasks.conversation.sse_debug_title': 'SSE Debug (latest 5)',
    };
    const scoped = namespace ? `${namespace}.${key}` : key;
    return dict[scoped] ?? scoped;
  },
}));

describe('AgentTaskSseDebugPanel', () => {
  it('renders nothing when no events', () => {
    const { container } = render(<AgentTaskSseDebugPanel events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders latest events summary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T06:42:40.000Z'));

    render(
      <AgentTaskSseDebugPanel
        events={[
          {
            at: '2026-02-22T06:42:38.000Z',
            phase: 'message',
            summary: 'type=message',
          },
          {
            at: '2026-02-22T06:42:40.000Z',
            phase: 'open',
            summary: 'sse_open',
          },
        ]}
      />,
    );

    expect(screen.getByTestId('agent-tasks__sse-debug-panel')).toBeInTheDocument();
    expect(screen.getByText('SSE Debug (latest 5)')).toBeInTheDocument();
    expect(screen.getByText(/message type=message/)).toBeInTheDocument();
    expect(screen.getByText(/open sse_open/)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
