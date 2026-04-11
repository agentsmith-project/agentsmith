import type { ProjectRoutePolicy } from '@/lib/routes/project-route-policy';
import {
  PROJECT_ROUTE_POLICIES,
  findProjectRoutePolicyByHref,
  listSidebarProjectRoutePolicies,
} from '@/lib/routes/project-route-policy-manifest';

const PROJECT_SURFACE_SECTION_ORDER: Record<ProjectRoutePolicy['navSection'], number> = {
  home: 0,
  use: 1,
  develop: 2,
  govern: 3,
  operate: 4,
};

type ProjectPermissionCarrier = {
  permissions?: readonly string[] | null;
};

type ProjectIdentity = {
  id: string;
};

export type ProjectSurfaceHref = ProjectRoutePolicy['href'];

export interface WorkspaceGovernanceProjectActions {
  canOpenOverview: boolean;
  canOpenMembers: boolean;
  canOpenSettings: boolean;
}

function normalizePermissions(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
): readonly string[] {
  if (Array.isArray(value)) {
    return value;
  }
  const carrier = value as ProjectPermissionCarrier | null | undefined;
  if (carrier && Array.isArray(carrier.permissions)) {
    return carrier.permissions;
  }
  return [];
}

function hasAnyRoutePermission(
  permissions: readonly string[],
  routePermissions: readonly string[],
): boolean {
  return routePermissions.some((permission) => permissions.includes(permission));
}

function comparePolicies(left: ProjectRoutePolicy, right: ProjectRoutePolicy): number {
  const sectionDelta = PROJECT_SURFACE_SECTION_ORDER[left.navSection] - PROJECT_SURFACE_SECTION_ORDER[right.navSection];
  if (sectionDelta !== 0) return sectionDelta;
  return left.navOrder - right.navOrder;
}

function dedupeProjectsById<T extends ProjectIdentity>(projects: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const project of projects) {
    if (seen.has(project.id)) continue;
    seen.add(project.id);
    result.push(project);
  }
  return result;
}

export function canAccessProjectRoute(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
  policy: ProjectRoutePolicy,
): boolean {
  return hasAnyRoutePermission(normalizePermissions(value), policy.permissions);
}

export function canAccessProjectSurfaceHref(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
  href: ProjectSurfaceHref,
): boolean {
  const policy = findProjectRoutePolicyByHref(href);
  if (!policy) return false;
  return canAccessProjectRoute(value, policy);
}

export function listAccessibleProjectRoutePolicies(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
): readonly ProjectRoutePolicy[] {
  const permissions = normalizePermissions(value);
  return PROJECT_ROUTE_POLICIES
    .filter((policy) => hasAnyRoutePermission(permissions, policy.permissions))
    .sort(comparePolicies);
}

export function listAccessibleSidebarProjectRoutePolicies(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
): readonly ProjectRoutePolicy[] {
  const permissions = normalizePermissions(value);
  return listSidebarProjectRoutePolicies()
    .filter((policy) => hasAnyRoutePermission(permissions, policy.permissions))
    .sort(comparePolicies);
}

export function resolveDefaultProjectSurfaceHref(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
): ProjectSurfaceHref | null {
  const [first] = listAccessibleSidebarProjectRoutePolicies(value);
  return first?.href ?? null;
}

export function hasReachableDefaultProjectSurface(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
): boolean {
  return resolveDefaultProjectSurfaceHref(value) !== null;
}

export function resolveWorkspaceGovernanceProjectActions(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
): WorkspaceGovernanceProjectActions {
  return {
    canOpenOverview: canAccessProjectSurfaceHref(value, 'overview'),
    canOpenMembers: canAccessProjectSurfaceHref(value, 'members'),
    canOpenSettings: canAccessProjectSurfaceHref(value, 'settings'),
  };
}

export function shouldUseGovernableProjectSwitcher<T extends ProjectIdentity>(params: {
  discoverableProjects: readonly T[];
  currentProject: T | null | undefined;
  canManageWorkspaceGovernance: boolean;
}): boolean {
  if (!params.canManageWorkspaceGovernance || !params.currentProject) return false;
  return !params.discoverableProjects.some((project) => project.id === params.currentProject?.id);
}

export function listSwitchableProjects<T extends ProjectIdentity & ProjectPermissionCarrier>(params: {
  discoverableProjects: readonly T[];
  governableProjects?: readonly T[];
  currentProject?: T | null;
  includeGovernableProjects?: boolean;
}): T[] {
  const baseProjects = params.includeGovernableProjects
    ? dedupeProjectsById([...(params.discoverableProjects ?? []), ...(params.governableProjects ?? [])])
    : [...(params.discoverableProjects ?? [])];

  const combinedProjects = !params.currentProject
    ? baseProjects
    : baseProjects.some((project) => project.id === params.currentProject?.id)
      ? baseProjects
      : [params.currentProject, ...baseProjects];

  return combinedProjects.filter((project) => hasReachableDefaultProjectSurface(project));
}

export function buildProjectSurfacePath(
  locale: string | null | undefined,
  workspaceId: string,
  projectId: string,
  href: ProjectSurfaceHref,
): string {
  const localePrefix = locale ? `/${locale}` : '';
  return `${localePrefix}/workspaces/${workspaceId}/projects/${projectId}/${href}`;
}
