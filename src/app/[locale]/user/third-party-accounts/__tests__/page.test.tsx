import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockRemove = vi.fn();
const mockGetProviderConfig = vi.fn();
const mockStartFeishuOAuth = vi.fn();
const mockCompleteFeishuOAuth = vi.fn();
const mockRefresh = vi.fn();

vi.mock('next-intl', () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));

vi.mock('@/lib/api', () => ({
  getApiClient: vi.fn(() => ({})),
  UserExternalConnectionsAPI: vi.fn().mockImplementation(function () {
    return {
      list: mockList,
      create: mockCreate,
      update: mockUpdate,
      remove: mockRemove,
      getProviderConfig: mockGetProviderConfig,
      startFeishuOAuth: mockStartFeishuOAuth,
      completeFeishuOAuth: mockCompleteFeishuOAuth,
      refresh: mockRefresh,
    };
  }),
  handleErrorForToast: vi.fn(),
}));

import ThirdPartyAccountsPage from '../page';

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

describe('ThirdPartyAccountsPage', () => {
  const user = userEvent.setup();
  const wrapper = createWrapper();

  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 'uec_1' });
    mockUpdate.mockResolvedValue({ id: 'uec_1' });
    mockRemove.mockResolvedValue(undefined);
    mockGetProviderConfig.mockResolvedValue({
      provider: 'feishu',
      interactive_login_required: true,
      refresh_supported: true,
      auth_configured: false,
      callback_uri: 'http://127.0.0.1:18181/callback',
      auth_url: null,
    });
    mockStartFeishuOAuth.mockResolvedValue({
      authorization_url: 'https://feishu.example/auth',
      state: 'state_1',
      redirect_uri: 'http://127.0.0.1:18181/callback',
      expires_at: new Date().toISOString(),
      scopes: ['offline_access'],
    });
    mockCompleteFeishuOAuth.mockResolvedValue({ id: 'uec_2' });
    mockRefresh.mockResolvedValue({ id: 'uec_3' });
  });

  it('disables Feishu connect when auth is not configured', async () => {
    render(<ThirdPartyAccountsPage />, { wrapper });

    const button = await screen.findByTestId('third-party-accounts__feishu-connect');
    expect(button).toBeDisabled();
    expect(screen.getByText('feishu_not_configured')).toBeInTheDocument();
  });

  it('creates a Jira secret bundle with provider-specific fields', async () => {
    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__create-btn'));

    await user.type(screen.getByLabelText('display_name_label'), 'Team Jira');
    await user.type(screen.getByLabelText('note_label'), 'Used for team issue sync');
    await user.type(screen.getByLabelText('jira_base_url_label'), 'https://company.atlassian.net');
    await user.type(screen.getByLabelText('jira_token_label'), 'jira-secret');

    await user.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith({
        provider: 'jira',
        kind: 'secret_bundle',
        display_name: 'Team Jira',
        note: 'Used for team issue sync',
        status: 'active',
        fields: [
          { key: 'base_url', value: 'https://company.atlassian.net', description: 'Jira base URL', secret: false },
          { key: 'api_token', value: 'jira-secret', description: 'Jira API token', secret: true },
        ],
        account_identity: undefined,
        scopes: undefined,
        expires_at: undefined,
        last_error: undefined,
        custom_domain: undefined,
      });
    });
  });

  it('creates a GitHub ssh keypair with provider-specific fields', async () => {
    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__create-btn'));

    await user.selectOptions(screen.getByLabelText('provider_label'), 'github');
    await user.selectOptions(screen.getByLabelText('kind_label'), 'ssh_keypair');
    await user.type(screen.getByLabelText('display_name_label'), 'GitHub Deploy Key');
    await user.type(screen.getByLabelText('note_label'), 'Repo deploy key');
    await user.clear(screen.getByLabelText('git_host_optional_label'));
    await user.type(screen.getByLabelText('git_host_optional_label'), 'github.enterprise.local');
    await user.type(screen.getByLabelText('ssh_public_key_label'), 'ssh-ed25519 AAAA');
    await user.type(screen.getByLabelText('ssh_private_key_label'), '-----BEGIN PRIVATE KEY-----');

    await user.click(screen.getByRole('button', { name: 'create' }));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'github',
        kind: 'ssh_keypair',
        display_name: 'GitHub Deploy Key',
        note: 'Repo deploy key',
        fields: [
          { key: 'git_host', value: 'github.enterprise.local', description: 'Git host', secret: false },
          { key: 'public_key', value: 'ssh-ed25519 AAAA', description: 'SSH public key', secret: false },
          { key: 'private_key', value: '-----BEGIN PRIVATE KEY-----', description: 'SSH private key', secret: true },
        ],
      }));
    });
  });

  it('preserves existing secret on edit when secret input is left blank', async () => {
    mockList.mockResolvedValue([
      {
        id: 'uec_existing',
        user_id: 'user_1',
        provider: 'github',
        kind: 'secret_bundle',
        display_name: 'GitHub Token',
        note: null,
        status: 'active',
        fields: [
          { key: 'api_base_url', description: 'GitHub API base URL', secret: false, masked_value: 'https://api.github.com' },
          { key: 'token', description: 'GitHub token', secret: true, masked_value: 'gh••••en' },
        ],
        account_identity: null,
        scopes: null,
        expires_at: null,
        last_refreshed_at: null,
        last_used_at: null,
        last_error: null,
        created_at: '2026-03-05T00:00:00Z',
        updated_at: '2026-03-05T00:00:00Z',
      },
    ]);

    render(<ThirdPartyAccountsPage />, { wrapper });

    await user.click(await screen.findByTestId('third-party-accounts__row-uec_existing'));
    await user.clear(screen.getByLabelText('display_name_label'));
    await user.type(screen.getByLabelText('display_name_label'), 'GitHub Token Updated');

    await user.click(screen.getByRole('button', { name: 'save' }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith(
        'uec_existing',
        {
          custom_domain: undefined,
          display_name: 'GitHub Token Updated',
          note: null,
          status: 'active',
          fields: [
            { key: 'api_base_url', value: 'https://api.github.com', description: 'GitHub API base URL', secret: false },
            { key: 'token', value: '', description: 'GitHub token', secret: true },
          ],
          account_identity: undefined,
          scopes: undefined,
          expires_at: undefined,
          last_error: undefined,
        },
      );
    });
  });
});
