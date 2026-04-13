import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryJsonDocStore } from '@mbos/adapters-private';
import {
  setProjectAdminGroupMembersPersisted,
  upsertProjectMemberPermissionState,
  upsertProjectMembershipRecord,
} from './project-member-governance-persistence.js';

const {
  writeProjectAuditEvent,
  readProjectPermissionContext,
} = vi.hoisted(() => ({
  writeProjectAuditEvent: vi.fn(),
  readProjectPermissionContext: vi.fn(),
}));

vi.mock('./audit-usage-recorders.js', () => ({
  writeProjectAuditEvent,
}));

vi.mock('./project-route-handler-utils.js', async () => {
  const actual = await vi.importActual<typeof import('./project-route-handler-utils.js')>(
    './project-route-handler-utils.js',
  );
  return {
    ...actual,
    readProjectPermissionContext,
  };
});

import {
  handleProjectGroupsRoute,
  handleProjectMembershipGovernanceRoute,
  handleProjectPermissionTemplatesRoute,
} from './project-member-governance-routes.js';
import {
  getProjectMembership,
  getProjectMemberPermissionState,
  listProjectGroups,
  listProjectMemberChangeHistory,
  listProjectPermissionTemplates,
  saveProjectPermissionTemplate,
} from './project-member-governance-persistence.js';
import type { NodeApiDeps } from './node-api-deps.js';

