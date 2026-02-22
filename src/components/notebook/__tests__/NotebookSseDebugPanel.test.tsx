import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotebookSseDebugPanel } from '../NotebookSseDebugPanel';

vi.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const dict: Record<string, string> = {
      'notebook.conversation.sse_debug_title': 'SSE Debug (latest 5)',
    };
    const scoped = namespace ? `${namespace}.${key}` : key;
    return dict[scoped] ?? scoped;
  },
}));

describe('NotebookSseDebugPanel', () => {
  it('renders nothing when no events', () => {
    const { container } = render(<NotebookSseDebugPanel events={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders latest events summary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T06:42:40.000Z'));

    render(
      <NotebookSseDebugPanel
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

    expect(screen.getByTestId('notebook__sse-debug-panel')).toBeInTheDocument();
    expect(screen.getByText('SSE Debug (latest 5)')).toBeInTheDocument();
    expect(screen.getByText(/message type=message/)).toBeInTheDocument();
    expect(screen.getByText(/open sse_open/)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
