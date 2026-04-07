/**
 * Simplified MVP Permission Model
 *
 * Project-level permissions:
 * - project:endpoint:use
 * - project:agent:use
 * - project:terminal:use
 * - project:agent:manage
 * - project:agent:public
 * - project:audit:read
 * - project:governance:update
 * - project:membership:update
 * - project:admins:update
 * - project:lifecycle:update
 * - project:files:update
 */

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: ['workspace:read', 'workspace:project:create', 'workspace:governance:update'] as const,
  PROJECT: [
    'project:endpoint:use',
    'project:agent:use',
    'project:terminal:use',
    'project:agent:manage',
    'project:agent:public',
    'project:audit:read',
    'project:governance:update',
    'project:membership:update',
    'project:admins:update',
    'project:lifecycle:update',
    'project:files:update',
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
  'project:agent:use': 'Use project agents in chat and notebook',
  'project:terminal:use': 'Open and interact with notebook task terminals',
  'project:agent:manage': 'Create and manage project agents',
  'project:agent:public': 'Publish or unpublish agents for project-wide visibility',
  'project:audit:read': 'Read project audit records',
  'project:governance:update': 'Manage project governance resources such as credentials, resource policy, and endpoint governance',
  'project:membership:update': 'Manage project memberships, templates, groups, and join requests',
  'project:admins:update': 'Assign or revoke project administrators',
  'project:lifecycle:update': 'Manage project lifecycle settings such as owner transfer and deletion',
  'project:files:update': 'Create, update, move, and delete project file libraries and objects',
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

export const PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS = {
  owner: [
    'project:endpoint:use',
    'project:agent:use',
    'project:terminal:use',
    'project:agent:manage',
    'project:audit:read',
    'project:governance:update',
    'project:membership:update',
    'project:admins:update',
    'project:lifecycle:update',
    'project:files:update',
  ],
  admin: [
    'project:endpoint:use',
    'project:agent:use',
    'project:terminal:use',
    'project:agent:manage',
    'project:audit:read',
    'project:governance:update',
    'project:files:update',
  ],
  operator: ['project:endpoint:use', 'project:agent:use', 'project:terminal:use'],
  member: ['project:endpoint:use', 'project:agent:use', 'project:terminal:use'],
} as const;

export const WORKSPACE_BUILT_IN_TEMPLATE_PERMISSIONS = {
  owner: ['workspace:read', 'workspace:project:create', 'workspace:governance:update'],
  projectCreator: ['workspace:read', 'workspace:project:create'],
  member: ['workspace:read'],
} as const;

export const DEFAULT_PERMISSION_TEMPLATE_PRESETS = {
  project_admin_template: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.admin],
  project_operator_template: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.operator],
  project_member_template: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.member],
  project_viewer_template: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.member],
} as const;

export const HIGH_RISK_PERMISSIONS = [
  'project:governance:update',
  'project:agent:public',
  'project:membership:update',
  'project:admins:update',
  'project:lifecycle:update',
  'project:files:update',
] as const;

export type PlatformPermission = (typeof ALL_PLATFORM_PERMISSIONS)[number];
export type ProjectBuiltInTemplatePermissionSet = keyof typeof PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS;
export type HighRiskPermission = (typeof HIGH_RISK_PERMISSIONS)[number];

export function isHighRiskPermission(permission: string): boolean {
  return HIGH_RISK_PERMISSIONS.includes(permission as HighRiskPermission);
}

export function getProjectBuiltInTemplatePermissions(template: ProjectBuiltInTemplatePermissionSet): readonly string[] {
  return PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS[template];
}

export function getAllPermissionsForProjectTemplate(template: ProjectBuiltInTemplatePermissionSet): string[] {
  return [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS[template]];
}
