/**
 * Permission Checking Hooks
 *
 * Utilities for checking user permissions in components.
 * These hooks use Zustand selectors with stable references to avoid infinite loops.
 */

import { useAuthStore } from '@/lib/stores/authStore';
import { useParams } from 'next/navigation';
import { useProject } from './use-projects-queries';
import { useMemo } from 'react';

// Stable empty array reference
const EMPTY_PERMISSIONS: string[] = Object.freeze([]) as unknown as string[];

// Local interface extending Project with role/permissions
// TODO: This should come from a membership API endpoint
interface ProjectWithMembership {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  visibility: 'public' | 'private';
  role?: 'owner' | 'admin' | 'developer' | 'user';
  permissions?: string[];
  status?: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
}

/**
 * Check if user is authenticated
 */
export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.isAuthenticated);
}

/**
 * Get current project permissions from React Query
 * @returns Array of permission strings, or empty array if no permissions
 */
export function useCurrentPermissions(): readonly string[] {
  const params = useParams();
  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;
  const { data: project } = useProject(workspaceId || '', projectId || '');

  return useMemo(() => {
    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = project as unknown as ProjectWithMembership | undefined;
    return projectWithMembership?.permissions ?? EMPTY_PERMISSIONS;
  }, [project]);
}

/**
 * Check if current user has a specific permission
 *
 * @param permission - The permission string to check (e.g., 'project:read')
 * @returns true if user has the permission, false otherwise
 */
export function useHasPermission(permission: string): boolean {
  const permissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    if (permissions.includes('*')) return true;
    if (permissions.includes(permission)) return true;
    // Prefix wildcard: e.g. 'project:*' grants 'project:audit:read', 'project:usage:read', etc.
    const prefixMatch = permissions.find((p) => p.endsWith(':*'));
    if (prefixMatch) {
      const prefix = prefixMatch.slice(0, -1); // 'project:'
      if (permission.startsWith(prefix)) return true;
    }
    return false;
  }, [permissions, permission]);
}

/**
 * Check if current user has any of the specified permissions
 *
 * @param permissions - Array of permission strings to check
 * @returns true if user has at least one of the permissions, false otherwise
 */
export function useHasAnyPermission(requiredPermissions: string[]): boolean {
  const permissions = useCurrentPermissions();

  return useMemo(() => {
    if (requiredPermissions.length === 0) return false;
    if (permissions.length === 0) return false;
    if (permissions.includes('*')) return true;
    return requiredPermissions.some((p) => permissions.includes(p));
  }, [permissions, requiredPermissions]);
}

/**
 * Check if current user has all of the specified permissions
 *
 * @param permissions - Array of permission strings to check
 * @returns true if user has all of the permissions, false otherwise
 */
export function useHasAllPermissions(requiredPermissions: string[]): boolean {
  const permissions = useCurrentPermissions();

  return useMemo(() => {
    if (requiredPermissions.length === 0) return false;
    if (permissions.length === 0) return false;
    if (permissions.includes('*')) return true;
    return requiredPermissions.every((p) => permissions.includes(p));
  }, [permissions, requiredPermissions]);
}

/**
 * Check if current user is owner or admin
 */
export function useIsOwnerOrAdmin(): boolean {
  const params = useParams();
  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;
  const { data: project } = useProject(workspaceId || '', projectId || '');

  return useMemo(() => {
    if (!project) {
      return false;
    }

    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = project as unknown as ProjectWithMembership | undefined;
    const role = projectWithMembership?.role || 'user';
    return role === 'owner' || role === 'admin';
  }, [project]);
}

/**
 * Check if current user is owner
 */
export function useIsOwner(): boolean {
  const params = useParams();
  const workspaceId = params?.workspace as string | undefined;
  const projectId = params?.project as string | undefined;
  const { data: project } = useProject(workspaceId || '', projectId || '');

  return useMemo(() => {
    if (!project) {
      return false;
    }

    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = project as unknown as ProjectWithMembership | undefined;
    const role = projectWithMembership?.role || 'user';
    return role === 'owner';
  }, [project]);
}
