import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();
const mockSetAuth = vi.fn();
const mockSetToken = vi.fn();
const mockUseSearchParams = vi.fn();
const mockApiPost = vi.fn();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({
    setAuth: mockSetAuth,
  }),
}));

vi.mock('@/lib/api/client', () => ({
  getApiClient: () => ({
    setToken: mockSetToken,
    post: mockApiPost,
  }),
}));

vi.mock('@/lib/auth/token-claims', () => ({
  readAccessTokenClaims: () => ({
    sub: 'user_001',
    email: 'user@example.com',
    name: 'User One',
  }),
}));

vi.mock('@/lib/public-runtime-config', () => ({
  buildPublicApiUrl: (path: string) => `https://api.example.com${path}`,
}));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

import { WorkspaceLoginCallbackClient } from '../WorkspaceLoginCallbackClient';

describe('WorkspaceLoginCallbackClient', () => {
  const fetchMock = vi.fn();
  const sessionStore = new Map<string, string>();

  beforeEach(() => {
    mockReplace.mockReset();
    mockSetAuth.mockReset();
    mockSetToken.mockReset();
    mockApiPost.mockReset();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('code=code_123&state=state_123'));
    sessionStore.clear();
    sessionStore.set(
      'mbos:keycloak:pkce',
      JSON.stringify({
        verifier: 'verifier_123',
        state: 'state_123',
        redirectUri: 'http://localhost:3001/workspaces/ws_alpha/login/callback',
        createdAt: Date.now(),
        workspaceId: 'ws_alpha',
        locale: 'en-US',
        desktopAuthRequestId: 'req_123',
      }),
    );
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/workspaces/ws_alpha') {
        return {
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
        } as Response;
      }
      if (url === 'https://login.example.com/realms/alpha/protocol/openid-connect/token') {
        return {
          ok: true,
          json: async () => ({
            access_token: 'access_123',
            refresh_token: 'refresh_123',
            expires_in: 3600,
          }),
        } as Response;
      }
      if (url === 'https://api.example.com/me/desktop/auth/requests/req_123/complete') {
        return { ok: true } as Response;
      }
      if (url === '/api/public/workspaces/ws_alpha/admin-binding') {
        return { ok: true } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    mockApiPost.mockImplementation(async (path: string) => {
      if (path === '/join/accept') {
        return {
          ok: true,
          workspace_id: 'ws_alpha',
          project_id: 'proj_alpha',
        };
      }
      throw new Error(`Unexpected api post: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'sessionStorage',
      ({
        getItem: vi.fn((key: string) => sessionStore.get(key) ?? null),
        removeItem: vi.fn((key: string) => {
          sessionStore.delete(key);
        }),
        setItem: vi.fn((key: string, value: string) => {
          sessionStore.set(key, value);
        }),
      } as unknown) as Storage,
    );
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        replace: mockReplace,
      },
    });
  });

  it('completes desktop auth request during keycloak callback and redirects to completion page', async () => {
    render(<WorkspaceLoginCallbackClient workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/public/workspaces/ws_alpha', { cache: 'no-store' });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://login.example.com/realms/alpha/protocol/openid-connect/token',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/me/desktop/auth/requests/req_123/complete',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockSetToken).toHaveBeenCalledWith('access_123');
      expect(mockReplace).toHaveBeenCalledWith('/en-US/desktop/auth/complete?desktop_auth_request_id=req_123');
    });
  });

  it('keeps the current workspace context by redirecting to the workspace project entry after sign in', async () => {
    sessionStore.set(
      'mbos:keycloak:pkce',
      JSON.stringify({
        verifier: 'verifier_123',
        state: 'state_123',
        redirectUri: 'http://localhost:3001/workspaces/ws_alpha/login/callback',
        createdAt: Date.now(),
        workspaceId: 'ws_alpha',
        locale: 'en-US',
      }),
    );

    render(<WorkspaceLoginCallbackClient workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockSetToken).toHaveBeenCalledWith('access_123');
      expect(mockReplace).toHaveBeenCalledWith('/en-US/workspaces/ws_alpha/projects');
    });
  });

  it('ignores stale invite handoff from another workspace during callback landing', async () => {
    sessionStore.set(
      'mbos:keycloak:pkce',
      JSON.stringify({
        verifier: 'verifier_123',
        state: 'state_123',
        redirectUri: 'http://localhost:3001/workspaces/ws_alpha/login/callback',
        createdAt: Date.now(),
        workspaceId: 'ws_alpha',
        locale: 'en-US',
      }),
    );
    sessionStore.set(
      'agentsmith:invite-handoff',
      JSON.stringify({
        workspaceId: 'ws_other',
        projectId: 'proj_other',
        storedAt: Date.now(),
      }),
    );

    render(<WorkspaceLoginCallbackClient workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockSetToken).toHaveBeenCalledWith('access_123');
      expect(mockReplace).toHaveBeenCalledWith('/en-US/workspaces/ws_alpha/projects');
    });
  });

  it('completes pending invite acceptance after auth and lands directly on the invited project overview', async () => {
    sessionStore.set(
      'mbos:keycloak:pkce',
      JSON.stringify({
        verifier: 'verifier_123',
        state: 'state_123',
        redirectUri: 'http://localhost:3001/workspaces/ws_alpha/login/callback',
        createdAt: Date.now(),
        workspaceId: 'ws_alpha',
        locale: 'en-US',
      }),
    );
    sessionStore.set(
      'agentsmith:pending-invite',
      JSON.stringify({
        inviteToken: 'invite_token',
        storedAt: Date.now(),
      }),
    );

    render(<WorkspaceLoginCallbackClient workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/join/accept', { token: 'invite_token' });
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockSetToken).toHaveBeenCalledWith('access_123');
      expect(mockReplace).toHaveBeenCalledWith('/en-US/workspaces/ws_alpha/projects/proj_alpha/overview');
    });
  });

  it('handles callback completion only once even after rerendering the callback page', async () => {
    sessionStore.set(
      'mbos:keycloak:pkce',
      JSON.stringify({
        verifier: 'verifier_123',
        state: 'state_123',
        redirectUri: 'http://localhost:3001/workspaces/ws_alpha/login/callback',
        createdAt: Date.now(),
        workspaceId: 'ws_alpha',
        locale: 'en-US',
      }),
    );

    const { rerender } = render(<WorkspaceLoginCallbackClient workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockSetToken).toHaveBeenCalledWith('access_123');
      expect(mockReplace).toHaveBeenCalledWith('/en-US/workspaces/ws_alpha/projects');
    });

    rerender(<WorkspaceLoginCallbackClient workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps auth and returns to desktop handoff recovery when callback desktop completion fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/public/workspaces/ws_alpha') {
        return {
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
        } as Response;
      }
      if (url === 'https://login.example.com/realms/alpha/protocol/openid-connect/token') {
        return {
          ok: true,
          json: async () => ({
            access_token: 'access_123',
            refresh_token: 'refresh_123',
            expires_in: 3600,
          }),
        } as Response;
      }
      if (url === 'https://api.example.com/me/desktop/auth/requests/req_123/complete') {
        return { ok: false, status: 503 } as Response;
      }
      if (url === '/api/public/workspaces/ws_alpha/admin-binding') {
        return { ok: true } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(<WorkspaceLoginCallbackClient workspaceId="ws_alpha" />);

    await waitFor(() => {
      expect(mockSetAuth).toHaveBeenCalled();
      expect(mockSetToken).toHaveBeenCalledWith('access_123');
      expect(mockReplace).toHaveBeenCalledWith('/en-US/desktop/auth/request?desktop_auth_request_id=req_123');
    });
  });
});
