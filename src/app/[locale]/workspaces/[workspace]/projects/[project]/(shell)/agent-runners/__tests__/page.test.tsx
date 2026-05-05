import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as nextNavigation from 'next/navigation';
import { useAgentRunnerPageCapabilities } from '@/lib/hooks/use-permissions';

const mockList = vi.fn().mockResolvedValue({ items: [] });
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDelete = vi.fn().mockResolvedValue({});
const mockDiagnostics = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  AgentRunnerAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      update: mockUpdate,
      delete: mockDelete,
      getDiagnostics: mockDiagnostics,
    };
  }),
}));

vi.mock('@/components/ui/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/agent-runners/CreateAgentRunnerDialog', () => ({
  CreateAgentRunnerDialog: () => null,
}));

vi.mock('@/components/agent-runners/EditAgentRunnerDialog', () => ({
  EditAgentRunnerDialog: () => null,
}));

vi.mock('@/components/api-keys/AgentRunnerKeysDialog', () => ({
  AgentRunnerKeysDialog: () => null,
}));

vi.mock('@/components/agent-runners/AgentRunnerDiagnosticsPanel', () => ({
  AgentRunnerDiagnosticsPanel: () => null,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useAgentRunnerPageCapabilities: vi.fn(() => ({
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    canRunDiagnostics: true,
    canManage: true,
  })),
}));

import AgentRunnersPage from '../page';

const mockUseAgentRunnerPageCapabilities = vi.mocked(useAgentRunnerPageCapabilities);
const mockUseSearchParams = vi.spyOn(nextNavigation, 'useSearchParams');

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('AgentRunnersPage', () => {
  const mockReadonlySearchParams = (query = '') =>
    new URLSearchParams(query) as unknown as ReturnType<typeof nextNavigation.useSearchParams>;

  it('renders header and toolbar layout', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    const toolbar = screen.getByTestId('page-layout__toolbar');
    expect(within(toolbar).getByTestId('agent-runners__create-btn')).toBeInTheDocument();
    expect(toolbar).not.toHaveTextContent(/external|internal|chat|notebook/i);
  });

  it('opens delete confirmation and deletes an agent', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce({
      items: [
        {
          id: 'runner_1',
          name: 'Runner One',
          description: '',
          status: 'ready',
          owner_name: 'owner',
          admin_name: 'admin',
        },
      ],
    });

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    const deleteBtn = await screen.findByRole('button', { name: /delete/i });
    await user.click(deleteBtn);

    expect(screen.getByText(/delete_confirm_title/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: /delete_confirm_action/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('ws_1', 'proj_1', 'runner_1');
    });
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: '<script>',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('validation_error')).toBeInTheDocument();
  });

  it('shows permission denied when user lacks read access', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canRunDiagnostics: false,
      canManage: false,
    });
    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });

  it('opens runner diagnostics panel from query parameter context', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams('runner=runner_1'));
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce({
      items: [
        {
          id: 'runner_1',
          name: 'Runner One',
          description: 'Primary runner',
          status: 'ready',
          owner_name: 'owner',
          admin_name: 'admin',
        },
      ],
    });

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Runner One')).toBeInTheDocument();
    });

    expect(screen.getByText('Primary runner')).toBeInTheDocument();
  });

  it('renders owner/admin fallback ids when name fields are missing', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce({
      items: [
        {
          id: 'runner_2',
          name: 'Runner Two',
          description: '',
          status: 'ready',
          owner_id: 'user_owner_1',
          admin_id: 'user_admin_1',
        },
      ],
    });

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Runner Two')).toBeInTheDocument();
    });

    expect(screen.getByText('user_owner_1')).toBeInTheDocument();
    expect(screen.getByText(/admin: user_admin_1/i)).toBeInTheDocument();
  });

  it('does not render legacy workload or runtime columns', async () => {
    mockUseSearchParams.mockReturnValue(mockReadonlySearchParams());
    mockUseAgentRunnerPageCapabilities.mockReturnValue({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
      canRunDiagnostics: true,
      canManage: true,
    });
    mockList.mockResolvedValueOnce({
      items: [
        {
          id: 'runner_1',
          name: 'Managed Runner',
          description: 'Task runner',
          status: 'ready',
          default_endpoint_id: 'ep_1',
          diagnostics: { queue_depth: 0 },
          capabilities: { terminal: true, artifacts: true },
        },
      ],
    });

    render(
      <AgentRunnersPage
        params={Promise.resolve({
          workspace: 'ws_1',
          project: 'proj_1',
          locale: 'en',
        })}
      />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByText('Managed Runner')).toBeInTheDocument();
    });

    expect(screen.getByTestId('agent-runners__table')).not.toHaveTextContent(/chat|notebook|external|internal|docker|compose/i);
  });
});
