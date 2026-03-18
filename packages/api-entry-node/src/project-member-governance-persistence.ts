import type { JsonDocStorePort } from '@mbos/ports';
import {
  PROJECT_BUILT_IN_GROUPS,
  PROJECT_BUILT_IN_GROUP_IDS,
  PROJECT_BUILT_IN_TEMPLATES,
  isBuiltInProjectGroupId,
  isBuiltInProjectTemplateId,
} from './project-governance-model.js';
import type { ProjectGroupRecord } from './project-groups-store.js';
import type { ProjectMembershipRecord } from './project-memberships-store.js';
import type { ProjectMemberPermissionState } from './project-member-permissions-store.js';
import type { ProjectPermissionTemplateRecord } from './project-permission-templates-store.js';

export type MemberChangeRecord = {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_email: string;
  change_type: 'permissions' | 'resource_policy' | 'group' | 'membership';
  changes: {
    added?: string[];
    removed?: string[];
    updated?: Record<string, { from: unknown; to: unknown }>;
  };
};

const MEMBERSHIP_COLLECTION = 'project_memberships';
const GROUP_COLLECTION = 'project_groups';
const TEMPLATE_COLLECTION = 'project_permission_templates';
const MEMBER_PERMISSION_COLLECTION = 'project_member_permissions';
const MEMBER_HISTORY_COLLECTION = 'project_member_change_history';

type StoredMembershipRecord = ProjectMembershipRecord & { workspace_id: string; id: string };
type StoredGroupRecord = ProjectGroupRecord & { workspace_id: string };
type StoredTemplateRecord = ProjectPermissionTemplateRecord & { workspace_id: string };
type StoredMemberPermissionRecord = ProjectMemberPermissionState & {
  workspace_id: string;
  project_id: string;
  user_id: string;
  id: string;
};
type StoredMemberChangeRecord = MemberChangeRecord & {
  workspace_id: string;
  project_id: string;
  user_id: string;
};

