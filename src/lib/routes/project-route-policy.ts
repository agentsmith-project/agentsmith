export interface ProjectRoutePolicy {
  scope: 'project';
  permissions: readonly string[];
  requiresWorkspaceParam: true;
  requiresProjectParam: true;
  routeGuard: 'useResolvedProjectRoute';
  featureKey?: string;
}

export interface ProjectRoutePolicyInput {
  permissions: readonly string[];
  featureKey?: string;
}

export function createProjectRoutePolicy(
  input: ProjectRoutePolicyInput,
): ProjectRoutePolicy {
  return {
    scope: 'project',
    permissions: input.permissions,
    requiresWorkspaceParam: true,
    requiresProjectParam: true,
    routeGuard: 'useResolvedProjectRoute',
    featureKey: input.featureKey,
  };
}
