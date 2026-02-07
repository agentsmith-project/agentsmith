import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useHasPermission } from '@/lib/hooks/use-permissions';

const mockUpdate = vi.fn().mockResolvedValue({});
const mockList = vi.fn().mockResolvedValue({
  items: [
    {
      id: 'ep_1',
      project_id: 'prj_1',
      name: 'OpenAI Main',
      description: 'Primary endpoint',
      openai_model: 'gpt-4o',
      type: 'openai',
      base_url: 'https://api.openai.com/v1',
      status: 'active',
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    },
  ],
  total: 1,
  page: 1,
  page_size: 20,
  has_more: false,
});

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  EndpointAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      update: mockUpdate,
      delete: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@/components/endpoints/CreateEndpointDialog', () => ({
  CreateEndpointDialog: () => null,
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasPermission: vi.fn(() => true),
}));

import EndpointsPage from '../page';

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

describe('EndpointsPage', () => {
  it('renders header and toolbar layout', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <EndpointsPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-layout__header')).toBeInTheDocument();
    });

    const header = screen.getByTestId('page-layout__header');
    expect(within(header).getByRole('heading', { level: 1, name: 'title' })).toBeInTheDocument();
    const toolbar = screen.getByTestId('page-layout__toolbar');
    expect(within(toolbar).getByTestId('endpoints__create-btn')).toBeInTheDocument();
  });

  it('toggles endpoint status', async () => {
    mockUseHasPermission.mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <EndpointsPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => expect(screen.getByText('OpenAI Main')).toBeInTheDocument());

    const disableButton = screen.getByRole('button', { name: 'action_disable' });
    await user.click(disableButton);

    expect(mockUpdate).toHaveBeenCalledWith('ws_1', 'prj_1', 'ep_1', { status: 'disabled' });
  });

  it('shows invalid parameter error state for unsafe route params', async () => {
    mockUseHasPermission.mockReturnValue(true);
    render(
      <EndpointsPage params={Promise.resolve({ workspace: '<script>', project: 'prj_1', locale: 'en-US' })} />,
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
      <EndpointsPage params={Promise.resolve({ workspace: 'ws_1', project: 'prj_1', locale: 'en-US' })} />,
      { wrapper: createWrapper() }
    );

    await waitFor(() => {
      expect(screen.getByTestId('page-state__error')).toBeInTheDocument();
    });

    expect(screen.getByText('permission_denied_title')).toBeInTheDocument();
  });
});
