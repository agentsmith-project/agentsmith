/**
 * Legacy in-memory project group store.
 *
 * Production governance data now lives in `project-member-governance-persistence.ts`
 * and the backing docStore. Keep this module out of production write/read paths.
 */
import { getProjectMembershipsState } from './project-memberships-store.js';
import {
  PROJECT_BUILT_IN_GROUPS,
  PROJECT_BUILT_IN_GROUP_IDS,
  isBuiltInProjectGroupId,
} from './project-governance-model.js';

export type ProjectGroupRecord = {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  permission_template_id: string;
  member_ids: string[];
  built_in?: boolean;
  system_key?: 'owner' | 'admins' | 'members';
  membership_mode?: 'system_managed' | 'manual';
  deletable?: boolean;
  created_at: string;
  updated_at: string;
};

const PROJECT_GROUPS_BY_PROJECT = new Map<string, ProjectGroupRecord[]>();

function projectScopedKey(workspaceId: string, projectId: string) {
  return `${workspaceId}:${projectId}`;
}

function ensureProjectGroupState(workspaceId: string, projectId: string): ProjectGroupRecord[] {
  const key = projectScopedKey(workspaceId, projectId);
  const existing = PROJECT_GROUPS_BY_PROJECT.get(key);
  if (existing) return existing;
  const now = new Date().toISOString();
  const next: ProjectGroupRecord[] = [
    {
      id: PROJECT_BUILT_IN_GROUPS.owner.id,
      project_id: projectId,
      name: PROJECT_BUILT_IN_GROUPS.owner.name,
      description: PROJECT_BUILT_IN_GROUPS.owner.description,
      permission_template_id: PROJECT_BUILT_IN_GROUPS.owner.template_id,
      member_ids: [],
      built_in: true,
      system_key: PROJECT_BUILT_IN_GROUPS.owner.system_key,
      membership_mode: PROJECT_BUILT_IN_GROUPS.owner.membership_mode,
      deletable: false,
      created_at: now,
      updated_at: now,
    },
    {
      id: PROJECT_BUILT_IN_GROUPS.admins.id,
      project_id: projectId,
      name: PROJECT_BUILT_IN_GROUPS.admins.name,
      description: PROJECT_BUILT_IN_GROUPS.admins.description,
      permission_template_id: PROJECT_BUILT_IN_GROUPS.admins.template_id,
      member_ids: [],
      built_in: true,
      system_key: PROJECT_BUILT_IN_GROUPS.admins.system_key,
      membership_mode: PROJECT_BUILT_IN_GROUPS.admins.membership_mode,
      deletable: false,
      created_at: now,
      updated_at: now,
    },
    {
      id: PROJECT_BUILT_IN_GROUPS.members.id,
      project_id: projectId,
      name: PROJECT_BUILT_IN_GROUPS.members.name,
      description: PROJECT_BUILT_IN_GROUPS.members.description,
      permission_template_id: PROJECT_BUILT_IN_GROUPS.members.template_id,
      member_ids: [],
      built_in: true,
      system_key: PROJECT_BUILT_IN_GROUPS.members.system_key,
      membership_mode: PROJECT_BUILT_IN_GROUPS.members.membership_mode,
      deletable: false,
      created_at: now,
      updated_at: now,
    },
  ];
  PROJECT_GROUPS_BY_PROJECT.set(key, next);
  return next;
}

function syncBuiltInProjectGroups(args: {
  workspaceId: string;
  projectId: string;
  projectOwnerId?: string | null;
}): ProjectGroupRecord[] {
  const state = ensureProjectGroupState(args.workspaceId, args.projectId);
  const ownerGroup = state.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.owner);
  const membersGroup = state.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.members);
  const activeMemberIds = Array.from(getProjectMembershipsState(args.workspaceId, args.projectId).values())
    .filter((membership) => membership.status === 'active')
    .map((membership) => membership.user_id);
  const now = new Date().toISOString();
  if (ownerGroup) {
    ownerGroup.member_ids = args.projectOwnerId ? [args.projectOwnerId] : [];
    ownerGroup.updated_at = now;
  }
  if (membersGroup) {
    membersGroup.member_ids = activeMemberIds.filter((userId) => userId !== args.projectOwnerId);
    membersGroup.updated_at = now;
  }
  return state;
}

export function getProjectGroupsState(
  workspaceId: string,
  projectId: string,
  projectOwnerId?: string | null,
): ProjectGroupRecord[] {
  return syncBuiltInProjectGroups({ workspaceId, projectId, projectOwnerId });
}

export function setProjectGroupsState(workspaceId: string, projectId: string, groups: ProjectGroupRecord[]): void {
  PROJECT_GROUPS_BY_PROJECT.set(projectScopedKey(workspaceId, projectId), groups);
}

export function getProjectGroupIdsForUser(
  workspaceId: string,
  projectId: string,
  userId: string,
  projectOwnerId?: string | null,
): string[] {
  return getProjectGroupsState(workspaceId, projectId, projectOwnerId)
    .filter((group) => group.member_ids.includes(userId))
    .map((group) => group.id);
}

export function getAllProjectGroupIdsForUser(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
  projectOwnerId?: string | null;
}): string[] {
  return Array.from(new Set(getProjectGroupIdsForUser(
    args.workspaceId,
    args.projectId,
    args.userId,
    args.projectOwnerId,
  )));
}

export function setProjectAdminGroupMembers(args: {
  workspaceId: string;
  projectId: string;
  memberIds: string[];
}): void {
  const state = ensureProjectGroupState(args.workspaceId, args.projectId);
  const adminGroup = state.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins);
  if (!adminGroup) return;
  adminGroup.member_ids = Array.from(new Set(args.memberIds.filter((memberId) => memberId.trim().length > 0)));
  adminGroup.updated_at = new Date().toISOString();
}

export function addUserToProjectAdminGroup(args: {
  workspaceId: string;
  projectId: string;
  userId: string;
}): void {
  const state = ensureProjectGroupState(args.workspaceId, args.projectId);
  const adminGroup = state.find((group) => group.id === PROJECT_BUILT_IN_GROUP_IDS.admins);
  if (!adminGroup) return;
  if (!adminGroup.member_ids.includes(args.userId)) {
    adminGroup.member_ids.push(args.userId);
    adminGroup.updated_at = new Date().toISOString();
  }
}

export function isMutableProjectGroup(groupId: string): boolean {
  return !isBuiltInProjectGroupId(groupId);
}
