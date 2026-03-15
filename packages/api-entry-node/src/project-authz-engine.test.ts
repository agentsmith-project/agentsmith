import { describe, expect, it } from 'vitest';
import { getProjectGroupsState, setProjectAdminGroupMembers } from './project-groups-store.js';
import { getProjectMemberPermissionsState } from './project-member-permissions-store.js';
import { upsertProjectMembership } from './project-memberships-store.js';
import { getProjectPermissionTemplatesState } from './project-permission-templates-store.js';
import { upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import { PROJECT_BUILT_IN_GROUP_IDS } from './project-governance-model.js';
import {
  evaluateProjectPermissions,
  evaluateResourcePolicyAuthorization,
  mapAuthorizationRequestToPermission,
  resolveProjectPermissionsForActor,
  resolveVisibleProjectPermissionsForActor,
} from './project-authz-engine.js';

describe('project-authz-engine', () => {
  it('resolves permissions from group templates and member custom grants', () => {
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    getProjectPermissionTemplatesState(workspaceId, projectId).push({
      id: 'pt_manage',
      project_id: projectId,
      name: 'Managers',
      permissions: ['project:governance:update'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    getProjectGroupsState(workspaceId, projectId).push({
      id: 'grp_manage',
      project_id: projectId,
      name: 'Managers',
      permission_template_id: 'pt_manage',
      member_ids: ['user_test'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    getProjectMemberPermissionsState(workspaceId, projectId).set('user_test', {
      mode: 'custom',
      permissions: ['project:endpoint:use'],
    });

    const permissions = new Set(resolveProjectPermissionsForActor({
      workspaceId,
      projectId,
      projectOwnerId: 'user_owner',
      actorUserId: 'user_test',
    }));
    expect(permissions.has('project:governance:update')).toBe(true);
    expect(permissions.has('project:endpoint:use')).toBe(true);
    expect(permissions.has('project:endpoint:use')).toBe(true);
  });

  it('grants project admin permissions from the built-in admin group', () => {
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    setProjectAdminGroupMembers({
      workspaceId,
      projectId,
      memberIds: ['user_test'],
    });

    const permissions = new Set(resolveProjectPermissionsForActor({
      workspaceId,
      projectId,
      projectOwnerId: 'user_owner',
      actorUserId: 'user_test',
    }));

    expect(permissions.has('project:endpoint:use')).toBe(true);
    expect(permissions.has('project:agent:manage')).toBe(true);
    expect(permissions.has('project:agent:public')).toBe(true);
    expect(permissions.has('project:governance:update')).toBe(true);
    expect(permissions.has('project:governance:update')).toBe(true);
  });

  it('denies all required permissions when membership is suspended', () => {
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    upsertProjectMembership(workspaceId, projectId, {
      project_id: projectId,
      user_id: 'user_test',
      role: 'member',
      status: 'suspended',
      joined_at: new Date().toISOString(),
    });

    const evaluation = evaluateProjectPermissions({
      workspaceId,
      projectId,
      projectOwnerId: 'user_owner',
      actorUserId: 'user_test',
      requiredPermissions: ['project:endpoint:use', 'project:endpoint:use'],
    });

    expect(evaluation.membership_status).toBe('suspended');
    expect(evaluation.decisions.every((item) => item.granted === false)).toBe(true);
    expect(evaluation.decisions[0]?.reason).toBe('membership_suspended');
    expect(
      resolveVisibleProjectPermissionsForActor({
        workspaceId,
        projectId,
        projectOwnerId: 'user_owner',
        actorUserId: 'user_test',
      }),
    ).toEqual([]);
  });

  it('evaluates resource policy allow-list for user and group subjects', () => {
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    getProjectGroupsState(workspaceId, projectId).push({
      id: 'grp_ops',
      project_id: projectId,
      name: 'Ops',
      permission_template_id: 'pt_none',
      member_ids: ['user_grouped'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    upsertProjectResourcePolicy(workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      access_mode: 'allow_list',
      allowed_subjects: [
        { subject_type: 'user', subject_id: 'user_direct' },
        { subject_type: 'group', subject_id: 'grp_ops' },
      ],
    });

    const direct = evaluateResourcePolicyAuthorization({
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      subjectType: 'user',
      subjectId: 'user_direct',
    });
    const grouped = evaluateResourcePolicyAuthorization({
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      subjectType: 'user',
      subjectId: 'user_grouped',
    });
    const denied = evaluateResourcePolicyAuthorization({
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      subjectType: 'user',
      subjectId: 'user_other',
    });

    expect(direct.allowed).toBe(true);
    expect(direct.matched_policy?.matched_subject).toEqual({ type: 'user', id: 'user_direct' });
    expect(grouped.allowed).toBe(true);
    expect(grouped.matched_policy?.matched_subject).toEqual({ type: 'group', id: 'grp_ops' });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('not_in_allow_list');
  });

  it('evaluates resource policy allow-list for the built-in admin group', () => {
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    upsertProjectMembership(workspaceId, projectId, {
      project_id: projectId,
      user_id: 'user_admin',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    setProjectAdminGroupMembers({
      workspaceId,
      projectId,
      memberIds: ['user_admin'],
    });
    upsertProjectResourcePolicy(workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: 'ep_default_group',
      access_mode: 'allow_list',
      allowed_subjects: [{ subject_type: 'group', subject_id: PROJECT_BUILT_IN_GROUP_IDS.admins }],
    });

    const result = evaluateResourcePolicyAuthorization({
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: 'ep_default_group',
      subjectType: 'user',
      subjectId: 'user_admin',
    });

    expect(result.allowed).toBe(true);
    expect(result.matched_policy?.matched_subject).toEqual({ type: 'group', id: PROJECT_BUILT_IN_GROUP_IDS.admins });
  });

  it('maps authorization actions to project permission tokens', () => {
    expect(mapAuthorizationRequestToPermission({ resourceType: 'endpoint', action: 'endpoint.invoke' })).toBe('project:endpoint:use');
    expect(mapAuthorizationRequestToPermission({ resourceType: 'endpoint', action: 'endpoint.update' })).toBe('project:governance:update');
    expect(mapAuthorizationRequestToPermission({ resourceType: 'project', action: 'project.audit.view' })).toBe('project:audit:read');
    expect(mapAuthorizationRequestToPermission({ resourceType: 'project', action: 'project.member.view' })).toBe('project:membership:update');
    expect(mapAuthorizationRequestToPermission({ resourceType: 'project', action: 'project.governance.credentials.update' })).toBe('project:governance:update');
    expect(mapAuthorizationRequestToPermission({ resourceType: 'source_library', action: 'source_library.upload' })).toBe('project:files:update');
  });
});
