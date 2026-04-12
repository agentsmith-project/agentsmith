import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskListHeader } from '@/components/notebook/task-list/TaskListHeader';

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

    const shell = screen.getByTestId('notebook__task-list-header');

    expect(shell.className).toContain('border-b');
    expect(shell.className).not.toMatch(/rounded-|shadow-/);
    expect(screen.getByTestId('notebook__create-task-btn')).toHaveTextContent('New Task');
  });
});
