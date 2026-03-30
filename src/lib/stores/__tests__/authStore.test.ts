import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoreModule = typeof import('@/lib/stores/authStore');

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
  return storage;
}

describe('authStore keycloak session persistence', () => {
  let storeModule: StoreModule;

  beforeEach(async () => {
    vi.resetModules();
    installMemoryStorage();
    storeModule = await import('@/lib/stores/authStore');
    storeModule.useAuthStore.getState().clearAuth();
  });

  it('stores workspace-specific keycloak session on login and preserves it across token refresh', () => {
    storeModule.useAuthStore.getState().setAuth(
      {
        id: 'user_1',
        email: 'user@example.com',
        name: 'User',
        locale: 'en-US',
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

    expect(storeModule.useAuthStore.getState().keycloakSession).toEqual({
      realmBase: 'https://keycloak.imotion.ai/realms/master',
      clientId: 'mbos',
    });

    storeModule.useAuthStore.getState().setToken('access_2', {
      refreshToken: 'refresh_2',
      expiresIn: 300,
    });

    expect(storeModule.useAuthStore.getState().keycloakSession).toEqual({
      realmBase: 'https://keycloak.imotion.ai/realms/master',
      clientId: 'mbos',
    });
  });
});
