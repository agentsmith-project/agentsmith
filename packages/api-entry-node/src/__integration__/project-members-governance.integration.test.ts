import { describe, expect, it } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { upsertProjectMembershipRecord } from '../project-member-governance-persistence.js';
import { apiFetch, apiFetchWithToken, startServer, startServerWithDeps } from './test-support.js';

describe('api-entry-node project members governance routes', () => {
  it('serves minimal project members governance read endpoints', async () => {
    const { baseUrl } = startServer();

    const membersRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/members');
    expect(membersRes.status).toBe(200);
    const members = (await membersRes.json()) as {
      items: Array<{
        id: string;
        email: string;
        name: string;
        role: string;
        permissions: string[];
        status: string;
        joined_at: string;
      }>;
      total: number;
    };
    expect(members.total).toBe(1);
    expect(members.items[0]?.id).toBe('user_test');
    expect(members.items[0]?.permissions).toContain('project:membership:update');

    const joinRequestsRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/join-requests');
    expect(joinRequestsRes.status).toBe(200);
    const joinRequests = (await joinRequestsRes.json()) as { items: unknown[]; total: number };
    expect(joinRequests).toEqual({ items: [], total: 0 });

    const permissionTemplatesRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/permission-templates',
    );
    expect(permissionTemplatesRes.status).toBe(200);
    const permissionTemplates = (await permissionTemplatesRes.json()) as {
      items: Array<{ id: string; built_in: boolean }>;
    };
    expect(permissionTemplates.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tpl_project_owner', built_in: true }),
        expect.objectContaining({ id: 'tpl_project_admin', built_in: true }),
        expect.objectContaining({ id: 'tpl_project_member', built_in: true }),
      ]),
    );

    const groupsRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/groups');
    expect(groupsRes.status).toBe(200);
    const groups = (await groupsRes.json()) as {
      items: Array<{ id: string; built_in: boolean }>;
    };
    expect(groups.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'grp_project_owner', built_in: true }),
        expect.objectContaining({ id: 'grp_project_admins', built_in: true }),
        expect.objectContaining({ id: 'grp_project_members', built_in: true }),
      ]),
    );

    const membershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_test',
    );
    expect(membershipRes.status).toBe(200);
    const membership = (await membershipRes.json()) as {
      user_id: string;
      project_id: string;
      role: string;
      permissions: string[];
    };
    expect(membership.user_id).toBe('user_test');
    expect(membership.project_id).toBe('proj_1');
    expect(membership.permissions).toContain('project:membership:update');
  });

  it('returns not found for private projects when actor is not an active member', async () => {
    const deps = createDefaultNodeApiDeps();
    const created = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_external',
      input: {
        name: 'Shared Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const getRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getRes.status).toBe(404);
    const got = (await getRes.json()) as {
      error_code: string;
    };
    expect(got.error_code).toBe('RESOURCE_NOT_FOUND');
  });

  it('allows plain workspace users to create join requests for public approval-required projects without member governance permission', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Joinable Project',
        visibility: 'public',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests`,
      'member-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'need access' }),
      },
    );
    expect(createRes.status).toBe(201);

    const ownerListRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests`,
      'owner-token',
    );
    expect(ownerListRes.status).toBe(200);
    const ownerList = (await ownerListRes.json()) as {
      items: Array<{ user_id: string; status: string; reason: string }>;
    };
    expect(ownerList.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: 'user_test',
          status: 'pending',
          reason: 'need access',
        }),
      ]),
    );
  });

  it('rejects self-service join requests for private projects', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Private Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests`,
      'member-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'need access' }),
      },
    );
    expect(createRes.status).toBe(403);
    await expect(createRes.json()).resolves.toEqual({
      error_code: 'PERMISSION_DENIED',
      message: 'project_join_requires_public_visibility',
    });
  });

  it('does not expose private projects in the regular project directory for non-members', async () => {
    const deps = createDefaultNodeApiDeps();
    const privateProject = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Private Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const publicProject = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Public Project',
        visibility: 'public',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const listRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', 'member-token');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(listBody.items.map((item) => item.id)).toContain(publicProject.id);
    expect(listBody.items.map((item) => item.id)).not.toContain(privateProject.id);
  });

  it('allows non-members to read public project metadata while returning empty permissions', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Discoverable Project',
        visibility: 'public',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const getRes = await apiFetchWithToken(baseUrl, `/api/v1/workspaces/ws_default/projects/${project.id}`, 'member-token');
    expect(getRes.status).toBe(200);
    const payload = (await getRes.json()) as { id: string; visibility: string; permissions: string[] };
    expect(payload.id).toBe(project.id);
    expect(payload.visibility).toBe('public');
    expect(payload.permissions).toEqual([]);
  });

  it('writes user notifications when join requests are approved or rejected', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Notified Project',
        visibility: 'public',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests`,
      'member-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'need access' }),
      },
    );
    expect(createRes.status).toBe(201);
    const createdBody = (await createRes.json()) as { outcome: string; join_request_id?: string };
    expect(createdBody.outcome).toBe('pending');
    expect(createdBody.join_request_id).toBeTruthy();

    const approveRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests/${createdBody.join_request_id}/approve`,
      'owner-token',
      { method: 'POST' },
    );
    expect(approveRes.status).toBe(204);

    const notificationsAfterApprove = await apiFetchWithToken(baseUrl, '/api/v1/me/notifications', 'member-token');
    expect(notificationsAfterApprove.status).toBe(200);
    const approvedPayload = (await notificationsAfterApprove.json()) as {
      items: Array<{ type: string; title: string; link_url?: string | null }>;
    };
    expect(approvedPayload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'join_request_approved',
          link_url: `/workspaces/ws_default/projects/${project.id}/overview`,
        }),
      ]),
    );

    const secondProject = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Rejected Project',
        visibility: 'public',
        join_policy: 'approval_required',
      },
    });
    const secondCreateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${secondProject.id}/join-requests`,
      'alt-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'let me in' }),
      },
    );
    expect(secondCreateRes.status).toBe(201);
    const secondBody = (await secondCreateRes.json()) as { join_request_id?: string };

    const rejectRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${secondProject.id}/join-requests/${secondBody.join_request_id}/reject`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'not in scope' }),
      },
    );
    expect(rejectRes.status).toBe(204);

    const notificationsAfterReject = await apiFetchWithToken(baseUrl, '/api/v1/me/notifications', 'alt-token');
    expect(notificationsAfterReject.status).toBe(200);
    const rejectedPayload = (await notificationsAfterReject.json()) as {
      items: Array<{ type: string; title: string; body?: string | null; link_url?: string | null }>;
    };
    expect(rejectedPayload.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'join_request_rejected',
          link_url: '/workspaces/ws_default/projects',
        }),
      ]),
    );
    expect(rejectedPayload.items.some((item) => item.body?.includes('not in scope'))).toBe(true);
  });

  it('lets workspace members directly join public open projects', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Open Project',
        visibility: 'public',
        join_policy: 'open',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const joinRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests`,
      'member-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(joinRes.status).toBe(201);
    await expect(joinRes.json()).resolves.toEqual({ outcome: 'joined', membership_status: 'active' });

    const projectRes = await apiFetchWithToken(baseUrl, `/api/v1/workspaces/ws_default/projects/${project.id}`, 'member-token');
    expect(projectRes.status).toBe(200);
    const projectBody = (await projectRes.json()) as { permissions: string[] };
    expect(projectBody.permissions).toContain('project:endpoint:use');
  });

  it('supports minimal project members governance write endpoints', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Minimal Member Governance Project',
        visibility: 'public',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createGroupRes = await apiFetchWithToken(baseUrl, `/api/v1/workspaces/ws_default/projects/${project.id}/groups`, 'owner-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Core Team',
        description: 'Core project members',
        permission_template_id: 'pt_custom_1',
        member_ids: ['user_test'],
      }),
    });
    expect(createGroupRes.status).toBe(200);
    const createdGroup = (await createGroupRes.json()) as {
      id: string;
      project_id: string;
      name: string;
      permission_template_id: string;
      member_ids: string[];
    };
    expect(createdGroup.project_id).toBe(project.id);
    expect(createdGroup.name).toBe('Core Team');
    expect(createdGroup.member_ids).toEqual(['user_test']);

    const listGroupsAfterCreateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups`,
      'owner-token',
    );
    expect(listGroupsAfterCreateRes.status).toBe(200);
    const groupsAfterCreate = (await listGroupsAfterCreateRes.json()) as { items: Array<{ id: string; name: string }> };
    expect(groupsAfterCreate.items.map((g) => g.id)).toContain(createdGroup.id);

    const patchGroupRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups/${createdGroup.id}`,
      'owner-token',
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Core Team Updated',
          member_ids: ['user_test', 'user_other'],
        }),
      },
    );
    expect(patchGroupRes.status).toBe(200);
    const patchedGroup = (await patchGroupRes.json()) as { name: string; member_ids: string[] };
    expect(patchedGroup.name).toBe('Core Team Updated');
    expect(patchedGroup.member_ids).toEqual(['user_test', 'user_other']);

    const applyTemplateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups/${createdGroup.id}/apply-template`,
      'owner-token',
      {
        method: 'POST',
        body: JSON.stringify({ member_ids: ['user_test'] }),
      },
    );
    expect(applyTemplateRes.status).toBe(200);
    const applyTemplate = (await applyTemplateRes.json()) as {
      applied_count: number;
      results: Array<{ member_id: string; status: string }>;
    };
    expect(applyTemplate.applied_count).toBe(1);
    expect(applyTemplate.results[0]).toMatchObject({ member_id: 'user_test', status: 'applied' });

    const missingApproveRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests/jr_missing/approve`,
      'owner-token',
      { method: 'POST' },
    );
    expect(missingApproveRes.status).toBe(404);

    const missingRejectRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests/jr_missing/reject`,
      'owner-token',
      {
        method: 'POST',
        body: JSON.stringify({ reason: 'nope' }),
      },
    );
    expect(missingRejectRes.status).toBe(404);

    const patchAltPermissionsRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_test/permissions`,
      'owner-token',
      {
        method: 'PATCH',
        body: JSON.stringify({
          mode: 'custom',
          permissions: ['project:endpoint:use'],
        }),
      },
    );
    expect(patchAltPermissionsRes.status).toBe(204);

    const permissionsAuditStart = new Date(Date.now() - 60_000).toISOString();
    const permissionsAuditEnd = new Date(Date.now() + 60_000).toISOString();
    const memberPermissionsAuditRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/audit?start_time=${encodeURIComponent(permissionsAuditStart)}&end_time=${encodeURIComponent(permissionsAuditEnd)}&action=member.permissions.updated&resource_type=member&resource_id=user_test&page=1&page_size=20`,
      'owner-token',
    );
    expect(memberPermissionsAuditRes.status).toBe(200);
    const memberPermissionsAuditBody = (await memberPermissionsAuditRes.json()) as {
      items: Array<{
        action: string;
        resource_id: string;
        result: string;
        metadata_json?: Record<string, unknown>;
      }>;
    };
    expect(
      memberPermissionsAuditBody.items.some((item) =>
        item.action === 'member.permissions.updated'
          && item.resource_id === 'user_test'
          && item.result === 'ok'
          && Array.isArray(item.metadata_json?.permissions_added)
          && (item.metadata_json?.permissions_added as unknown[]).includes('project:endpoint:use')),
    ).toBe(true);

    const invalidPermissionsPatchRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_test/permissions`,
      'owner-token',
      {
        method: 'PATCH',
        body: JSON.stringify({
          permissions: ['project:endpoint:use'],
        }),
      },
    );
    expect(invalidPermissionsPatchRes.status).toBe(422);

    const invalidPermissionsAuditStart = new Date(Date.now() - 60_000).toISOString();
    const invalidPermissionsAuditEnd = new Date(Date.now() + 60_000).toISOString();
    const invalidPermissionsAuditRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/audit?start_time=${encodeURIComponent(invalidPermissionsAuditStart)}&end_time=${encodeURIComponent(invalidPermissionsAuditEnd)}&action=member.permissions.updated&resource_type=member&resource_id=user_test&page=1&page_size=20`,
      'owner-token',
    );
    expect(invalidPermissionsAuditRes.status).toBe(200);
    const invalidPermissionsAuditBody = (await invalidPermissionsAuditRes.json()) as {
      items: Array<{
        action: string;
        resource_id?: string;
        result: string;
        error_code?: string;
        error_message?: string;
      }>;
    };
    expect(
      invalidPermissionsAuditBody.items.some((item) =>
        item.action === 'member.permissions.updated'
          && item.resource_id === 'user_test'
          && item.result === 'error'
          && item.error_code === 'VALIDATION_ERROR'
          && item.error_message === 'mode is required'),
    ).toBe(true);

    const suspendMissingMembershipRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_missing`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      },
    );
    expect(suspendMissingMembershipRes.status).toBe(404);

    const deleteMissingMembershipRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_missing`,
      'owner-token',
      { method: 'DELETE' },
    );
    expect(deleteMissingMembershipRes.status).toBe(404);

    const failedMembershipAuditStart = new Date(Date.now() - 60_000).toISOString();
    const failedMembershipAuditEnd = new Date(Date.now() + 60_000).toISOString();
    const failedMembershipAuditRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/audit?start_time=${encodeURIComponent(failedMembershipAuditStart)}&end_time=${encodeURIComponent(failedMembershipAuditEnd)}&resource_type=membership&page=1&page_size=20`,
      'owner-token',
    );
    expect(failedMembershipAuditRes.status).toBe(200);
    const failedMembershipAuditBody = (await failedMembershipAuditRes.json()) as {
      items: Array<{
        action: string;
        resource_id?: string;
        result: string;
        error_code?: string;
        error_message?: string;
      }>;
    };
    expect(
      failedMembershipAuditBody.items.some((item) =>
        item.action === 'member.membership.suspended'
          && item.resource_id === 'user_missing'
          && item.result === 'error'
          && item.error_code === 'NOT_FOUND'
          && item.error_message === 'membership_not_found'),
    ).toBe(true);
    expect(
      failedMembershipAuditBody.items.some((item) =>
        item.action === 'member.membership.removed'
          && item.resource_id === 'user_missing'
          && item.result === 'error'
          && item.error_code === 'NOT_FOUND'
          && item.error_message === 'membership_not_found'),
    ).toBe(true);
  });

  it('supports minimal permission template CRUD endpoints', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Minimal Permission Template Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const listBeforeRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
    );
    expect(listBeforeRes.status).toBe(200);
    const listBefore = (await listBeforeRes.json()) as {
      items: Array<{ id: string; built_in?: boolean }>;
    };
    expect(listBefore.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tpl_project_owner', built_in: true }),
        expect.objectContaining({ id: 'tpl_project_admin', built_in: true }),
        expect.objectContaining({ id: 'tpl_project_member', built_in: true }),
      ]),
    );

    const createRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Analyst',
          description: 'Read and operate',
          permissions: ['project:endpoint:use', 'project:governance:update'],
        }),
      },
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      id: string;
      project_id: string;
      name: string;
      permissions: string[];
      built_in?: boolean;
    };
    expect(created.project_id).toBe(project.id);
    expect(created.name).toBe('Analyst');
    expect(created.permissions).toContain('project:governance:update');
    expect(created.built_in).toBe(false);

    const patchRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates/${created.id}`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Analyst v2',
          permissions: ['project:endpoint:use'],
        }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { name: string; permissions: string[] };
    expect(patched.name).toBe('Analyst v2');
    expect(patched.permissions).toEqual(['project:endpoint:use']);

    const listAfterRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
    );
    expect(listAfterRes.status).toBe(200);
    const listAfter = (await listAfterRes.json()) as { items: Array<{ id: string }> };
    expect(listAfter.items.map((i) => i.id)).toContain(created.id);

    const deleteRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates/${created.id}`,
      'owner-token',
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);

    const listFinalRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
    );
    expect(listFinalRes.status).toBe(200);
    const listFinal = (await listFinalRes.json()) as { items: Array<{ id: string }> };
    expect(listFinal.items.map((i) => i.id)).not.toContain(created.id);
  });

  it('applies group permission templates to backend route authorization', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Governed Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const deniedRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Should Fail',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(deniedRes.status).toBe(403);

    const createTemplateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Managers',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(createTemplateRes.status).toBe(200);
    const createdTemplate = (await createTemplateRes.json()) as { id: string };

    const createGroupRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Managers',
          permission_template_id: createdTemplate.id,
          member_ids: ['user_test'],
        }),
      },
    );
    expect(createGroupRes.status).toBe(200);

    const allowedRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Allowed after template',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(allowedRes.status).toBe(200);
  });

  it('applies member custom permissions to backend route authorization', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Member Custom Perms Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const activateMemberRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_test`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      },
    );
    expect(activateMemberRes.status).toBe(204);

    const deniedRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Should Fail',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(deniedRes.status).toBe(403);

    const patchMemberPermsRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_test/permissions`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'custom',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(patchMemberPermsRes.status).toBe(204);

    const allowedRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Allowed via member custom perms',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(allowedRes.status).toBe(200);
  });

  it('returns unified authorization decisions with permission and resource policy explain', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Authz Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const deniedRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/authorize`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: { type: 'user', id: 'user_test' },
          action: 'project.member.manage',
          resource: { type: 'project', id: project.id },
        }),
      },
    );
    expect(deniedRes.status).toBe(200);
    expect(await deniedRes.json()).toEqual({
      allowed: false,
      decision: {
        source: 'permission',
        rule_id: 'project:membership:update',
        reason: 'permission_not_granted',
      },
    });

    const createTemplateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Managers',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(createTemplateRes.status).toBe(200);
    const createdTemplate = (await createTemplateRes.json()) as { id: string };

    const createGroupRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Managers',
          permission_template_id: createdTemplate.id,
          member_ids: ['user_test'],
        }),
      },
    );
    expect(createGroupRes.status).toBe(200);

    const allowRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/authorize`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: { type: 'user', id: 'user_test' },
          action: 'project.member.manage',
          resource: { type: 'project', id: project.id },
        }),
      },
    );
    expect(allowRes.status).toBe(200);
    expect(await allowRes.json()).toEqual({
      allowed: true,
      decision: {
        source: 'permission',
        rule_id: 'project:membership:update',
        reason: 'granted_by_member_governance',
      },
    });
  });

  it('denies suspended memberships in route authz and authorize endpoint', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Suspended Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createTemplateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Managers',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    const createdTemplate = (await createTemplateRes.json()) as { id: string };

    await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Managers',
          permission_template_id: createdTemplate.id,
          member_ids: ['user_test'],
        }),
      },
    );

    const activateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_test`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      },
    );
    expect(activateRes.status).toBe(204);

    const suspendRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_test`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      },
    );
    expect(suspendRes.status).toBe(204);

    const blockedRouteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Should Fail Suspended',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(blockedRouteRes.status).toBe(403);
    const blockedRouteBody = (await blockedRouteRes.json()) as {
      authz_decision?: { membership_status?: string; decisions?: Array<{ reason: string }> };
    };
    expect(blockedRouteBody.authz_decision?.membership_status).toBe('suspended');
    expect(blockedRouteBody.authz_decision?.decisions?.[0]?.reason).toBe('membership_suspended');

    const blockedAuthorizeRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/authorize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: { type: 'user', id: 'user_test' },
          action: 'project.member.manage',
          resource: { type: 'project', id: project.id },
        }),
      },
    );
    expect(blockedAuthorizeRes.status).toBe(403);
    expect(await blockedAuthorizeRes.json()).toEqual({
      error_code: 'FORBIDDEN',
      message: 'forbidden',
    });

    const restoreRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_test`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      },
    );
    expect(restoreRes.status).toBe(204);

    const restoredRouteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Recovered Access',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(restoredRouteRes.status).toBe(200);

    const restoredAuthorizeRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/authorize`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subject: { type: 'user', id: 'user_test' },
          action: 'project.member.manage',
          resource: { type: 'project', id: project.id },
        }),
      },
    );
    expect(restoredAuthorizeRes.status).toBe(200);
    expect(await restoredAuthorizeRes.json()).toEqual({
      allowed: true,
      decision: {
        source: 'permission',
        rule_id: 'project:membership:update',
        reason: 'granted_by_member_governance',
      },
    });
  });

  it('preserves member governance state across suspend and restore on repo-backed projects', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Member Lifecycle Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const createTemplateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Lifecycle Managers',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(createTemplateRes.status).toBe(200);
    const createdTemplate = (await createTemplateRes.json()) as { id: string };

    const createGroupRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups`,
      'owner-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Lifecycle Group',
          permission_template_id: createdTemplate.id,
          member_ids: ['user_alt'],
        }),
      },
    );
    expect(createGroupRes.status).toBe(200);
    const createdGroup = (await createGroupRes.json()) as { id: string };

    const activateRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_alt`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      },
    );
    expect(activateRes.status).toBe(204);

    const patchAltPermissionsRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_alt/permissions`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'custom',
          permissions: ['project:endpoint:use'],
        }),
      },
    );
    expect(patchAltPermissionsRes.status).toBe(204);

    const suspendRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_alt`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      },
    );
    expect(suspendRes.status).toBe(204);

    const suspendedRouteRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'alt-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Suspended Should Fail',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(suspendedRouteRes.status).toBe(403);

    const suspendedPermissionsRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_alt/permissions`,
      'owner-token',
    );
    expect(suspendedPermissionsRes.status).toBe(200);
    expect(await suspendedPermissionsRes.json()).toEqual({
      platform_permissions: ['project:endpoint:use'],
      resource_permissions: undefined,
    });

    const groupsWhileSuspendedRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/groups`,
      'owner-token',
    );
    expect(groupsWhileSuspendedRes.status).toBe(200);
    const groupsWhileSuspended = (await groupsWhileSuspendedRes.json()) as {
      items: Array<{ id: string; member_ids: string[] }>;
    };
    expect(groupsWhileSuspended.items.find((item) => item.id === createdGroup.id)?.member_ids).toContain('user_alt');

    const restoreRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/memberships/user_alt`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      },
    );
    expect(restoreRes.status).toBe(204);

    const restoredRouteRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      'alt-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Restored Should Pass',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(restoredRouteRes.status).toBe(200);
  });

  it('supports member governance overrides, history, and resource policy endpoints', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Member Governance Overrides Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const getPermsRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_test/permissions`,
      'owner-token',
    );
    expect(getPermsRes.status).toBe(200);
    expect(await getPermsRes.json()).toEqual({
      platform_permissions: [],
      resource_permissions: undefined,
    });

    const patchPermsRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_test/permissions`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'custom',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(patchPermsRes.status).toBe(204);

    const getPermsAfterRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_test/permissions`,
      'owner-token',
    );
    expect(getPermsAfterRes.status).toBe(200);
    expect(await getPermsAfterRes.json()).toEqual({
      platform_permissions: ['project:audit:read', 'project:membership:update'],
      resource_permissions: undefined,
    });

    const changeHistoryRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members/user_test/change-history`,
      'owner-token',
    );
    expect(changeHistoryRes.status).toBe(200);
    const changeHistory = (await changeHistoryRes.json()) as {
      items: Array<{ change_type: string }>;
    };
    expect(changeHistory.items.map((i) => i.change_type)).toEqual(['permissions']);

    const getPolicyRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/resources/endpoint/ep_test/policy`,
      'owner-token',
    );
    expect(getPolicyRes.status).toBe(200);
    expect(await getPolicyRes.json()).toEqual(expect.objectContaining({
      resource_type: 'endpoint',
      resource_id: 'ep_test',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
      rate_limits: expect.objectContaining({
        rules: expect.arrayContaining([
          expect.objectContaining({ key: 'endpoint.requests_per_day', value: 20000 }),
        ]),
      }),
      spending_limits: expect.objectContaining({
        rules: expect.arrayContaining([
          expect.objectContaining({ key: 'endpoint.spending_usd_per_day', value: 400 }),
        ]),
      }),
    }));

    const patchPolicyRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/resources/endpoint/ep_test/policy`,
      'owner-token',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [
            {
              subject_type: 'group',
              subject_id: 'grp_1',
              spending_limits: { rules: [{ key: 'endpoint.spending_usd_per_day', value: 1234 }] },
            },
          ],
          spending_limits: { rules: [{ key: 'endpoint.spending_usd_per_day', value: 9999 }] },
        }),
      },
    );
    expect(patchPolicyRes.status).toBe(204);
    const policyAuditStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const policyAuditEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const policyAuditRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/audit?start_time=${encodeURIComponent(policyAuditStart)}&end_time=${encodeURIComponent(policyAuditEnd)}&action=resource_policy.updated&page=1&page_size=20`,
      'owner-token',
    );
    expect(policyAuditRes.status).toBe(200);
    const policyAuditBody = (await policyAuditRes.json()) as {
      items: Array<{
        action: string;
        resource_type?: string;
        resource_id?: string;
        metadata_json?: Record<string, unknown>;
      }>;
    };
    expect(
      policyAuditBody.items.some(
        (item) => item.action === 'resource_policy.updated'
          && item.resource_type === 'resource_policy'
          && item.resource_id === 'endpoint:ep_test',
      ),
    ).toBe(true);

    const getPolicyAfterRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/resources/endpoint/ep_test/policy`,
      'owner-token',
    );
    expect(getPolicyAfterRes.status).toBe(200);
    const policy = (await getPolicyAfterRes.json()) as {
      access_mode: string;
      allowed_subjects: Array<{ subject_id: string; updated_at?: string }>;
      spending_limits?: unknown;
    };
    expect(policy.access_mode).toBe('allow_list');
    expect(policy.allowed_subjects[0]).toMatchObject({ subject_id: 'grp_1' });
    expect(policy.allowed_subjects[0]?.updated_at).toBeTruthy();
    expect(policy.spending_limits).toEqual(expect.objectContaining({
      rules: expect.arrayContaining([
        expect.objectContaining({ key: 'endpoint.spending_usd_per_day', value: 9999 }),
      ]),
    }));

    const patchInvalidRootRateKeyRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'file_library.requests_per_minute', value: 1 }] },
        }),
      },
    );
    expect(patchInvalidRootRateKeyRes.status).toBe(422);
    expect(await patchInvalidRootRateKeyRes.json()).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message: 'rate_limits_rule_key_invalid',
    });

    const patchInvalidSubjectRateKeyRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [
            {
              subject_type: 'user',
              subject_id: 'user_test',
              rate_limits: { rules: [{ key: 'agent.requests_per_minute', value: 1 }] },
            },
          ],
        }),
      },
    );
    expect(patchInvalidSubjectRateKeyRes.status).toBe(422);
    expect(await patchInvalidSubjectRateKeyRes.json()).toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message: 'rate_limits_rule_key_invalid',
    });
  });

  it('shows real member name and email after open join instead of internal user ids', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Open Join Identity Project',
        visibility: 'public',
        join_policy: 'open',
      },
    });
    const { baseUrl } = startServerWithDeps(deps);

    const joinRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/join-requests`,
      'member-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(joinRes.status).toBe(201);
    await expect(joinRes.json()).resolves.toEqual({
      outcome: 'joined',
      membership_status: 'active',
    });

    const membersRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members`,
      'owner-token',
    );
    expect(membersRes.status).toBe(200);
    const members = (await membersRes.json()) as {
      items: Array<{ id: string; email: string; name: string }>;
    };
    expect(members.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'user_test',
          email: 'test@example.com',
          name: 'Test User',
        }),
      ]),
    );
  });

  it('backfills legacy membership display fields from workspace directory lookup', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Legacy Membership Identity Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    await upsertProjectMembershipRecord(deps.docStore, 'ws_default', project.id, {
      project_id: project.id,
      user_id: 'user_alt',
      status: 'active',
      joined_at: new Date().toISOString(),
    });
    const { baseUrl } = startServerWithDeps(deps);

    const membersRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/members`,
      'owner-token',
    );
    expect(membersRes.status).toBe(200);
    const members = (await membersRes.json()) as {
      items: Array<{ id: string; email: string; name: string }>;
    };
    expect(members.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'user_alt',
          email: 'alt@example.com',
          name: 'Alt User',
        }),
      ]),
    );
  });
});
