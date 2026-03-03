/**
 * Simplified MVP Permission Model
 *
 * Project-level permissions:
 * - project:endpoint:use
 * - project:agent:manage
 * - project:agent:public
 * - project:manage
 */

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: ['workspace:read', 'workspace:project:create'] as const,
  PROJECT: [
    // Canonical tokens
    'project:endpoint:use',
    'project:agent:manage',
    'project:agent:public',
    'project:manage',
    // Legacy aliases kept for gate compatibility during migration
    'project:endpoint:invoke',
    'project:agent:create',
    'project:agent:publish',
  ] as const,
} as const;

export const ALL_PLATFORM_PERMISSIONS = [
  ...PLATFORM_PERMISSIONS.WORKSPACE,
  ...PLATFORM_PERMISSIONS.PROJECT,
] as const;

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'project:endpoint:use': 'Use project endpoints',
  'project:agent:manage': 'Create and manage own agents',
  'project:agent:public': 'Publish or unpublish agents for project-wide visibility',
  'project:manage': 'Manage all project resources and governance settings',
  'project:endpoint:invoke': 'Use project endpoints (legacy alias)',
  'project:agent:create': 'Create and manage own agents (legacy alias)',
  'project:agent:publish': 'Publish or unpublish agents (legacy alias)',
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
  owner: ['project:endpoint:use', 'project:agent:manage', 'project:manage'],
  admin: ['project:endpoint:use', 'project:agent:manage', 'project:manage'],
  developer: ['project:endpoint:use', 'project:agent:manage'],
  user: ['project:endpoint:use'],
} as const;

export const DEFAULT_PERMISSION_GROUP_TEMPLATES = {
  project_admin_template: [...GROUP_TEMPLATES.owner],
  project_operator_template: [...GROUP_TEMPLATES.developer],
  project_member_template: [...GROUP_TEMPLATES.user],
  project_viewer_template: [...GROUP_TEMPLATES.user],
} as const;

export const HIGH_RISK_PERMISSIONS = [
  'project:agent:public',
  'project:agent:publish',
  'project:manage',
] as const;

export const LEGACY_PERMISSION_ALIASES: Record<string, string> = {
  'project:endpoint:invoke': 'project:endpoint:use',
  'project:agent:create': 'project:agent:manage',
  'project:agent:publish': 'project:agent:public',
};

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