function membershipDocId(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

function memberPermissionDocId(projectId: string, userId: string): string {
  return `${projectId}:${userId}`;
}

function historyDocId(userId: string, changeId: string): string {
  return `${userId}:${changeId}`;
}

function toBuiltInTemplates(projectId: string, now: string): ProjectPermissionTemplateRecord[] {
  return Object.values(PROJECT_BUILT_IN_TEMPLATES).map((template) => ({
    id: template.id,
    project_id: projectId,
    name: template.name,
    description: template.description,
    permissions: [...template.permissions],
    built_in: true,
    editable: false,
    created_at: now,
    updated_at: now,
  }));
}

async function listStoredMemberships(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
): Promise<ProjectMembershipRecord[]> {
  const items = await docStore.list<StoredMembershipRecord>(MEMBERSHIP_COLLECTION, {
    workspace_id: workspaceId,
    project_id: projectId,
  });
  return items.map(({ workspace_id: _workspaceId, id: _id, ...membership }) => membership);
}

export async function getProjectMembershipMap(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
): Promise<Map<string, ProjectMembershipRecord>> {
  const items = await listStoredMemberships(docStore, workspaceId, projectId);
  return new Map(items.map((item) => [item.user_id, item]));
}

export async function getProjectMembership(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<ProjectMembershipRecord | null> {
  const item = await docStore.get<StoredMembershipRecord>(MEMBERSHIP_COLLECTION, membershipDocId(projectId, userId));
  if (!item) return null;
  if (item.workspace_id !== workspaceId || item.project_id !== projectId) return null;
  const { workspace_id: _workspaceId, id: _id, ...membership } = item;
  return membership;
}

export async function upsertProjectMembershipRecord(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  membership: ProjectMembershipRecord,
): Promise<void> {
  await docStore.upsert<StoredMembershipRecord>(
    MEMBERSHIP_COLLECTION,
    membershipDocId(projectId, membership.user_id),
    {
      workspace_id: workspaceId,
      id: membershipDocId(projectId, membership.user_id),
      ...membership,
    },
  );
}

export async function deleteProjectMembershipRecord(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const existing = await getProjectMembership(docStore, workspaceId, projectId, userId);
  if (!existing) return;
  await docStore.delete(MEMBERSHIP_COLLECTION, membershipDocId(projectId, userId));
}

async function listStoredGroups(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
): Promise<ProjectGroupRecord[]> {
  const items = await docStore.list<StoredGroupRecord>(GROUP_COLLECTION, {
    workspace_id: workspaceId,
    project_id: projectId,
  });
  return items.map(({ workspace_id: _workspaceId, ...group }) => group);
}

export async function listProjectGroups(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  projectOwnerId?: string | null,
): Promise<ProjectGroupRecord[]> {
  const storedGroups = await listStoredGroups(docStore, workspaceId, projectId);
  const customGroups = storedGroups.filter((group) => !isBuiltInProjectGroupId(group.id));
  const adminGroup = storedGroups.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins);
  const memberships = await listStoredMemberships(docStore, workspaceId, projectId);
  const activeMemberIds = memberships
    .filter((membership) => membership.status === 'active')
    .map((membership) => membership.user_id);
  const now = new Date().toISOString();
  const ownerGroup: ProjectGroupRecord = {
    id: PROJECT_BUILT_IN_GROUPS.owner.id,
    project_id: projectId,
    name: PROJECT_BUILT_IN_GROUPS.owner.name,
    description: PROJECT_BUILT_IN_GROUPS.owner.description,
    permission_template_id: PROJECT_BUILT_IN_GROUPS.owner.template_id,
    member_ids: projectOwnerId ? [projectOwnerId] : [],
    built_in: true,
    system_key: PROJECT_BUILT_IN_GROUPS.owner.system_key,
    membership_mode: PROJECT_BUILT_IN_GROUPS.owner.membership_mode,
    deletable: false,
    created_at: adminGroup?.created_at ?? now,
    updated_at: now,
  };
  const builtInAdminGroup: ProjectGroupRecord = {
    id: PROJECT_BUILT_IN_GROUPS.admins.id,
    project_id: projectId,
    name: adminGroup?.name ?? PROJECT_BUILT_IN_GROUPS.admins.name,
    description: adminGroup?.description ?? PROJECT_BUILT_IN_GROUPS.admins.description,
    permission_template_id: adminGroup?.permission_template_id ?? PROJECT_BUILT_IN_GROUPS.admins.template_id,
    member_ids: adminGroup ? [...adminGroup.member_ids] : [],
    built_in: true,
    system_key: PROJECT_BUILT_IN_GROUPS.admins.system_key,
    membership_mode: PROJECT_BUILT_IN_GROUPS.admins.membership_mode,
    deletable: false,
    created_at: adminGroup?.created_at ?? now,
    updated_at: adminGroup?.updated_at ?? now,
  };
  const membersGroup: ProjectGroupRecord = {
    id: PROJECT_BUILT_IN_GROUPS.members.id,
    project_id: projectId,
    name: PROJECT_BUILT_IN_GROUPS.members.name,
    description: PROJECT_BUILT_IN_GROUPS.members.description,
    permission_template_id: PROJECT_BUILT_IN_GROUPS.members.template_id,
    member_ids: activeMemberIds.filter((userId) => userId !== projectOwnerId),
    built_in: true,
    system_key: PROJECT_BUILT_IN_GROUPS.members.system_key,
    membership_mode: PROJECT_BUILT_IN_GROUPS.members.membership_mode,
    deletable: false,
    created_at: adminGroup?.created_at ?? now,
    updated_at: now,
  };
  return [ownerGroup, builtInAdminGroup, membersGroup, ...customGroups];
}

export async function getProjectGroupIdsForUser(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
  projectOwnerId?: string | null,
): Promise<string[]> {
  const groups = await listProjectGroups(docStore, workspaceId, projectId, projectOwnerId);
  return groups.filter((group) => group.member_ids.includes(userId)).map((group) => group.id);
}

export async function getAllProjectGroupIdsForUserPersisted(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  userId: string;
  projectOwnerId?: string | null;
}): Promise<string[]> {
  return Array.from(new Set(await getProjectGroupIdsForUser(
    args.docStore,
    args.workspaceId,
    args.projectId,
    args.userId,
    args.projectOwnerId,
  )));
}

export async function saveProjectGroup(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  group: ProjectGroupRecord,
): Promise<void> {
  await docStore.upsert<StoredGroupRecord>(GROUP_COLLECTION, group.id, {
    workspace_id: workspaceId,
    ...group,
    project_id: projectId,
  });
}

export async function deleteProjectGroup(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  groupId: string,
): Promise<void> {
  const item = await docStore.get<StoredGroupRecord>(GROUP_COLLECTION, groupId);
  if (!item || item.workspace_id !== workspaceId || item.project_id !== projectId) return;
  await docStore.delete(GROUP_COLLECTION, groupId);
}

export async function setProjectAdminGroupMembersPersisted(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  memberIds: string[];
}): Promise<void> {
  const now = new Date().toISOString();
  await saveProjectGroup(args.docStore, args.workspaceId, args.projectId, {
    id: PROJECT_BUILT_IN_GROUP_IDS.admins,
    project_id: args.projectId,
    name: PROJECT_BUILT_IN_GROUPS.admins.name,
    description: PROJECT_BUILT_IN_GROUPS.admins.description,
    permission_template_id: PROJECT_BUILT_IN_GROUPS.admins.template_id,
    member_ids: Array.from(new Set(args.memberIds.filter((memberId) => memberId.trim().length > 0))),
    built_in: true,
    system_key: PROJECT_BUILT_IN_GROUPS.admins.system_key,
    membership_mode: PROJECT_BUILT_IN_GROUPS.admins.membership_mode,
    deletable: false,
    created_at: now,
    updated_at: now,
  });
}

