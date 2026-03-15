export const WORKSPACE_BUILT_IN_TEMPLATE_IDS = {
  owner: 'tpl_workspace_owner',
  projectCreator: 'tpl_workspace_project_creator',
  member: 'tpl_workspace_member',
} as const;

export const WORKSPACE_BUILT_IN_GROUP_IDS = {
  owner: 'grp_workspace_owner',
  projectCreators: 'grp_workspace_project_creators',
  members: 'grp_workspace_members',
} as const;

const WORKSPACE_OWNER_TEMPLATE_PERMISSIONS = [
  'workspace:read',
  'workspace:project:create',
  'workspace:governance:update',
] as const;

const WORKSPACE_PROJECT_CREATOR_TEMPLATE_PERMISSIONS = [
  'workspace:read',
  'workspace:project:create',
] as const;

const WORKSPACE_MEMBER_TEMPLATE_PERMISSIONS = [
  'workspace:read',
] as const;

export const WORKSPACE_BUILT_IN_TEMPLATES = {
  owner: {
    id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.owner,
    name: 'Workspace owner',
    description: 'System-managed template for workspace owners.',
    permissions: [...WORKSPACE_OWNER_TEMPLATE_PERMISSIONS],
    built_in: true,
    editable: false,
  },
  projectCreator: {
    id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.projectCreator,
    name: 'Workspace project creators',
    description: 'System-managed template for users who can create projects in a workspace.',
    permissions: [...WORKSPACE_PROJECT_CREATOR_TEMPLATE_PERMISSIONS],
    built_in: true,
    editable: false,
  },
  member: {
    id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.member,
    name: 'Workspace members',
    description: 'System-managed template for workspace members.',
    permissions: [...WORKSPACE_MEMBER_TEMPLATE_PERMISSIONS],
    built_in: true,
    editable: false,
  },
} as const;

export const WORKSPACE_BUILT_IN_GROUPS = {
  owner: {
    id: WORKSPACE_BUILT_IN_GROUP_IDS.owner,
    name: 'Workspace owner',
    description: 'System-managed workspace owner group.',
    permission_template_id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.owner,
    built_in: true,
    system_key: 'owner',
    membership_mode: 'system_managed',
    deletable: false,
  },
  projectCreators: {
    id: WORKSPACE_BUILT_IN_GROUP_IDS.projectCreators,
    name: 'Project creators',
    description: 'System-managed group for users who can create projects.',
    permission_template_id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.projectCreator,
    built_in: true,
    system_key: 'project_creators',
    membership_mode: 'manual',
    deletable: false,
  },
  members: {
    id: WORKSPACE_BUILT_IN_GROUP_IDS.members,
    name: 'Workspace members',
    description: 'System-managed group for active workspace members.',
    permission_template_id: WORKSPACE_BUILT_IN_TEMPLATE_IDS.member,
    built_in: true,
    system_key: 'members',
    membership_mode: 'system_managed',
    deletable: false,
  },
} as const;
