/**
 * Permission Hooks (token-only)
 */

import { useMemo } from 'react';
import { useProject } from './use-projects-queries';
import { useWorkspaceMembers } from './use-workspaces';
import { useParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { validateProjectWithMembership, type ProjectWithMembership as ValidationProjectWithMembership } from '@/lib/utils/validation-zod';
import { validateProjectParam, validateWorkspaceParam } from '@/lib/utils/validate-url-params';
import { LEGACY_PERMISSION_ALIASES } from '@/lib/constants/permissions';

export type ProjectWithMembership = ValidationProjectWithMembership;

const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]);

// Deprecated alias bridge for mixed-token environments.
// New gates must use canonical tokens: endpoint:use / agent:manage / agent:public.
function buildPermissionAliases(): Record<string, readonly string[]> {
  const map: Record<string, string[]> = {};
  for (const [legacy, canonical] of Object.entries(LEGACY_PERMISSION_ALIASES)) {
    map[legacy] ??= [];
    map[canonical] ??= [];
    map[legacy].push(canonical);
    map[canonical].push(legacy);
  }
  return map;
}

const PERMISSION_ALIASES = buildPermissionAliases();

function permissionMatches(granted: readonly string[], required: string): boolean {
  if (granted.includes(required)) return true;
  const aliases = PERMISSION_ALIASES[required];
  if (!aliases || aliases.length === 0) return false;
  return aliases.some((alias) => granted.includes(alias));
}

export function useIsAuthenticated(): boolean {
  return useAuthStore((state) => state.isAuthenticated);
}

export function useCurrentPermissions() {
  const { workspace, project } = useParams();
  const workspaceId = validateWorkspaceParam(workspace);
  const projectId = validateProjectParam(project);
  const { data: currentProject } = useProject(workspaceId ?? '', projectId ?? '');

  return useMemo(() => {
    if (!workspaceId || !projectId) return EMPTY_PERMISSIONS;
    const validated = currentProject ? validateProjectWithMembership(currentProject) : null;
    if (!validated) return EMPTY_PERMISSIONS;

    return validated.permissions ?? EMPTY_PERMISSIONS;
  }, [currentProject, workspaceId, projectId]);
}

export function useCurrentWorkspacePermissions() {
  const { workspace } = useParams();
  const workspaceId = validateWorkspaceParam(workspace);
  const userId = useAuthStore((state) => state.user?.id);
  const { data: members = [] } = useWorkspaceMembers(workspaceId ?? '');

  return useMemo(() => {
    if (!workspaceId || !userId) return EMPTY_PERMISSIONS;
    const currentMember = members.find((m) => m.user_id === userId);
    if (!currentMember) return EMPTY_PERMISSIONS;
    return currentMember.permissions ?? EMPTY_PERMISSIONS;
  }, [members, userId, workspaceId]);
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

// Semantic aliases mapped to token checks.
export function useIsOwnerOrAdmin(): boolean {
  return useHasPermission('project:manage');
}

export function useIsOwner(): boolean {
  return useHasPermission('project:manage');
}

export function useIsProjectAdmin(): boolean {
  return useHasPermission('project:manage');
}

export function useCanManageProject(): boolean {
  return useHasPermission('project:manage');
}

export function useCanManageMemberGovernance(): boolean {
  return useHasPermission('project:manage');
}

export function useCanManageResourcePolicy(): boolean {
  return useHasPermission('project:manage');
}

export function useCanReadProjectPolicy(): boolean {
  return useHasPermission('project:manage');
}

export function useCanUpdateProjectPolicy(): boolean {
  return useHasPermission('project:manage');
}

export function useCanAccessCredentials(): { canRead: boolean; canManage: boolean } {
  const canManage = useHasPermission('project:manage');
  return useMemo(() => ({ canRead: canManage, canManage }), [canManage]);
}

export function useCanAccessChat(): boolean {
  return useHasPermission('project:endpoint:use');
}

export function useCanUseChat(): boolean {
  return useCanAccessChat();
}

export function useCanManageChatSessions(): boolean {
  return useCanAccessChat();
}

export function useCanAccessNotebook(): boolean {
  return useHasPermission('project:endpoint:use');
}

export function useCanReadTasks(): boolean {
  return useCanAccessNotebook();
}

export function useCanCreateTask(): boolean {
  return useCanAccessNotebook();
}

export function useCanUpdateTask(): boolean {
  return useCanAccessNotebook();
}

export function useCanDeleteTask(): boolean {
  return useCanAccessNotebook();
}
