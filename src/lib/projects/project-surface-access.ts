import type { ProjectRoutePolicy } from '@/lib/routes/project-route-policy';
import { PROJECT_ROUTE_POLICIES, listSidebarProjectRoutePolicies } from '@/lib/routes/project-route-policy-manifest';

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

export type ProjectSurfaceHref = ProjectRoutePolicy['href'];

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

export function canAccessProjectRoute(
  value: ProjectPermissionCarrier | readonly string[] | null | undefined,
  policy: ProjectRoutePolicy,
): boolean {
  return hasAnyRoutePermission(normalizePermissions(value), policy.permissions);
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

export function buildProjectSurfacePath(
  locale: string | null | undefined,
  workspaceId: string,
  projectId: string,
  href: ProjectSurfaceHref,
): string {
  const localePrefix = locale ? `/${locale}` : '';
  return `${localePrefix}/workspaces/${workspaceId}/projects/${projectId}/${href}`;
}
