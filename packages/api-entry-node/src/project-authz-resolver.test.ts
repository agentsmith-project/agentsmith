import { describe, expect, it } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import { saveProjectGroup, saveProjectPermissionTemplate } from './project-member-governance-persistence.js';
import { resolveProjectPermissionsForRequest } from './project-authz-resolver.js';

describe('resolveProjectPermissionsForRequest', () => {
  it('grants group template permissions from persisted governance state', async () => {
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

    const perms = new Set(await resolveProjectPermissionsForRequest({
      docStore,
      workspaceId,
      projectId,
      projectOwnerId: 'user_owner',
      actorUserId: 'user_test',
    }));

    expect(perms.has('project:governance:update')).toBe(true);
  });
});
