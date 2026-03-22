/**
 * Protected Route Wrapper Component
 *
 * A wrapper component that protects routes requiring authentication.
 * Redirects to login page if user is not authenticated.
 */

'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useHasPermission, useHasAllPermissions, useIsAuthenticated } from '@/lib/hooks/use-permissions';
import { useAuthStoreHydration } from '@/lib/stores/authStore';
import { getPublicRuntimeConfig } from '@/lib/public-runtime-config';

interface ProtectedRouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  requirePermission?: string | string[];
}

export function ProtectedRoute({
  children,
  fallback,
  requirePermission,
}: ProtectedRouteProps) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useIsAuthenticated();
  const hydrated = useAuthStoreHydration();
  const latestAuthRef = useRef(isAuthenticated);
  latestAuthRef.current = isAuthenticated;

  // Normalize permission requirements defensively.
  // Empty strings / empty arrays must behave as "no permission required".
  const normalized = useMemo(() => {
    if (!requirePermission) {
      return { mode: 'none' as const, single: '', multi: [] as string[] };
    }
    if (Array.isArray(requirePermission)) {
      const cleaned = requirePermission.map((p) => p.trim()).filter((p) => p.length > 0);
      if (cleaned.length === 0) {
        return { mode: 'none' as const, single: '', multi: [] as string[] };
      }
      return { mode: 'multi' as const, single: '', multi: cleaned };
    }
    const single = requirePermission.trim();
    if (!single) {
      return { mode: 'none' as const, single: '', multi: [] as string[] };
    }
    return { mode: 'single' as const, single, multi: [] as string[] };
  }, [requirePermission]);

  // Check permissions using stable hooks
  const hasAllPermissionsResult = useHasAllPermissions(normalized.multi);
  const hasSinglePermissionResult = useHasPermission(normalized.single);

  // Determine hasPermission based on requirePermission type
  const hasPermission = useMemo(() => {
    if (normalized.mode === 'none') return true;
    if (!isAuthenticated) return false;

    if (normalized.mode === 'multi') {
      return hasAllPermissionsResult;
    }
    return hasSinglePermissionResult;
  }, [normalized.mode, isAuthenticated, hasAllPermissionsResult, hasSinglePermissionResult]);

  // Mock development check - bypass auth in dev if needed
  const isDev = process.env.NODE_ENV === 'development';
  const bypassAuth = isDev && getPublicRuntimeConfig().bypassAuth;

  // Extract locale from pathname for login redirect
  const loginPath = useMemo(() => {
    const segments = pathname.split('/');
    const locale = segments[1] || 'en-US'; // Default to en-US if no locale in path
    return `/${locale}/login/workspace`;
  }, [pathname]);

  useEffect(() => {
    if (!hydrated) return;
    // In development with E2E tests, check if mock auth is being set up
    const hasMockAuthSetup = typeof window !== 'undefined' && !!window.__MBOS_AUTH_SETUP__;

    if (hasMockAuthSetup && !bypassAuth && !isAuthenticated) {
      // Poll for mock auth to be set up (E2E testing scenario)
      const checkMockAuth = () => {
        const storeHook = window.__MBOS_AUTH_STORE__;
        if (storeHook) {
          // Use getState() to read current state outside React render context
          const state = typeof storeHook.getState === 'function'
            ? storeHook.getState()
            : storeHook();
          if (state.isAuthenticated) {
            console.log('[ProtectedRoute] Mock auth detected, isAuthenticated:', state.isAuthenticated);
            return true;
          }
          try {
            const raw = window.localStorage.getItem('agentsmith-auth');
            const parsed = raw ? JSON.parse(raw) as {
              state?: {
                user?: {
                  id?: string;
                  email?: string;
                  name?: string;
                  locale?: 'en-US' | 'zh-CN';
                };
                token?: string | null;
                refreshToken?: string | null;
                tokenExpiresAt?: number | null;
                isAuthenticated?: boolean;
              };
            } : null;
            const persisted = parsed?.state;
            if (
              persisted?.isAuthenticated
              && persisted.user
              && typeof persisted.token === 'string'
              && persisted.token.length > 0
              && typeof state.setAuth === 'function'
            ) {
              const expiresIn = typeof persisted.tokenExpiresAt === 'number'
                ? Math.max(1, Math.floor((persisted.tokenExpiresAt - Date.now()) / 1000))
                : undefined;
              if (
                typeof persisted.user.id === 'string'
                && typeof persisted.user.email === 'string'
                && typeof persisted.user.name === 'string'
              ) {
                state.setAuth(
                  {
                    id: persisted.user.id,
                    email: persisted.user.email,
                    name: persisted.user.name,
                    locale: persisted.user.locale,
                  },
                  persisted.token,
                  {
                    refreshToken: persisted.refreshToken ?? null,
                    expiresIn,
                  },
                );
                return true;
              }
            }
          } catch {
            // Ignore malformed localStorage and continue normal fallback.
          }
        }
        return false;
      };

      // Poll for mock auth for up to 2 seconds
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (checkMockAuth() || attempts > 40) {
          clearInterval(interval);
          console.log('[ProtectedRoute] Mock auth check complete, attempts:', attempts, 'found:', checkMockAuth());
          // If still not authenticated after waiting, redirect to login
          if (!checkMockAuth()) {
            router.replace(loginPath);
          }
        }
      }, 50);

      return () => clearInterval(interval);
    } else if (!bypassAuth && !isAuthenticated) {
      // Normal redirect to login (production or non-E2E dev).
      // Delay a tick to avoid hydration race causing redirect loops.
      const t = window.setTimeout(() => {
        if (!bypassAuth && !latestAuthRef.current) {
          router.replace(loginPath);
        }
      }, 60);
      return () => window.clearTimeout(t);
    }
  }, [hydrated, isAuthenticated, router, bypassAuth, loginPath]);

  // Show loading state while checking permissions
  if (!hydrated || (!bypassAuth && !isAuthenticated)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-secondary">Loading...</p>
        </div>
      </div>
    );
  }

  // Show fallback if permission check failed
  if (!hasPermission) {
    return fallback || (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center bg-surface border border-subtle rounded-lg p-8">
          <h2 className="text-xl font-semibold text-error mb-2">Permission Denied</h2>
          <p className="text-secondary">You don&apos;t have permission to access this resource.</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-surface border border-subtle rounded-lg hover:bg-hover text-primary transition-all duration-200"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
