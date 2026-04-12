import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockReplace = vi.fn();
const mockSetAuth = vi.fn();
const mockSetToken = vi.fn();
const mockUseSearchParams = vi.fn();

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

  beforeEach(() => {
    mockReplace.mockReset();
    mockSetAuth.mockReset();
    mockSetToken.mockReset();
    mockUseSearchParams.mockReturnValue(new URLSearchParams('code=code_123&state=state_123'));
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
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal(
      'sessionStorage',
      ({
        getItem: vi.fn(() =>
          JSON.stringify({
            verifier: 'verifier_123',
            state: 'state_123',
            redirectUri: 'http://localhost:3001/workspaces/ws_alpha/login/callback',
            createdAt: Date.now(),
            workspaceId: 'ws_alpha',
            locale: 'en-US',
            desktopAuthRequestId: 'req_123',
          }),
        ),
        removeItem: vi.fn(),
        setItem: vi.fn(),
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
