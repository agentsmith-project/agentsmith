import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHasPermission } from '@/lib/hooks/use-permissions';

const mockList = vi.fn().mockResolvedValue({ items: [] });
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDelete = vi.fn().mockResolvedValue({});
const mockDiagnostics = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  AgentAPI: vi.fn().mockImplementation(function () {
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

vi.mock('@/components/agents/CreateAgentDialog', () => ({
  CreateAgentDialog: () => null,
}));

vi.mock('@/components/agents/EditAgentDialog', () => ({
  EditAgentDialog: () => null,
}));

vi.mock('@/components/api-keys/AgentKeysDialog', () => ({
  AgentKeysDialog: () => null,
}));

vi.mock('@/components/agents/AgentDiagnosticsPanel', () => ({
  AgentDiagnosticsPanel: () => null,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

import AgentsPage from '../page';

const mockUseHasPermission = vi.mocked(useHasPermission);

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

describe('AgentsPage', () => {
  it('renders header and toolbar layout', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <AgentsPage
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
    expect(within(toolbar).getByTestId('agents__create-btn')).toBeInTheDocument();
  });

  it('opens delete confirmation and deletes an agent', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    mockList.mockResolvedValueOnce({
      items: [
        {
          id: 'agent_1',
          name: 'Agent One',
          description: '',
          mode: 'external',
          status: 'enabled',
          interaction_mode: 'both',
          owner_name: 'owner',
          admin_name: 'admin',
        },
      ],
    });

    render(
      <AgentsPage
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
      expect(mockDelete).toHaveBeenCalledWith('ws_1', 'proj_1', 'agent_1');
    });
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <AgentsPage
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
    mockUseHasPermission.mockReturnValue(false);
    render(
      <AgentsPage
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
});
