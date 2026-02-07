/**
 * Permission Hooks
 *
 * Check user permissions for current project.
 * Project data comes from React Query, not Zustand.
 * Auth state (user, token, isAuthenticated) remains in Zustand.
 */

import { useMemo } from 'react';
import { useProject } from './use-projects-queries';
import { useWorkspaceMembers } from './use-workspaces';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { useWorkspaceGovernance } from './use-workspace-governance';
import { validateProjectWithMembership, type ProjectWithMembership as ValidationProjectWithMembership } from '@/lib/utils/validation-zod';
import { ROLE_TEMPLATES } from '@/lib/constants/permissions';

// Re-export type for backward compatibility
export type ProjectWithMembership = ValidationProjectWithMembership;

// Stable empty array reference - now properly typed
const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]);

/**
 * Check if a set of granted permissions includes a required permission,
 * supporting wildcard matching (e.g. 'project:*' grants 'project:audit:read').
 */
function permissionMatches(granted: readonly string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  // Prefix wildcard: e.g. 'project:*' grants 'project:audit:read'
  return granted.some((p) => {
    if (!p.endsWith(':*')) return false;
    const prefix = p.slice(0, -1); // e.g. 'project:'
    return required.startsWith(prefix);
  });
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
    // Runtime validation: ensure project data matches expected schema
    const validated = currentProject ? validateProjectWithMembership(currentProject) : null;
    if (!validated) return EMPTY_PERMISSIONS;

    const explicitPermissions = validated.permissions ?? [];
    if (explicitPermissions.length > 0) {
      return explicitPermissions;
    }

    const role = validated.role;
    if (!role) return EMPTY_PERMISSIONS;
    return ROLE_TEMPLATES[role] ?? EMPTY_PERMISSIONS;
  }, [currentProject]);
}

/**
 * Get current workspace permissions.
 *
 * Priority:
 * 1) explicit permissions returned by backend for workspace membership
 * 2) role template fallback for strict gate checks on workspace-scoped pages
 */
export function useCurrentWorkspacePermissions() {
  const { workspace } = useParams();
  const workspaceId = workspace as string;
  const userId = useAuthStore((state) => state.user?.id);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);

  return useMemo(() => {
    if (!userId) return EMPTY_PERMISSIONS;
    const currentMember = members.find((m) => m.user_id === userId);
    if (!currentMember) return EMPTY_PERMISSIONS;

    if (currentMember.permissions && currentMember.permissions.length > 0) {
      return currentMember.permissions;
    }

    return ROLE_TEMPLATES[currentMember.role] ?? EMPTY_PERMISSIONS;
  }, [members, userId]);
}

/**
 * Check if user has a specific permission
 */
export function useHasPermission(permission: string): boolean {
  const permissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    return permissionMatches(permissions, permission);
  }, [permissions, permission]);
}

/**
 * Check workspace-scoped permission on routes without [project] param.
 */
export function useHasWorkspacePermission(permission: string): boolean {
  const permissions = useCurrentWorkspacePermissions();

  return useMemo(() => {
    if (permissions.length === 0) return false;
    return permissionMatches(permissions, permission);
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
    return permissions.some((p) => permissionMatches(currentPermissions, p));
  }, [currentPermissions, permissions]);
}

/**
 * Check if user has all of the specified permissions
 */
