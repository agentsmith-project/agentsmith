import { describe, expect, it } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { setProjectAdminGroupMembersPersisted } from '../project-member-governance-persistence.js';
import { apiFetch, apiFetchWithToken, startServer, startServerWithDeps } from './test-support.js';

describe('api-entry-node project lifecycle and governance routes', () => {
  it('records project lifecycle changes in audit events', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_project_create_audit',
      },
      body: JSON.stringify({
        name: 'Audit Project',
        description: 'project audit flow',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };

    const updateRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_project_update_audit',
      },
      body: JSON.stringify({
        name: 'Audit Project Renamed',
      }),
    });
    expect(updateRes.status).toBe(200);

    const deleteRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'DELETE',
      headers: {
        'x-request-id': 'req_project_delete_audit',
      },
    });
    expect(deleteRes.status).toBe(204);

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{ action: string; request_id: string; result: string; metadata_json?: { name?: string } }>;
    };
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.create'
          && item.request_id === 'req_project_create_audit'
          && item.result === 'ok'
          && item.metadata_json?.name === 'Audit Project',
      ),
    ).toBe(true);
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.update'
          && item.request_id === 'req_project_update_audit'
          && item.result === 'ok'
          && item.metadata_json?.name === 'Audit Project Renamed',
      ),
    ).toBe(true);
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.delete' && item.request_id === 'req_project_delete_audit' && item.result === 'ok',
      ),
    ).toBe(true);
  });

  it('records failed project update and delete attempts in audit events', async () => {
    const { baseUrl } = startServer();
    const missingProjectId = 'proj_missing_audit';

    const updateRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${missingProjectId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_project_update_missing',
      },
      body: JSON.stringify({
        name: 'Missing Project',
      }),
    });
    expect(updateRes.status).toBe(404);

    const deleteRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${missingProjectId}`, {
      method: 'DELETE',
      headers: {
        'x-request-id': 'req_project_delete_missing',
      },
    });
    expect(deleteRes.status).toBe(404);

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${missingProjectId}/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=20&result=error`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{ action: string; request_id: string; result: string; error_code?: string; error_message?: string }>;
    };
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.update'
          && item.request_id === 'req_project_update_missing'
          && item.result === 'error'
          && item.error_code === 'RESOURCE_NOT_FOUND'
          && item.error_message === 'project_not_found',
      ),
    ).toBe(true);
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.delete'
          && item.request_id === 'req_project_delete_missing'
          && item.result === 'error'
          && item.error_code === 'RESOURCE_NOT_FOUND'
          && item.error_message === 'project_not_found',
      ),
    ).toBe(true);
  });

  it('rejects legacy project_admins updates', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Project Admin Audit',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const updateRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_project_admin_assignment',
      },
      body: JSON.stringify({
        governance_json: {
          project_admins: ['user_alt'],
        },
      }),
    });
    expect(updateRes.status).toBe(422);
  });

  it('rejects project admin assignment changes from non-owners via the removed legacy field', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Owner Only Assignment',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    await setProjectAdminGroupMembersPersisted({
      docStore: deps.docStore,
      workspaceId: 'ws_default',
      projectId: created.id,
      memberIds: ['user_alt'],
    });

    const forbiddenAssignRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}`,
      'alt-token',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_project_admin_forbidden',
        },
        body: JSON.stringify({
          governance_json: {
            project_admins: ['user_alt', 'user_owner'],
          },
        }),
      },
    );
    expect(forbiddenAssignRes.status).toBe(422);
    await expect(forbiddenAssignRes.json()).resolves.toMatchObject({
      error_code: 'VALIDATION_ERROR',
      message: 'legacy_project_admin_list_removed_use_admin_group',
    });
  });

  it('lets project owners transfer ownership and records audit events', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Owner Transfer Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; owner_id: string };
    expect(created.owner_id).toBe('user_test');

    const transferRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-request-id': 'req_project_owner_transfer',
      },
      body: JSON.stringify({
        owner_id: 'user_alt',
      }),
    });
    expect(transferRes.status).toBe(200);
    await expect(transferRes.json()).resolves.toMatchObject({
      owner_id: 'user_alt',
    });

    const previousOwnerViewRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      headers: {
        authorization: 'Bearer test-token',
      },
    });
    expect(previousOwnerViewRes.status).toBe(200);
    await expect(previousOwnerViewRes.json()).resolves.toMatchObject({
      owner_id: 'user_alt',
      admin_member_ids: expect.arrayContaining(['user_test']),
      permissions: expect.arrayContaining(['project:governance:update']),
    });

    const auditRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}/audit?start_time=${encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString())}&end_time=${encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString())}&action=project.owner.transferred&page=1&page_size=20`,
      'alt-token',
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{
        action: string;
        request_id?: string;
        result: string;
        metadata_json?: {
          previous_owner_id?: string;
          next_owner_id?: string;
          previous_owner_retained_admin?: boolean;
        };
      }>;
    };
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.owner.transferred'
          && item.request_id === 'req_project_owner_transfer'
          && item.result === 'ok'
          && item.metadata_json?.previous_owner_id === 'user_test'
          && item.metadata_json?.next_owner_id === 'user_alt'
          && item.metadata_json?.previous_owner_retained_admin === true,
      ),
    ).toBe(true);
  });

  it('rejects forced ownership transfer when actor lacks the built-in workspace owner group', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Forced Owner Transfer Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    await setProjectAdminGroupMembersPersisted({
      docStore: deps.docStore,
      workspaceId: 'ws_default',
      projectId: created.id,
      memberIds: ['user_alt'],
    });

    const forbiddenTransferRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}`,
      'alt-token',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_project_owner_transfer_forbidden',
        },
        body: JSON.stringify({
          owner_id: 'user_owner',
        }),
      },
    );
    expect(forbiddenTransferRes.status).toBe(403);
    await expect(forbiddenTransferRes.json()).resolves.toMatchObject({
      error_code: 'PERMISSION_DENIED',
      message: 'project_owner_or_workspace_admin_required',
    });

    const forcedTransferRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}`,
      'owner-token',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_project_owner_transfer_forced',
        },
        body: JSON.stringify({
          owner_id: 'user_owner',
        }),
      },
    );
    expect(forcedTransferRes.status).toBe(403);
    await expect(forcedTransferRes.json()).resolves.toMatchObject({
      error_code: 'FORBIDDEN',
      message: 'forbidden',
    });

    const auditRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}/audit?start_time=${encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString())}&end_time=${encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString())}&action=project.owner.transferred&page=1&page_size=20`,
      'test-token',
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{
        action: string;
        request_id?: string;
        result: string;
        error_code?: string;
        error_message?: string;
      }>;
    };
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.owner.transferred'
          && item.request_id === 'req_project_owner_transfer_forbidden'
          && item.result === 'error',
      ),
    ).toBe(true);
  });

  it('rejects project deletion from non-owners and records audit errors', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Owner Only Delete',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    await setProjectAdminGroupMembersPersisted({
      docStore: deps.docStore,
      workspaceId: 'ws_default',
      projectId: created.id,
      memberIds: ['user_alt'],
    });

    const forbiddenDeleteRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}`,
      'alt-token',
      {
        method: 'DELETE',
        headers: {
          'x-request-id': 'req_project_delete_forbidden',
        },
      },
    );
    expect(forbiddenDeleteRes.status).toBe(403);
    await expect(forbiddenDeleteRes.json()).resolves.toMatchObject({
      error_code: 'PERMISSION_DENIED',
      message: 'project_owner_required',
    });

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&action=project.delete&page=1&page_size=20&result=error`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{
        action: string;
        request_id: string;
        result: string;
        error_code?: string;
        error_message?: string;
      }>;
    };
    expect(
      audit.items.some(
        (item) =>
          item.action === 'project.delete'
          && item.request_id === 'req_project_delete_forbidden'
          && item.result === 'error'
          && item.error_code === 'PERMISSION_DENIED'
          && item.error_message === 'project_owner_required',
      ),
    ).toBe(true);
  });

  it('records failed resource policy update attempts in audit events', async () => {
    const { baseUrl } = startServer();

    const failedPolicyRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_policy_invalid' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.invalid_key', value: 10 }] },
          spending_limits: { rules: [] },
        }),
      },
    );
    expect(failedPolicyRes.status).toBe(422);

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&action=resource_policy.updated&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{
        action: string;
        result?: string;
        resource_type?: string;
        resource_id?: string;
        request_id?: string;
        error_code?: string;
        error_message?: string;
      }>;
    };
    expect(
      audit.items.some(
        (item) =>
          item.action === 'resource_policy.updated'
          && item.result === 'error'
          && item.resource_type === 'resource_policy'
          && item.resource_id === 'endpoint:ep_test'
          && item.request_id === 'req_policy_invalid'
          && item.error_code === 'VALIDATION_ERROR'
          && item.error_message === 'rate_limits_rule_key_invalid',
      ),
    ).toBe(true);
  });
});
