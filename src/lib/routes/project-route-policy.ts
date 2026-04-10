export interface ProjectRoutePolicy {
  scope: 'project';
  permissions: readonly string[];
  requiresWorkspaceParam: true;
  requiresProjectParam: true;
  routeGuard: 'useResolvedProjectRoute';
  featureKey?: string;
  href: string;
  navLabelKey: string;
  navLabelNamespace: 'nav' | 'context_store';
  navSection: 'home' | 'use' | 'develop' | 'govern' | 'operate';
  navOrder: number;
  sidebar: boolean;
  governanceObject: boolean;
  relatedHrefs?: readonly string[];
}

export interface ProjectRoutePolicyInput {
  permissions: readonly string[];
  featureKey?: string;
  href: string;
  navLabelKey: string;
  navLabelNamespace?: 'nav' | 'context_store';
  navSection: 'home' | 'use' | 'develop' | 'govern' | 'operate';
  navOrder: number;
  sidebar?: boolean;
  governanceObject?: boolean;
  relatedHrefs?: readonly string[];
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
    href: input.href,
    navLabelKey: input.navLabelKey,
    navLabelNamespace: input.navLabelNamespace ?? 'nav',
    navSection: input.navSection,
    navOrder: input.navOrder,
    sidebar: input.sidebar ?? true,
    governanceObject: input.governanceObject ?? input.navSection === 'govern',
    relatedHrefs: input.relatedHrefs,
  };
}
