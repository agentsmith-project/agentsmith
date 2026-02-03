/**
 * Permission Points Constants
 *
 * Defines all permission points according to the standard specification.
 * Reference: 文档/决策/2026-02-02-权限点标准规范-v1-正式版.md
 */

// ============================================================
// Platform-level Permission Points (46 total)
// ============================================================

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: [
    'workspace:read',
    'workspace:project:create',
  ] as const,

  PROJECT: [
    'project:read',
    'project:update',
    'project:delete',
    'project:visibility:update',
  ] as const,

  MEMBERSHIP: [
    'project:join:request',
    'project:join:approve',
    'project:member:read',
    'project:member:manage',
  ] as const,

  POLICY_GOVERNANCE: [
    'project:policy:read',
    'project:policy:update',
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
    'agent_thread:handoff',
    'agent_thread:cancel',
  ] as const,

  USERDATA: [
    'userdata:docdb:read',
    'userdata:docdb:write',
    'userdata:docdb:delete',
    'userdata:docdb:clear',
    'userdata:vectordb:search',
    'userdata:vectordb:upsert',
    'userdata:vectordb:delete',
    'userdata:storage:read',
    'userdata:storage:write',
    'userdata:storage:delete',
    'userdata:storage:clear',
  ] as const,
} as const;

// Flattened list of all platform permissions
export const ALL_PLATFORM_PERMISSIONS = Object.values(PLATFORM_PERMISSIONS).flat() as readonly string[];

// Permission descriptions for UI tooltips (from 权限点标准规范-v1)
export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'project:read': 'View project info',
  'project:update': 'Update project config',
  'project:delete': 'Delete project (irreversible)',
  'project:visibility:update': 'Update project visibility',
  'project:join:request': 'Request to join project',
  'project:join:approve': 'Approve join requests',
  'project:member:read': 'View member list',
  'project:member:manage': 'Manage members (permissions, quota, remove)',
  'project:policy:read': 'View project policy (quota, limits, guardrails)',
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
  'agent_thread:handoff': 'Handoff between agents',
  'agent_thread:cancel': 'Cancel turn',
  'userdata:docdb:read': 'Read DocDB data',
  'userdata:docdb:write': 'Write DocDB data',
  'userdata:docdb:delete': 'Delete DocDB data',
  'userdata:docdb:clear': 'Clear DocDB collections (irreversible)',
  'userdata:vectordb:search': 'Search VectorDB',
  'userdata:vectordb:upsert': 'Upsert VectorDB data',
  'userdata:vectordb:delete': 'Delete VectorDB data',
  'userdata:storage:read': 'Read Storage files',
  'userdata:storage:write': 'Write Storage files',
  'userdata:storage:delete': 'Delete Storage files',
  'userdata:storage:clear': 'Clear Storage (irreversible)',
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
    name: 'Project Policy & Governance',
    permissions: PLATFORM_PERMISSIONS.POLICY_GOVERNANCE,
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
    name: 'AgentThread',
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
    'endpoint:read',
    'endpoint:use',
    'endpoint:write',
    'endpoint:admin',
  ] as const,
} as const;

// ============================================================
// Role Templates
// ============================================================

