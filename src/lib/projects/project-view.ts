import type { ProjectWithMembership } from '@/lib/hooks/use-permissions';

export type Project = ProjectWithMembership & { pinned: boolean };

export function formatProjectGroupAlias(role: string | undefined): string {
  switch (role) {
    case 'owner':
      return 'governance';
    case 'admin':
      return 'manager';
    case 'developer':
      return 'operator';
    case 'user':
      return 'member';
    default:
      return role ? role.charAt(0).toUpperCase() + role.slice(1) : '-';
  }
}

export function hasProjectPermission(project: Project, permission: string): boolean {
  return Array.isArray(project.permissions) && project.permissions.includes(permission);
}

export function hasAnyProjectPermission(project: Project, permissions: readonly string[]): boolean {
  return permissions.some((permission) => hasProjectPermission(project, permission));
}

export function buildProjectAdminSummary(
  project: Pick<ProjectWithMembership, 'governance_json' | 'owner_id'>,
  memberNameById: Map<string, string>,
): string {
  const rawAdmins = project.governance_json?.['project_admins'];
  const ids: string[] = [];
  const labels: string[] = [];

  if (Array.isArray(rawAdmins)) {
    for (const item of rawAdmins) {
      if (typeof item === 'string') {
        ids.push(item);
        continue;
      }
      if (item && typeof item === 'object') {
        const maybeId = (item as Record<string, unknown>).id;
        const maybeName = (item as Record<string, unknown>).name;
        if (typeof maybeId === 'string') ids.push(maybeId);
        if (typeof maybeName === 'string' && maybeName.trim()) labels.push(maybeName.trim());
      }
    }
  }

  ids.push(project.owner_id);
  const resolved = [...labels, ...ids.map((id) => memberNameById.get(id) || id)];
  const unique = Array.from(new Set(resolved.filter((name) => name.trim().length > 0)));
  if (unique.length === 0) return '-';
  if (unique.length <= 2) return unique.join(', ');
  return `${unique.slice(0, 2).join(', ')}...`;
}