describe('project-member-governance-routes', () => {
  function buildDeps(): NodeApiDeps {
    return {
      docStore: new InMemoryJsonDocStore(),
      getProjectUseCase: {
        execute: vi.fn().mockResolvedValue({
          id: 'proj_default',
          owner_id: 'owner-1',
          created_at: '2026-03-01T00:00:00Z',
          governance_json: null,
        }),
      },
    } as unknown as NodeApiDeps;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    writeProjectAuditEvent.mockResolvedValue(undefined);
    readProjectPermissionContext.mockResolvedValue({
      ownerId: 'owner-1',
      permissions: ['project:membership:update'],
    });
  });

  it('creates permission templates and protects built-in templates from deletion', async () => {
    const workspaceId = `ws-templates-${Date.now()}`;
    const projectId = `proj-templates-${Date.now()}`;
    const deps = buildDeps();
    const json = vi.fn();
    const res = { end: vi.fn(), statusCode: 200 } as never;

    await expect(handleProjectPermissionTemplatesRoute({
      routeKind: 'projectPermissionTemplates',
      method: 'POST',
      workspaceId,
      projectId,
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Custom Editors',
        description: 'custom',
        permissions: ['project:files:update', 1, 'project:audit:read'],
      }),
    })).resolves.toBe(true);

    const created = (await listProjectPermissionTemplates(deps.docStore, workspaceId, projectId)).find((item) => item.name === 'Custom Editors');
    expect(created).toEqual(expect.objectContaining({
      name: 'Custom Editors',
      permissions: ['project:files:update', 'project:audit:read'],
      built_in: false,
    }));

    await saveProjectPermissionTemplate(deps.docStore, workspaceId, projectId, {
      id: 'pt_builtin',
      project_id: projectId,
      name: 'Built In',
      permissions: ['project:audit:read'],
      built_in: true,
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
    });

    await expect(handleProjectPermissionTemplatesRoute({
      routeKind: 'projectPermissionTemplateItem',
      method: 'DELETE',
      workspaceId,
      projectId,
      templateId: 'pt_builtin',
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenLastCalledWith(
      res,
      409,
      { error_code: 'CONFLICT', message: 'Built-in templates cannot be deleted' },
    );
  });

  it('creates groups and applies templates to explicit members', async () => {
    const workspaceId = `ws-groups-${Date.now()}`;
    const projectId = `proj-groups-${Date.now()}`;
    const deps = buildDeps();
    const json = vi.fn();
    const res = { end: vi.fn(), statusCode: 200 } as never;

    await expect(handleProjectGroupsRoute({
      routeKind: 'projectGroups',
      method: 'POST',
      workspaceId,
      projectId,
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn().mockResolvedValue({
        name: 'Reviewers',
        permission_template_id: 'pt_review',
        member_ids: ['user-1', 'user-2', 1],
      }),
    })).resolves.toBe(true);

    const group = (await listProjectGroups(deps.docStore, workspaceId, projectId, 'owner-1'))
      .find((item) => item.name === 'Reviewers');
    expect(group).toEqual(expect.objectContaining({
      name: 'Reviewers',
      permission_template_id: 'pt_review',
      member_ids: ['user-1', 'user-2'],
    }));

    await expect(handleProjectGroupsRoute({
      routeKind: 'projectGroupApplyTemplate',
      method: 'POST',
      workspaceId,
      projectId,
      groupId: group!.id,
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn().mockResolvedValue({ member_ids: ['user-2'] }),
    })).resolves.toBe(true);

    expect(json).toHaveBeenLastCalledWith(res, 200, {
      applied_count: 1,
      results: [{ member_id: 'user-2', status: 'applied' }],
    });
  });

  it('updates membership and member permissions while recording history', async () => {
    const workspaceId = `ws-members-${Date.now()}`;
    const projectId = `proj-members-${Date.now()}`;
    const deps = buildDeps();
    const json = vi.fn();
    const res = { end: vi.fn(), statusCode: 200 } as never;

    await expect(handleProjectMembershipGovernanceRoute({
      routeKind: 'projectMembershipItem',
      method: 'PATCH',
      workspaceId,
      projectId,
      userId: 'user-1',
      req: { headers: { 'x-request-id': 'req-members-1' } } as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn().mockResolvedValue({ status: 'active' }),
    })).resolves.toBe(true);

    await expect(handleProjectMembershipGovernanceRoute({
      routeKind: 'projectMemberPermissions',
      method: 'PATCH',
      workspaceId,
      projectId,
      userId: 'user-1',
      req: { headers: { 'x-request-id': 'req-members-2' } } as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn().mockResolvedValue({
        mode: 'custom',
        permissions: ['project:files:update', 'project:audit:read'],
      }),
    })).resolves.toBe(true);

    await expect(handleProjectMembershipGovernanceRoute({
      routeKind: 'projectMemberChangeHistory',
      method: 'GET',
      workspaceId,
      projectId,
      userId: 'user-1',
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(await getProjectMembership(deps.docStore, workspaceId, projectId, 'user-1')).toEqual(expect.objectContaining({
      status: 'active',
    }));
    expect(await getProjectMemberPermissionState(deps.docStore, workspaceId, projectId, 'user-1')).toEqual({
      mode: 'custom',
      template: null,
      permissions: ['project:files:update', 'project:audit:read'],
    });
    expect(await listProjectMemberChangeHistory(deps.docStore, workspaceId, projectId, 'user-1')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ change_type: 'permissions' }),
        expect.objectContaining({ change_type: 'membership' }),
      ]),
    );
    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ action: 'member.membership.activated', requestId: 'req-members-1' }),
    );
    expect(writeProjectAuditEvent).toHaveBeenCalledWith(
      deps,
      expect.objectContaining({ action: 'member.permissions.updated', requestId: 'req-members-2' }),
    );
    expect(json).toHaveBeenLastCalledWith(
      res,
      200,
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ change_type: 'permissions' }),
          expect.objectContaining({ change_type: 'membership' }),
        ]),
      }),
    );
  });


  it('returns group-derived effective permissions for the member permissions snapshot', async () => {
    const workspaceId = `ws-effective-${Date.now()}`;
    const projectId = `proj-effective-${Date.now()}`;
    const deps = buildDeps();
    const json = vi.fn();
    const res = { end: vi.fn(), statusCode: 200 } as never;

    await upsertProjectMembershipRecord(deps.docStore, workspaceId, projectId, {
      project_id: projectId,
      user_id: 'user-1',
      role: 'member',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    await setProjectAdminGroupMembersPersisted({
      docStore: deps.docStore,
      workspaceId,
      projectId,
      memberIds: ['user-1'],
    });
    await upsertProjectMemberPermissionState(deps.docStore, workspaceId, projectId, 'user-1', {
      mode: 'custom',
      template: null,
      permissions: ['project:files:update'],
    });

    await expect(handleProjectMembershipGovernanceRoute({
      routeKind: 'projectMemberPermissions',
      method: 'GET',
      workspaceId,
      projectId,
      userId: 'user-1',
      req: {} as never,
      res,
      deps,
      user: { id: 'owner-1', email: 'owner-1@example.com', name: 'Owner One' },
      json,
      readBody: vi.fn(),
    })).resolves.toBe(true);

    expect(json).toHaveBeenLastCalledWith(
      res,
      200,
      expect.objectContaining({
        platform_permissions: expect.arrayContaining([
          'project:endpoint:use',
          'project:agent:manage',
          'project:agent:public',
          'project:governance:update',
          'project:membership:update',
          'project:admins:update',
          'project:files:update',
        ]),
        resource_permissions: undefined,
      }),
    );
  });
});
