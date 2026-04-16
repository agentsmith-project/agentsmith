import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';

const mockUseParams = vi.fn(() => ({ workspace: 'ws_1', locale: 'en-US' }));
const mockGetFeishuIntegration = vi.fn();
const mockListConnections = vi.fn();
const mockGetProviderConfig = vi.fn();

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
    getProviderConfig = mockGetProviderConfig;
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
    mockUseParams.mockReturnValue({ workspace: 'ws_1', locale: 'en-US' });
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
    mockGetProviderConfig.mockResolvedValue({
      provider: 'feishu',
      interactive_login_required: true,
      refresh_supported: true,
      auth_configured: true,
      callback_uri: 'http://localhost/callback',
      auth_url: 'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
      scope_policy: 'full',
      requested_scopes: ['offline_access', 'search:docs:read', 'wiki:wiki', 'wiki:wiki:readonly', 'wiki:node:retrieve'],
      required_scopes: ['search:docs:read', 'wiki:wiki', 'wiki:wiki:readonly', 'wiki:node:retrieve'],
    });
  });

  it('renders Feishu card as disabled when workspace is not configured', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getAllByText('workspace_integrations_title').length).toBeGreaterThan(0);
    });

    expect(screen.getByTestId('workspace-connections__feishu-connect')).toBeDisabled();
    expect(screen.getByTestId('workspace-connections__feishu-connect')).not.toHaveClass('bg-foreground');
    expect(screen.getByTestId('workspace-connections__open-projects')).not.toHaveClass('bg-foreground');
    expect(screen.getByTestId('workspace-connections__open-projects')).toHaveAttribute(
      'href',
      '/en-US/workspaces/ws_1/projects',
    );
    expect(screen.getAllByText('workspace_feishu_disabled_description').length).toBeGreaterThan(0);
    expect(screen.getByTestId('workspace-connections__capability-note')).toHaveTextContent('workspace_connections_capability_note');
    expect(screen.getByTestId('workspace-connections__resolver-note')).toHaveTextContent('workspace_connections_resolver_note_title');
    expect(screen.getByTestId('workspace-connections__resolver-note')).toHaveTextContent('workspace_connections_resolver_note_body');
    expect(screen.getByTestId('workspace-connections__workspace-state')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-connections__personal-state')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-connections__next-step')).toBeInTheDocument();
  });


  it('shows recovery actions when the workspace id is invalid', () => {
    mockUseParams.mockReturnValue({ workspace: '', locale: 'en-US' });

    renderPage();

    expect(screen.getByText('feishu_invalid_workspace_title')).toBeInTheDocument();
    expect(screen.getByText('feishu_invalid_workspace_description')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'workspace_connections_back_to_workspaces' })).toHaveAttribute('href', '/en-US/workspaces');
  });

  it('keeps the workspace connections page in read-only mode for workspace readers', async () => {
    mockUseHasWorkspacePermission.mockImplementation((permission: string) => permission === 'workspace:read');

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-connections__read-only-hint')).toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'workspace_connections_open_personal_connections' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'workspace_connections_manage_feishu' })).not.toBeInTheDocument();
  });

  it('shows a retry action when the workspace integration cannot load', async () => {
    mockGetFeishuIntegration.mockRejectedValueOnce(new Error('boom'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'workspace_connections_load_failed_title' })).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'retry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'workspace_connections_back_to_workspaces' })).toHaveAttribute('href', '/en-US/workspaces');
  });

  it('shows a reauthorization warning when Feishu is missing required scopes', async () => {
    mockGetFeishuIntegration.mockResolvedValue({
      id: 'workspace_feishu:ws_1',
      workspace_id: 'ws_1',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      redirect_uri: 'http://localhost/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
      has_app_secret: true,
    });
    mockListConnections.mockResolvedValue([
      {
        id: 'uec_1',
        provider: 'feishu',
        workspace_id: 'ws_1',
        status: 'reauth_required',
        reauth_reason: 'missing_scopes',
        missing_scopes: ['search:docs:read', 'wiki:wiki'],
        last_error: 'feishu_missing_required_scopes:search:docs:read,wiki:wiki',
        account_identity: null,
        last_refreshed_at: null,
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('workspace_feishu_reauth_required_title')).toBeInTheDocument();
    });

    expect(screen.getByText(/workspace_feishu_missing_scopes_label: search:docs:read, wiki:wiki/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'refresh_connection' })).toBeDisabled();
  });

  it('keeps refresh available for generic refresh failures', async () => {
    mockGetFeishuIntegration.mockResolvedValue({
      id: 'workspace_feishu:ws_1',
      workspace_id: 'ws_1',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      redirect_uri: 'http://localhost/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
      has_app_secret: true,
    });
    mockListConnections.mockResolvedValue([
      {
        id: 'uec_2',
        provider: 'feishu',
        workspace_id: 'ws_1',
        status: 'reauth_required',
        reauth_reason: 'refresh_failed',
        missing_scopes: null,
        last_error: 'feishu_token_exchange_failed',
        account_identity: null,
        last_refreshed_at: null,
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('workspace_feishu_refresh_failed_title')).toBeInTheDocument();
    });

    expect(screen.queryByText('workspace_feishu_reauth_required_title')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'refresh_connection' })).not.toBeDisabled();
  });

  it('uses primary Feishu action only when an enabled workspace still needs a personal connection', async () => {
    mockGetFeishuIntegration.mockResolvedValue({
      id: 'workspace_feishu:ws_1',
      workspace_id: 'ws_1',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      redirect_uri: 'http://localhost/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
      has_app_secret: true,
    });
    mockListConnections.mockResolvedValue([]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-connections__feishu-connect')).toHaveClass('bg-foreground');
    });
    expect(screen.getByTestId('workspace-connections__open-projects')).not.toHaveClass('bg-foreground');
  });

  it('keeps reconnect secondary when Feishu is already connected', async () => {
    mockGetFeishuIntegration.mockResolvedValue({
      id: 'workspace_feishu:ws_1',
      workspace_id: 'ws_1',
      provider: 'feishu',
      status: 'enabled',
      app_id: 'app_123',
      redirect_uri: 'http://localhost/callback',
      verified_at: null,
      verified_by_user_id: null,
      verified_by_email: null,
      last_error: null,
      created_at: '2026-03-19T00:00:00.000Z',
      updated_at: '2026-03-19T00:00:00.000Z',
      has_app_secret: true,
    });
    mockListConnections.mockResolvedValue([
      {
        id: 'uec_connected',
        provider: 'feishu',
        workspace_id: 'ws_1',
        status: 'connected',
        reauth_reason: null,
        missing_scopes: null,
        last_error: null,
        account_identity: {
          external_email: 'visual.tester@example.com',
          external_name: 'Visual Tester',
        },
        last_refreshed_at: '2026-03-19T00:00:00.000Z',
      },
    ]);

    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('workspace-connections__feishu-connect')).toHaveTextContent('workspace_feishu_reconnect');
    });
    expect(screen.getByTestId('workspace-connections__last-refresh-value')).toHaveTextContent(
      'Mar 19, 2026, 12:00 AM UTC',
    );
    expect(screen.getByTestId('workspace-connections__last-refresh-value')).not.toHaveTextContent(
      '2026-03-19T00:00:00.000Z',
    );
    expect(screen.getByTestId('workspace-connections__feishu-connect')).not.toHaveClass('bg-foreground');
    expect(screen.getByTestId('workspace-connections__open-projects')).not.toHaveClass('bg-foreground');
  });
});
