import type { JsonDocStorePort } from '@mbos/ports';
import {
  getAllProjectGroupIdsForUserPersisted,
  getProjectMembership,
  getProjectMemberPermissionState,
  listProjectGroups,
  listProjectPermissionTemplates,
} from './project-member-governance-persistence.js';
import type { ProjectPermissionTemplateRecord } from './project-member-governance-types.js';
import {
  getProjectResourcePolicy,
} from './project-resource-policy-store.js';
import {
  PROJECT_BUILT_IN_GROUP_IDS,
} from './project-governance-model.js';

type ResourceType = 'project' | 'endpoint' | 'file_library' | 'agent';
type SubjectType = 'user' | 'group' | 'agent';

export type ProjectAuthzPermissionSource =
  | {
    type: 'group_template';
    permission: string;
    group_id: string;
    group_name: string;
    template_id: string;
    template_name: string;
  }
  | {
    type: 'member_template';
    permission: string;
    template_id: string;
    template_name: string;
  }
  | {
    type: 'member_custom';
    permission: string;
  };

export type ProjectPermissionDecision = {
  permission: string;
  granted: boolean;
  reason: string;
  source: 'permission';
  source_detail?: ProjectAuthzPermissionSource;
  membership_status: 'active' | 'pending' | 'suspended' | 'none';
};

export type ProjectAuthorizationSnapshot = {
  effective_permissions: string[];
  membership_status: 'active' | 'pending' | 'suspended' | 'none';
  permission_sources: ProjectAuthzPermissionSource[];
};

export type ProjectAuthorizationEvaluation = ProjectAuthorizationSnapshot & {
  decisions: ProjectPermissionDecision[];
};

export type ResourcePolicyDecision = {
  allowed: boolean;
  matched_policy?: {
    id: string;
    resource_type: 'endpoint' | 'file_library' | 'agent';
    resource_id: string;
    access_mode: 'allow_all_members' | 'allow_list';
    matched_subject?: {
      type: 'user' | 'group';
      id: string;
    };
  };
  reason?: string;
};

function getMembershipStatus(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
  actorUserId: string,
): Promise<ProjectAuthorizationSnapshot['membership_status']> {
  return getProjectMembership(docStore, workspaceId, projectId, actorUserId)
    .then((membership) => membership?.status ?? 'none');
}

function addPermissionSource(
  target: Map<string, ProjectAuthzPermissionSource>,
  source: ProjectAuthzPermissionSource,
): void {
  if (!target.has(source.permission)) {
    target.set(source.permission, source);
  }
}

function templateMap(
  docStore: JsonDocStorePort,
  workspaceId: string,
  projectId: string,
): Promise<Map<string, ProjectPermissionTemplateRecord>> {
  return listProjectPermissionTemplates(docStore, workspaceId, projectId)
    .then((templates) => new Map(templates.map((template) => [template.id, template])));
}

async function collectPermissionSources(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  projectGovernance?: unknown;
  actorUserId: string;
}): ProjectAuthorizationSnapshot {
  const { docStore, workspaceId, projectId, projectOwnerId, actorUserId } = args;
  const storedMembershipStatus = await getMembershipStatus(docStore, workspaceId, projectId, actorUserId);
  const byPermission = new Map<string, ProjectAuthzPermissionSource>();

  const templates = await templateMap(docStore, workspaceId, projectId);
  const groups = await listProjectGroups(docStore, workspaceId, projectId, projectOwnerId);
  const hasGroupMembership = groups.some((group) => group.member_ids.includes(actorUserId));
  const membershipStatus: ProjectAuthorizationSnapshot['membership_status'] =
    actorUserId === projectOwnerId
      ? 'active'
      : (storedMembershipStatus === 'none' && hasGroupMembership ? 'active' : storedMembershipStatus);

  if (membershipStatus !== 'active' && actorUserId !== projectOwnerId) {
    return {
      membership_status: membershipStatus,
      effective_permissions: [],
      permission_sources: [],
    };
  }

  for (const group of groups) {
    if (!group.member_ids.includes(actorUserId)) continue;
    const template = templates.get(group.permission_template_id);
    if (!template) continue;
    for (const permission of template.permissions) {
      addPermissionSource(byPermission, {
        type: 'group_template',
        permission,
        group_id: group.id,
        group_name: group.name,
        template_id: template.id,
        template_name: template.name,
      });
    }
  }

  const memberPermissionState = await getProjectMemberPermissionState(docStore, workspaceId, projectId, actorUserId);
  if (memberPermissionState) {
    if (memberPermissionState.mode === 'template' && memberPermissionState.template) {
      const template = templates.get(memberPermissionState.template);
      if (template) {
        for (const permission of template.permissions) {
          addPermissionSource(byPermission, {
            type: 'member_template',
            permission,
            template_id: template.id,
            template_name: template.name,
          });
        }
      }
    }
    if (memberPermissionState.mode === 'custom') {
      for (const permission of memberPermissionState.permissions) {
        addPermissionSource(byPermission, {
          type: 'member_custom',
          permission,
        });
      }
    }
  }

  return {
    membership_status: membershipStatus,
    effective_permissions: [...byPermission.keys()],
    permission_sources: [...byPermission.values()],
  };
}

