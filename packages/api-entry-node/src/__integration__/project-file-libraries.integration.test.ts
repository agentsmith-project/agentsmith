import { describe, expect, it } from 'vitest';
import { apiFetch, startServer } from './test-support.js';

describe('api-entry-node project file libraries integration', () => {
  it('supports file libraries CRUD flow', async () => {
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
      filesystem_name: string;
    };
    expect(created.id).toContain('flib_');
    expect(created.name).toBe('Project Uploads');
    expect(created.description).toBe('default uploads library');
    expect(created.status).toBe('ready');
    expect(created.filesystem_name).toContain('flib-');

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
});
