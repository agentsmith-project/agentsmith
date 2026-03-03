import { getProjectGroupsState } from './project-groups-store.js';
import {
  getProjectMembershipsState,
} from './project-memberships-store.js';
import {
  getProjectMemberPermissionsState,
} from './project-member-permissions-store.js';
import {
  getProjectPermissionTemplatesState,
  type ProjectPermissionTemplateRecord,
} from './project-permission-templates-store.js';
import {
  getProjectResourcePolicy,
} from './project-resource-policy-store.js';
import { resolveProjectPermissions, OWNER_PROJECT_PERMISSIONS } from './workspace-permissions.js';

type ResourceType = 'project' | 'endpoint' | 'source_library' | 'agent';
type SubjectType = 'user' | 'group' | 'agent';

export type ProjectAuthzPermissionSource =
  | {
    type: 'owner';
    permission: string;
  }
  | {
    type: 'project_default';
    permission: string;
  }
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
  source: 'permission' | 'project_default';
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
    resource_type: 'endpoint' | 'source_library' | 'agent';
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
  workspaceId: string,
  projectId: string,
  actorUserId: string,
): ProjectAuthorizationSnapshot['membership_status'] {
  const membership = getProjectMembershipsState(workspaceId, projectId).get(actorUserId);
  return membership?.status ?? 'none';
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
  workspaceId: string,
  projectId: string,
): Map<string, ProjectPermissionTemplateRecord> {
  return new Map(
    getProjectPermissionTemplatesState(workspaceId, projectId).map((template) => [template.id, template]),
  );
}

function collectPermissionSources(args: {
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
}): ProjectAuthorizationSnapshot {
  const { workspaceId, projectId, projectOwnerId, actorUserId } = args;
  const membershipStatus = getMembershipStatus(workspaceId, projectId, actorUserId);
  const byPermission = new Map<string, ProjectAuthzPermissionSource>();

  if (projectOwnerId === actorUserId) {
    for (const permission of OWNER_PROJECT_PERMISSIONS) {
      addPermissionSource(byPermission, { type: 'owner', permission });
    }
    return {
      membership_status: 'active',
      effective_permissions: [...byPermission.keys()],
      permission_sources: [...byPermission.values()],
    };
  }

  // Keep current compatibility baseline until lifecycle closure fully hardens all flows.
  for (const permission of resolveProjectPermissions(projectOwnerId, actorUserId)) {
    addPermissionSource(byPermission, { type: 'project_default', permission });
  }

  const templates = templateMap(workspaceId, projectId);

  for (const group of getProjectGroupsState(workspaceId, projectId)) {
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

  const memberPermissionState = getProjectMemberPermissionsState(workspaceId, projectId).get(actorUserId);
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

export function evaluateProjectPermissions(args: {
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
  requiredPermissions: readonly string[];
}): ProjectAuthorizationEvaluation {
  const snapshot = collectPermissionSources(args);
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
      const source: ProjectPermissionDecision['source'] =
        sourceDetail.type === 'project_default' || sourceDetail.type === 'owner'
          ? 'project_default'
          : 'permission';
      return {
        permission,
        granted: true,
        reason:
          sourceDetail.type === 'project_default' || sourceDetail.type === 'owner'
            ? 'granted_by_project_default'
            : 'granted_by_member_governance',
        source,
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

export function resolveVisibleProjectPermissionsForActor(args: {
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
}): readonly string[] {
  const snapshot = collectPermissionSources(args);
  if (snapshot.membership_status === 'pending' || snapshot.membership_status === 'suspended') {
    return [];
  }
  return snapshot.effective_permissions;
}

function mapProjectActionToPermission(action: string): string | null {
  if (action.startsWith('project.audit.')) return 'project:endpoint:use';
  if (action.startsWith('project.usage.')) return 'project:endpoint:use';
  if (action === 'project.read') return 'project:endpoint:use';
  if (action === 'project.delete' || action === 'project.update' || action.startsWith('project.settings.')) {
    return 'project:settings:manage';
  }
  if (action.startsWith('project.member.') || action.startsWith('project.governance.')) {
    return 'project:settings:manage';
  }
  return 'project:endpoint:use';
}

function mapResourceActionToPermission(resourceType: Exclude<ResourceType, 'project'>, action: string): string {
  if (resourceType === 'endpoint') {
    return /invoke|proxy|rerank|image|video|read|list/i.test(action)
      ? 'project:endpoint:use'
      : 'project:endpoint:manage';
  }
  if (resourceType === 'source_library') {
    return /read|list|download|browse/i.test(action)
      ? 'project:endpoint:use'
      : 'project:settings:manage';
  }
  return /invoke|run|read|list|use/i.test(action) ? 'project:agent:use' : 'project:agent:manage';
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

export function evaluateResourcePolicyAuthorization(args: {
  workspaceId: string;
  projectId: string;
  resourceType: Exclude<ResourceType, 'project'>;
  resourceId: string;
  subjectType: SubjectType;
  subjectId: string;
}): ResourcePolicyDecision {
  const policy = getProjectResourcePolicy(args.workspaceId, args.projectId, args.resourceType, args.resourceId);
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
    const groups = getProjectGroupsState(args.workspaceId, args.projectId)
      .filter((group) => group.member_ids.includes(args.subjectId))
      .map((group) => group.id);
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

export function resolveProjectPermissionsForActor(args: {
  workspaceId: string;
  projectId: string;
  projectOwnerId: string;
  actorUserId: string;
}): readonly string[] {
  return collectPermissionSources(args).effective_permissions;
}