export async function addUserToProjectAdminGroupPersisted(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  userId: string;
}): Promise<void> {
  const groups = await listProjectGroups(args.docStore, args.workspaceId, args.projectId);
  const admin = groups.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins);
  const memberIds = Array.from(new Set([...(admin?.member_ids ?? []), args.userId]));
  await setProjectAdminGroupMembersPersisted({
    docStore: args.docStore,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    memberIds,
  });
}

export async function listProjectPermissionTemplates(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
): Promise<ProjectPermissionTemplateRecord[]> {
  const now = new Date().toISOString();
  const builtIns = toBuiltInTemplates(projectId, now);
  const stored = await docStore.list<StoredTemplateRecord>(TEMPLATE_COLLECTION, {
    workspace_id: workspaceId,
    project_id: projectId,
  });
  const custom = stored
    .map(({ workspace_id: _workspaceId, ...template }) => template)
    .filter((template) => !isBuiltInProjectTemplateId(template.id));
  return [...builtIns, ...custom];
}

export async function saveProjectPermissionTemplate(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  template: ProjectPermissionTemplateRecord,
): Promise<void> {
  await docStore.upsert<StoredTemplateRecord>(TEMPLATE_COLLECTION, template.id, {
    workspace_id: workspaceId,
    ...template,
    project_id: projectId,
  });
}

export async function deleteProjectPermissionTemplate(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  templateId: string,
): Promise<void> {
  const item = await docStore.get<StoredTemplateRecord>(TEMPLATE_COLLECTION, templateId);
  if (!item || item.workspace_id !== workspaceId || item.project_id !== projectId) return;
  await docStore.delete(TEMPLATE_COLLECTION, templateId);
}

export async function getProjectMemberPermissionState(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<ProjectMemberPermissionState | null> {
  const item = await docStore.get<StoredMemberPermissionRecord>(MEMBER_PERMISSION_COLLECTION, memberPermissionDocId(projectId, userId));
  if (!item || item.workspace_id !== workspaceId || item.project_id !== projectId || item.user_id !== userId) return null;
  const { workspace_id: _workspaceId, project_id: _projectId, user_id: _userId, id: _id, ...state } = item;
  return state;
}

export async function getProjectMemberPermissionMap(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
): Promise<Map<string, ProjectMemberPermissionState>> {
  const items = await docStore.list<StoredMemberPermissionRecord>(MEMBER_PERMISSION_COLLECTION, {
    workspace_id: workspaceId,
    project_id: projectId,
  });
  return new Map(items.map((item) => {
    const { workspace_id: _workspaceId, project_id: _projectId, user_id, id: _id, ...state } = item;
    return [user_id, state];
  }));
}

export async function upsertProjectMemberPermissionState(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
  state: ProjectMemberPermissionState,
): Promise<void> {
  await docStore.upsert<StoredMemberPermissionRecord>(
    MEMBER_PERMISSION_COLLECTION,
    memberPermissionDocId(projectId, userId),
    {
      workspace_id: workspaceId,
      project_id: projectId,
      user_id: userId,
      id: memberPermissionDocId(projectId, userId),
      ...state,
    },
  );
}

export async function deleteProjectMemberPermissionState(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<void> {
  const existing = await getProjectMemberPermissionState(docStore, workspaceId, projectId, userId);
  if (!existing) return;
  await docStore.delete(MEMBER_PERMISSION_COLLECTION, memberPermissionDocId(projectId, userId));
}

export async function listProjectMemberChangeHistory(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
): Promise<MemberChangeRecord[]> {
  const items = await docStore.list<StoredMemberChangeRecord>(MEMBER_HISTORY_COLLECTION, {
    workspace_id: workspaceId,
    project_id: projectId,
    user_id: userId,
  });
  return items
    .map(({ workspace_id: _workspaceId, project_id: _projectId, user_id: _userId, ...item }) => item)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function appendProjectMemberChangeHistory(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  userId: string,
  change: MemberChangeRecord,
): Promise<void> {
  await docStore.upsert<StoredMemberChangeRecord>(
    MEMBER_HISTORY_COLLECTION,
    historyDocId(userId, change.id),
    {
      workspace_id: workspaceId,
      project_id: projectId,
      user_id: userId,
      ...change,
    },
  );
}
