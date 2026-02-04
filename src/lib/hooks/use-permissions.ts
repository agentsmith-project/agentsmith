/**
 * Permission Hooks
 *
 * Check user permissions for current project.
 * Project data comes from React Query, not Zustand.
 * Auth state (user, token, isAuthenticated) remains in Zustand.
 */

import { useMemo } from 'react';
import { useProject } from './use-projects-queries';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { validateProjectWithMembership, type ProjectWithMembership as ValidationProjectWithMembership } from '@/lib/utils/validation-zod';

// Re-export type for backward compatibility
export type ProjectWithMembership = ValidationProjectWithMembership;

// Stable empty array reference - now properly typed
const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]);

/**
 * Check if user is authenticated
 */
export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.isAuthenticated);
}

/**
 * Get current project permissions
 */
export function useCurrentPermissions() {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;

  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    // Runtime validation: ensure project data matches expected schema
    const validated = currentProject ? validateProjectWithMembership(currentProject) : null;
    return validated?.permissions ?? EMPTY_PERMISSIONS;
  }, [currentProject]);
}

/**
 * Check if user has a specific permission
 */
export function useHasPermission(permission: string): boolean {
  const permissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    if (permissions.includes('*')) return true;
    if (permissions.includes(permission)) return true;

    // Prefix wildcard: e.g. 'project:*' grants 'project:audit:read'
    const prefixMatch = permissions.find((p) => p.endsWith(':*'));
    if (prefixMatch) {
      const prefix = prefixMatch.slice(0, -1);
      if (permission.startsWith(prefix)) return true;
    }

    return false;
  }, [permissions, permission]);
}

/**
 * Check if user has any of the specified permissions
 */
export function useHasAnyPermission(permissions: string[]): boolean {
  const currentPermissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    if (currentPermissions.length === 0) return false;
    if (currentPermissions.includes('*')) return true;
    return permissions.some((p) => currentPermissions.includes(p));
  }, [currentPermissions, permissions]);
}

/**
 * Check if user has all of the specified permissions
 */
export function useHasAllPermissions(permissions: string[]): boolean {
  const currentPermissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    if (currentPermissions.length === 0) return false;
    if (currentPermissions.includes('*')) return true;
    return permissions.every((p) => currentPermissions.includes(p));
  }, [currentPermissions, permissions]);
}

/**
 * Check if current user is owner or admin
 */
export function useIsOwnerOrAdmin(): boolean {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    if (!currentProject) {
      return false;
    }

    // Runtime validation: ensure project data matches expected schema
    const validated = validateProjectWithMembership(currentProject);
    const role = validated?.role || 'user';
    return role === 'owner' || role === 'admin';
  }, [currentProject]);
}

/**
 * Check if current user is owner
 */
export function useIsOwner(): boolean {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    if (!currentProject) {
      return false;
    }

    // Runtime validation: ensure project data matches expected schema
    const validated = validateProjectWithMembership(currentProject);
    const role = validated?.role || 'user';
    return role === 'owner';
  }, [currentProject]);
}
