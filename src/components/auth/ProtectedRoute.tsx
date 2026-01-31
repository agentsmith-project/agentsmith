/**
 * Protected Route Wrapper Component
 *
 * A wrapper component that protects routes requiring authentication.
 * Redirects to login page if user is not authenticated.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useIsAuthenticated, useHasPermission, useHasAllPermissions } from '@/lib/hooks/use-permissions';

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
  const isAuthenticated = useIsAuthenticated();

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

  useEffect(() => {
    if (!bypassAuth && !isAuthenticated) {
      // Redirect to login
      router.push('/login');
    }
  }, [isAuthenticated, router, bypassAuth]);

  // Show loading state while checking permissions
  if (!bypassAuth && !isAuthenticated) {
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
