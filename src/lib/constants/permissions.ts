/**
 * Simplified MVP Permission Model
 *
 * Project-level permissions:
 * - project:endpoint:invoke
 * - project:agent:create
 * - project:agent:publish
 * - project:manage
 */

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: ['workspace:read', 'workspace:project:create'] as const,
  PROJECT: [
    'project:endpoint:invoke',
    'project:agent:create',
    'project:agent:publish',
    'project:manage',
  ] as const,
} as const;

export const ALL_PLATFORM_PERMISSIONS = [
  ...PLATFORM_PERMISSIONS.WORKSPACE,
  ...PLATFORM_PERMISSIONS.PROJECT,
] as const;

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'project:endpoint:invoke': 'Invoke project endpoints',
  'project:agent:create': 'Access agents module and create own agents',
  'project:agent:publish': 'Publish or unpublish agents for project-wide visibility',
  'project:manage': 'Manage all project resources and governance settings',
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
  owner: ['project:endpoint:invoke', 'project:agent:create', 'project:manage'],
  admin: ['project:endpoint:invoke', 'project:agent:create', 'project:manage'],
  developer: ['project:endpoint:invoke', 'project:agent:create'],
  user: ['project:endpoint:invoke'],
} as const;

export const DEFAULT_PERMISSION_GROUP_TEMPLATES = {
  project_admin_template: [...GROUP_TEMPLATES.owner],
  project_operator_template: [...GROUP_TEMPLATES.developer],
  project_member_template: [...GROUP_TEMPLATES.user],
  project_viewer_template: [...GROUP_TEMPLATES.user],
} as const;

export const HIGH_RISK_PERMISSIONS = [
  'project:agent:publish',
  'project:manage',
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
