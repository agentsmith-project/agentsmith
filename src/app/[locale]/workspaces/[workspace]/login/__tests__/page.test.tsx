import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockAssign = vi.fn();
const mockSetAuth = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US', workspace: 'ws_alpha' }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/i18n/routing', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/app-shell/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: () => true,
  useAuthStore: () => ({
    setAuth: mockSetAuth,
    isAuthenticated: false,
  }),
}));

vi.mock('@/lib/auth/pkce', () => ({
  randomBase64Url: () => 'random-state',
  createPkceChallenge: async () => ({
    challenge: 'challenge',
    method: 'S256',
  }),
}));

import WorkspaceLoginPage from '../page';

describe('WorkspaceLoginPage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockReplace.mockReset();
    mockPush.mockReset();
    mockSetAuth.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'ws_alpha',
        name: 'Alpha Workspace',
        login_idp: {
          kind: 'keycloak',
          url: 'https://login.example.com',
          realm: 'alpha',
          client_id: 'alpha-client',
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'sessionStorage',
      ({
        setItem: vi.fn(),
        removeItem: vi.fn(),
        getItem: vi.fn(() => null),
      } as unknown) as Storage,
    );
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3001',
        assign: mockAssign,
      },
    });
  });

  it('loads workspace-specific login config', async () => {
    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__heading')).toHaveTextContent('Alpha Workspace');
    expect(fetchMock).toHaveBeenCalledWith('/api/public/workspaces/ws_alpha', { cache: 'no-store' });
    expect(screen.queryByText('system_login_link')).not.toBeInTheDocument();
  });

  it('redirects to workspace home after mock quick login', async () => {
    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__submit')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-login__email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-login__submit'));

    expect(mockSetAuth).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_alpha');
  });

  it('starts keycloak login with a locale-independent workspace callback', async () => {
    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__keycloak-btn')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('workspace-login__keycloak-btn'));

    await waitFor(() => expect(mockAssign).toHaveBeenCalledTimes(1));
    const [authUrl] = mockAssign.mock.calls[0] as [string];
    expect(decodeURIComponent(authUrl)).toContain('/workspaces/ws_alpha/login/callback');
    expect(decodeURIComponent(authUrl)).not.toContain('/en-US/workspaces/ws_alpha/login/callback');
  });

  it('shows not found state when workspace login config is unavailable', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error_code: 'WORKSPACE_NOT_FOUND',
        error_message: 'workspace_not_found',
      }),
    }).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error_code: 'WORKSPACE_NOT_FOUND',
        error_message: 'workspace_not_found',
      }),
    }).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({
        error_code: 'WORKSPACE_NOT_FOUND',
        error_message: 'workspace_not_found',
      }),
    });

    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__error')).toBeInTheDocument();
    expect(screen.getByText('workspace_not_found')).toBeInTheDocument();
  });

  it('retries transient workspace-not-found responses before showing the login button', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error_code: 'WORKSPACE_NOT_FOUND',
          error_message: 'workspace_not_found',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: 'ws_alpha',
          name: 'Alpha Workspace',
          login_idp: {
            kind: 'keycloak',
            url: 'https://login.example.com',
            realm: 'alpha',
            client_id: 'alpha-client',
          },
        }),
      });

    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__keycloak-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-login__error')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps only a back link to workspace selection on the direct workspace login page', async () => {
    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__back-to-selection')).toHaveAttribute('href', '/en-US/login');
    expect(screen.queryByText('system_login_link')).not.toBeInTheDocument();
  });
});
