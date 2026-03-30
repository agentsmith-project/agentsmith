'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';

import { useAuthStore } from '@/lib/stores/authStore';
import { getApiClient } from '@/lib/api/client';
import { getKeycloakClientId, getKeycloakRealmBase } from '@/lib/auth/keycloak';
import { addSessionRecoveryListener, setSessionRefreshHandler } from '@/lib/auth/session-recovery';

function resolveLocaleFromPathname(pathname: string | null): string {
  const first = pathname?.split('/').filter(Boolean)[0] ?? '';
  if (first === 'en-US' || first === 'zh-CN') return first;
  return 'en-US';
}

function isWorkspaceSelectPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return /^\/(en-US|zh-CN)\/login\/workspace\/?$/.test(pathname);
}

export function SessionRecoveryProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { clearAuth } = useAuthStore();
  const handlingRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const locale = useMemo(() => resolveLocaleFromPathname(pathname), [pathname]);

  useEffect(() => {
    setSessionRefreshHandler(() => {
      if (refreshInFlightRef.current) {
        return refreshInFlightRef.current;
      }

      const refreshPromise = (async () => {
        const { refreshToken, setToken, keycloakSession } = useAuthStore.getState();
        const realmBase = keycloakSession?.realmBase ?? getKeycloakRealmBase();
        const clientId = keycloakSession?.clientId ?? getKeycloakClientId();
        if (!refreshToken || !realmBase || !clientId) {
          return false;
        }

        const response = await fetch(`${realmBase}/protocol/openid-connect/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
          }).toString(),
        });

        if (!response.ok) {
          return false;
        }

        const payload = (await response.json()) as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (!payload.access_token) {
          return false;
        }

        setToken(payload.access_token, {
          refreshToken: payload.refresh_token,
          expiresIn: payload.expires_in,
        });
        getApiClient().setToken(payload.access_token);
        return true;
      })().finally(() => {
        refreshInFlightRef.current = null;
      });

      refreshInFlightRef.current = refreshPromise;
      return refreshPromise;
    });

    const unsubscribe = addSessionRecoveryListener(() => {
      if (isWorkspaceSelectPath(pathname)) {
        // Workspace select page has dedicated UX for session-expired/retry handling.
        // Avoid global hard-redirect loop that hides that state.
        return;
      }
      if (handlingRef.current) return;
      handlingRef.current = true;
      clearAuth();
      queryClient.clear();
      router.replace('/login/workspace');
      window.setTimeout(() => {
        handlingRef.current = false;
      }, 250);
    });

    return () => {
      unsubscribe();
      setSessionRefreshHandler(null);
    };
  }, [clearAuth, locale, pathname, queryClient, router]);

  return <>{children}</>;
}
