import { afterEach, describe, expect, it, vi } from 'vitest';

import { withAuth } from '../../../e2e/fixtures/authenticated';
import type { AuthState, User } from '@/lib/stores/authStore';

type CapturedInitScript = {
  callback: (seed: unknown) => void;
  seed: unknown;
};

type CapturedInterval = {
  id: number;
  callback: () => void;
};

type PersistedAuthState = {
  user?: {
    id?: string;
    email?: string;
    name?: string;
    locale?: 'en-US';
  } | null;
  token?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: number | null;
  isAuthenticated?: boolean;
};

function readPersistedAuthState(): PersistedAuthState | null {
  const raw = window.localStorage.getItem('agentsmith-auth');
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw) as { state?: PersistedAuthState };
  return parsed.state ?? null;
}

function createWindowAuthStore(state: AuthState): NonNullable<Window['__MBOS_AUTH_STORE__']> {
  return Object.assign(() => state, {
    getState: () => state,
  });
}

function createAboutBlankPageStub(capturedInitScripts: CapturedInitScript[]) {
  return {
    addInitScript: vi.fn(async (callback: (seed: unknown) => void, seed: unknown) => {
      capturedInitScripts.push({ callback, seed });
    }),
    evaluate: vi.fn(async () => {
      throw new Error('cross_origin_evaluate_blocked');
    }),
    url: vi.fn(() => 'about:blank'),
  };
}

function installPersistingAuthStore() {
  const persistState = () => {
    window.localStorage.setItem('agentsmith-auth', JSON.stringify({
      state: {
        user: state.user,
        token: state.token,
        refreshToken: state.refreshToken,
        tokenExpiresAt: state.tokenExpiresAt,
        keycloakSession: state.keycloakSession,
        isAuthenticated: state.isAuthenticated,
      },
      version: 0,
    }));
  };

  const state: AuthState = {
    user: null,
    token: null,
    refreshToken: null,
    tokenExpiresAt: null,
    keycloakSession: null,
    isAuthenticated: false,
    setAuth: vi.fn((user: User, token: string, session) => {
      state.user = user;
      state.token = token;
      state.refreshToken = session?.refreshToken ?? null;
      state.tokenExpiresAt = typeof session?.expiresIn === 'number'
        ? Date.now() + session.expiresIn * 1000
        : null;
      state.keycloakSession = session?.keycloakSession ?? null;
      state.isAuthenticated = true;
      persistState();
    }),
    setToken: vi.fn((token: string, session) => {
      state.token = token;
      state.refreshToken = session?.refreshToken === undefined
        ? state.refreshToken
        : (session.refreshToken ?? null);
      state.tokenExpiresAt = typeof session?.expiresIn === 'number'
        ? Date.now() + session.expiresIn * 1000
        : state.tokenExpiresAt;
      state.keycloakSession = session?.keycloakSession === undefined
        ? state.keycloakSession
        : (session.keycloakSession ?? null);
      state.isAuthenticated = Boolean(state.user);
      persistState();
    }),
    clearAuth: vi.fn(() => {
      state.user = null;
      state.token = null;
      state.refreshToken = null;
      state.tokenExpiresAt = null;
      state.keycloakSession = null;
      state.isAuthenticated = false;
      persistState();
    }),
  };

  window.__MBOS_AUTH_STORE__ = createWindowAuthStore(state);
  return state;
}

describe('mock auth seed retry', () => {
  const originalSetInterval = window.setInterval;
  const originalClearInterval = window.clearInterval;

  afterEach(() => {
    window.localStorage.clear();
    delete window.__MBOS_AUTH_STORE__;
    delete window.__MBOS_AUTH_SETUP__;
    delete window.__MBOS_AUTH_E2E_CONTEXT__;
    delete (window as Window & { __MBOS_AUTH_E2E_SEED_ISSUED_AT__?: number }).__MBOS_AUTH_E2E_SEED_ISSUED_AT__;
    delete (window as Window & { __MBOS_AUTH_E2E_RETRY_INTERVAL__?: number }).__MBOS_AUTH_E2E_RETRY_INTERVAL__;
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;
    vi.restoreAllMocks();
  });

  it('prevents an older queued retry callback from overwriting a newer auth seed', async () => {
    const capturedInitScripts: CapturedInitScript[] = [];
    const scheduledIntervals: CapturedInterval[] = [];
    let nextIntervalId = 1;

    window.setInterval = ((callback: TimerHandler) => {
      const intervalId = nextIntervalId;
      nextIntervalId += 1;
      const intervalCallback = callback as () => void;
      scheduledIntervals.push({
        id: intervalId,
        callback: intervalCallback,
      });
      return intervalId as unknown as number;
    }) as typeof window.setInterval;
    window.clearInterval = vi.fn() as typeof window.clearInterval;

    const page = createAboutBlankPageStub(capturedInitScripts);

    await withAuth(page as never, 'ws_default', 'test@example.com', 'user_001');
    await withAuth(page as never, 'ws_default', 'dev2@corp.com', 'u_2');

    expect(capturedInitScripts).toHaveLength(2);

    capturedInitScripts[0]!.callback(capturedInitScripts[0]!.seed);
    capturedInitScripts[1]!.callback(capturedInitScripts[1]!.seed);

    expect(window.__MBOS_AUTH_E2E_CONTEXT__).toMatchObject({
      userEmail: 'dev2@corp.com',
      userId: 'u_2',
    });
    expect(readPersistedAuthState()?.user).toMatchObject({
      id: 'u_2',
      email: 'dev2@corp.com',
    });
    expect(scheduledIntervals).toHaveLength(2);

    const storeState = installPersistingAuthStore();

    // The latest seed should win first.
    scheduledIntervals[1]!.callback();

    expect(storeState.user).toMatchObject({
      id: 'u_2',
      email: 'dev2@corp.com',
    });
    expect(readPersistedAuthState()?.user).toMatchObject({
      id: 'u_2',
      email: 'dev2@corp.com',
    });

    // Simulate a stale callback that was already queued before clearInterval landed.
    scheduledIntervals[0]!.callback();

    expect(window.__MBOS_AUTH_E2E_CONTEXT__).toMatchObject({
      userEmail: 'dev2@corp.com',
      userId: 'u_2',
    });
    expect(storeState.setAuth).toHaveBeenCalledTimes(1);
    expect(storeState.user).toMatchObject({
      id: 'u_2',
      email: 'dev2@corp.com',
    });
    expect(readPersistedAuthState()?.user).toMatchObject({
      id: 'u_2',
      email: 'dev2@corp.com',
    });
  });
});
