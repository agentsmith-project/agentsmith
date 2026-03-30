import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCanAccessNotebook } from '@/lib/hooks/use-permissions';

vi.mock('@/components/notebook/TaskList', () => ({
  TaskList: ({ workspaceId, projectId, canCreateTask }: { workspaceId: string; projectId: string; canCreateTask: boolean }) => (
    <div data-testid="notebook__task-list-route">{workspaceId}:{projectId}:{String(canCreateTask)}</div>
  ),
}));
vi.mock('@/lib/hooks/use-permissions', () => ({ useCanAccessNotebook: vi.fn(() => true) }));

import NotebookPage from '../page';

const mockUseCanAccessNotebook = vi.mocked(useCanAccessNotebook);

describe('NotebookPage route', () => {
  it('renders task list when params and permission are valid', async () => {
    mockUseCanAccessNotebook.mockReturnValue(true);
    render(<NotebookPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('notebook__task-list-route')).toBeInTheDocument();
    });
  });

  it('shows invalid parameter error for unsafe workspace/project', async () => {
    render(<NotebookPage params={Promise.resolve({ workspace: '<script>', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks notebook access', async () => {
    mockUseCanAccessNotebook.mockReturnValue(false);
    render(<NotebookPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });
});
