export const PROJECT_BUILT_IN_TEMPLATE_IDS = {
  owner: 'tpl_project_owner',
  admin: 'tpl_project_admin',
  member: 'tpl_project_member',
} as const;

export const PROJECT_BUILT_IN_GROUP_IDS = {
  owner: 'grp_project_owner',
  admins: 'grp_project_admins',
  members: 'grp_project_members',
} as const;

export type ProjectBuiltInTemplateKey = keyof typeof PROJECT_BUILT_IN_TEMPLATE_IDS;
export type ProjectBuiltInGroupKey = keyof typeof PROJECT_BUILT_IN_GROUP_IDS;

export type ProjectBuiltInTemplateRecord = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  built_in: true;
  editable: false;
};

export type ProjectBuiltInGroupRecord = {
  id: string;
  name: string;
  description: string;
  template_id: string;
  built_in: true;
  system_key: ProjectBuiltInGroupKey;
  membership_mode: 'system_managed' | 'manual';
  deletable: false;
};

const PROJECT_OWNER_TEMPLATE_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent_task:use',
  'project:agent_task:terminal',
  'project:agent_runner:read',
  'project:agent_runner:manage',
  'project:audit:read',
  'project:governance:update',
  'project:membership:update',
  'project:admins:update',
  'project:lifecycle:update',
  'project:files:update',
] as const;

const PROJECT_ADMIN_TEMPLATE_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent_task:use',
  'project:agent_task:terminal',
  'project:agent_runner:read',
  'project:agent_runner:manage',
  'project:audit:read',
  'project:governance:update',
  'project:membership:update',
  'project:admins:update',
  'project:files:update',
] as const;

const PROJECT_MEMBER_TEMPLATE_PERMISSIONS = [
  'project:endpoint:use',
  'project:agent_task:use',
  'project:agent_task:terminal',
] as const;

export const PROJECT_BUILT_IN_TEMPLATES: Record<ProjectBuiltInTemplateKey, ProjectBuiltInTemplateRecord> = {
  owner: {
    id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
    name: 'Project owner',
    description: 'System-managed template for the project owner.',
    permissions: [...PROJECT_OWNER_TEMPLATE_PERMISSIONS],
    built_in: true,
    editable: false,
  },
  admin: {
    id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
    name: 'Project admins',
    description: 'System-managed template for project administrators.',
    permissions: [...PROJECT_ADMIN_TEMPLATE_PERMISSIONS],
    built_in: true,
    editable: false,
  },
  member: {
    id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
    name: 'Project members',
    description: 'System-managed template for active project members.',
    permissions: [...PROJECT_MEMBER_TEMPLATE_PERMISSIONS],
    built_in: true,
    editable: false,
  },
};

export const PROJECT_BUILT_IN_GROUPS: Record<ProjectBuiltInGroupKey, ProjectBuiltInGroupRecord> = {
  owner: {
    id: PROJECT_BUILT_IN_GROUP_IDS.owner,
    name: 'Project owner',
    description: 'System-managed owner group.',
    template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
    built_in: true,
    system_key: 'owner',
    membership_mode: 'system_managed',
    deletable: false,
  },
  admins: {
    id: PROJECT_BUILT_IN_GROUP_IDS.admins,
    name: 'Project admins',
    description: 'System-managed administrator group.',
    template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
    built_in: true,
    system_key: 'admins',
    membership_mode: 'manual',
    deletable: false,
  },
  members: {
    id: PROJECT_BUILT_IN_GROUP_IDS.members,
    name: 'Project members',
    description: 'System-managed active member group.',
    template_id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
    built_in: true,
    system_key: 'members',
    membership_mode: 'system_managed',
    deletable: false,
  },
};

export function isBuiltInProjectTemplateId(templateId: string | undefined): boolean {
  if (!templateId) return false;
  return Object.values(PROJECT_BUILT_IN_TEMPLATE_IDS).includes(templateId as (typeof PROJECT_BUILT_IN_TEMPLATE_IDS)[ProjectBuiltInTemplateKey]);
}

export function isBuiltInProjectGroupId(groupId: string | undefined): boolean {
  if (!groupId) return false;
  return Object.values(PROJECT_BUILT_IN_GROUP_IDS).includes(groupId as (typeof PROJECT_BUILT_IN_GROUP_IDS)[ProjectBuiltInGroupKey]);
}
