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
    'workspace:governance:read',
    'workspace:governance:update',
  ] as const,

  PROJECT: [
    'project:read',
    'project:update',
    'project:delete',
  ] as const,

  MEMBERSHIP: [
    'project:join:approve',
    'project:member:read',
    'project:member:manage',
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
  ] as const,

  RECIPES: [
    'project:recipe:create',
    'project:recipe:read',
    'project:recipe:update',
    'project:recipe:delete',
  ] as const,

  SHARED_RESOURCES: [
    'project:resource:read',
    'project:resource:create',
    'project:resource:update',
    'project:resource:delete',
  ] as const,

  AGENT: [
    'agent:read',
    'agent:manage',
    'agent:key:issue',
    'agent:key:revoke',
  ] as const,

  AGENT_THREAD: [
    'agent_thread:create',
    'agent_thread:read',
  ] as const,

  USERDATA: [
    'userdata:docdb:read',
    'userdata:vectordb:search',
    'userdata:storage:read',
  ] as const,
} as const;

// Flattened list of all platform permissions
export const ALL_PLATFORM_PERMISSIONS = Object.values(PLATFORM_PERMISSIONS).flat() as readonly string[];

// Permission descriptions for UI tooltips (from 权限点标准规范-v1)
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'workspace:governance:read': 'View workspace governance groups',
  'workspace:governance:update': 'Update workspace governance groups',
  'project:read': 'View project info',
  'project:update': 'Update project config',
  'project:delete': 'Delete project (irreversible)',
  'project:join:approve': 'Approve join requests',
  'project:member:read': 'View member list',
  'project:member:manage': 'Manage members (permissions, quota, remove)',
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
  'project:recipe:create': 'Create recipes',
  'project:recipe:read': 'View recipes',
  'project:recipe:update': 'Update recipes',
  'project:recipe:delete': 'Delete recipes',
  'project:resource:read': 'View shared resources (KB/Endpoints)',
  'project:resource:create': 'Create shared resources',
  'project:resource:update': 'Update shared resources',
  'project:resource:delete': 'Delete shared resources',
  'agent:read': 'View agent list and details',
  'agent:manage': 'Manage agents (create/update/enable/disable/kick)',
  'agent:key:issue': 'Issue agent service keys',
  'agent:key:revoke': 'Revoke agent service keys',
  'agent_thread:create': 'Create agent threads',
  'agent_thread:read': 'View agent threads',
  'userdata:docdb:read': 'Read DocDB data',
  'userdata:vectordb:search': 'Search VectorDB',
  'userdata:storage:read': 'Read Storage files',
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
    id: 'recipes',
    name: 'Workbench & Recipes',
    permissions: PLATFORM_PERMISSIONS.RECIPES,
  },
  {
    id: 'agent',
    name: 'Agent & Keys',
    permissions: PLATFORM_PERMISSIONS.AGENT,
  },
  {
    id: 'agent_thread',
    name: 'Agent Thread',
    permissions: PLATFORM_PERMISSIONS.AGENT_THREAD,
  },
  {
    id: 'shared_resources',
    name: 'Shared Resources',
    permissions: PLATFORM_PERMISSIONS.SHARED_RESOURCES,
  },
  {
    id: 'userdata',
    name: 'UserData',
    permissions: PLATFORM_PERMISSIONS.USERDATA,
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
    'workspace:governance:read',
    'workspace:governance:update',
    'project:read',
    'project:update',
    'project:delete',
    'project:join:approve',
    'project:member:read',
    'project:member:manage',
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
    'project:recipe:create',
    'project:recipe:read',
    'project:recipe:update',
    'project:recipe:delete',
    'project:resource:read',
    'project:resource:create',
    'project:resource:update',
    'project:resource:delete',
    'agent:read',
    'agent:manage',
    'agent:key:issue',
    'agent:key:revoke',
    'agent_thread:create',
    'agent_thread:read',
    'userdata:docdb:read',
    'userdata:vectordb:search',
    'userdata:storage:read',
  ] as const,

  admin: [
    'workspace:read',
    'workspace:project:create',
    'workspace:governance:read',
    'project:read',
    'project:update',
    'project:join:approve',
    'project:member:read',
    'project:member:manage',
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
    'project:recipe:create',
    'project:recipe:read',
    'project:recipe:update',
    'project:recipe:delete',
    'project:resource:read',
    'project:resource:create',
    'project:resource:update',
    'project:resource:delete',
    'agent:read',
    'agent:manage',
    'agent:key:issue',
    'agent:key:revoke',
    'agent_thread:create',
    'agent_thread:read',
    'userdata:docdb:read',
    'userdata:vectordb:search',
    'userdata:storage:read',
  ] as const,

  developer: [
    'project:read',
    'project:member:read',
    'project:policy:read',
    'project:usage:read',
    'project:source:read',
    'project:source:upload',
    'project:source:download',
    'project:recipe:create',
    'project:recipe:read',
    'project:recipe:update',
    'project:resource:read',
    'agent:read',
    'agent:key:issue',
    'agent_thread:create',
    'agent_thread:read',
    'userdata:docdb:read',
    'userdata:vectordb:search',
    'userdata:storage:read',
  ] as const,

  user: [
    'project:read',
    'project:member:read',
    'project:policy:read',
    'project:usage:read',
    'project:source:read',
    'project:source:download',
    'project:recipe:create',
    'project:recipe:read',
    'project:resource:read',
    'agent:read',
    'agent_thread:create',
    'agent_thread:read',
    'userdata:docdb:read',
    'userdata:vectordb:search',
    'userdata:storage:read',
  ] as const,
} as const;

// ============================================================
// High-Risk Permissions
// ============================================================

export const HIGH_RISK_PERMISSIONS = [
  'project:delete',
  'agent:key:issue',
  'project:member:manage',
  'project:resource:delete',
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
