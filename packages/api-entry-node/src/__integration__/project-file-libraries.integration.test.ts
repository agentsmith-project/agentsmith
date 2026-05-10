import { describe, expect, it } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { apiFetch, apiFetchWithToken, startServer as startBaseServer, startServerWithDeps as startBaseServerWithDeps } from './test-support.js';
import { configureAfscpReadyFileLibraryTestDeps } from './afscp-file-library-test-support.js';

function startServer(): ReturnType<typeof startBaseServer> {
  const started = startBaseServer();
  configureAfscpReadyFileLibraryTestDeps(started.deps);
  return started;
}

function startServerWithDeps(deps: ReturnType<typeof createDefaultNodeApiDeps>): ReturnType<typeof startBaseServerWithDeps> {
  configureAfscpReadyFileLibraryTestDeps(deps);
  return startBaseServerWithDeps(deps);
}

describe.sequential('api-entry-node project file libraries integration', () => {
  it('supports file libraries CRUD flow through the AFSCP storage adapter', async () => {
    const { baseUrl } = startServer();

    const listBefore = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries');
    expect(listBefore.status).toBe(200);
    const listBeforeBody = (await listBefore.json()) as { items: Array<{ id: string }> };
    expect(Array.isArray(listBeforeBody.items)).toBe(true);
    const initialCount = listBeforeBody.items.length;

    const createRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Project Uploads', description: 'default uploads library' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      name: string;
      description?: string;
      status: string;
      source: string;
    };
    expect(created.id).toContain('flib_');
    expect(created.name).toBe('Project Uploads');
    expect(created.description).toBe('default uploads library');
    expect(created.status).toBe('ready');
    expect(created.source).toBe('agent_task_files');
    expect(created).not.toHaveProperty('filesystem_name');

    const updateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'managed upload library' }),
      },
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { description?: string };
    expect(updated.description).toBe('managed upload library');

    const listAfter = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries');
    expect(listAfter.status).toBe(200);
    const listed = (await listAfter.json()) as { items: Array<{ id: string; name: string }> };
    expect(listed.items).toHaveLength(initialCount + 1);
    expect(listed.items.some((item) => item.id === created.id && item.name === 'Project Uploads')).toBe(true);

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);
  });

  it('preserves file libraries across api restarts when the same deps/doc store are reused', async () => {
    const deps = createDefaultNodeApiDeps();
    const firstServer = startServerWithDeps(deps);

    const createRes = await apiFetch(
      firstServer.baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Restart Persistence', description: 'persists across restart' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };

    firstServer.server.closeAllConnections?.();
    firstServer.server.closeIdleConnections?.();
    await new Promise<void>((resolve) => firstServer.server.close(() => resolve()));

    const secondServer = startServerWithDeps(deps);
    const listRes = await apiFetch(secondServer.baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries');
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { items: Array<{ id: string; name: string }> };
    expect(listed.items.some((item) => item.id === created.id && item.name === created.name)).toBe(true);
  });

  it('lists and reads file libraries by project scope instead of creator ownership', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      'test-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Private Library', description: 'owner only' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; name: string };

    const ownerList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      'test-token',
    );
    expect(ownerList.status).toBe(200);
    await expect(ownerList.json()).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: created.id, name: created.name })]),
    });

    const otherList = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      'owner-token',
    );
    expect(otherList.status).toBe(200);
    const otherListBody = (await otherList.json()) as { items: Array<{ id: string }> };
    expect(otherListBody.items.some((item) => item.id === created.id)).toBe(true);

    const itemRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/${created.id}`,
      'owner-token',
    );
    expect(itemRes.status).toBe(200);
    await expect(itemRes.json()).resolves.toMatchObject({
      id: created.id,
      created_by_user_id: 'user_test',
      source: 'agent_task_files',
    });
  });
});
