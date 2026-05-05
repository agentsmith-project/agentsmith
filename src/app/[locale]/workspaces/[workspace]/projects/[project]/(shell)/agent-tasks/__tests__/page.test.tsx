import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCanAccessAgentTasks } from '@/lib/hooks/use-permissions';

vi.mock('@/components/agent-tasks/TaskList', () => ({
  TaskList: ({ workspaceId, projectId, canCreateTask }: { workspaceId: string; projectId: string; canCreateTask: boolean }) => (
    <div data-testid="agent-tasks__task-list-route">{workspaceId}:{projectId}:{String(canCreateTask)}</div>
  ),
}));
vi.mock('@/lib/hooks/use-permissions', () => ({ useCanAccessAgentTasks: vi.fn(() => true) }));

import AgentTasksPage from '../page';

const mockUseCanAccessAgentTasks = vi.mocked(useCanAccessAgentTasks);

describe('AgentTasksPage route', () => {
  it('renders task list when params and permission are valid', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(true);
    render(<AgentTasksPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-tasks__task-list-route')).toBeInTheDocument();
    });
  });

  it('shows invalid parameter error for unsafe workspace/project', async () => {
    render(<AgentTasksPage params={Promise.resolve({ workspace: '<script>', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });

  it('shows permission denied when user lacks agent task access', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(false);
    render(<AgentTasksPage params={Promise.resolve({ workspace: 'ws_1', project: 'proj_1', locale: 'en' })} />);
    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });
  });
});
