import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  saveProjectGroup,
  saveProjectPermissionTemplate,
  setProjectAdminGroupMembersPersisted,
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';
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
  it('resolves permissions from group templates and member custom grants', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    await saveProjectPermissionTemplate(docStore, workspaceId, projectId, {
      id: 'pt_manage',
      project_id: projectId,
      name: 'Managers',
      permissions: ['project:governance:update'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await saveProjectGroup(docStore, workspaceId, projectId, {
      id: 'grp_manage',
      project_id: projectId,
      name: 'Managers',
      permission_template_id: 'pt_manage',
      member_ids: ['user_test'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await upsertProjectMemberPermissionState(docStore, workspaceId, projectId, 'user_test', {
      mode: 'custom',
      template: null,
      permissions: ['project:endpoint:use'],
    });

    const permissions = new Set(await resolveProjectPermissionsForActor({
      docStore,
      workspaceId,
      projectId,
      projectOwnerId: 'user_owner',
      actorUserId: 'user_test',
    }));
    expect(permissions.has('project:governance:update')).toBe(true);
    expect(permissions.has('project:endpoint:use')).toBe(true);
    expect(permissions.has('project:endpoint:use')).toBe(true);
  });

  it('grants project admin permissions from the built-in admin group', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    await setProjectAdminGroupMembersPersisted({
      docStore,
      workspaceId,
      projectId,
      memberIds: ['user_test'],
    });

    const permissions = new Set(await resolveProjectPermissionsForActor({
      docStore,
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

  it('denies all required permissions when membership is suspended', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    await upsertProjectMembershipRecord(docStore, workspaceId, projectId, {
      project_id: projectId,
      user_id: 'user_test',
      role: 'member',
      status: 'suspended',
      joined_at: new Date().toISOString(),
    });

    const evaluation = await evaluateProjectPermissions({
      docStore,
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
      await resolveVisibleProjectPermissionsForActor({
        docStore,
        workspaceId,
        projectId,
        projectOwnerId: 'user_owner',
        actorUserId: 'user_test',
      }),
    ).toEqual([]);
  });

  it('evaluates resource policy allow-list for user and group subjects', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    await saveProjectGroup(docStore, workspaceId, projectId, {
      id: 'grp_ops',
      project_id: projectId,
      name: 'Ops',
      permission_template_id: 'pt_none',
      member_ids: ['user_grouped'],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await upsertProjectResourcePolicy(docStore, workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: 'ep_1',
      access_mode: 'allow_list',
      allowed_subjects: [
        { subject_type: 'user', subject_id: 'user_direct' },
        { subject_type: 'group', subject_id: 'grp_ops' },
      ],
    });

    const direct = await evaluateResourcePolicyAuthorization({
      docStore,
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      subjectType: 'user',
      subjectId: 'user_direct',
    });
    const grouped = await evaluateResourcePolicyAuthorization({
      docStore,
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: 'ep_1',
      subjectType: 'user',
      subjectId: 'user_grouped',
    });
    const denied = await evaluateResourcePolicyAuthorization({
      docStore,
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

  it('evaluates resource policy allow-list for the built-in admin group', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    await upsertProjectMembershipRecord(docStore, workspaceId, projectId, {
      project_id: projectId,
      user_id: 'user_admin',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await setProjectAdminGroupMembersPersisted({
      docStore,
      workspaceId,
      projectId,
      memberIds: ['user_admin'],
    });
    await upsertProjectResourcePolicy(docStore, workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: 'ep_default_group',
      access_mode: 'allow_list',
      allowed_subjects: [{ subject_type: 'group', subject_id: PROJECT_BUILT_IN_GROUP_IDS.admins }],
    });

    const result = await evaluateResourcePolicyAuthorization({
      docStore,
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
    expect(mapAuthorizationRequestToPermission({ resourceType: 'file_library', action: 'file_library.upload' })).toBe('project:endpoint:use');
  });
});