export async function evaluateProjectPermissions(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  projectGovernance?: unknown;
  actorUserId: string;
  requiredPermissions: readonly string[];
}): Promise<ProjectAuthorizationEvaluation> {
  const snapshot = await collectPermissionSources(args);
  const sourceByPermission = new Map(snapshot.permission_sources.map((item) => [item.permission, item]));
  const decisions = args.requiredPermissions.map((permission) => {
    if (snapshot.membership_status === 'pending') {
      return {
        permission,
        granted: false,
        reason: 'membership_pending',
        source: 'permission' as const,
        membership_status: snapshot.membership_status,
      };
    }
    if (snapshot.membership_status === 'suspended') {
      return {
        permission,
        granted: false,
        reason: 'membership_suspended',
        source: 'permission' as const,
        membership_status: snapshot.membership_status,
      };
    }
    const sourceDetail = sourceByPermission.get(permission);
    if (sourceDetail) {
      return {
        permission,
        granted: true,
        reason: 'granted_by_member_governance',
        source: 'permission',
        source_detail: sourceDetail,
        membership_status: snapshot.membership_status,
      };
    }
    return {
      permission,
      granted: false,
      reason: 'permission_not_granted',
      source: 'permission' as const,
      membership_status: snapshot.membership_status,
    };
  });

  return {
    ...snapshot,
    decisions,
  };
}

export async function resolveVisibleProjectPermissionsForActor(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  projectGovernance?: unknown;
  actorUserId: string;
}): Promise<readonly string[]> {
  const snapshot = await collectPermissionSources(args);
  if (snapshot.membership_status === 'pending' || snapshot.membership_status === 'suspended') {
    return [];
  }
  return snapshot.effective_permissions;
}

export async function resolveVisibleProjectRoleForActor(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  projectGovernance?: unknown;
  actorUserId: string;
}): Promise<'owner' | 'admin' | 'developer' | undefined> {
  if (args.projectOwnerId === args.actorUserId) {
    return 'owner';
  }
  const groupIds = await getAllProjectGroupIdsForUserPersisted({
    docStore: args.docStore,
    workspaceId: args.workspaceId,
    projectId: args.projectId,
    userId: args.actorUserId,
    projectOwnerId: args.projectOwnerId,
  });
  if (groupIds.includes(PROJECT_BUILT_IN_GROUP_IDS.admins)) {
    return 'admin';
  }
  const snapshot = await collectPermissionSources(args);
  return snapshot.membership_status === 'active' ? 'developer' : undefined;
}

function mapProjectActionToPermission(action: string): string | null {
  if (action.startsWith('project.audit.')) return 'project:audit:read';
  if (action.startsWith('project.usage.')) return 'project:endpoint:use';
  if (action === 'project.read') return 'project:endpoint:use';
  if (action === 'project.delete' || action.startsWith('project.owner.') || action.startsWith('project.settings.lifecycle.')) {
    return 'project:lifecycle:update';
  }
  if (action.startsWith('project.admin.') || action.startsWith('project.settings.admins.')) {
    return 'project:admins:update';
  }
  if (action.startsWith('project.member.')) return 'project:membership:update';
  if (action.startsWith('project.governance.')) return 'project:governance:update';
  if (action === 'project.update' || action.startsWith('project.settings.')) {
    return 'project:lifecycle:update';
  }
  return 'project:endpoint:use';
}

