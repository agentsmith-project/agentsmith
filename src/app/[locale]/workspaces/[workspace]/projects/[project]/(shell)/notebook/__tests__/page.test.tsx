import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useHasPermission } from '@/lib/hooks/use-permissions';

vi.mock('@/components/notebook/TaskList', () => ({
  TaskList: ({ workspaceId, projectId, canCreateTask }: { workspaceId: string; projectId: string; canCreateTask: boolean }) => (
    <div data-testid="notebook__task-list-route">
      {workspaceId}:{projectId}:{String(canCreateTask)}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn((permission: string) => permission === 'project:notebook:access'),
}));

import NotebookPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

describe('NotebookPage route', () => {
  it('renders task list when params and permission are valid', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <NotebookPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('notebook__task-list-route')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:true')).toBeInTheDocument();
    expect(screen.getByTestId('notebook__open-chat')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/chat');
    expect(screen.getByTestId('notebook__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
    expect(screen.getByTestId('notebook__open-agents')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/agents');
  });

  it('shows invalid parameter error for unsafe workspace/project', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <NotebookPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
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
      <NotebookPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
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
