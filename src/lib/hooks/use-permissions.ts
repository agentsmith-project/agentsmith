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
import type { Project } from '@/lib/api/types';

// Stable empty array reference
const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]) as unknown as string[];

// Project extended with role/permissions from membership
// TODO: This should come from a membership API endpoint
export interface ProjectWithMembership extends Project {
  role?: 'owner' | 'admin' | 'developer' | 'user';
  permissions?: string[];
}

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
    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = currentProject as unknown as ProjectWithMembership | undefined;
    return projectWithMembership?.permissions ?? EMPTY_PERMISSIONS;
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

    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = currentProject as unknown as ProjectWithMembership | undefined;
    const role = projectWithMembership?.role || 'user';
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

    // Cast to extended type - will be resolved when membership API is integrated
    const projectWithMembership = currentProject as unknown as ProjectWithMembership | undefined;
    const role = projectWithMembership?.role || 'user';
    return role === 'owner';
  }, [currentProject]);
}
