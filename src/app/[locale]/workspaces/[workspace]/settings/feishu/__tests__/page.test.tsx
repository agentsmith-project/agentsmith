import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHasWorkspacePermission } from '@/lib/hooks/use-permissions';

const mockUseParams = vi.fn(() => ({ workspace: 'ws_1', locale: 'en-US' }));
const mockUseSearchParams = vi.fn(() => new URLSearchParams());
const mockReplace = vi.fn();
const mockGetFeishuIntegration = vi.fn();
const mockUpdateFeishuIntegration = vi.fn();
const mockStartFeishuVerification = vi.fn();
const mockEnableFeishuIntegration = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => ({ replace: mockReplace }),
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
    updateFeishuIntegration = mockUpdateFeishuIntegration;
    startFeishuVerification = mockStartFeishuVerification;
    enableFeishuIntegration = mockEnableFeishuIntegration;
  },
}));

import WorkspaceFeishuSettingsPage from '../page';

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
      <WorkspaceFeishuSettingsPage />
    </QueryClientProvider>,
  );
}

describe('WorkspaceFeishuSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('step=credentials'));
    mockUseHasWorkspacePermission.mockReturnValue(true);
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
    mockUpdateFeishuIntegration.mockResolvedValue({});
    mockStartFeishuVerification.mockResolvedValue({});
    mockEnableFeishuIntegration.mockResolvedValue({});
  });

  it('shows guided setup and saves credential draft', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('feishu_setup_title')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(document.getElementById('feishu-app-id')).not.toBeNull();
    });
    const appIdInput = document.getElementById('feishu-app-id') as HTMLInputElement;
    const appSecretInput = document.getElementById('feishu-app-secret') as HTMLInputElement;
    const redirectUriInput = document.getElementById('feishu-redirect-uri') as HTMLInputElement;
    await user.type(appIdInput, 'cli_demo');
    await user.type(appSecretInput, 'secret_demo');
    await user.type(redirectUriInput, 'http://localhost:3001/en-US/workspaces/ws_1/feishu/callback');
    await user.click(screen.getByTestId('ws-feishu__save-draft'));

    await waitFor(() => {
      expect(mockUpdateFeishuIntegration).toHaveBeenCalledWith('ws_1', {
        app_id: 'cli_demo',
        app_secret: 'secret_demo',
        redirect_uri: 'http://localhost:3001/en-US/workspaces/ws_1/feishu/callback',
      });
    });
  });
});
