import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/zh-CN/workspaces/lab',
}));

type StoreModule = typeof import('@/lib/stores/authStore');
type SessionRecoveryModule = typeof import('@/lib/auth/session-recovery');
type ProviderModule = typeof import('../SessionRecoveryProvider');

function installMemoryStorage() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage,
  });
}

describe('SessionRecoveryProvider', () => {
  let storeModule: StoreModule;
  let sessionRecoveryModule: SessionRecoveryModule;
  let providerModule: ProviderModule;

  beforeEach(async () => {
    vi.resetModules();
    replaceMock.mockReset();
    installMemoryStorage();
    (window as typeof window & {
      __MBOS_PUBLIC_RUNTIME_CONFIG__?: unknown;
    }).__MBOS_PUBLIC_RUNTIME_CONFIG__ = {
      apiBase: 'http://localhost:20000/api/v1',
      keycloakUrl: 'http://mbos.imotion.ai:18080',
      keycloakRealm: 'mbos',
      keycloakClientId: 'agentsmith',
      useMsw: false,
      mswStrictReady: false,
      sseTicketEnabled: false,
      sseTicketPercentage: 0,
      sseAllowJwtFallback: false,
      trustedImageDomains: [],
      bypassAuth: false,
      notebookSseDebugPanel: false,
      docFixtures: false,
    };
    storeModule = await import('@/lib/stores/authStore');
    sessionRecoveryModule = await import('@/lib/auth/session-recovery');
    providerModule = await import('../SessionRecoveryProvider');
    storeModule.useAuthStore.getState().clearAuth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    storeModule.useAuthStore.getState().clearAuth();
  });

  it('refreshes using the persisted workspace-specific keycloak session instead of the public default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'access_2',
        refresh_token: 'refresh_2',
        expires_in: 300,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    storeModule.useAuthStore.getState().setAuth(
      {
        id: 'user_1',
        email: 'user@example.com',
        name: 'User',
        locale: 'zh-CN',
      },
      'access_1',
      {
        refreshToken: 'refresh_1',
        expiresIn: 300,
        keycloakSession: {
          realmBase: 'https://keycloak.imotion.ai/realms/master',
          clientId: 'mbos',
        },
      },
    );

    const queryClient = new QueryClient();
    const SessionRecoveryProvider = providerModule.SessionRecoveryProvider;
    render(
      <QueryClientProvider client={queryClient}>
        <SessionRecoveryProvider>
          <div>ok</div>
        </SessionRecoveryProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      await expect(sessionRecoveryModule.tryRefreshSession()).resolves.toBe(true);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://keycloak.imotion.ai/realms/master/protocol/openid-connect/token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(storeModule.useAuthStore.getState().token).toBe('access_2');
    expect(storeModule.useAuthStore.getState().keycloakSession).toEqual({
      realmBase: 'https://keycloak.imotion.ai/realms/master',
      clientId: 'mbos',
    });
  });
});
