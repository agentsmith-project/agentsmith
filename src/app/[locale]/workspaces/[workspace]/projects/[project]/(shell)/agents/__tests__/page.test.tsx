import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockList = vi.fn().mockResolvedValue({ items: [] });
const mockUpdate = vi.fn().mockResolvedValue({});
const mockDiagnostics = vi.fn().mockResolvedValue(null);

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  AgentAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      update: mockUpdate,
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

import AgentsPage from '../page';

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
});