export function useHasAllPermissions(permissions: string[]): boolean {
  const currentPermissions = useCurrentPermissions();

  return useMemo(() => {
    if (permissions.length === 0) return true; // vacuous truth
    if (currentPermissions.length === 0) return false;
    return permissions.every((p) => permissionMatches(currentPermissions, p));
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

/**
 * Check if current user is project admin in current project.
 */
export function useIsProjectAdmin(): boolean {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    if (!currentProject) return false;
    const validated = validateProjectWithMembership(currentProject);
    const role = validated?.role;
    return role === 'owner' || role === 'admin';
  }, [currentProject]);
}

/**
 * Check if current user can manage current project.
 * Requires project admin membership and project update/delete capability.
 */
export function useCanManageProject(): boolean {
  const isProjectAdmin = useIsProjectAdmin();
  const canProjectUpdate = useHasPermission('project:update');
  const canProjectDelete = useHasPermission('project:delete');

  return useMemo(
    () => isProjectAdmin && (canProjectUpdate || canProjectDelete),
    [isProjectAdmin, canProjectUpdate, canProjectDelete],
  );
}

/**
 * Governance write operations in members module require:
 * 1) current user is project admin in this project
 * 2) has member governance mutation token
 */
export function useCanManageMemberGovernance(): boolean {
  const isProjectAdmin = useIsProjectAdmin();
  const canProjectAdminGrant = useHasPermission('project:admin:grant');
  const canProjectAdminRevoke = useHasPermission('project:admin:revoke');
  const hasManageToken = canProjectAdminGrant || canProjectAdminRevoke;

  return useMemo(
    () => isProjectAdmin && hasManageToken,
    [isProjectAdmin, hasManageToken],
  );
}

/**
 * Resource policy write operations require:
 * 1) current user is project admin in this project
 * 2) has update token for at least one governed resource type
 */
export function useCanManageResourcePolicy(): boolean {
  const isProjectAdmin = useIsProjectAdmin();
  const canUpdateEndpoint = useHasPermission('project:endpoint:update');
  const canUpdateSourceLibrary = useHasPermission('project:source:library:update');
  const canUpdateAgent = useHasPermission('project:agent:update');
  const hasResourcePolicyToken = canUpdateEndpoint || canUpdateSourceLibrary || canUpdateAgent;

  return useMemo(
    () => isProjectAdmin && hasResourcePolicyToken,
    [isProjectAdmin, hasResourcePolicyToken],
  );
}

/**
 * Check if current user can read project policy.
 */
export function useCanReadProjectPolicy(): boolean {
  const canPolicyRead = useHasPermission('project:policy:read');
  const canPolicyUpdate = useHasPermission('project:policy:update');
  return useMemo(() => canPolicyRead || canPolicyUpdate, [canPolicyRead, canPolicyUpdate]);
}

/**
 * Check if current user can update project policy.
 */
export function useCanUpdateProjectPolicy(): boolean {
  const isProjectAdmin = useIsProjectAdmin();
  const canPolicyUpdate = useHasPermission('project:policy:update');
  return useMemo(() => isProjectAdmin && canPolicyUpdate, [isProjectAdmin, canPolicyUpdate]);
}

/**
 * Credentials access requires wheel governance + endpoint/source management token gate.
 */
export function useCanAccessCredentials(): { canRead: boolean; canManage: boolean } {
  const { workspace } = useParams();
  const workspaceId = workspace as string;
  const { canViewCredentials } = useWorkspaceGovernance(workspaceId || '');
  const isProjectAdmin = useIsProjectAdmin();
  const canEndpointRead = useHasPermission('project:endpoint:read');
  const canEndpointCreate = useHasPermission('project:endpoint:create');
  const canEndpointUpdate = useHasPermission('project:endpoint:update');
  const canEndpointDelete = useHasPermission('project:endpoint:delete');
  const canSourceLibraryRead = useHasPermission('project:source:library:read');
  const canSourceLibraryCreate = useHasPermission('project:source:library:create');
  const canSourceLibraryUpdate = useHasPermission('project:source:library:update');
  const canSourceLibraryDelete = useHasPermission('project:source:library:delete');

  return useMemo(
    () => ({
      canRead:
        canViewCredentials &&
        (
          canEndpointRead ||
          canEndpointUpdate ||
          canEndpointDelete ||
          canSourceLibraryRead ||
          canSourceLibraryUpdate ||
          canSourceLibraryDelete
        ),
      canManage:
        isProjectAdmin &&
        canViewCredentials &&
        (
          canEndpointCreate ||
          canEndpointUpdate ||
          canEndpointDelete ||
          canSourceLibraryCreate ||
          canSourceLibraryUpdate ||
          canSourceLibraryDelete
        ),
    }),
    [
      canViewCredentials,
      isProjectAdmin,
      canEndpointRead,
      canEndpointCreate,
      canEndpointUpdate,
      canEndpointDelete,
      canSourceLibraryRead,
      canSourceLibraryCreate,
      canSourceLibraryUpdate,
      canSourceLibraryDelete,
    ],
  );
}

/**
 * Chat page access gate.
 */
export function useCanAccessChat(): boolean {
  return useHasPermission('project:chat:access');
}

/**
 * Backward-compatible alias.
 */
export function useCanUseChat(): boolean {
  return useCanAccessChat();
}

/**
 * Chat actions follow chat access in MVP.
 */
export function useCanManageChatSessions(): boolean {
  return useCanAccessChat();
}

/**
 * Studio (workbench/task) access gate.
 */
export function useCanAccessStudio(): boolean {
  return useHasPermission('project:studio:access');
}

/**
 * Backward-compatible alias.
 */
export function useCanReadRecipes(): boolean {
  return useCanAccessStudio();
}

export function useCanCreateRecipe(): boolean {
  return useCanAccessStudio();
}

export function useCanUpdateRecipe(): boolean {
  return useCanAccessStudio();
}

export function useCanDeleteRecipe(): boolean {
  return useCanAccessStudio();
}
