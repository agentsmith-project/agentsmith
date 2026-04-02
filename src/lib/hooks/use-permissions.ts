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

export function useCanAccessNotebook(): boolean {
  return useHasPermission('project:endpoint:use');
}

export function useCanUseNotebookTerminal(): boolean {
  return useHasPermission('project:terminal:use');
}

export function useAgentPageCapabilities() {
  const canUse = useHasPermission('project:agent:use');
  const canManage = useHasPermission('project:agent:manage');
  const canPublic = useHasPermission('project:agent:public');

  return useMemo(() => ({
    canRead: canUse || canManage,
    canCreate: canManage,
    canUpdate: canManage,
    canDelete: canManage,
    canIssueKeys: canManage,
    canRevokeKeys: canManage,
    canUse,
    canManage,
    canPublic,
  }), [canManage, canPublic, canUse]);
}

export function useEndpointPageCapabilities() {
  const canUse = useHasPermission('project:endpoint:use');
  const canManage = useHasPermission('project:governance:update');

  return useMemo(() => ({
    canUse,
    canManage,
    canRead: canUse || canManage,
  }), [canManage, canUse]);
}

export function useAlertPageCapabilities() {
  const canRead = useCanReadAudit();
  const canManage = useHasPermission('project:governance:update');

  return useMemo(() => ({
    canRead,
    canManage,
  }), [canManage, canRead]);
}

export function useUsagePageCapabilities() {
  const canRead = useHasPermission('project:endpoint:use');

  return useMemo(() => ({
    canRead,
  }), [canRead]);
}

export function useFilesPageCapabilities() {
  const canRead = useHasPermission('project:endpoint:use');
  const canManage = canRead;
  const canExchangeCredentials = canRead;

  return useMemo(() => ({
    canRead,
    canManage,
    canExchangeCredentials,
  }), [canExchangeCredentials, canManage, canRead]);
}

export function useMemberPageCapabilities() {
  const canRead = useHasPermission('project:membership:update');
  const canManage = canRead;

  return useMemo(() => ({
    canRead,
    canManage,
  }), [canManage, canRead]);
}

export function useProjectOverviewCapabilities() {
  const canUseProject = useHasPermission('project:endpoint:use');
  const canUseAgents = useHasPermission('project:agent:use');
  const canManageAgents = useHasPermission('project:agent:manage');
  const canManageGovernance = useHasPermission('project:governance:update');
  const canManageMembership = useHasPermission('project:membership:update');
  const canReadAudit = useCanReadAudit();
  const canReadProjectSettings = useCanReadProjectSettings();

  return useMemo(() => ({
    canUseProject,
    canUseAgents,
    canManageAgents,
    canManageGovernance,
    canManageMembership,
    canReadAudit,
    canReadProjectSettings,
  }), [
    canManageAgents,
    canManageGovernance,
    canManageMembership,
    canReadAudit,
    canReadProjectSettings,
    canUseAgents,
    canUseProject,
  ]);
}

export function useProjectSettingsCapabilities() {
  const canReadSettings = useCanReadProjectSettings();
  const canReadAudit = useCanReadAudit();
  const canManageProjectLifecycle = useCanManageProjectLifecycle();
  const canManageProjectAdmins = useCanManageProjectAdmins();
  const canManageGovernance = useHasPermission('project:governance:update');
  const canManageMembership = useHasPermission('project:membership:update');

  return useMemo(() => ({
    canReadSettings,
    canReadAudit,
    canManageProjectLifecycle,
    canManageProjectAdmins,
    canManageGovernance,
    canManageMembership,
  }), [
    canManageGovernance,
    canManageMembership,
    canManageProjectAdmins,
    canManageProjectLifecycle,
    canReadAudit,
    canReadSettings,
  ]);
}