export const ROLE_TEMPLATES = {
  owner: [
    // Workspace (2)
    'workspace:read',
    'workspace:project:create',
    // Project (4)
    'project:read',
    'project:update',
    'project:delete',
    'project:visibility:update',
    // Membership (4)
    'project:join:request',
    'project:join:approve',
    'project:member:read',
    'project:member:manage',
    // Policy & Governance (4)
    'project:policy:read',
    'project:policy:update',
    'project:audit:read',
    'project:usage:read',
    // Sources (4)
    'project:source:read',
    'project:source:upload',
    'project:source:delete',
    'project:source:download',
    // Recipes (4)
    'project:recipe:create',
    'project:recipe:read',
    'project:recipe:update',
    'project:recipe:delete',
    // Shared Resources (4)
    'project:resource:read',
    'project:resource:create',
    'project:resource:update',
    'project:resource:delete',
    // Agent (4)
    'agent:read',
    'agent:manage',
    'agent:key:issue',
    'agent:key:revoke',
    // AgentThread (4)
    'agent_thread:create',
    'agent_thread:read',
    'agent_thread:handoff',
    'agent_thread:cancel',
    // UserData (12)
    'userdata:docdb:read',
    'userdata:docdb:write',
    'userdata:docdb:delete',
    'userdata:docdb:clear',
    'userdata:vectordb:search',
    'userdata:vectordb:upsert',
    'userdata:vectordb:delete',
    'userdata:storage:read',
    'userdata:storage:write',
    'userdata:storage:delete',
    'userdata:storage:clear',
  ] as const,

  admin: [
    // Workspace (2)
    'workspace:read',
    'workspace:project:create',
    // Project (3, exclude project:delete)
    'project:read',
    'project:update',
    'project:visibility:update',
    // Membership (4)
    'project:join:request',
    'project:join:approve',
    'project:member:read',
    'project:member:manage',
    // Policy & Governance (4)
    'project:policy:read',
    'project:policy:update',
    'project:audit:read',
    'project:usage:read',
    // Sources (4)
    'project:source:read',
    'project:source:upload',
    'project:source:delete',
    'project:source:download',
    // Recipes (4)
    'project:recipe:create',
    'project:recipe:read',
    'project:recipe:update',
    'project:recipe:delete',
    // Shared Resources (4)
    'project:resource:read',
    'project:resource:create',
    'project:resource:update',
    'project:resource:delete',
    // Agent (4)
    'agent:read',
    'agent:manage',
    'agent:key:issue',
    'agent:key:revoke',
    // AgentThread (4)
    'agent_thread:create',
    'agent_thread:read',
    'agent_thread:handoff',
    'agent_thread:cancel',
    // UserData (12)
    'userdata:docdb:read',
    'userdata:docdb:write',
    'userdata:docdb:delete',
    'userdata:docdb:clear',
    'userdata:vectordb:search',
    'userdata:vectordb:upsert',
    'userdata:vectordb:delete',
    'userdata:storage:read',
    'userdata:storage:write',
    'userdata:storage:delete',
    'userdata:storage:clear',
  ] as const,

  developer: [
    // Project (1)
    'project:read',
    // Membership (1)
    'project:member:read',
    // Policy & Governance (2)
    'project:policy:read',
    'project:usage:read',
    // Sources (3)
    'project:source:read',
    'project:source:upload',
    'project:source:download',
    // Recipes (3)
    'project:recipe:create',
    'project:recipe:read',
    'project:recipe:update',
    // Shared Resources (1)
    'project:resource:read',
    // Agent (2)
    'agent:read',
    'agent:key:issue',
    // AgentThread (4)
    'agent_thread:create',
    'agent_thread:read',
    'agent_thread:handoff',
    'agent_thread:cancel',
    // UserData (11, exclude userdata:docdb:clear and userdata:storage:clear)
    'userdata:docdb:read',
    'userdata:docdb:write',
    'userdata:docdb:delete',
    'userdata:vectordb:search',
    'userdata:vectordb:upsert',
    'userdata:vectordb:delete',
    'userdata:storage:read',
    'userdata:storage:write',
    'userdata:storage:delete',
  ] as const,

  user: [
    // Project (1)
    'project:read',
    // Membership (1)
    'project:member:read',
    // Policy & Governance (1) - user can view own usage only; backend filters by end_user_id
    'project:usage:read',
    // Sources (2)
    'project:source:read',
    'project:source:download',
    // Recipes (2)
    'project:recipe:create',
    'project:recipe:read',
    // Shared Resources (1)
    'project:resource:read',
    // Agent (1)
    'agent:read',
    // AgentThread (4)
    'agent_thread:create',
    'agent_thread:read',
    'agent_thread:handoff',
    'agent_thread:cancel',
    // UserData (3)
    'userdata:docdb:read',
    'userdata:docdb:write',
    'userdata:vectordb:search',
    'userdata:storage:read',
    'userdata:storage:write',
  ] as const,
} as const;

// ============================================================
// High-Risk Permissions
// ============================================================

export const HIGH_RISK_PERMISSIONS = [
  'project:delete',
  'agent:key:issue',
  'project:member:manage',
  'project:policy:update',
  'userdata:docdb:clear',
  'userdata:storage:clear',
  'endpoint:admin',
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
