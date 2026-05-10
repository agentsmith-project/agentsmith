import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();
const mockPush = vi.fn();
const mockAssign = vi.fn();
const mockUseSearchParams = vi.fn();
const mockApiPost = vi.fn();
const mockDateNow = vi.spyOn(Date, 'now');

const {
  useAuthStoreMock,
  mockSetAuth,
  resetAuthStoreMock,
} = vi.hoisted(() => {
  const React = require('react') as typeof import('react');
  const listeners = new Set<() => void>();
  let snapshot = {
    isAuthenticated: false,
    token: null as string | null,
  };

  const notify = () => {
    listeners.forEach((listener) => listener());
  };

  const mockSetAuth = vi.fn((user: { id: string; email: string; name: string; locale?: string }, token: string) => {
    snapshot = {
      ...snapshot,
      isAuthenticated: true,
      token,
    };
    notify();
  });

  const mockClearAuth = vi.fn(() => {
    snapshot = {
      isAuthenticated: false,
      token: null,
    };
    notify();
  });

  const useAuthStoreMock = (selector?: (state: { isAuthenticated: boolean; token: string | null; setAuth: typeof mockSetAuth; clearAuth: typeof mockClearAuth }) => unknown) => {
    const state = React.useSyncExternalStore(
      (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      () => snapshot,
      () => snapshot,
    );

    const fullState = {
      ...state,
      setAuth: mockSetAuth,
      clearAuth: mockClearAuth,
    };

    return typeof selector === 'function' ? selector(fullState) : fullState;
  };

  const resetAuthStoreMock = () => {
    snapshot = {
      isAuthenticated: false,
      token: null,
    };
    listeners.clear();
    mockSetAuth.mockClear();
    mockClearAuth.mockClear();
  };

  return {
    useAuthStoreMock,
    mockSetAuth,
    resetAuthStoreMock,
  };
});

vi.mock('next/navigation', () => ({
  useParams: () => ({ locale: 'en-US', workspace: 'ws_alpha' }),
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/app-shell/Logo', () => ({
  Logo: () => <div data-testid="logo" />,
}));

vi.mock('@/components/theme/PublicThemeToggle', () => ({
  PublicThemeToggle: () => <div data-testid="public-theme-toggle" />,
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStoreHydration: () => true,
  useAuthStore: useAuthStoreMock,
}));

vi.mock('@/lib/api', () => ({
  getApiClient: () => ({
    post: mockApiPost,
    setToken: vi.fn(),
  }),
  MemberAPI: class {
    private readonly client: { post: typeof mockApiPost };

    constructor(client: { post: typeof mockApiPost }) {
      this.client = client;
    }

    async acceptInvite(token: string) {
      return this.client.post('/join/accept', { token });
    }

    async declineInvite(token: string) {
      return this.client.post('/join/decline', { token });
    }
  },
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
    resetAuthStoreMock();
    mockApiPost.mockReset();
    mockUseSearchParams.mockReset();
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
    fetchMock.mockReset();
    mockDateNow.mockReturnValue(12345);
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

  afterEach(() => {
    mockDateNow.mockReset();
  });

  it('loads workspace-specific login config', async () => {
    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__heading')).toHaveTextContent('Alpha Workspace');
    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-recipe', 'public_auth_single');
    expect(screen.getByTestId('logo')).toBeInTheDocument();
    expect(screen.getByTestId('public-theme-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-recipe', 'public_auth_single');
    expect(screen.getByTestId('public-auth__shell')).toHaveAttribute('data-family', 'public-auth');
    expect(fetchMock).toHaveBeenCalledWith('/api/public/workspaces/ws_alpha', { cache: 'no-store' });
    expect(screen.queryByText('system_login_link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('workspace-login__primary-action-panel')).not.toBeInTheDocument();
    const support = screen.getByTestId('workspace-login__support');
    expect(support).toBeVisible();
    expect(support).toHaveTextContent('workspace_login_support_value');
    expect(support).toHaveTextContent('keycloak_sign_in_hint');
    expect(support).toHaveTextContent('workspace_login_support_hint');
    expect(screen.getByTestId('workspace-login__keycloak-btn')).toBeVisible();
    expect(screen.getByTestId('workspace-login__keycloak-btn')).toBeEnabled();
    expect(screen.getByTestId('workspace-login__keycloak-btn')).toHaveClass('h-12');
    expect(screen.getByTestId('workspace-login__keycloak-btn')).toHaveClass('rounded-[14px]');
  });

  it('ignores stale invite handoff from another workspace when computing the login target', async () => {
    vi.stubGlobal(
      'sessionStorage',
      ({
        setItem: vi.fn(),
        removeItem: vi.fn(),
        getItem: vi.fn((key: string) => (key === 'agentsmith:invite-handoff'
          ? JSON.stringify({ workspaceId: 'ws_other', projectId: 'proj_other', storedAt: Date.now() })
          : null)),
      } as unknown) as Storage,
    );

    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__submit')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-login__email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-login__submit'));

    expect(mockSetAuth).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_alpha/projects');
  });

  it('redirects quick login into the invited project overview when project_id is only available from invite handoff storage', async () => {
    vi.stubGlobal(
      'sessionStorage',
      ({
        setItem: vi.fn(),
        removeItem: vi.fn(),
        getItem: vi.fn(() => JSON.stringify({ workspaceId: 'ws_alpha', projectId: 'proj_alpha', storedAt: Date.now() })),
      } as unknown) as Storage,
    );

    render(<WorkspaceLoginPage />);

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(await screen.findByTestId('workspace-login__submit')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-login__email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-login__submit'));

    expect(mockSetAuth).toHaveBeenCalled();
    expect(mockSetAuth.mock.calls[0]?.[1]).toBe('mock_token_user_001__user%40example.com__12345');
    expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_alpha/projects/proj_alpha/overview');
  });

  it('handles authenticated quick-login continuation only once even after rerendering the page', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('project_id=proj_alpha'));

    const { rerender } = render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__submit')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-login__email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-login__submit'));

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_alpha/projects/proj_alpha/overview');
    });

    rerender(<WorkspaceLoginPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });
  });

  it('accepts the pending invite during quick login and redirects directly to the invited project overview', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('project_id=proj_alpha'));
    mockApiPost.mockImplementation(async (path: string, body: { token?: string }) => {
      if (path === '/join/accept' && body.token === 'invite_token') {
        return { ok: true, workspace_id: 'ws_alpha', project_id: 'proj_alpha' };
      }
      throw new Error(`Unexpected api post: ${path}`);
    });
    vi.stubGlobal(
      'sessionStorage',
      ({
        setItem: vi.fn(),
        removeItem: vi.fn(),
        getItem: vi.fn((key: string) => (key === 'agentsmith:pending-invite'
          ? JSON.stringify({ inviteToken: 'invite_token', storedAt: Date.now() })
          : null)),
      } as unknown) as Storage,
    );

    render(<WorkspaceLoginPage />);

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(await screen.findByTestId('workspace-login__submit')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-login__email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-login__submit'));

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockApiPost).toHaveBeenCalledWith('/join/accept', { token: 'invite_token' });
      expect(mockReplace).toHaveBeenCalledWith('/workspaces/ws_alpha/projects/proj_alpha/overview');
    });
  });

  it('only accepts a pending invite once after quick login rerenders into the authenticated state', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('project_id=proj_alpha'));
    let resolveInvite!: (value: { ok: true; workspace_id: string; project_id: string }) => void;
    const inviteAccepted = new Promise<{ ok: true; workspace_id: string; project_id: string }>((resolve) => {
      resolveInvite = resolve;
    });
    mockApiPost.mockImplementation(async (path: string, body: { token?: string }) => {
      if (path === '/join/accept' && body.token === 'invite_token') {
        return inviteAccepted;
      }
      throw new Error(`Unexpected api post: ${path}`);
    });
    vi.stubGlobal(
      'sessionStorage',
      ({
        setItem: vi.fn(),
        removeItem: vi.fn(),
        getItem: vi.fn((key: string) => (key === 'agentsmith:pending-invite'
          ? JSON.stringify({ inviteToken: 'invite_token', storedAt: Date.now() })
          : null)),
      } as unknown) as Storage,
    );

    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__submit')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-login__email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-login__submit'));

    await waitFor(() => expect(mockSetAuth).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    resolveInvite({ ok: true, workspace_id: 'ws_alpha', project_id: 'proj_alpha' });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/workspaces/ws_alpha/projects/proj_alpha/overview');
    });
  });

  it('redirects quick login into the invited project overview when project_id is present', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('project_id=proj_alpha'));

    render(<WorkspaceLoginPage />);

    expect(screen.getByTestId('public-auth__frame')).toHaveAttribute('data-width', 'narrow');
    expect(await screen.findByTestId('workspace-login__submit')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('workspace-login__email-input'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.click(screen.getByTestId('workspace-login__submit'));

    expect(mockSetAuth).toHaveBeenCalled();
    expect(mockSetAuth.mock.calls[0]?.[1]).toBe('mock_token_user_001__user%40example.com__12345');
    expect(mockPush).toHaveBeenCalledWith('/workspaces/ws_alpha/projects/proj_alpha/overview');
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

  it('preserves the invited project target in the back link when the workspace login was reached from an invite', async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams('project_id=proj_alpha'));

    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__back-to-selection')).toHaveAttribute('href', '/en-US/login/workspace?project_id=proj_alpha');
    expect(screen.queryByText('system_login_link')).not.toBeInTheDocument();
  });

  it('keeps only a back link to workspace selection on the direct workspace login page', async () => {
    render(<WorkspaceLoginPage />);

    expect(await screen.findByTestId('workspace-login__back-to-selection')).toHaveAttribute('href', '/en-US/login/workspace');
    expect(screen.queryByText('system_login_link')).not.toBeInTheDocument();
  });
});
