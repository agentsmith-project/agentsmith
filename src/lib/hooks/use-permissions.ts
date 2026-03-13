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

export type ProjectWithMembership = ValidationProjectWithMembership;

const EMPTY_PERMISSIONS: readonly string[] = Object.freeze([]);

function permissionMatches(granted: readonly string[], required: string): boolean {
  return granted.includes(required);
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

export function useCurrentProjectRole(): ProjectWithMembership['role'] | null {
  const { workspace, project } = useParams();
  const workspaceId = validateWorkspaceParam(workspace);
  const projectId = validateProjectParam(project);
  const { data: currentProject } = useProject(workspaceId ?? '', projectId ?? '');

  return useMemo(() => {
    if (!workspaceId || !projectId) return null;
    const validated = currentProject ? validateProjectWithMembership(currentProject) : null;
    return validated?.role ?? null;
  }, [currentProject, projectId, workspaceId]);
}

export function useCurrentWorkspacePermissions() {
  const { workspace } = useParams();
  const workspaceId = validateWorkspaceParam(workspace);
  const userId = useAuthStore((state) => state.user?.id);
  const userEmail = useAuthStore((state) => state.user?.email);
  const { data: members = [] } = useWorkspaceMembers(workspaceId ?? '');

  return useMemo(() => {
    if (!workspaceId || !userId) return EMPTY_PERMISSIONS;
    const currentMember = members.find((m) => m.user_id === userId || (userEmail ? m.email === userEmail : false));
    if (!currentMember) return EMPTY_PERMISSIONS;
    return currentMember.permissions ?? EMPTY_PERMISSIONS;
  }, [members, userEmail, userId, workspaceId]);
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

export function useCanReadProjectSettings(): boolean {
  return useHasAnyPermission([
    'project:governance:update',
    'project:admins:update',
    'project:lifecycle:update',
  ]);
}

export function useCanReadAudit(): boolean {
  return useHasPermission('project:audit:read');
}

export function useCanManageProjectAdmins(): boolean {
  return useHasPermission('project:admins:update');
}

export function useCanManageProjectLifecycle(): boolean {
  return useHasPermission('project:lifecycle:update');
}

export function useCanManageMemberGovernance(): boolean {
  return useHasPermission('project:membership:update');
}

export function useCanManageResourcePolicy(): boolean {
  return useHasPermission('project:governance:update');
}

export function useCanReadProjectPolicy(): boolean {
  return useHasPermission('project:governance:update');
}

export function useCanUpdateProjectPolicy(): boolean {
  return useHasPermission('project:governance:update');
}

export function useCanAccessCredentials(): { canRead: boolean; canManage: boolean } {
  const canManage = useHasPermission('project:governance:update');
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
