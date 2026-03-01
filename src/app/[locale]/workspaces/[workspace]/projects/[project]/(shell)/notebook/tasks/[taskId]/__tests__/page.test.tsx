import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

vi.mock('@/components/notebook/TaskPage', () => ({
  TaskPage: ({
    workspaceId,
    projectId,
    taskId,
    canCreateTask,
    canUpdateTask,
    canDeleteTask,
  }: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    canCreateTask: boolean;
    canUpdateTask: boolean;
    canDeleteTask: boolean;
  }) => (
    <div data-testid="notebook__task-detail-route">
      {workspaceId}:{projectId}:{taskId}:{String(canCreateTask)}:{String(canUpdateTask)}:{String(canDeleteTask)}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn((permission: string) => permission === 'project:notebook:access'),
}));

import NotebookTaskDetailPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('NotebookTaskDetailPage route', () => {
  it('renders task page with validated params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <NotebookTaskDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          taskId: 'task_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('notebook__task-detail-route')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:task_1:true:true:true')).toBeInTheDocument();
    const header = screen.getByTestId('page-layout__header');
    expect(screen.getByTestId('notebook-task__open-list')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/notebook');
    expect(screen.getByTestId('notebook-task__open-chat')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/chat');
    expect(screen.getByTestId('notebook-task__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
    expect(header).toBeInTheDocument();
  });

  it('shows invalid parameter error for unsafe taskId', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <NotebookTaskDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          taskId: '<script>',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks notebook access', async () => {
    mockUseHasPermission.mockReturnValue(false);
    render(
      <NotebookTaskDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          taskId: 'task_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
