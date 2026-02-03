/**
 * Permission Checking Hooks
 *
 * Utilities for checking user permissions in components.
 * These hooks use Zustand selectors with stable references to avoid infinite loops.
 */

import { useAuthStore, selectHasPermission, selectHasAnyPermission, selectHasAllPermissions, selectCurrentPermissions } from '@/lib/stores/authStore';
import { useMemo } from 'react';

/**
 * Check if user is authenticated
 */
export function useIsAuthenticated(): boolean {
  return useAuthStore(state => state.isAuthenticated);
}

/**
 * Check if current user has a specific permission
 * 
 * @param permission - The permission string to check (e.g., 'project:read')
 * @returns true if user has the permission, false otherwise
 */
export function useHasPermission(permission: string): boolean {
  // Use stable selector factory - Zustand will handle memoization
  const selector = useMemo(
    () => selectHasPermission(permission),
    [permission]
  );
  
  return useAuthStore(selector);
}

/**
 * Check if current user has any of the specified permissions
 * 
 * @param permissions - Array of permission strings to check
 * @returns true if user has at least one of the permissions, false otherwise
 */
export function useHasAnyPermission(permissions: string[]): boolean {
  const stablePermissions = useMemo(() => permissions, [permissions]);
  
  // Use stable selector factory
  const selector = useMemo(
    () => selectHasAnyPermission(stablePermissions),
    [stablePermissions]
  );
  
  return useAuthStore(selector);
}

/**
 * Check if current user has all of the specified permissions
 * 
 * @param permissions - Array of permission strings to check
 * @returns true if user has all of the permissions, false otherwise
 */
export function useHasAllPermissions(permissions: string[]): boolean {
  const stablePermissions = useMemo(() => permissions, [permissions]);
  
  // Use stable selector factory
  const selector = useMemo(
    () => selectHasAllPermissions(stablePermissions),
    [stablePermissions]
  );
  
  return useAuthStore(selector);
}

/**
 * Get current user permissions array
 * 
 * @returns Array of permission strings, or empty array if no permissions
 */
export function useCurrentPermissions(): readonly string[] {
  return useAuthStore(selectCurrentPermissions);
}

/**
 * Check if current user is owner or admin
 */
export function useIsOwnerOrAdmin(): boolean {
  const currentProject = useAuthStore(state => state.currentProject);
  
  if (!currentProject) {
    return false;
  }

  const role = currentProject.role || 'user';
  return role === 'owner' || role === 'admin';
}

/**
 * Check if current user is owner
 */
export function useIsOwner(): boolean {
  const currentProject = useAuthStore(state => state.currentProject);
  
  if (!currentProject) {
    return false;
  }

  const role = currentProject.role || 'user';
  return role === 'owner';
}
