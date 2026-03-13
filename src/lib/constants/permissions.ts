/**
 * Simplified MVP Permission Model
 *
 * Project-level permissions:
 * - project:endpoint:use
 * - project:agent:manage
 * - project:agent:public
 * - project:audit:read
 * - project:files:update
 * - project:governance:update
 * - project:membership:update
 * - project:admins:update
 * - project:lifecycle:update
 * - project:manage (legacy compatibility token, not primary authz truth)
 */

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: ['workspace:read', 'workspace:project:create', 'workspace:governance:update'] as const,
  PROJECT: [
    'project:endpoint:use',
    'project:agent:manage',
    'project:agent:public',
    'project:audit:read',
    'project:files:update',
    'project:governance:update',
    'project:membership:update',
    'project:admins:update',
    'project:lifecycle:update',
  ] as const,
} as const;

export const ALL_PLATFORM_PERMISSIONS = [
  ...PLATFORM_PERMISSIONS.WORKSPACE,
  ...PLATFORM_PERMISSIONS.PROJECT,
] as const;

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'workspace:governance:update': 'Manage workspace project governance',
  'project:endpoint:use': 'Use project endpoints',
  'project:agent:manage': 'Create and manage own agents',
  'project:agent:public': 'Publish or unpublish agents for project-wide visibility',
  'project:audit:read': 'Read project audit records',
  'project:files:update': 'Create, upload, move, rename, and delete project file libraries and objects',
  'project:governance:update': 'Manage project governance resources such as credentials, resource policy, and endpoint governance',
  'project:membership:update': 'Manage project memberships, templates, groups, and join requests',
  'project:admins:update': 'Assign or revoke project administrators',
  'project:lifecycle:update': 'Manage project lifecycle settings such as owner transfer and deletion',
  'project:manage': 'Transitional umbrella permission for project governance and lifecycle gates during refactor',
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
  // These templates are product-facing defaults, not the authorization truth.
  // Runtime allow/deny must still resolve through permission checks in scope.
  // Owner/admin/creator labels are only sources for deriving permissions.
  owner: [
    'project:endpoint:use',
    'project:agent:manage',
    'project:audit:read',
    'project:files:update',
    'project:governance:update',
    'project:membership:update',
    'project:admins:update',
    'project:lifecycle:update',
  ],
  admin: [
    'project:endpoint:use',
    'project:agent:manage',
    'project:audit:read',
    'project:files:update',
    'project:governance:update',
  ],
  developer: ['project:endpoint:use', 'project:agent:manage'],
  user: ['project:endpoint:use'],
} as const;

export const DEFAULT_PERMISSION_GROUP_TEMPLATES = {
  project_admin_template: [...GROUP_TEMPLATES.admin],
  project_operator_template: [...GROUP_TEMPLATES.developer],
  project_member_template: [...GROUP_TEMPLATES.user],
  project_viewer_template: [...GROUP_TEMPLATES.user],
} as const;

export const HIGH_RISK_PERMISSIONS = [
  'project:governance:update',
  'project:agent:public',
  'project:membership:update',
  'project:admins:update',
  'project:lifecycle:update',
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
