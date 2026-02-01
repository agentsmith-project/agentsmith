/**
 * Protected Route Wrapper Component
 *
 * A wrapper component that protects routes requiring authentication.
 * Redirects to login page if user is not authenticated.
 */

'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIsAuthenticated, useHasPermission, useHasAllPermissions } from '@/lib/hooks/use-permissions';
import { useAuthStore } from '@/lib/stores/authStore';

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
  const hydrated = useAuthStore((s) => s.hydrated);

  // Check permission if specified - must call hooks unconditionally
  const hasAllPermissionsResult = useHasAllPermissions(requirePermission && Array.isArray(requirePermission) ? requirePermission : []);
  const hasSinglePermissionResult = useHasPermission(requirePermission && typeof requirePermission === 'string' ? requirePermission : '');

  // Determine hasPermission based on requirePermission type
  let hasPermission = true;
  if (requirePermission && isAuthenticated) {
    if (Array.isArray(requirePermission)) {
      hasPermission = hasAllPermissionsResult;
    } else {
      hasPermission = hasSinglePermissionResult;
    }
  }

  // Mock development check - bypass auth in dev if needed
  const isDev = process.env.NODE_ENV === 'development';
  const bypassAuth = isDev && process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true';

  // Extract locale from pathname for login redirect
  const loginPath = useMemo(() => {
    const segments = pathname.split('/');
    const locale = segments[1] || 'en-US'; // Default to en-US if no locale in path
    return `/${locale}/login`;
  }, [pathname]);

  useEffect(() => {
    if (!hydrated) return;
    // In development with E2E tests, check if mock auth is being set up
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hasMockAuthSetup = typeof window !== 'undefined' && !!(window as any).__MBOS_AUTH_SETUP__;

    if (hasMockAuthSetup && !bypassAuth && !isAuthenticated) {
      // Poll for mock auth to be set up (E2E testing scenario)
      const checkMockAuth = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__MBOS_AUTH_STORE__;
        if (store && store.getState) {
          const state = store.getState();
          if (state.isAuthenticated) {
            console.log('[ProtectedRoute] Mock auth detected, isAuthenticated:', state.isAuthenticated);
            return true;
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
      // Normal redirect to login (production or non-E2E dev)
      router.replace(loginPath);
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
