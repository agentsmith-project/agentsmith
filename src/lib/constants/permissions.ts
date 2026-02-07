/**
 * Permission Points Constants
 *
 * Defines all permission points according to the standard specification.
 * Reference: 文档/决策/2026-02-02-权限点标准规范-v1-正式版.md
 */

// ============================================================
// Platform-level Permission Points
// ============================================================

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: [
    'workspace:read',
    'workspace:project:create',
    'workspace:governance:update',
  ] as const,

  PROJECT: [
    'project:read',
    'project:update',
    'project:delete',
    'project:chat:access',
    'project:studio:access',
  ] as const,

  MEMBERSHIP: [
    'project:join:approve',
    'project:member:read',
    'project:admin:grant',
    'project:admin:revoke',
  ] as const,

  POLICY: [
    'project:policy:read',
    'project:policy:update',
  ] as const,
  GOVERNANCE: [
    'project:audit:read',
    'project:usage:read',
  ] as const,

  SOURCES: [
    'project:source:read',
    'project:source:upload',
    'project:source:delete',
    'project:source:download',
    'project:source:library:read',
    'project:source:library:create',
    'project:source:library:update',
    'project:source:library:delete',
  ] as const,

  ENDPOINTS: [
    'project:endpoint:read',
    'project:endpoint:create',
    'project:endpoint:update',
    'project:endpoint:delete',
  ] as const,

  AGENT: [
    'project:agent:read',
    'project:agent:create',
    'project:agent:update',
    'project:agent:delete',
    'project:agent:key:issue',
    'project:agent:key:revoke',
  ] as const,
} as const;

// Flattened list of all platform permissions
export const ALL_PLATFORM_PERMISSIONS = Object.values(PLATFORM_PERMISSIONS).flat() as readonly string[];

// Permission descriptions for UI tooltips (from 权限点标准规范-v1)
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'workspace:governance:update': 'Update workspace governance groups',
  'project:read': 'View project info',
  'project:update': 'Update project config',
  'project:delete': 'Delete project (irreversible)',
  'project:chat:access': 'Access chat page and features',
  'project:studio:access': 'Access AI Studio page and tasks',
  'project:join:approve': 'Approve join requests',
  'project:member:read': 'View member list',
  'project:admin:grant': 'Grant project admin to a member',
  'project:admin:revoke': 'Revoke project admin from a member',
  'project:policy:read': 'View project policy',
  'project:policy:update': 'Update project policy',
  'project:audit:read': 'View audit logs',
  'project:usage:read': 'View usage stats',
  'project:source:read': 'View file list',
  'project:source:upload': 'Upload files',
  'project:source:delete': 'Delete files',
  'project:source:download': 'Download files',
  'project:source:library:read': 'View source libraries',
  'project:source:library:create': 'Create source libraries',
  'project:source:library:update': 'Update source libraries',
  'project:source:library:delete': 'Delete source libraries',
  'project:endpoint:read': 'View endpoints',
  'project:endpoint:create': 'Create endpoints',
  'project:endpoint:update': 'Update endpoints',
  'project:endpoint:delete': 'Delete endpoints',
  'project:agent:read': 'View agent list and details',
  'project:agent:create': 'Create agents',
  'project:agent:update': 'Update/enable/disable agents',
  'project:agent:delete': 'Delete agents',
  'project:agent:key:issue': 'Issue agent service keys',
  'project:agent:key:revoke': 'Revoke agent service keys',
};

// Grouped permissions for UI display
export const PLATFORM_PERMISSIONS_GROUPED = [
  {
    id: 'workspace',
    name: 'Workspace',
    permissions: PLATFORM_PERMISSIONS.WORKSPACE,
  },
  {
    id: 'project',
    name: 'Project & Membership',
    permissions: [
      ...PLATFORM_PERMISSIONS.PROJECT,
      ...PLATFORM_PERMISSIONS.MEMBERSHIP,
    ],
  },
  {
    id: 'policy',
    name: 'Project Policy',
    permissions: PLATFORM_PERMISSIONS.POLICY,
  },
  {
    id: 'governance',
    name: 'Project Governance',
    permissions: PLATFORM_PERMISSIONS.GOVERNANCE,
  },
  {
    id: 'sources',
    name: 'Sources & Files',
    permissions: PLATFORM_PERMISSIONS.SOURCES,
  },
  {
    id: 'agent',
    name: 'Agent & Keys',
    permissions: PLATFORM_PERMISSIONS.AGENT,
  },
  {
    id: 'endpoints',
    name: 'Endpoints',
    permissions: PLATFORM_PERMISSIONS.ENDPOINTS,
  },
] as const;

