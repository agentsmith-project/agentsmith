/**
 * Authentication Store - Zustand
 *
 * Manages user authentication state only (user, token).
 * Server data (workspaces, projects) handled by React Query.
 */

import { create } from 'zustand';
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

const isDev = process.env.NEXT_PUBLIC_USE_MSW === 'true';

const createAuthStore = () =>
  create<AuthState>()(
    isDev
      ? persist(
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
      : (set) => ({
          ...initialData,
          setAuth: (user: User, token: string) => {
            set({ user, token, isAuthenticated: true });
          },
          clearAuth: () => {
            set(initialData);
          },
        })
  );

export const useAuthStore = createAuthStore();

// ============================================================
// Hydration Hook
// ============================================================

import { useState, useEffect } from 'react';

export const useAuthStoreHydration = () => {
  const [hydrated, setHydrated] = useState(() => {
    const persistApi = (useAuthStore as unknown as {
      persist?: { hasHydrated?: () => boolean };
    }).persist;
    return persistApi?.hasHydrated
      ? persistApi.hasHydrated()
      : typeof window !== 'undefined';
  });

  useEffect(() => {
    const persistApi = (useAuthStore as unknown as {
      persist?: { onFinishHydration?: (fn: () => void) => () => void };
    }).persist;
    if (persistApi?.onFinishHydration) {
      const unsub = persistApi.onFinishHydration(() => setHydrated(true));
      return () => unsub?.();
    }
    setHydrated(true);
    return;
  }, []);

  return hydrated;
};

// ============================================================
// Selectors
// ============================================================

export const selectCurrentUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => state.isAuthenticated;
export const selectToken = (state: AuthState) => state.token;
