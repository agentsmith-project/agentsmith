/**
 * Authentication Store - Zustand
 *
 * Manages user authentication state only (user, token).
 * Server data (workspaces, projects) handled by React Query.
 */

import { useState, useEffect } from 'react';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Locale } from '@/lib/i18n/config';

// ============================================================
// Types
// ============================================================

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  locale?: Locale;
}

interface AuthData {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface AuthState extends AuthData {
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
}

/**
 * Type for Zustand persist API (from zustand/middleware/persist.d.ts)
 * Used for type-safe hydration handling
 */
interface PersistApi<T> {
  setOptions: (options: Partial<unknown>) => void;
  clearStorage: () => void;
  rehydrate: () => Promise<void> | void;
  hasHydrated: () => boolean;
  onHydrate: (fn: (state: T) => void) => () => void;
  onFinishHydration: (fn: (state: T) => void) => () => void;
  getOptions: () => Partial<unknown>;
}

/**
 * Type for store with optional persist middleware
 */
type AuthStoreWithPersist = UseBoundStore<StoreApi<AuthState>> & {
  persist?: PersistApi<AuthState>;
};

// ============================================================
// Initial State
// ============================================================

const initialData: AuthData = {
  user: null,
  token: null,
  isAuthenticated: false,
};

// ============================================================
// Store Factory (environment-aware)
// ============================================================

const usePersist = process.env.NEXT_PUBLIC_USE_MSW === 'true';

const createAuthStore = (): AuthStoreWithPersist => {
  if (usePersist) {
    return create<AuthState>()(
      persist(
        (set) => ({
          ...initialData,
          setAuth: (user: User, token: string) => {
            set({ user, token, isAuthenticated: true });
          },
          clearAuth: () => {
            set(initialData);
          },
        }),
        {
          name: 'mbos-auth',
          storage: createJSONStorage(() => localStorage),
          partialize: (state) => ({
            user: state.user,
            token: state.token,
            isAuthenticated: state.isAuthenticated,
          }),
        }
      )
    ) as AuthStoreWithPersist;
  }

  return create<AuthState>()((set) => ({
    ...initialData,
    setAuth: (user: User, token: string) => {
      set({ user, token, isAuthenticated: true });
    },
    clearAuth: () => {
      set(initialData);
    },
  })) as AuthStoreWithPersist;
};

export const useAuthStore = createAuthStore();

// ============================================================
// Token Sync — single source of truth for API client auth
// ============================================================

/**
 * Automatically sync the Zustand auth token to the API client singleton.
 *
 * This subscription fires on every state change, including:
 * - setAuth(user, token)  →  client.setToken(token)
 * - clearAuth()           →  client.clearToken()
 * - Persist rehydration   →  client.setToken(restoredToken)
 *
 * By handling it at the store level we guarantee the API client
 * always reflects the latest auth state without callers needing
 * to remember to sync manually.
 */
if (typeof window !== 'undefined') {
  // Lazy import avoids circular dependency at module-parse time.
  // getApiClient is cheap (returns singleton) so this is safe.
  const syncTokenToClient = () => {
    const { getApiClient } = require('../api/client') as typeof import('../api/client');
    const client = getApiClient();
    const { token } = useAuthStore.getState();
    if (token) {
      client.setToken(token);
    } else {
      client.clearToken();
    }
  };

  // Sync on every future state change
  useAuthStore.subscribe(syncTokenToClient);

  // Sync the initial / rehydrated state once the store is ready
  if (useAuthStore.persist) {
    useAuthStore.persist.onFinishHydration(syncTokenToClient);
    // If already hydrated (e.g. fast refresh), sync now
    if (useAuthStore.persist.hasHydrated()) {
      syncTokenToClient();
    }
  } else {
    syncTokenToClient();
  }
}

// ============================================================
// Hydration Hook
// ============================================================

/**
 * Hook to check if the auth store has been hydrated from storage.
 *
 * In development mode (with persist middleware), this waits for
 * localStorage data to be loaded. In production (without persist),
 * hydration is immediate.
 *
 * @returns boolean - true when store is ready to use
 */
export const useAuthStoreHydration = (): boolean => {
  const [hydrated, setHydrated] = useState(() => {
    // If persist middleware is not enabled, hydration is immediate
    if (!useAuthStore.persist) {
      return true;
    }
    // Check if already hydrated (for fast refresh scenarios)
    return useAuthStore.persist.hasHydrated();
  });

  useEffect(() => {
    // If no persist middleware, nothing to wait for
    if (!useAuthStore.persist) {
      setHydrated(true);
      return;
    }

    // Subscribe to hydration completion
    const unsubscribe = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });

    // Check again in case hydration completed between render and effect
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true);
    }

    return unsubscribe;
  }, []);

  return hydrated;
};

// ============================================================
// Selectors
// ============================================================

export const selectCurrentUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => state.isAuthenticated;
export const selectToken = (state: AuthState) => state.token;
