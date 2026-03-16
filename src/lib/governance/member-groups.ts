import type { MemberGroupSummary, PermissionTemplate } from '@/lib/api/types';
import { PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS } from '@/lib/constants/permissions';

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

type Translator = (key: string) => string;

export function getProjectBuiltInTemplateOptions(t: Translator): PermissionTemplate[] {
  return [
    {
      id: PROJECT_BUILT_IN_TEMPLATE_IDS.owner,
      name: t('default_templates.owner'),
      description: t('default_templates.owner_description'),
      permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.owner],
      built_in: true,
      editable: false,
      is_default: true,
      is_readonly: true,
    },
    {
      id: PROJECT_BUILT_IN_TEMPLATE_IDS.admin,
      name: t('default_templates.admin'),
      description: t('default_templates.admin_description'),
      permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.admin],
      built_in: true,
      editable: false,
      is_default: true,
      is_readonly: true,
    },
    {
      id: PROJECT_BUILT_IN_TEMPLATE_IDS.member,
      name: t('default_templates.user'),
      description: t('default_templates.user_description'),
      permissions: [...PROJECT_BUILT_IN_TEMPLATE_PERMISSIONS.member],
      built_in: true,
      editable: false,
      is_default: true,
      is_readonly: true,
    },
  ];
}

export function isProjectBuiltInTemplateId(templateId: string | undefined): boolean {
  if (!templateId) return false;
  return Object.values(PROJECT_BUILT_IN_TEMPLATE_IDS).includes(
    templateId as (typeof PROJECT_BUILT_IN_TEMPLATE_IDS)[keyof typeof PROJECT_BUILT_IN_TEMPLATE_IDS],
  );
}

export function isProjectBuiltInGroupId(groupId: string | undefined): boolean {
  if (!groupId) return false;
  return Object.values(PROJECT_BUILT_IN_GROUP_IDS).includes(
    groupId as (typeof PROJECT_BUILT_IN_GROUP_IDS)[keyof typeof PROJECT_BUILT_IN_GROUP_IDS],
  );
}

export function getMemberAccessGroupLabel(args: {
  groups?: MemberGroupSummary[];
  permissions?: readonly string[];
  fallback?: string;
}): string {
  const groups = args.groups ?? [];
  if (groups.some((group) => group.system_key === 'owner' || group.id === PROJECT_BUILT_IN_GROUP_IDS.owner)) {
    return 'governance';
  }
  if (groups.some((group) => group.system_key === 'admins' || group.id === PROJECT_BUILT_IN_GROUP_IDS.admins)) {
    return 'manager';
  }
  if (groups.some((group) => group.system_key === 'members' || group.id === PROJECT_BUILT_IN_GROUP_IDS.members)) {
    return 'member';
  }
  return args.fallback ?? '-';
}

export function getWorkspaceAccessGroupLabel(args: {
  groups?: MemberGroupSummary[];
  permissions?: readonly string[];
}): 'owner' | 'project_creator' | 'member' {
  const groups = args.groups ?? [];
  if (groups.some((group) => group.id === WORKSPACE_BUILT_IN_GROUP_IDS.owner || group.system_key === 'owner')) {
    return 'owner';
  }
  if (
    groups.some((group) => group.id === WORKSPACE_BUILT_IN_GROUP_IDS.projectCreators || group.system_key === 'project_creators')
    || (args.permissions ?? []).includes('workspace:project:create')
  ) {
    return 'project_creator';
  }
  return 'member';
}
