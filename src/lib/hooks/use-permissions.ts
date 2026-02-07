/**
 * Permission Hooks (token-only)
 */

import { useMemo } from 'react';
import { useProject } from './use-projects-queries';
import { useWorkspaceMembers } from './use-workspaces';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { validateProjectWithMembership, type ProjectWithMembership as ValidationProjectWithMembership } from '@/lib/utils/validation-zod';

export type ProjectWithMembership = ValidationProjectWithMembership;

const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]);

function permissionMatches(granted: readonly string[], required: string): boolean {
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;
  return granted.some((p) => p.endsWith(':*') && required.startsWith(p.slice(0, -1)));
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.isAuthenticated);
}

export function useCurrentPermissions() {
  const { workspace, project } = useParams();
  const workspaceId = workspace as string;
  const projectId = project as string;
  const { data: currentProject } = useProject(workspaceId, projectId);

  return useMemo(() => {
    const validated = currentProject ? validateProjectWithMembership(currentProject) : null;
    if (!validated) return EMPTY_PERMISSIONS;
    return validated.permissions ?? EMPTY_PERMISSIONS;
  }, [currentProject]);
}

export function useCurrentWorkspacePermissions() {
  const { workspace } = useParams();
  const workspaceId = workspace as string;
  const userId = useAuthStore((state) => state.user?.id);
  const { data: members = [] } = useWorkspaceMembers(workspaceId);

  return useMemo(() => {
    if (!userId) return EMPTY_PERMISSIONS;
    const currentMember = members.find((m) => m.user_id === userId);
    if (!currentMember) return EMPTY_PERMISSIONS;
    return currentMember.permissions ?? EMPTY_PERMISSIONS;
  }, [members, userId]);
}

export function useHasPermission(permission: string): boolean {
  const permissions = useCurrentPermissions();
  return useMemo(() => permissionMatches(permissions, permission), [permissions, permission]);
}

export function useHasWorkspacePermission(permission: string): boolean {
  const permissions = useCurrentWorkspacePermissions();
  return useMemo(() => permissionMatches(permissions, permission), [permissions, permission]);
}

export function useHasAnyPermission(permissions: string[]): boolean {
  const currentPermissions = useCurrentPermissions();
  return useMemo(() => permissions.some((p) => permissionMatches(currentPermissions, p)), [currentPermissions, permissions]);
}

export function useHasAllPermissions(permissions: string[]): boolean {
  const currentPermissions = useCurrentPermissions();
  return useMemo(() => permissions.every((p) => permissionMatches(currentPermissions, p)), [currentPermissions, permissions]);
}

// Backward-compatible semantic aliases, now token-driven.
export function useIsOwnerOrAdmin(): boolean {
  return useHasPermission('project:member:manage');
}

export function useIsOwner(): boolean {
  return useHasPermission('project:settings:manage');
}

export function useIsProjectAdmin(): boolean {
  return useHasPermission('project:member:manage');
}

export function useCanManageProject(): boolean {
  return useHasPermission('project:settings:manage');
}

export function useCanManageMemberGovernance(): boolean {
  return useHasPermission('project:member:manage');
}

export function useCanManageResourcePolicy(): boolean {
  return useHasPermission('project:resource_policy:manage');
}

export function useCanReadProjectPolicy(): boolean {
  return useHasPermission('project:settings:manage');
}

export function useCanUpdateProjectPolicy(): boolean {
  return useHasPermission('project:settings:manage');
}

export function useCanAccessCredentials(): { canRead: boolean; canManage: boolean } {
  const canManage = useHasPermission('project:credential:manage');
  return useMemo(() => ({ canRead: canManage, canManage }), [canManage]);
}

export function useCanAccessChat(): boolean {
  return useHasPermission('project:chat:access');
}

export function useCanUseChat(): boolean {
  return useCanAccessChat();
}

export function useCanManageChatSessions(): boolean {
  return useCanAccessChat();
}

export function useCanAccessStudio(): boolean {
  return useHasPermission('project:studio:access');
}

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
