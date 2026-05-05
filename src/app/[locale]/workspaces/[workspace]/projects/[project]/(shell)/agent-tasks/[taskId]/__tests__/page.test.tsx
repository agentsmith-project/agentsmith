import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanAccessAgentTasks, useCanUseAgentTaskTerminal } from '@/lib/hooks/use-permissions';
import { useProject } from '@/lib/hooks/use-projects-queries';

vi.mock('@/components/agent-tasks/TaskPage', () => ({
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
    <div data-testid="agent-task__detail-route">
      {workspaceId}:{projectId}:{taskId}:{String(canCreateTask)}:{String(canUpdateTask)}:{String(canDeleteTask)}:{String(canUseTerminal)}
    </div>
  ),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useCanAccessAgentTasks: vi.fn(() => true),
  useCanUseAgentTaskTerminal: vi.fn(() => true),
}));

vi.mock('@/lib/hooks/use-projects-queries', () => ({
  useProject: vi.fn(() => ({
    data: { permissions: ['project:agent_task:use', 'project:endpoint:use'] },
  })),
}));

import AgentTaskDetailPage from '../page';

const mockUseCanAccessAgentTasks = vi.mocked(useCanAccessAgentTasks);
const mockUseCanUseAgentTaskTerminal = vi.mocked(useCanUseAgentTaskTerminal);
const mockUseProject = vi.mocked(useProject);

describe('AgentTaskDetailPage route', () => {
  beforeEach(() => {
    mockUseProject.mockReturnValue({
      data: { permissions: ['project:agent_task:use', 'project:endpoint:use'] },
    } as unknown as ReturnType<typeof useProject>);
  });

  it('renders task page with validated params', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(true);
    mockUseCanUseAgentTaskTerminal.mockReturnValue(true);
    render(
      <AgentTaskDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          taskId: 'task_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-task__detail-route')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:task_1:true:true:true:true')).toBeInTheDocument();
    expect(screen.queryByTestId('project-workbench')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-task__open-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-task__open-chat')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-task__open-files')).not.toBeInTheDocument();
  });

  it('shows recovery actions for unsafe taskId', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(true);
    mockUseCanUseAgentTaskTerminal.mockReturnValue(true);
    render(
      <AgentTaskDetailPage
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
    expect(screen.getByTestId('agent-task__open-list')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/agent-tasks');
    expect(screen.getByTestId('agent-task__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
    expect(screen.getByTestId('agent-task__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
  });

  it('filters invalid-task recovery actions to reachable project surfaces', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(true);
    mockUseProject.mockReturnValue({
      data: { permissions: ['project:agent_task:use', 'project:endpoint:use'] },
    } as unknown as ReturnType<typeof useProject>);

    render(
      <AgentTaskDetailPage
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

    expect(screen.getByTestId('agent-task__open-list')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/agent-tasks');
    expect(screen.getByTestId('agent-task__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
    expect(screen.getByTestId('agent-task__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
  });

  it('shows recovery actions when user lacks agent task access', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(false);
    mockUseCanUseAgentTaskTerminal.mockReturnValue(false);
    render(
      <AgentTaskDetailPage
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
    expect(screen.getByTestId('agent-task__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
    expect(screen.getByTestId('agent-task__open-files')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/files');
    expect(screen.getByTestId('agent-task__open-chat')).toHaveAttribute('href', '/en/workspaces/ws_1/projects/proj_1/chat');
  });

  it('filters permission-denied recovery actions to reachable project surfaces', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(false);
    mockUseCanUseAgentTaskTerminal.mockReturnValue(false);
    mockUseProject.mockReturnValue({
      data: { permissions: [] },
    } as unknown as ReturnType<typeof useProject>);

    render(
      <AgentTaskDetailPage
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

    expect(screen.getByTestId('agent-task__back-to-workspace')).toHaveAttribute('href', '/en/workspaces/ws_1');
    expect(screen.queryByTestId('agent-task__open-files')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-task__open-chat')).not.toBeInTheDocument();
  });

  it('keeps agent task access but disables terminal when user lacks terminal permission', async () => {
    mockUseCanAccessAgentTasks.mockReturnValue(true);
    mockUseCanUseAgentTaskTerminal.mockReturnValue(false);
    render(
      <AgentTaskDetailPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          taskId: 'task_1',
          locale: 'en',
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('agent-task__detail-route')).toBeInTheDocument();
    });
    expect(screen.getByText('ws_1:proj_1:task_1:true:true:true:false')).toBeInTheDocument();
  });
});
