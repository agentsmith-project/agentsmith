import type { ProjectWithMembership } from '@/lib/hooks/use-permissions';

export type Project = ProjectWithMembership & { pinned: boolean };

export function hasProjectPermission(project: Project, permission: string): boolean {
  return Array.isArray(project.permissions) && project.permissions.includes(permission);
}

export function hasAnyProjectPermission(project: Project, permissions: readonly string[]): boolean {
  return permissions.some((permission) => hasProjectPermission(project, permission));
}

function isNonMemberProject(project: Pick<ProjectWithMembership, 'permissions'>): boolean {
  return !(Array.isArray(project.permissions) && project.permissions.length > 0);
}

export function canRequestProjectJoin(project: Pick<ProjectWithMembership, 'permissions' | 'visibility' | 'join_policy' | 'status'>): boolean {
  return isNonMemberProject(project)
    && project.visibility === 'public'
    && project.join_policy === 'approval_required'
    && project.status === 'active';
}

export function canSelfJoinProject(project: Pick<ProjectWithMembership, 'permissions' | 'visibility' | 'join_policy' | 'status'>): boolean {
  return isNonMemberProject(project)
    && project.visibility === 'public'
    && project.join_policy === 'open'
    && project.status === 'active';
}

export function requiresProjectJoinFlow(project: Pick<ProjectWithMembership, 'permissions' | 'visibility' | 'join_policy' | 'status'>): boolean {
  return canRequestProjectJoin(project) || canSelfJoinProject(project);
}

export function buildProjectAdminSummary(
  project: Pick<ProjectWithMembership, 'admin_member_ids' | 'owner_id'>,
  memberNameById: Map<string, string>,
): string {
  const ids = [...(project.admin_member_ids ?? []), project.owner_id];
  const resolved = ids.map((id) => memberNameById.get(id) || id);
  const unique = Array.from(new Set(resolved.filter((name) => name.trim().length > 0)));
  if (unique.length === 0) return '-';
  if (unique.length <= 2) return unique.join(', ');
  return `${unique.slice(0, 2).join(', ')}...`;
}
