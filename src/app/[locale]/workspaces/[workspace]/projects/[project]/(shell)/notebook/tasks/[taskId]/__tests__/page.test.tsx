import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCanAccessNotebook, useCanUseNotebookTerminal } from '@/lib/hooks/use-permissions';

vi.mock('@/components/notebook/TaskPage', () => ({
  TaskPage: ({
    workspaceId,
    projectId,
    taskId,
    canCreateTask,
    canUpdateTask,
    canDeleteTask,
    canUseTerminal,
  }: {
    workspaceId: string;
    projectId: string;
    taskId: string;
    canCreateTask: boolean;
    canUpdateTask: boolean;
    canDeleteTask: boolean;
    canUseTerminal?: boolean;
  }) => (
    <div data-testid="notebook__task-detail-route">
      {workspaceId}:{projectId}:{taskId}:{String(canCreateTask)}:{String(canUpdateTask)}:{String(canDeleteTask)}:{String(canUseTerminal)}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanAccessNotebook: vi.fn(() => true),
  useCanUseNotebookTerminal: vi.fn(() => true),
}));

import NotebookTaskDetailPage from '../page';

const mockUseCanAccessNotebook = vi.mocked(useCanAccessNotebook);
const mockUseCanUseNotebookTerminal = vi.mocked(useCanUseNotebookTerminal);

describe('NotebookTaskDetailPage route', () => {
  it('renders task page with validated params', async () => {
    mockUseCanAccessNotebook.mockReturnValue(true);
    mockUseCanUseNotebookTerminal.mockReturnValue(true);
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
    expect(screen.getByText('ws_1:proj_1:task_1:true:true:true:true')).toBeInTheDocument();
    expect(screen.queryByTestId('notebook-task__open-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notebook-task__open-chat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('notebook-task__open-files')).not.toBeInTheDocument();
  });

  it('shows recovery actions for unsafe taskId', async () => {
    mockUseCanAccessNotebook.mockReturnValue(true);
    mockUseCanUseNotebookTerminal.mockReturnValue(true);
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
    expect(screen.getByTestId('notebook-task__open-list')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/notebook');
    expect(screen.getByTestId('notebook-task__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
    expect(screen.getByTestId('notebook-task__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
  });

  it('shows recovery actions when user lacks notebook access', async () => {
    mockUseCanAccessNotebook.mockReturnValue(false);
    mockUseCanUseNotebookTerminal.mockReturnValue(false);
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
    expect(screen.getByTestId('notebook-task__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
    expect(screen.getByTestId('notebook-task__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
    expect(screen.getByTestId('notebook-task__open-chat')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/chat');
  });

  it('keeps notebook access but disables terminal when user lacks terminal permission', async () => {
    mockUseCanAccessNotebook.mockReturnValue(true);
    mockUseCanUseNotebookTerminal.mockReturnValue(false);
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
    expect(screen.getByText('ws_1:proj_1:task_1:true:true:true:false')).toBeInTheDocument();
  });
});