function mapResourceActionToPermission(resourceType: Exclude<ResourceType, 'project'>, action: string): string {
  if (resourceType === 'endpoint') {
    return /invoke|proxy|rerank|image|video|read|list/i.test(action)
      ? 'project:endpoint:use'
      : 'project:governance:update';
  }
  if (resourceType === 'file_library') {
    return /read|list|download|browse/i.test(action)
      ? 'project:endpoint:use'
      : 'project:files:update';
  }
  if (/public|publish|unpublish/i.test(action)) {
    return 'project:agent:public';
  }
  return 'project:agent:manage';
}

export function mapAuthorizationRequestToPermission(args: {
  resourceType: ResourceType;
  action: string;
}): string | null {
  if (args.resourceType === 'project') {
    return mapProjectActionToPermission(args.action);
  }
  return mapResourceActionToPermission(args.resourceType, args.action);
}

export async function evaluateResourcePolicyAuthorization(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  resourceType: Exclude<ResourceType, 'project'>;
  resourceId: string;
  subjectType: SubjectType;
  subjectId: string;
}): Promise<ResourcePolicyDecision> {
  const policy = await getProjectResourcePolicy(
    args.docStore,
    args.workspaceId,
    args.projectId,
    args.resourceType,
    args.resourceId,
  );
  if (!policy) {
    return { allowed: true };
  }
  if (policy.access_mode === 'allow_all_members') {
    return {
      allowed: true,
      matched_policy: {
        id: `${policy.resource_type}:${policy.resource_id}`,
        resource_type: policy.resource_type,
        resource_id: policy.resource_id,
        access_mode: policy.access_mode,
      },
    };
  }

  if (args.subjectType === 'user') {
    const userMatch = policy.allowed_subjects.find(
      (subject) => subject.subject_type === 'user' && subject.subject_id === args.subjectId,
    );
    if (userMatch) {
      return {
        allowed: true,
        matched_policy: {
          id: `${policy.resource_type}:${policy.resource_id}`,
          resource_type: policy.resource_type,
          resource_id: policy.resource_id,
          access_mode: policy.access_mode,
          matched_subject: { type: 'user', id: args.subjectId },
        },
      };
    }
    const groups = await getAllProjectGroupIdsForUserPersisted({
      docStore: args.docStore,
      workspaceId: args.workspaceId,
      projectId: args.projectId,
      userId: args.subjectId,
      projectOwnerId: null,
    });
    const groupMatch = policy.allowed_subjects.find(
      (subject) => subject.subject_type === 'group' && groups.includes(subject.subject_id),
    );
    if (groupMatch) {
      return {
        allowed: true,
        matched_policy: {
          id: `${policy.resource_type}:${policy.resource_id}`,
          resource_type: policy.resource_type,
          resource_id: policy.resource_id,
          access_mode: policy.access_mode,
          matched_subject: { type: 'group', id: groupMatch.subject_id },
        },
      };
    }
  }

  if (args.subjectType === 'group') {
    const groupMatch = policy.allowed_subjects.find(
      (subject) => subject.subject_type === 'group' && subject.subject_id === args.subjectId,
    );
    if (groupMatch) {
      return {
        allowed: true,
        matched_policy: {
          id: `${policy.resource_type}:${policy.resource_id}`,
          resource_type: policy.resource_type,
          resource_id: policy.resource_id,
          access_mode: policy.access_mode,
          matched_subject: { type: 'group', id: args.subjectId },
        },
      };
    }
  }

  return {
    allowed: false,
    matched_policy: {
      id: `${policy.resource_type}:${policy.resource_id}`,
      resource_type: policy.resource_type,
      resource_id: policy.resource_id,
      access_mode: policy.access_mode,
    },
    reason: 'not_in_allow_list',
  };
}

export async function resolveProjectPermissionsForActor(args: {
  docStore: JsonDocStorePort;
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
}): Promise<readonly string[]> {
  return (await collectPermissionSources(args)).effective_permissions;
}
