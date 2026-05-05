import { createProjectRoutePolicy } from './project-route-policy';
import { PROJECT_SETTINGS_READ_PERMISSIONS } from '@/lib/projects/project-settings-access';

export const PROJECT_ROUTE_POLICY_MANIFEST = {
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-runners/page.tsx': createProjectRoutePolicy({
    permissions: ['project:agent_runner:read', 'project:agent_runner:manage'],
    href: 'agent-runners',
    navLabelKey: 'agent_runners',
    navSection: 'develop',
    navOrder: 10,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/alerts/page.tsx': createProjectRoutePolicy({
    permissions: ['project:audit:read'],
    href: 'alerts',
    navLabelKey: 'alerts',
    navSection: 'operate',
    navOrder: 10,
    sidebar: false,
    governanceObject: false,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/audit/page.tsx': createProjectRoutePolicy({
    permissions: ['project:audit:read'],
    featureKey: 'audit',
    href: 'audit',
    navLabelKey: 'audit',
    navSection: 'govern',
    navOrder: 60,
    relatedHrefs: ['members', 'resource-policy', 'credentials', 'context', 'settings'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/chat/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
    href: 'chat',
    navLabelKey: 'chat',
    navSection: 'use',
    navOrder: 10,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/context/page.tsx': createProjectRoutePolicy({
    permissions: ['project:governance:update'],
    href: 'context',
    navLabelKey: 'project_title',
    navLabelNamespace: 'context_store',
    navSection: 'govern',
    navOrder: 30,
    relatedHrefs: ['resource-policy', 'credentials', 'members', 'audit', 'settings'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/credentials/page.tsx': createProjectRoutePolicy({
    permissions: ['project:governance:update'],
    href: 'credentials',
    navLabelKey: 'credentials',
    navSection: 'govern',
    navOrder: 40,
    relatedHrefs: ['resource-policy', 'context', 'members', 'audit', 'settings'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/endpoints/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use', 'project:governance:update'],
    href: 'endpoints',
    navLabelKey: 'endpoints',
    navSection: 'govern',
    navOrder: 10,
    relatedHrefs: ['resource-policy', 'credentials', 'context', 'usage', 'use-guide'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/files/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
    href: 'files',
    navLabelKey: 'files',
    navSection: 'use',
    navOrder: 30,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/members/page.tsx': createProjectRoutePolicy({
    permissions: ['project:membership:update'],
    featureKey: 'members',
    href: 'members',
    navLabelKey: 'members',
    navSection: 'govern',
    navOrder: 50,
    relatedHrefs: ['credentials', 'resource-policy', 'context', 'audit', 'settings'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/page.tsx': createProjectRoutePolicy({
    permissions: ['project:agent_task:use'],
    href: 'agent-tasks',
    navLabelKey: 'agent_tasks',
    navSection: 'use',
    navOrder: 20,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/my-context/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
    href: 'my-context',
    navLabelKey: 'member_project_title',
    navLabelNamespace: 'context_store',
    navSection: 'govern',
    navOrder: 35,
    sidebar: false,
    governanceObject: false,
    relatedHrefs: ['context', 'settings'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/agent-tasks/[taskId]/page.tsx': createProjectRoutePolicy({
    permissions: ['project:agent_task:use'],
    href: 'agent-tasks',
    navLabelKey: 'agent_tasks',
    navSection: 'use',
    navOrder: 20,
    sidebar: false,
    governanceObject: false,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/overview/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
    href: 'overview',
    navLabelKey: 'overview',
    navSection: 'home',
    navOrder: 10,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/resource-policy/page.tsx': createProjectRoutePolicy({
    permissions: ['project:governance:update'],
    featureKey: 'resource_policy',
    href: 'resource-policy',
    navLabelKey: 'resource_policy',
    navSection: 'govern',
    navOrder: 20,
    relatedHrefs: ['context', 'credentials', 'members', 'audit', 'settings'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/settings/page.tsx': createProjectRoutePolicy({
    permissions: PROJECT_SETTINGS_READ_PERMISSIONS,
    href: 'settings',
    navLabelKey: 'settings',
    navSection: 'govern',
    navOrder: 70,
    relatedHrefs: ['members', 'resource-policy', 'credentials', 'context', 'audit'],
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/usage/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
    featureKey: 'usage',
    href: 'usage',
    navLabelKey: 'usage',
    navSection: 'use',
    navOrder: 40,
  }),
  'src/app/[locale]/workspaces/[workspace]/projects/[project]/(shell)/use-guide/page.tsx': createProjectRoutePolicy({
    permissions: ['project:endpoint:use'],
    href: 'use-guide',
    navLabelKey: 'api_access_guide',
    navSection: 'use',
    navOrder: 50,
  }),
} as const;

export const PROJECT_ROUTE_POLICIES = Object.values(PROJECT_ROUTE_POLICY_MANIFEST);

export function findProjectRoutePolicyByHref(href: string) {
  return PROJECT_ROUTE_POLICIES.find((policy) => policy.href === href) ?? null;
}

export function listSidebarProjectRoutePolicies() {
  return PROJECT_ROUTE_POLICIES.filter((policy) => policy.sidebar).sort((left, right) => left.navOrder - right.navOrder);
}

export function listProjectGovernanceRoutePolicies() {
  return PROJECT_ROUTE_POLICIES.filter((policy) => policy.governanceObject).sort((left, right) => left.navOrder - right.navOrder);
}
