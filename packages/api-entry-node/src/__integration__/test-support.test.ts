import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createDefaultNodeApiDeps } from '../index.js';
import { apiFetch, startServerWithDepsReady } from './test-support.js';

async function createFileLibrary(
  baseUrl: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const createLibraryRes = await apiFetch(
    baseUrl,
    '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, description: 'test workspace library' }),
    },
  );
  expect(createLibraryRes.status).toBe(201);
  return (await createLibraryRes.json()) as { id: string; name: string };
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe('integration test support startup', () => {
  it('returns a live api base url that can create file libraries immediately after reload', async () => {
    const deps = createDefaultNodeApiDeps();
    const firstServer = await startServerWithDepsReady(deps);

    const firstLibrary = await createFileLibrary(
      firstServer.baseUrl,
      'Reload Startup First Library',
    );
    expect(firstLibrary.id).toBeTruthy();

    await closeServer(firstServer.server);

    const secondServer = await startServerWithDepsReady(deps);
    const secondLibrary = await createFileLibrary(
      secondServer.baseUrl,
      'Reload Startup Second Library',
    );

    expect(secondLibrary.id).toBeTruthy();
    expect(secondLibrary.id).not.toBe(firstLibrary.id);
  });
});
