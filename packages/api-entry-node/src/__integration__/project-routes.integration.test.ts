import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createDefaultNodeApiDeps } from '../index.js';
import { setProjectAdminGroupMembers } from '../project-groups-store.js';
import { apiFetch, apiFetchWithToken, startServer, startServerWithDeps } from './test-support.js';

describe('api-entry-node project routes integration', () => {
  it('returns authenticated workspace and member payload', async () => {
    const { baseUrl } = startServer();

    const workspaces = await apiFetch(baseUrl, '/api/v1/workspaces');
    expect(workspaces.status).toBe(200);
    const workspaceBody = (await workspaces.json()) as { items: Array<{ id: string }> };
    expect(workspaceBody.items[0]?.id).toBe('ws_default');

    const members = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/members');
    expect(members.status).toBe(200);
    const membersBody = (await members.json()) as {
      items: Array<{ user_id: string; permissions: string[] }>;
    };
    const workspaceAdmin = membersBody.items.find((item) => item.permissions.includes('workspace:project:create'));
    expect(workspaceAdmin?.user_id).toBe('owner@example.com');
    expect(workspaceAdmin?.permissions).toContain('workspace:project:create');
  });

  it('does not expose disabled registered workspaces in runtime workspace list', async () => {
    const { baseUrl } = startServer();
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH!,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          provisioning_status: 'ready',
          workspace_admin: 'owner@example.com',
          project_creators: ['test@example.com'],
          idp: {
            kind: 'keycloak',
            url: process.env.KEYCLOAK_ISSUER_URL,
            realm: 'mbos',
            client_id: 'agentsmith-web',
          },
          tenant: {
            substrate: 'default',
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
          },
        },
        {
          id: 'ws_disabled',
          name: 'Disabled Workspace',
          provisioning_status: 'disabled',
          workspace_admin: 'disabled-owner@example.com',
          project_creators: ['disabled@example.com'],
          idp: {
            kind: 'keycloak',
            url: process.env.KEYCLOAK_ISSUER_URL,
            realm: 'disabled',
            client_id: 'agentsmith-disabled',
          },
          tenant: {
            substrate: 'default',
            database_name: 'agentsmith_ws_disabled',
            collection_prefix: 'ws_disabled_',
          },
        },
      ]),
      'utf-8',
    );

    const workspaces = await apiFetch(baseUrl, '/api/v1/workspaces');
    expect(workspaces.status).toBe(200);
    const body = (await workspaces.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((item) => item.id)).toEqual(['ws_default']);
  });

  it('blocks project listing and creation for disabled registered workspaces', async () => {
    const { baseUrl } = startServer();
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH!,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          provisioning_status: 'ready',
          workspace_admin: 'owner@example.com',
          project_creators: ['test@example.com'],
          idp: {
            kind: 'keycloak',
            url: process.env.KEYCLOAK_ISSUER_URL,
            realm: 'mbos',
            client_id: 'agentsmith-web',
          },
          tenant: {
            substrate: 'default',
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
          },
        },
        {
          id: 'ws_disabled',
          name: 'Disabled Workspace',
          provisioning_status: 'disabled',
          workspace_admin: 'disabled-owner@example.com',
          project_creators: ['disabled@example.com'],
          idp: {
            kind: 'keycloak',
            url: process.env.KEYCLOAK_ISSUER_URL,
            realm: 'disabled',
            client_id: 'agentsmith-disabled',
          },
          tenant: {
            substrate: 'default',
            database_name: 'agentsmith_ws_disabled',
            collection_prefix: 'ws_disabled_',
          },
        },
      ]),
      'utf-8',
    );

    const listRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_disabled/projects');
    expect(listRes.status).toBe(404);
    await expect(listRes.json()).resolves.toEqual({
      error_code: 'RESOURCE_NOT_FOUND',
      message: 'workspace_not_found',
    });

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_disabled/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Blocked Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(404);
    await expect(createRes.json()).resolves.toEqual({
      error_code: 'RESOURCE_NOT_FOUND',
      message: 'workspace_not_found',
    });
  });

  it('lets workspace admins manage project creators and exposes creator permissions in workspace members', async () => {
    const { baseUrl } = startServer();
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH!,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          workspace_admin: 'owner@example.com',
          project_creators: ['alt@example.com'],
          idp: {
            kind: 'keycloak',
            url: process.env.KEYCLOAK_ISSUER_URL,
            realm: 'mbos',
            client_id: 'agentsmith-web',
          },
          tenant: {
            substrate: 'default',
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
          },
        },
      ]),
      'utf-8',
    );

    const creatorsRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/project-creators', 'owner-token');
    expect(creatorsRes.status).toBe(200);
    const creatorsBody = (await creatorsRes.json()) as { items: Array<{ user_id: string }> };
    expect(creatorsBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: 'alt@example.com' }),
      ]),
    );

    const updateRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/project-creators', 'owner-token', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_creator_user_ids: ['user_alt', 'user_creator'] }),
    });
    expect(updateRes.status).toBe(200);

    const membersRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/members', 'owner-token');
    expect(membersRes.status).toBe(200);
    const membersBody = (await membersRes.json()) as {
      items: Array<{ user_id: string; permissions: string[] }>;
    };
    expect(membersBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: 'user_alt',
          permissions: expect.arrayContaining(['workspace:project:create']),
        }),
      ]),
    );
  });

  it('forbids plain workspace members from creating projects while allowing project creators', async () => {
    const { baseUrl } = startServer();
    writeFileSync(
      process.env.SYSTEM_WORKSPACE_REGISTRY_PATH!,
      JSON.stringify([
        {
          id: 'ws_default',
          name: 'Default Workspace',
          workspace_admin: 'owner@example.com',
          project_creators: ['alt@example.com'],
          idp: {
            kind: 'keycloak',
            url: 'http://localhost:8080',
            realm: 'mbos',
            client_id: 'agentsmith-web',
          },
          tenant: {
            substrate: 'default',
            database_name: 'agentsmith_ws_default',
            collection_prefix: 'ws_default_',
          },
        },
      ]),
      'utf-8',
    );

    const deniedRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', 'member-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Blocked Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(deniedRes.status).toBe(403);
    await expect(deniedRes.json()).resolves.toEqual({
      error_code: 'PERMISSION_DENIED',
      message: 'workspace_project_create_required',
    });

    const allowedRes = await apiFetchWithToken(baseUrl, '/api/v1/workspaces/ws_default/projects', 'alt-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Creator Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(allowedRes.status).toBe(201);
    const created = (await allowedRes.json()) as { owner_id: string; name: string };
    expect(created.name).toBe('Creator Project');
    expect(created.owner_id).toBe('user_alt');
  });

  it('supports create then list flow', async () => {
    const { baseUrl } = startServer();

    const listBefore = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects');
    expect(listBefore.status).toBe(200);
    expect(await listBefore.json()).toEqual({ items: [] });

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Demo Project',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string; workspace_id: string };
    expect(created.id).toContain('proj_');
    expect(created.name).toBe('Demo Project');
    expect(created.workspace_id).toBe('ws_default');

    const listAfter = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects?from=test');
    const listed = (await listAfter.json()) as { items: Array<{ id: string }> };
    expect(listAfter.status).toBe(200);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(created.id);

    const getRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { id: string; name: string };
    expect(got.id).toBe(created.id);
    expect(got.name).toBe('Demo Project');

    const patchRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Renamed Project',
        description: 'Updated from patch',
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { id: string; name: string; description: string };
    expect(patched.id).toBe(created.id);
    expect(patched.name).toBe('Renamed Project');
    expect(patched.description).toBe('Updated from patch');

    const getAfterPatch = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    const gotAfterPatch = (await getAfterPatch.json()) as { name: string; description: string };
    expect(getAfterPatch.status).toBe(200);
    expect(gotAfterPatch.name).toBe('Renamed Project');
    expect(gotAfterPatch.description).toBe('Updated from patch');

    const deleteRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getAfterDelete.status).toBe(404);
  });

  it('returns admin permissions for configured project admins', async () => {
    const deps = createDefaultNodeApiDeps();
    const created = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_external',
      input: {
        name: 'Admin Shared Project',
        visibility: 'private',
        join_policy: 'approval_required',
      },
    });
    setProjectAdminGroupMembers({
      workspaceId: 'ws_default',
      projectId: created.id,
      projectOwnerId: created.owner_id,
      memberIds: ['user_test'],
    });
    const { baseUrl } = startServerWithDeps(deps);

    const getRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { owner_id: string; admin_member_ids?: string[]; permissions: string[] };
    expect(got.owner_id).toBe('user_external');
    expect(got.admin_member_ids).toContain('user_test');
    expect(got.permissions).toContain('project:endpoint:use');
    expect(got.permissions).toContain('project:agent:manage');
    expect(got.permissions).toContain('project:governance:update');

    const listRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects');
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      items: Array<{ id: string; admin_member_ids?: string[]; permissions: string[] }>;
    };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed?.admin_member_ids).toContain('user_test');
    expect(listed?.permissions).toContain('project:governance:update');
  });

  it('returns validation error for invalid payload', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe('VALIDATION_ERROR');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown project id', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe('RESOURCE_NOT_FOUND');
    expect(body.message).toBe('project_not_found');
  });
});
