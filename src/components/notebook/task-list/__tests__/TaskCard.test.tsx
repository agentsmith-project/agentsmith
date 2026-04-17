import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../TaskCard';

describe('TaskCard', () => {
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  const task = {
    id: 'task_1',
    title: 'Alpha Task',
    agent_presence: 'online' as const,
    run_state: 'running' as const,
    agent_name: 'Research Agent',
    last_activity_at: '2026-03-19T01:00:00.000Z',
    created_at: '2026-03-19T00:00:00.000Z',
    attached_inputs: [],
    stats: {
      user_turn_count: 2,
      artifact_count: 1,
      attached_input_count: 0,
    },
  };
  const t = (key: string, values?: Record<string, string | number>) => {
    if (key === 'last_activity') return 'Last activity';
    if (key === 'created_at') return 'Created';
    if (key === 'run_running') return 'Running';
    if (key === 'agent_online') return 'Online';
    if (key === 'turns') return `Turns ${values?.count ?? ''}`;
    if (key === 'artifacts') return `Artifacts ${values?.count ?? ''}`;
    if (key === 'inputs') return `Inputs ${values?.count ?? ''}`;
    return key;
  };

  beforeEach(() => {
    document.documentElement.lang = 'en-US';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T01:05:00.000Z'));
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function resolvedOptions(this: Intl.DateTimeFormat) {
      return {
        ...originalResolvedOptions.call(this),
        timeZone: 'America/Los_Angeles',
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders viewer-local task timestamps with machine-readable datetime metadata', () => {
    render(<TaskCard t={t} task={task} onClick={vi.fn()} />);

    const lastActivity = screen.getByTestId('notebook__task-last-activity');
    const createdAt = screen.getByTestId('notebook__task-created-at');

    expect(lastActivity).toHaveAttribute('dateTime', task.last_activity_at);
    expect(lastActivity).toHaveAttribute('data-visual-datetime-policy', 'viewer_local');
    expect(lastActivity).toHaveAttribute('title', 'Mar 18, 2026, 06:00 PM PDT');
    expect(lastActivity).toHaveTextContent('5m ago');

    expect(createdAt).toHaveAttribute('dateTime', task.created_at);
    expect(createdAt).toHaveAttribute('data-visual-datetime-policy', 'viewer_local');
    expect(createdAt).toHaveTextContent('Mar 18, 2026, 05:00 PM PDT');
  });
});
