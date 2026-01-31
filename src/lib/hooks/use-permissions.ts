/**
 * Permission Check Hooks
 *
 * Custom hooks for checking user permissions.
 * These hooks wrap the authStore to provide convenient permission checking APIs.
 */

import { useAuthStore } from '@/lib/stores/authStore';

/**
 * Check if current user has a specific permission
 *
 * @example
 * const canCreateAgent = useHasPermission('project:agent:create');
 * if (canCreateAgent) { ... }
 */
export function useHasPermission(permission: string): boolean {
  const currentProject = useAuthStore((state) => state.currentProject);
  const userPermissions = currentProject?.permissions || [];

  return userPermissions.includes('*') || userPermissions.includes(permission);
}

/**
 * Check if current user has any of the specified permissions
 *
 * @example
 * const canManage = useHasAnyPermission(['project:agent:create', 'project:agent:manage']);
 */
export function useHasAnyPermission(permissions: string[]): boolean {
  const currentProject = useAuthStore((state) => state.currentProject);
  const userPermissions = currentProject?.permissions || [];

  return userPermissions.includes('*') ||
    permissions.some((p) => userPermissions.includes(p));
}

/**
 * Check if current user has all of the specified permissions
 *
 * @example
 * const canFullManage = useHasAllPermissions(['project:agent:create', 'project:agent:manage']);
 */
export function useHasAllPermissions(permissions: string[]): boolean {
  const currentProject = useAuthStore((state) => state.currentProject);
  const userPermissions = currentProject?.permissions || [];

  if (userPermissions.includes('*')) {
    return true;
  }

  return permissions.every((p) => userPermissions.includes(p));
}

/**
 * Check if current user is authenticated
 */
export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.isAuthenticated);
}

/**
 * Get current user
 */
export function useCurrentUser() {
  return useAuthStore((state) => state.user);
}

/**
 * Get current workspace
 */
export function useCurrentWorkspace() {
  return useAuthStore((state) => state.currentWorkspace);
}

/**
 * Get current project
 */
export function useCurrentProject() {
  return useAuthStore((state) => state.currentProject);
}

/**
 * Get all available workspaces
 */
export function useWorkspaces() {
  return useAuthStore((state) => state.workspaces);
}

/**
 * Get all available projects in current workspace
 */
export function useProjects() {
  const currentWorkspace = useCurrentWorkspace();
  const allProjects = useAuthStore((state) => state.projects);

  return allProjects.filter((p) => p.workspace_id === currentWorkspace?.id);
}

/**
 * Check if user has a specific role in current project
 */
export function useHasRole(role: 'owner' | 'admin' | 'developer' | 'user'): boolean {
  const currentProject = useCurrentProject();
  if (!currentProject) return false;

  return currentProject.role === role;
}

/**
 * Check if user can manage the current project (owner or admin)
 */
export function useCanManageProject(): boolean {
  const isOwner = useHasRole('owner');
  const isAdmin = useHasRole('admin');
  return isOwner || isAdmin;
}

/**
 * Check if user is the owner of current project
 */
export function useIsOwner(): boolean {
  return useHasRole('owner');
}

/**
 * Check if user is a developer or higher in current project
 */
export function useIsDeveloper(): boolean {
  const isOwner = useHasRole('owner');
  const isAdmin = useHasRole('admin');
  const isDev = useHasRole('developer');
  return isOwner || isAdmin || isDev;
}
