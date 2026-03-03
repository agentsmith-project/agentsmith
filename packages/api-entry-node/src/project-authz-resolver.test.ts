import { describe, expect, it } from 'vitest';
import { getProjectGroupsState } from './project-groups-store.js';
import { getProjectPermissionTemplatesState } from './project-permission-templates-store.js';
import { resolveProjectPermissionsForRequest } from './project-authz-resolver.js';

describe('resolveProjectPermissionsForRequest', () => {
  it('grants group template permissions in addition to baseline operator permissions', () => {
    const workspaceId = `ws_${Date.now()}`;
    const projectId = `proj_${Math.random().toString(36).slice(2, 10)}`;
    getProjectPermissionTemplatesState(workspaceId, projectId).push({
      id: 'pt_manage',
      project_id: projectId,
      name: 'Managers',
      permissions: ['project:settings:manage'],
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

    const perms = new Set(resolveProjectPermissionsForRequest({
      workspaceId,
      projectId,
      projectOwnerId: 'user_owner',
      actorUserId: 'user_test',
    }));

    expect(perms.has('project:endpoint:use')).toBe(true);
    expect(perms.has('project:settings:manage')).toBe(true);
  });
});
