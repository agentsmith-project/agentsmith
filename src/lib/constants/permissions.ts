/**
 * Permission Points Constants (Token-only MVP)
 */

export const PLATFORM_PERMISSIONS = {
  WORKSPACE: [
    'workspace:read',
    'workspace:project:create',
    'workspace:governance:update',
  ] as const,

  PROJECT_BASE: ['project:read'] as const,

  ACCESS: ['project:chat:access', 'project:studio:access'] as const,

  SOURCE: ['project:source:use', 'project:source:manage'] as const,

  ENDPOINT: ['project:endpoint:use', 'project:endpoint:manage'] as const,

  AGENT: ['project:agent:use', 'project:agent:manage'] as const,

  RESOURCE_POLICY: ['project:resource_policy:manage'] as const,

  CREDENTIAL: ['project:credential:manage'] as const,

  SETTINGS: ['project:settings:manage'] as const,

  MEMBER: ['project:member:view', 'project:member:manage'] as const,

  OBSERVABILITY: ['project:audit:view', 'project:usage:view'] as const,
} as const;

export const ALL_PLATFORM_PERMISSIONS = [
  ...PLATFORM_PERMISSIONS.WORKSPACE,
  ...PLATFORM_PERMISSIONS.PROJECT_BASE,
  ...PLATFORM_PERMISSIONS.ACCESS,
  ...PLATFORM_PERMISSIONS.SOURCE,
  ...PLATFORM_PERMISSIONS.ENDPOINT,
  ...PLATFORM_PERMISSIONS.AGENT,
  ...PLATFORM_PERMISSIONS.RESOURCE_POLICY,
  ...PLATFORM_PERMISSIONS.CREDENTIAL,
  ...PLATFORM_PERMISSIONS.SETTINGS,
  ...PLATFORM_PERMISSIONS.MEMBER,
  ...PLATFORM_PERMISSIONS.OBSERVABILITY,
] as const;

export const PERMISSION_DESCRIPTIONS: Record<string, string> = {
  'workspace:read': 'View workspace info',
  'workspace:project:create': 'Create projects in workspace',
  'workspace:governance:update': 'Update workspace governance groups',
  'project:read': 'View project shell and overview',
  'project:chat:access': 'Access chat page and features',
  'project:studio:access': 'Access AI Studio page and tasks',
  'project:source:use': 'Use source libraries and files',
  'project:source:manage': 'Manage source libraries and files',
  'project:endpoint:use': 'Use model endpoints',
  'project:endpoint:manage': 'Manage model endpoints',
  'project:agent:use': 'Use agents',
  'project:agent:manage': 'Manage agents and keys',
  'project:resource_policy:manage': 'Manage resource access and usage policy',
  'project:credential:manage': 'Manage project credentials',
  'project:settings:manage': 'Manage project settings',
  'project:member:view': 'View members',
  'project:member:manage': 'Manage members and templates',
  'project:audit:view': 'View audit logs',
  'project:usage:view': 'View usage data',
};

export const PLATFORM_PERMISSIONS_GROUPED = [
  {
    id: 'workspace',
    name: 'Workspace',
    permissions: PLATFORM_PERMISSIONS.WORKSPACE,
  },
  {
    id: 'access',
    name: 'Chat / Studio Access',
    permissions: PLATFORM_PERMISSIONS.ACCESS,
  },
  {
    id: 'resources',
    name: 'Resources',
    permissions: [
      ...PLATFORM_PERMISSIONS.SOURCE,
      ...PLATFORM_PERMISSIONS.ENDPOINT,
      ...PLATFORM_PERMISSIONS.AGENT,
    ],
  },
  {
    id: 'governance',
    name: 'Governance',
    permissions: [
      ...PLATFORM_PERMISSIONS.RESOURCE_POLICY,
      ...PLATFORM_PERMISSIONS.CREDENTIAL,
      ...PLATFORM_PERMISSIONS.SETTINGS,
      ...PLATFORM_PERMISSIONS.MEMBER,
      ...PLATFORM_PERMISSIONS.PROJECT_BASE,
    ],
  },
  {
    id: 'observability',
    name: 'Audit / Usage',
    permissions: PLATFORM_PERMISSIONS.OBSERVABILITY,
  },
] as const;

export const GROUP_TEMPLATES = {
  owner: [
    ...PLATFORM_PERMISSIONS.WORKSPACE,
    ...PLATFORM_PERMISSIONS.PROJECT_BASE,
    ...PLATFORM_PERMISSIONS.ACCESS,
    ...PLATFORM_PERMISSIONS.SOURCE,
    ...PLATFORM_PERMISSIONS.ENDPOINT,
    ...PLATFORM_PERMISSIONS.AGENT,
    ...PLATFORM_PERMISSIONS.RESOURCE_POLICY,
    ...PLATFORM_PERMISSIONS.CREDENTIAL,
    ...PLATFORM_PERMISSIONS.SETTINGS,
    ...PLATFORM_PERMISSIONS.MEMBER,
    ...PLATFORM_PERMISSIONS.OBSERVABILITY,
  ],
  admin: [
    ...PLATFORM_PERMISSIONS.WORKSPACE,
    ...PLATFORM_PERMISSIONS.PROJECT_BASE,
    ...PLATFORM_PERMISSIONS.ACCESS,
    ...PLATFORM_PERMISSIONS.SOURCE,
    ...PLATFORM_PERMISSIONS.ENDPOINT,
    ...PLATFORM_PERMISSIONS.AGENT,
    ...PLATFORM_PERMISSIONS.RESOURCE_POLICY,
    ...PLATFORM_PERMISSIONS.CREDENTIAL,
    ...PLATFORM_PERMISSIONS.SETTINGS,
    ...PLATFORM_PERMISSIONS.MEMBER,
    ...PLATFORM_PERMISSIONS.OBSERVABILITY,
  ],
  developer: [
    'workspace:read',
    ...PLATFORM_PERMISSIONS.PROJECT_BASE,
    ...PLATFORM_PERMISSIONS.ACCESS,
    'project:source:use',
    'project:endpoint:use',
    'project:agent:use',
    ...PLATFORM_PERMISSIONS.OBSERVABILITY,
  ],
  user: [
    'workspace:read',
    ...PLATFORM_PERMISSIONS.PROJECT_BASE,
    ...PLATFORM_PERMISSIONS.ACCESS,
    'project:source:use',
    'project:endpoint:use',
    'project:agent:use',
    ...PLATFORM_PERMISSIONS.OBSERVABILITY,
  ],
} as const;

export const DEFAULT_PERMISSION_GROUP_TEMPLATES = {
  project_admin_template: [...GROUP_TEMPLATES.owner],
  project_operator_template: [
    ...PLATFORM_PERMISSIONS.ACCESS,
    ...PLATFORM_PERMISSIONS.SOURCE,
    ...PLATFORM_PERMISSIONS.ENDPOINT,
    ...PLATFORM_PERMISSIONS.AGENT,
    'project:member:view',
    ...PLATFORM_PERMISSIONS.OBSERVABILITY,
  ],
  project_member_template: [...GROUP_TEMPLATES.user],
  project_viewer_template: [...PLATFORM_PERMISSIONS.OBSERVABILITY],
} as const;

export const HIGH_RISK_PERMISSIONS = [
  'project:resource_policy:manage',
  'project:credential:manage',
  'project:settings:manage',
  'project:member:manage',
  'project:agent:manage',
  'project:endpoint:manage',
  'project:source:manage',
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
