import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { saveProjectGroup, setProjectAdminGroupMembersPersisted, upsertProjectMembershipRecord } from './project-member-governance-persistence.js';
import { isProjectResourceAccessAllowedForUser, upsertProjectResourcePolicy } from './project-resource-policy-store.js';
import { PROJECT_BUILT_IN_GROUP_IDS } from './project-governance-model.js';

describe('project-resource-policy-store', () => {
  it('allows user via group allow-list subject', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 8)}`;
    const endpointId = 'ep_test';
    const userId = 'user_test';
    await saveProjectGroup(docStore, workspaceId, projectId, {
      id: 'grp_ops',
      project_id: projectId,
      name: 'ops',
      permission_template_id: 'perm_tpl_default',
      member_ids: [userId],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await upsertProjectResourcePolicy(docStore, workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: endpointId,
      access_mode: 'allow_list',
      allowed_subjects: [{ subject_type: 'group', subject_id: 'grp_ops' }],
    });
    const result = await isProjectResourceAccessAllowedForUser({
      docStore,
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: endpointId,
      userId,
    });
    expect(result.allowed).toBe(true);
  });

  it('allows user via built-in admin group allow-list subject', async () => {
    const docStore = new InMemoryJsonDocStore();
    const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 8)}`;
    const endpointId = 'ep_default_group';
    const userId = 'user_admin';
    await upsertProjectMembershipRecord(docStore, workspaceId, projectId, {
      project_id: projectId,
      user_id: userId,
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await setProjectAdminGroupMembersPersisted({
      docStore,
      workspaceId,
      projectId,
      memberIds: [userId],
    });
    await upsertProjectResourcePolicy(docStore, workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: endpointId,
      access_mode: 'allow_list',
      allowed_subjects: [{ subject_type: 'group', subject_id: PROJECT_BUILT_IN_GROUP_IDS.admins }],
    });

    const result = await isProjectResourceAccessAllowedForUser({
      docStore,
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: endpointId,
      userId,
    });
    expect(result.allowed).toBe(true);
  });
});
