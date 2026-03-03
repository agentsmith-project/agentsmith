/**
 * Simplified MVP Permission Model
 *
 * Project-level permissions are intentionally reduced to:
 * - project:endpoint:use
 * - project:endpoint:manage
 * - project:agent:use
 * - project:agent:manage
 * - project:settings:manage
 */

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: ['workspace:read', 'workspace:project:create'] as const,
  PROJECT: [
    'project:endpoint:use',
    'project:endpoint:manage',
    'project:agent:use',
    'project:agent:manage',
    'project:settings:manage',
  ] as const,
} as const;

export const ALL_PLATFORM_PERMISSIONS = [
  ...PLATFORM_PERMISSIONS.WORKSPACE,
  ...PLATFORM_PERMISSIONS.PROJECT,
] as const;

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'project:endpoint:use': 'Use product capabilities through endpoints',
  'project:endpoint:manage': 'Manage endpoints and endpoint-level runtime controls',
  'project:agent:use': 'Use agent capabilities',
  'project:agent:manage': 'Manage agents and agent runtime controls',
  'project:settings:manage': 'Manage project settings and governance configuration',
};

export const PLATFORM_PERMISSIONS_GROUPED = [
  {
    id: 'workspace',
    name: 'Workspace',
    permissions: PLATFORM_PERMISSIONS.WORKSPACE,
  },
  {
    id: 'project',
    name: 'Project',
    permissions: PLATFORM_PERMISSIONS.PROJECT,
  },
] as const;

export const GROUP_TEMPLATES = {
  owner: [...PLATFORM_PERMISSIONS.PROJECT],
  admin: [...PLATFORM_PERMISSIONS.PROJECT],
  developer: [
    'project:endpoint:use',
    'project:endpoint:manage',
    'project:agent:use',
    'project:agent:manage',
  ],
  user: ['project:endpoint:use', 'project:agent:use'],
} as const;

export const DEFAULT_PERMISSION_GROUP_TEMPLATES = {
  project_admin_template: [...GROUP_TEMPLATES.owner],
  project_operator_template: [...GROUP_TEMPLATES.developer],
  project_member_template: [...GROUP_TEMPLATES.user],
  project_viewer_template: [...GROUP_TEMPLATES.user],
} as const;

export const HIGH_RISK_PERMISSIONS = [
  'project:endpoint:manage',
  'project:agent:manage',
  'project:settings:manage',
] as const;

export type PlatformPermission = (typeof ALL_PLATFORM_PERMISSIONS)[number];
export type GroupTemplate = keyof typeof GROUP_TEMPLATES;
export type HighRiskPermission = (typeof HIGH_RISK_PERMISSIONS)[number];

export function isHighRiskPermission(permission: string): boolean {
  return HIGH_RISK_PERMISSIONS.includes(permission as HighRiskPermission);
}

export function getGroupTemplatePermissions(groupTemplate: GroupTemplate): readonly string[] {
  return GROUP_TEMPLATES[groupTemplate];
}

export function getAllPermissionsForGroup(groupTemplate: GroupTemplate): string[] {
  return [...GROUP_TEMPLATES[groupTemplate]];
}