// ============================================================
// Resource-level Permission Points
// ============================================================

export const RESOURCE_PERMISSIONS = {
  ENDPOINT: [
    'endpoint:use',
  ] as const,
} as const;

// ============================================================
// Role Templates
// ============================================================

export const ROLE_TEMPLATES = {
  owner: [
    'workspace:read',
    'workspace:project:create',
    'workspace:governance:update',
    'project:read',
    'project:update',
    'project:chat:access',
    'project:studio:access',
    'project:delete',
    'project:join:approve',
    'project:member:read',
    'project:admin:grant',
    'project:admin:revoke',
    'project:policy:read',
    'project:policy:update',
    'project:audit:read',
    'project:usage:read',
    'project:source:read',
    'project:source:upload',
    'project:source:delete',
    'project:source:download',
    'project:source:library:read',
    'project:source:library:create',
    'project:source:library:update',
    'project:source:library:delete',
    'project:endpoint:read',
    'project:endpoint:create',
    'project:endpoint:update',
    'project:endpoint:delete',
    'project:agent:read',
    'project:agent:create',
    'project:agent:update',
    'project:agent:delete',
    'project:agent:key:issue',
    'project:agent:key:revoke',
  ] as const,

  admin: [
    'workspace:read',
    'workspace:project:create',
    'project:read',
    'project:chat:access',
    'project:studio:access',
    'project:update',
    'project:join:approve',
    'project:member:read',
    'project:admin:grant',
    'project:admin:revoke',
    'project:policy:read',
    'project:policy:update',
    'project:audit:read',
    'project:usage:read',
    'project:source:read',
    'project:source:upload',
    'project:source:delete',
    'project:source:download',
    'project:source:library:read',
    'project:source:library:create',
    'project:source:library:update',
    'project:source:library:delete',
    'project:endpoint:read',
    'project:endpoint:create',
    'project:endpoint:update',
    'project:endpoint:delete',
    'project:agent:read',
    'project:agent:create',
    'project:agent:update',
    'project:agent:delete',
    'project:agent:key:issue',
    'project:agent:key:revoke',
  ] as const,

  developer: [
    'project:read',
    'project:chat:access',
    'project:studio:access',
    'project:member:read',
    'project:policy:read',
    'project:usage:read',
    'project:source:read',
    'project:source:upload',
    'project:source:download',
    'project:source:library:read',
    'project:endpoint:read',
    'project:agent:read',
    'project:agent:key:issue',
  ] as const,

  user: [
    'project:read',
    'project:member:read',
    'project:policy:read',
    'project:usage:read',
    'project:source:read',
    'project:source:download',
    'project:source:library:read',
    'project:endpoint:read',
    'project:agent:read',
  ] as const,
} as const;

// ============================================================
// High-Risk Permissions
// ============================================================

export const HIGH_RISK_PERMISSIONS = [
  'project:delete',
  'project:agent:key:issue',
  'project:endpoint:delete',
  'project:source:library:delete',
] as const;

// Type helpers
export type PlatformPermission = typeof ALL_PLATFORM_PERMISSIONS[number];
export type ResourcePermission = typeof RESOURCE_PERMISSIONS.ENDPOINT[number];
export type RoleTemplate = keyof typeof ROLE_TEMPLATES;
export type HighRiskPermission = typeof HIGH_RISK_PERMISSIONS[number];

// Helper functions
export function isHighRiskPermission(permission: string): boolean {
  return HIGH_RISK_PERMISSIONS.includes(permission as HighRiskPermission);
}

export function getRoleTemplatePermissions(role: RoleTemplate): readonly string[] {
  return ROLE_TEMPLATES[role];
}

export function getAllPermissionsForRole(role: RoleTemplate): string[] {
  return [...ROLE_TEMPLATES[role]];
}
