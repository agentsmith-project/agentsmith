import { describe, expect, it } from 'vitest';
import { getProjectGroupsState } from './project-groups-store.js';
import { isProjectResourceAccessAllowedForUser, upsertProjectResourcePolicy } from './project-resource-policy-store.js';

describe('project-resource-policy-store', () => {
  it('allows user via group allow-list subject', () => {
    const workspaceId = `ws_${Math.random().toString(36).slice(2, 8)}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 8)}`;
    const endpointId = 'ep_test';
    const userId = 'user_test';
    const groups = getProjectGroupsState(workspaceId, projectId);
    groups.push({
      id: 'grp_ops',
      project_id: projectId,
      name: 'ops',
      permission_template_id: 'perm_tpl_default',
      member_ids: [userId],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    upsertProjectResourcePolicy(workspaceId, projectId, {
      resource_type: 'endpoint',
      resource_id: endpointId,
      access_mode: 'allow_list',
      allowed_subjects: [{ subject_type: 'group', subject_id: 'grp_ops' }],
    });
    const result = isProjectResourceAccessAllowedForUser({
      workspaceId,
      projectId,
      resourceType: 'endpoint',
      resourceId: endpointId,
      userId,
    });
    expect(result.allowed).toBe(true);
  });
});
