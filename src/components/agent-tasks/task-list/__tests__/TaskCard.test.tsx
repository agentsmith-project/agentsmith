import { render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCard } from '../TaskCard';

type TaskCardTask = ComponentProps<typeof TaskCard>['task'];

describe('TaskCard', () => {
  const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  const task = {
    id: 'task_1',
    title: 'Alpha Task',
    run_state: 'running' as const,
    active_run: {
      id: 'run_1',
      status: 'running',
      runner_id: 'runner_research',
    },
    last_activity_at: '2026-03-19T01:00:00.000Z',
    created_at: '2026-03-19T00:00:00.000Z',
    attached_inputs: [],
    stats: {
      user_turn_count: 2,
      artifact_count: 1,
      attached_input_count: 0,
    },
  } satisfies TaskCardTask;
  const t = (key: string, values?: Record<string, string | number>) => {
    if (key === 'last_activity') return 'Last activity';
    if (key === 'created_at') return 'Created';
    if (key === 'run_running') return 'Running';
    if (key === 'runner_test_badge') return 'runner_test';
    if (key === 'runner_test_source_value') return 'Developer runner test';
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

    const cardSurface = screen.getByTestId(`agent-tasks__task-card--${task.id}`);
    expect(within(cardSurface).queryByText('runner_research')).not.toBeInTheDocument();
    const lastActivity = within(cardSurface).getByTestId('agent-tasks__task-last-activity');
    const createdAt = within(cardSurface).getByTestId('agent-tasks__task-created-at');

    expect(lastActivity).toHaveAttribute('dateTime', task.last_activity_at);
    expect(lastActivity).toHaveAttribute('data-visual-datetime-policy', 'viewer_local');
    expect(lastActivity).toHaveAttribute('title', 'Mar 18, 2026, 06:00 PM PDT');
    expect(lastActivity).toHaveTextContent('5m ago');

    expect(createdAt).toHaveAttribute('dateTime', task.created_at);
    expect(createdAt).toHaveAttribute('data-visual-datetime-policy', 'viewer_local');
    expect(createdAt).toHaveTextContent('Mar 18, 2026, 05:00 PM PDT');
    expect(screen.queryByTestId(`agent-tasks__task-last-activity--${task.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`agent-tasks__task-created-at--${task.id}`)).not.toBeInTheDocument();
  });

  it('does not display legacy task agent or top-level runner fallback fields', () => {
    const legacyFieldTask = {
      id: task.id,
      title: task.title,
      run_state: task.run_state,
      last_activity_at: task.last_activity_at,
      created_at: task.created_at,
      attached_inputs: task.attached_inputs,
      stats: task.stats,
      agent_name: 'Legacy Agent Name',
      runner_name: 'Top-level Runner Name',
    } satisfies TaskCardTask & {
      agent_name: string;
      runner_name: string;
    };

    render(<TaskCard
      t={t}
      task={legacyFieldTask}
      onClick={vi.fn()}
    />);

    const cardSurface = screen.getByTestId(`agent-tasks__task-card--${task.id}`);
    expect(within(cardSurface).queryByText(/Legacy Agent Name/)).not.toBeInTheDocument();
    expect(within(cardSurface).queryByText(/Top-level Runner Name/)).not.toBeInTheDocument();
  });

  it('surfaces runner_test tasks in the ordinary task list', () => {
    const runnerTestTask = {
      ...task,
      id: 'task_runner_test_1',
      title: 'Developer runner test task',
      source: 'runner_test',
      runner_test: true,
      active_run: {
        id: 'run_runner_test_1',
        status: 'running',
        runner_id: 'ag_2',
        source: 'runner_test',
        runner_test: true,
      },
    } satisfies TaskCardTask;

    render(<TaskCard
      t={t}
      task={runnerTestTask}
      onClick={vi.fn()}
    />);

    const cardSurface = screen.getByTestId('agent-tasks__task-card--task_runner_test_1');
    const badge = within(cardSurface).getByTestId('agent-tasks__runner-test-badge');
    expect(badge).toHaveTextContent('runner_test');
    expect(badge).toHaveAttribute('title', 'Developer runner test');
  });
});
