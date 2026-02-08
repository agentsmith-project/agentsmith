import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createDefaultNodeApiDeps, createNodeApiServer } from './index.js';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  servers.length = 0;
});

function startServer(): { server: Server; baseUrl: string } {
  const server = createNodeApiServer(0, createDefaultNodeApiDeps());
  servers.push(server);

  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

describe('api-entry-node projects routes', () => {
  it('supports create then list flow', async () => {
    const { baseUrl } = startServer();

    const listBefore = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects`);
    expect(listBefore.status).toBe(200);
    expect(await listBefore.json()).toEqual({ items: [] });

    const createRes = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects`, {
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

    const listAfter = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects?from=test`);
    const listed = (await listAfter.json()) as { items: Array<{ id: string }> };
    expect(listAfter.status).toBe(200);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(created.id);

    const getRes = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { id: string; name: string };
    expect(got.id).toBe(created.id);
    expect(got.name).toBe('Demo Project');

    const patchRes = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects/${created.id}`, {
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

    const getAfterPatch = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects/${created.id}`);
    const gotAfterPatch = (await getAfterPatch.json()) as { name: string; description: string };
    expect(getAfterPatch.status).toBe(200);
    expect(gotAfterPatch.name).toBe('Renamed Project');
    expect(gotAfterPatch.description).toBe('Updated from patch');

    const deleteRes = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);

    const getAfterDelete = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects/${created.id}`);
    expect(getAfterDelete.status).toBe(404);
  });

  it('returns validation error for invalid payload', async () => {
    const { baseUrl } = startServer();

    const res = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: '',
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown project id', async () => {
    const { baseUrl } = startServer();

    const res = await fetch(`${baseUrl}/api/v1/workspaces/ws_default/projects/proj_missing`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.message).toBe('project_not_found');
  });

  it('supports create and list sources flow', async () => {
    const { baseUrl } = startServer();

    const listBefore = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources`,
    );
    expect(listBefore.status).toBe(200);
    expect(await listBefore.json()).toEqual({ items: [] });

    const createdRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'hello.txt',
          content_type: 'text/plain',
          content_base64: Buffer.from('hello', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as { id: string; name: string; size_bytes: number };
    expect(created.id).toContain('src_');
    expect(created.name).toBe('hello.txt');
    expect(created.size_bytes).toBe(5);

    const listAfter = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources`,
    );
    expect(listAfter.status).toBe(200);
    const listed = (await listAfter.json()) as { items: Array<{ id: string }> };
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(created.id);

    const detail = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}`,
    );
    expect(detail.status).toBe(200);

    const quota = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources/quota`,
    );
    expect(quota.status).toBe(200);
    const quotaJson = (await quota.json()) as { storage: { used: number } };
    expect(quotaJson.storage.used).toBe(5);

    const download = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}/download`,
    );
    expect(download.status).toBe(200);
    const text = await download.text();
    expect(text).toBe('hello');

    const deleteRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);

    const listAfterDelete = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/sources`,
    );
    expect(listAfterDelete.status).toBe(200);
    const listedAfterDelete = (await listAfterDelete.json()) as { items: Array<{ id: string }> };
    expect(listedAfterDelete.items).toHaveLength(0);
  });

  it('supports source libraries CRUD flow', async () => {
    const { baseUrl } = startServer();

    const listBefore = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/source-libraries`,
    );
    expect(listBefore.status).toBe(200);
    expect(await listBefore.json()).toEqual({ items: [] });

    const createRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/source-libraries`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Shared Docs', visibility: 'shared' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };
    expect(created.id).toContain('lib_');
    expect(created.name).toBe('Shared Docs');

    const updateRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'policy docs' }),
      },
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { description?: string };
    expect(updated.description).toBe('policy docs');

    const listAfter = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/source-libraries`,
    );
    const listed = (await listAfter.json()) as { items: Array<{ id: string }> };
    expect(listAfter.status).toBe(200);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(created.id);

    const deleteRes = await fetch(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);
  });
});
