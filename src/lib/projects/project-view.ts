import type { ProjectWithMembership } from '@/lib/hooks/use-permissions';

export type Project = ProjectWithMembership & { pinned: boolean };

export function hasProjectPermission(project: Project, permission: string): boolean {
  return Array.isArray(project.permissions) && project.permissions.includes(permission);
}

export function hasAnyProjectPermission(project: Project, permissions: readonly string[]): boolean {
  return permissions.some((permission) => hasProjectPermission(project, permission));
}

export function isPendingProjectMembership(
  project: Pick<ProjectWithMembership, 'membership_status'>,
): boolean {
  return project.membership_status === 'pending';
}

function isJoinEligibleNonMemberProject(
  project: Pick<ProjectWithMembership, 'membership_status' | 'visibility' | 'status'>,
): boolean {
  return project.membership_status === 'none'
    && project.visibility === 'public'
    && project.status === 'active';
}

export function canRequestProjectJoin(
  project: Pick<ProjectWithMembership, 'membership_status' | 'visibility' | 'join_policy' | 'status'>,
): boolean {
  return isJoinEligibleNonMemberProject(project)
    && project.join_policy === 'approval_required';
}

export function canSelfJoinProject(
  project: Pick<ProjectWithMembership, 'membership_status' | 'visibility' | 'join_policy' | 'status'>,
): boolean {
  return isJoinEligibleNonMemberProject(project)
    && project.join_policy === 'open';
}

export function requiresProjectJoinFlow(
  project: Pick<ProjectWithMembership, 'membership_status' | 'visibility' | 'join_policy' | 'status'>,
): boolean {
  return isPendingProjectMembership(project) || canRequestProjectJoin(project) || canSelfJoinProject(project);
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
