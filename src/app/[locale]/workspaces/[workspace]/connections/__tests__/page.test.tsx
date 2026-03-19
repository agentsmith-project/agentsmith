import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';

const mockUseParams = vi.fn(() => ({ workspace: 'ws_1', locale: 'en-US' }));
const mockGetFeishuIntegration = vi.fn();
const mockListConnections = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('@/lib/hooks/use-permissions', () => ({
  useHasWorkspacePermission: vi.fn(() => true),
}));

vi.mock('@/lib/hooks/use-workspaces', () => ({
  useWorkspace: () => ({ data: { id: 'ws_1', name: 'Corp Workspace' } }),
}));

vi.mock('@/components/app-shell/Topbar', () => ({
  Topbar: () => <div data-testid="topbar" />,
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({}),
  handleErrorForToast: vi.fn(),
  APIError: class APIError extends Error {},
  WorkspaceAPI: class {
    getFeishuIntegration = mockGetFeishuIntegration;
    startWorkspaceFeishuAuth = vi.fn();
  },
  UserExternalConnectionsAPI: class {
    list = mockListConnections;
    refresh = vi.fn();
  },
}));

import WorkspaceConnectionsPage from '../page';

const mockUseHasWorkspacePermission = vi.mocked(useHasWorkspacePermission);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceConnectionsPage />
    </QueryClientProvider>,
  );
}

describe('WorkspaceConnectionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => (
      permission === 'workspace:read' || permission === 'workspace:governance:update'
    ));
    mockGetFeishuIntegration.mockResolvedValue({
      id: 'workspace_feishu:ws_1',
      workspace_id: 'ws_1',
      provider: 'feishu',
      status: 'not_configured',
      app_id: '',
      redirect_uri: '',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
      has_app_secret: false,
    });
    mockListConnections.mockResolvedValue([]);
  });

  it('renders Feishu card as disabled when workspace is not configured', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('workspace_connections_title')).toBeInTheDocument();
    });

    expect(screen.getByTestId('workspace-connections__feishu-connect')).toBeDisabled();
    expect(screen.getByText('workspace_feishu_disabled_description')).toBeInTheDocument();
  });
});
