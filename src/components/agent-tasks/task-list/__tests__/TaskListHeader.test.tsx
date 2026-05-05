import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskListHeader } from '@/components/agent-tasks/task-list/TaskListHeader';

describe('TaskListHeader', () => {
  const t = (key: string) => {
    const dict: Record<string, string> = {
      title: 'Tasks',
      description: 'A calm list of agent work',
      new_task: 'New Task',
    };
    return dict[key] ?? key;
  };

  it('uses a quiet section shell instead of a boxed card', () => {
    render(<TaskListHeader canCreateTask t={t} onCreate={vi.fn()} />);

    const shell = screen.getByTestId('agent-tasks__task-list-header');

    expect(shell.className).toContain('border-b');
    expect(shell.className).not.toMatch(/rounded-|shadow-/);
    expect(screen.getByTestId('agent-tasks__create-task-btn')).toHaveTextContent('New Task');
  });

  it('keeps the list header compact instead of presenting a second page-level description block', () => {
    render(<TaskListHeader canCreateTask t={t} onCreate={vi.fn()} />);

    expect(screen.queryByText('A calm list of agent work')).not.toBeInTheDocument();
  });

  it('marks the create-task button as the page primary action so visual gates can require first-viewport discoverability', () => {
    render(<TaskListHeader canCreateTask t={t} onCreate={vi.fn()} />);

    const createTaskButton = screen.getByTestId('agent-tasks__create-task-btn');

    expect(createTaskButton).toHaveAttribute('data-visual-prominence', 'primary');
    expect(createTaskButton).toHaveAttribute('data-visual-primary-action', 'true');
    expect(createTaskButton).toHaveAttribute('data-visual-viewport-required', 'true');
  });
});
