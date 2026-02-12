import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { createDefaultNodeApiDeps, createNodeApiServer } from './index.js';

const servers: Server[] = [];
const originalKeycloakIssuer = process.env.KEYCLOAK_ISSUER_URL;

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
  if (originalKeycloakIssuer === undefined) {
    delete process.env.KEYCLOAK_ISSUER_URL;
  } else {
    process.env.KEYCLOAK_ISSUER_URL = originalKeycloakIssuer;
  }
});

function startMockKeycloakServer(): { server: Server; issuerUrl: string } {
  const server = http.createServer((_req, res) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        sub: 'user_test',
        email: 'test@example.com',
        preferred_username: 'test-user',
        name: 'Test User',
      }),
    );
  });
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { server, issuerUrl: `http://127.0.0.1:${address.port}` };
}

function startServer(): { server: Server; baseUrl: string } {
  const keycloak = startMockKeycloakServer();
  process.env.KEYCLOAK_ISSUER_URL = keycloak.issuerUrl;
  const server = createNodeApiServer(0, createDefaultNodeApiDeps());
  servers.push(server);

  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function startServerWithDeps(deps: ReturnType<typeof createDefaultNodeApiDeps>): { server: Server; baseUrl: string } {
  const keycloak = startMockKeycloakServer();
  process.env.KEYCLOAK_ISSUER_URL = keycloak.issuerUrl;
  const server = createNodeApiServer(0, deps);
  servers.push(server);

  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

function apiFetch(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', 'Bearer test-token');
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
}

function buildMultipartBody(
  fields: Array<{ name: string; value: string }>,
  file: { fieldName: string; filename: string; contentType: string; content: Uint8Array },
): { body: Uint8Array; contentType: string } {
  const boundary = `----mbos-boundary-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const field of fields) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    chunks.push(encoder.encode(`Content-Disposition: form-data; name="${field.name}"\r\n\r\n`));
    chunks.push(encoder.encode(field.value));
    chunks.push(encoder.encode('\r\n'));
  }

  chunks.push(encoder.encode(`--${boundary}\r\n`));
  chunks.push(
    encoder.encode(
      `Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\n`,
    ),
  );
  chunks.push(encoder.encode(`Content-Type: ${file.contentType}\r\n\r\n`));
  chunks.push(file.content);
  chunks.push(encoder.encode('\r\n'));
  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  const size = chunks.reduce((acc, cur) => acc + cur.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function startUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
} {
  let body: unknown = null;
  let path = '';
  const server = http.createServer((req, res) => {
    void (async () => {
      path = req.url ?? '';
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, echoed: body }));
    })();
  });
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    lastBody: () => body,
    lastPath: () => path,
  };
}

function startOpenAICompatibleUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
} {
  let body: unknown = null;
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};

      if (req.url?.includes('/chat/completions')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'chatcmpl_test',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'deepseek-chat',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from upstream.' },
                finish_reason: 'stop',
              },
            ],
          }),
        );
        return;
      }

      res.statusCode = 404;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'not_found' }));
    })();
  });
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, lastBody: () => body };
}

function startSlowOpenAICompatibleUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
} {
  let body: unknown = null;
  const server = http.createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};

      if (!req.url?.includes('/chat/completions')) {
        res.statusCode = 404;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }

      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.write(
        'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      );
      setTimeout(() => {
        res.write(
          'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n',
        );
      }, 300);
      setTimeout(() => {
        res.write(
          'data: {"id":"chatcmpl_slow","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":12}}\n\n',
        );
        res.write('data: [DONE]\n\n');
        res.end();
      }, 1_200);
    })();
  });
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/v1`, lastBody: () => body };
}

function parseSseEventPayload(text: string, event: string): Record<string, unknown> | null {
  const blocks = text.split('\n\n').map((item) => item.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event:'));
    if (!eventLine) continue;
    const name = eventLine.slice('event:'.length).trim();
    if (name !== event) continue;
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    try {
      return JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

describe('api-entry-node projects routes', () => {
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
    expect(membersBody.items[0]?.user_id).toBe('user_test');
    expect(membersBody.items[0]?.permissions).toContain('workspace:project:create');
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

  it('returns operator permissions for non-owner project in minimal mode', async () => {
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
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { owner_id: string; permissions: string[] };
    expect(got.owner_id).toBe('user_external');
    expect(got.permissions).toContain('project:chat:access');
    expect(got.permissions).toContain('project:source:manage');
    expect(got.permissions).toContain('project:endpoint:manage');
    expect(got.permissions).toContain('project:credential:manage');
    expect(got.permissions).not.toContain('project:member:manage');
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

  it('supports create and list sources flow', async () => {
    const { baseUrl } = startServer();

    const listBefore = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/sources');
    expect(listBefore.status).toBe(200);
    expect(await listBefore.json()).toEqual({ items: [] });

    const createdRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'hello.txt',
          library_id: 'lib_a',
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

    const secondRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'readme.txt',
          library_id: 'lib_b',
          content_type: 'text/plain',
          content_base64: Buffer.from('abc', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(secondRes.status).toBe(201);

    const listAfter = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/sources');
    expect(listAfter.status).toBe(200);
    const listed = (await listAfter.json()) as { items: Array<{ id: string }> };
    expect(listed.items).toHaveLength(2);
    expect(listed.items[0].id).toBe(created.id);

    const listLibA = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources?library_id=lib_a',
    );
    expect(listLibA.status).toBe(200);
    const listedLibA = (await listLibA.json()) as { items: Array<{ id: string; library_id?: string }> };
    expect(listedLibA.items).toHaveLength(1);
    expect(listedLibA.items[0].library_id).toBe('lib_a');

    const detail = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}`);
    expect(detail.status).toBe(200);

    const quota = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/sources/quota');
    expect(quota.status).toBe(200);
    const quotaJson = (await quota.json()) as { storage: { used: number } };
    expect(quotaJson.storage.used).toBe(8);

    const quotaLibA = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources/quota?library_id=lib_a',
    );
    expect(quotaLibA.status).toBe(200);
    const quotaLibAJson = (await quotaLibA.json()) as { storage: { used: number } };
    expect(quotaLibAJson.storage.used).toBe(5);

    const aiReadyStart = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}/ai-ready/start`,
      { method: 'POST' },
    );
    expect(aiReadyStart.status).toBe(200);
    const aiReadyJob = (await aiReadyStart.json()) as { status: string };
    expect(aiReadyJob.status).toBe('ready');

    const download = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}/download`);
    expect(download.status).toBe(200);
    const text = await download.text();
    expect(text).toBe('hello');

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);

    const listAfterDelete = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/sources');
    expect(listAfterDelete.status).toBe(200);
    const listedAfterDelete = (await listAfterDelete.json()) as { items: Array<{ id: string }> };
    expect(listedAfterDelete.items).toHaveLength(1);
  });

  it('supports source libraries CRUD flow', async () => {
    const { baseUrl } = startServer();

    const listBefore = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries');
    expect(listBefore.status).toBe(200);
    expect(await listBefore.json()).toEqual({ items: [] });

    const createRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Shared Docs', visibility: 'shared' }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      name: string;
      object_prefix?: string;
      doc_namespace?: string;
      vector_namespace?: string;
    };
    expect(created.id).toContain('lib_');
    expect(created.name).toBe('Shared Docs');
    expect(created.object_prefix).toContain(`/libraries/${created.id}`);
    expect(created.doc_namespace).toContain(created.id);
    expect(created.vector_namespace).toContain(created.id);

    const updateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'policy docs' }),
      },
    );
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { description?: string };
    expect(updated.description).toBe('policy docs');

    const listAfter = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries');
    const listed = (await listAfter.json()) as { items: Array<{ id: string }> };
    expect(listAfter.status).toBe(200);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0].id).toBe(created.id);

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);
  });

  it('supports source library object browser routes', async () => {
    const { baseUrl } = startServer();

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Obj Docs', visibility: 'shared' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const library = (await createLibraryRes.json()) as { id: string };

    const createFolderRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/folders`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: 'docs/' }),
      },
    );
    expect(createFolderRes.status).toBe(201);

    const form = buildMultipartBody(
      [{ name: 'prefix', value: 'docs/' }],
      {
        fieldName: 'file',
        filename: 'readme.txt',
        contentType: 'text/plain',
        content: new TextEncoder().encode('hello object'),
      },
    );
    const uploadRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/upload`,
      {
        method: 'POST',
        headers: { 'content-type': form.contentType },
        body: Buffer.from(form.body),
      },
    );
    expect(uploadRes.status).toBe(201);
    const uploaded = (await uploadRes.json()) as { key: string; content_type: string };
    expect(uploaded.key).toBe('docs/readme.txt');
    expect(uploaded.content_type).toBe('text/plain');

    const cnForm = buildMultipartBody(
      [{ name: 'prefix', value: 'docs/' }],
      {
        fieldName: 'file',
        filename: '敲冰块.nes',
        contentType: 'application/octet-stream',
        content: new TextEncoder().encode('binary'),
      },
    );
    const cnUploadRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/upload`,
      {
        method: 'POST',
        headers: { 'content-type': cnForm.contentType },
        body: Buffer.from(cnForm.body),
      },
    );
    expect(cnUploadRes.status).toBe(201);
    const cnUploaded = (await cnUploadRes.json()) as { key: string };
    expect(cnUploaded.key).toBe('docs/敲冰块.nes');

    const listRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=docs/&delimiter=/`,
    );
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as {
      items: Array<{ kind: string; key?: string; prefix?: string }>;
    };
    expect(listed.items.some((item) => item.kind === 'object' && item.key === 'docs/readme.txt')).toBe(true);

    const searchedListRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=docs/&delimiter=/&search=readme&sort_by=name&sort_order=asc`,
    );
    expect(searchedListRes.status).toBe(200);
    const searchedListed = (await searchedListRes.json()) as {
      items: Array<{ kind: string; key?: string; name?: string }>;
    };
    const searchedObjects = searchedListed.items.filter((item) => item.kind === 'object');
    expect(searchedObjects).toHaveLength(1);
    expect(searchedObjects[0]?.key).toBe('docs/readme.txt');

    const invalidDelimiterRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=docs/&delimiter=.`,
    );
    expect(invalidDelimiterRes.status).toBe(400);

    const metaRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/meta?key=${encodeURIComponent('docs/readme.txt')}`,
    );
    expect(metaRes.status).toBe(200);
    const meta = (await metaRes.json()) as { key: string; size_bytes: number };
    expect(meta.key).toBe('docs/readme.txt');
    expect(meta.size_bytes).toBeGreaterThan(0);

    const shareRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/share-link`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'docs/readme.txt',
          expires_in_seconds: 600,
        }),
      },
    );
    expect(shareRes.status).toBe(200);
    const shared = (await shareRes.json()) as {
      key: string;
      url: string;
      expires_in_seconds: number;
      expires_at: string;
    };
    expect(shared.key).toBe('docs/readme.txt');
    expect(shared.url).toContain(encodeURIComponent('readme.txt'));
    expect(shared.expires_in_seconds).toBe(600);
    expect(new Date(shared.expires_at).toString()).not.toBe('Invalid Date');

    const moveRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/move`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          from_key: 'docs/readme.txt',
          to_key: 'docs/readme-renamed.txt',
          overwrite: false,
        }),
      },
    );
    expect(moveRes.status).toBe(200);

    const downloadRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/download?key=${encodeURIComponent('docs/readme-renamed.txt')}`,
    );
    expect(downloadRes.status).toBe(200);
    expect(await downloadRes.text()).toBe('hello object');

    const downloadMissingKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/download`,
    );
    expect(downloadMissingKeyRes.status).toBe(400);
    const downloadMissingKeyBody = (await downloadMissingKeyRes.json()) as { error_code: string; message: string };
    expect(downloadMissingKeyBody.error_code).toBe('invalid_key');

    const deleteObjectsRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/delete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keys: ['docs/readme-renamed.txt', 'docs/'] }),
      },
    );
    expect(deleteObjectsRes.status).toBe(200);

    const deleteLibraryRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}`,
      { method: 'DELETE' },
    );
    expect(deleteLibraryRes.status).toBe(204);
  });

  it('supports library scoped ai-ready-jobs create/get/cancel flow', async () => {
    const { baseUrl } = startServer();

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'RAG Docs', visibility: 'shared' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const library = (await createLibraryRes.json()) as { id: string };

    const createSourceRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'rag.txt',
          library_id: library.id,
          content_type: 'text/plain',
          content_base64: Buffer.from('rag-source', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(createSourceRes.status).toBe(201);
    const source = (await createSourceRes.json()) as { id: string };

    const createJobRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/ai-ready-jobs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': 'idem-job-1' },
        body: JSON.stringify({ source_ids: [source.id] }),
      },
    );
    expect(createJobRes.status).toBe(201);
    const job = (await createJobRes.json()) as { id: string; status: string; type: string };
    expect(job.type).toBe('document_ingest');
    expect(['queued', 'running', 'succeeded']).toContain(job.status);

    let found: { id: string; source_ids: string[]; status: string } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const getJobRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/ai-ready-jobs/${job.id}`,
      );
      expect(getJobRes.status).toBe(200);
      found = (await getJobRes.json()) as { id: string; source_ids: string[]; status: string };
      if (found.status === 'succeeded') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(found?.id).toBe(job.id);
    expect(found?.source_ids).toEqual([source.id]);
    expect(found?.status).toBe('succeeded');

    const cancelRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/ai-ready-jobs/${job.id}:cancel`,
      { method: 'POST' },
    );
    expect(cancelRes.status).toBe(200);
    const cancelled = (await cancelRes.json()) as { status: string };
    expect(cancelled.status).toBe('cancelled');
  });

  it('supports credentials and endpoints CRUD plus openai-compatible proxy', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'deepseek-key',
          type: 'api_key',
          value: 'sk-test',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string; fingerprint: string };
    expect(credential.id).toContain('cred_');
    expect(credential.fingerprint.length).toBeGreaterThan(0);

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'deepseek-chat',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };
    expect(endpoint.id).toContain('ep_');

    const proxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'will-be-overridden',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      },
    );
    expect(proxy.status).toBe(200);
    const proxied = (await proxy.json()) as { ok: boolean };
    expect(proxied.ok).toBe(true);
    const echoed = upstream.lastBody() as { model?: string };
    expect(echoed.model).toBe('deepseek-chat');
  });

  it('normalizes endpoint base_url when full chat/completions path is provided', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-key',
          type: 'api_key',
          value: 'sk-glm-test',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-chat',
          openai_model: 'glm-4-flash',
          type: 'custom',
          mode: 'openai',
          base_url: `${upstream.baseUrl}/chat/completions`,
          credential_ref: credential.id,
          provider_family: 'glm',
          protocol: 'glm_native',
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string; base_url: string };
    expect(endpoint.base_url.endsWith('/chat/completions')).toBe(false);

    const streamRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'glm-4-flash',
        }),
      },
    );
    expect(streamRes.status).toBe(201);
    const session = (await streamRes.json()) as { id: string };

    const sendRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello glm' },
        }),
      },
    );
    expect(sendRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/chat/completions');
  });

  it('sends image attachments to upstream multimodal chat payload', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'vision-key',
          type: 'api_key',
          value: 'sk-vision',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'vision-endpoint',
          openai_model: 'gpt-4o',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'openai',
          protocol: 'openai_compatible',
          capabilities: [{ type: 'multimodal_completion', enabled: true, default_model_id: 'gpt-4o' }],
          models: [{ capability: 'multimodal_completion', model_id: 'gpt-4o' }],
          defaults: { multimodal_model_id: 'gpt-4o' },
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'gpt-4o',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    const initAttachment = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/attachments/init`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          file_name: 'cat.png',
          file_type: 'image/png',
          file_size: 4,
          content_base64: 'AQIDBA==',
        }),
      },
    );
    expect(initAttachment.status).toBe(200);
    const attachmentBody = (await initAttachment.json()) as { attachment: { id: string } };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: {
            role: 'user',
            content: 'describe this image',
            attachments: [attachmentBody.attachment.id],
          },
        }),
      },
    );
    expect(streamRes.status).toBe(200);

    const upstreamBody = upstream.lastBody() as {
      messages?: Array<{ role: string; content: unknown }>;
    };
    const userMessage = upstreamBody.messages?.find((item) => item.role === 'user');
    expect(Array.isArray(userMessage?.content)).toBe(true);
    const parts = userMessage?.content as Array<Record<string, unknown>>;
    const imagePart = parts.find((item) => item.type === 'image_url');
    expect(imagePart).toBeTruthy();
    expect((imagePart?.image_url as { url?: string } | undefined)?.url?.startsWith('data:image/png;base64,')).toBe(
      true,
    );
  });

  it('imports openai-compatible endpoint config in one request', async () => {
    const { baseUrl } = startServer();
    const importRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints/import-openai-compatible',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          reranker: {
            model: 'qwen3-reranker-0.6b',
            api_base: 'http://pullot.com:20551/v1',
            api_key: '20552055',
            mode: 'openai',
          },
          embedding: {
            model: 'qwen3-embedding-0.6b',
            api_base: 'http://pullot.com:20553/v1',
            api_key: '20552055',
          },
          completion: {
            model: 'deepseek-chat',
            api_base: 'https://api.deepseek.com',
            api_key: 'sk-test',
          },
        }),
      },
    );
    expect(importRes.status).toBe(201);
    const imported = (await importRes.json()) as { items: Array<{ id: string }> };
    expect(imported.items.length).toBe(3);

    const listed = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { items: Array<{ id: string }> };
    expect(body.items.length).toBe(3);
  });

  it('supports rerank route with capability model selection', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'rerank-key',
          type: 'api_key',
          value: 'sk-rerank',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'rerank-endpoint',
          openai_model: 'qwen-reranker',
          type: 'custom',
          mode: 'openai',
          protocol: 'openai_compatible',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [{ type: 'rerank', enabled: true, default_model_id: 'qwen-reranker' }],
          models: [{ capability: 'rerank', model_id: 'qwen-reranker', display_name: 'qwen-reranker' }],
          defaults: { rerank_model_id: 'qwen-reranker' },
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const rerankRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/rerank`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored-model',
          query: 'hello',
          documents: ['a', 'b'],
        }),
      },
    );
    expect(rerankRes.status).toBe(200);
    const echoed = upstream.lastBody() as { model?: string; query?: string; documents?: string[] };
    expect(upstream.lastPath()).toBe('/v1/rerank');
    expect(echoed.model).toBe('qwen-reranker');
    expect(echoed.query).toBe('hello');
    expect(echoed.documents).toEqual(['a', 'b']);
  });

  it('fails fast when endpoint capability is not enabled or unsupported by protocol', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'generic-key',
          type: 'api_key',
          value: 'sk-generic',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const disabledCapabilityEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-only',
          openai_model: 'chat-model',
          protocol: 'openai_compatible',
          type: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'chat-model' }],
          models: [{ capability: 'chat_completion', model_id: 'chat-model' }],
          defaults: { chat_model_id: 'chat-model' },
        }),
      },
    );
    expect(disabledCapabilityEndpointRes.status).toBe(201);
    const disabledCapabilityEndpoint = (await disabledCapabilityEndpointRes.json()) as { id: string };

    const disabledRerankRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${disabledCapabilityEndpoint.id}/rerank`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'q', documents: ['a'] }),
      },
    );
    expect(disabledRerankRes.status).toBe(422);
    const disabledBody = (await disabledRerankRes.json()) as { message: string };
    expect(disabledBody.message).toBe('endpoint_capability_not_enabled');

    const unsupportedProtocolEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'google-rerank',
          openai_model: 'gemini-rerank',
          protocol: 'google_gemini',
          provider_family: 'google',
          type: 'custom',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [{ type: 'rerank', enabled: true, default_model_id: 'gemini-rerank' }],
          models: [{ capability: 'rerank', model_id: 'gemini-rerank' }],
          defaults: { rerank_model_id: 'gemini-rerank' },
        }),
      },
    );
    expect(unsupportedProtocolEndpointRes.status).toBe(201);
    const unsupportedProtocolEndpoint = (await unsupportedProtocolEndpointRes.json()) as { id: string };

    const unsupportedRerankRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${unsupportedProtocolEndpoint.id}/rerank`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'q', documents: ['a'] }),
      },
    );
    expect(unsupportedRerankRes.status).toBe(422);
    const unsupportedBody = (await unsupportedRerankRes.json()) as { message: string };
    expect(unsupportedBody.message).toBe('endpoint_capability_not_supported_for_protocol');
  });

  it('supports image/video generation routes with capability model binding', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'media-key',
          type: 'api_key',
          value: 'sk-media',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'media-endpoint',
          openai_model: 'gpt-4o-mini',
          protocol: 'openai_compatible',
          type: 'custom',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          capabilities: [
            { type: 'image_generation', enabled: true, default_model_id: 'gpt-image-1' },
            { type: 'video_generation', enabled: true, default_model_id: 'sora' },
          ],
          models: [
            { capability: 'image_generation', model_id: 'gpt-image-1' },
            { capability: 'video_generation', model_id: 'sora' },
          ],
          defaults: { image_model_id: 'gpt-image-1', video_model_id: 'sora' },
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const imageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/images/generations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'red mountain' }),
      },
    );
    expect(imageRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/images/generations');
    const imagePayload = upstream.lastBody() as { model?: string; prompt?: string };
    expect(imagePayload.model).toBe('gpt-image-1');
    expect(imagePayload.prompt).toBe('red mountain');

    const videoCreateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/videos/generations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'flying over city' }),
      },
    );
    expect(videoCreateRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/videos/generations');
    const videoPayload = upstream.lastBody() as { model?: string; prompt?: string };
    expect(videoPayload.model).toBe('sora');
    expect(videoPayload.prompt).toBe('flying over city');

    const videoPollRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/videos/generations/job_123`,
      {
        method: 'GET',
      },
    );
    expect(videoPollRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/videos/generations/job_123');
    const pollPayload = upstream.lastBody() as { model?: string };
    expect(pollPayload.model).toBeUndefined();

    const videoCancelRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/videos/generations/job_123/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(videoCancelRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/videos/generations/job_123/cancel');
    const cancelPayload = upstream.lastBody() as { model?: string };
    expect(cancelPayload.model).toBe('sora');
  });

  it('supports chat stream via project endpoint and persists assistant reply', async () => {
    const { baseUrl } = startServer();
    const upstream = startOpenAICompatibleUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-key',
          type: 'api_key',
          value: 'sk-chat',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    const createUser = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello from user',
        }),
      },
    );
    expect(createUser.status).toBe(201);
    const userMessage = (await createUser.json()) as { id: string };

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessage.id,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    const sse = await stream.text();
    expect(sse).toContain('event: meta');
    expect(sse).toContain('event: delta');
    expect(sse).toContain('Hello from upstream.');
    expect(sse).toContain('event: done');

    const history = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
    );
    expect(history.status).toBe(200);
    const messages = (await history.json()) as {
      items: Array<{ role: 'user' | 'assistant'; content: string }>;
    };
    expect(messages.items.length).toBe(2);
    expect(messages.items[0]).toMatchObject({ role: 'user', content: 'hello from user' });
    expect(messages.items[1]).toMatchObject({ role: 'assistant', content: 'Hello from upstream.' });

    const upstreamBody = upstream.lastBody() as { model?: string; messages?: Array<{ role: string }> };
    expect(upstreamBody.model).toBe('deepseek-chat');
    expect(upstreamBody.messages?.at(-1)?.role).toBe('user');
  });

  it('supports stopping an active stream by session id', async () => {
    const { baseUrl } = startServer();
    const upstream = startSlowOpenAICompatibleUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-key',
          type: 'api_key',
          value: 'sk-chat',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    const createUser = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello from user',
        }),
      },
    );
    expect(createUser.status).toBe(201);
    const userMessage = (await createUser.json()) as { id: string };

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessage.id,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);

    const stopBySession = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(stopBySession.status).toBe(202);
    const stopBody = (await stopBySession.json()) as { state: string };
    expect(stopBody.state).toBe('stopping');

    const sse = await stream.text();
    const done = parseSseEventPayload(sse, 'done');
    expect(done?.message_status).toBe('stopped');
  });

  it('lists active stream ids by session for refresh recovery', async () => {
    const { baseUrl } = startServer();
    const upstream = startSlowOpenAICompatibleUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-key',
          type: 'api_key',
          value: 'sk-chat',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    const createUser = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello from user',
        }),
      },
    );
    expect(createUser.status).toBe(201);
    const userMessage = (await createUser.json()) as { id: string };

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessage.id,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);

    const activeStreams = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/streams`,
    );
    expect(activeStreams.status).toBe(200);
    const activeBody = (await activeStreams.json()) as {
      items: Array<{ stream_id: string; status: string; started_at: string }>;
      total: number;
    };
    expect(activeBody.total).toBe(1);
    expect(activeBody.items[0]?.stream_id).toContain('stream_');
    expect(activeBody.items[0]?.status).toBe('running');
    expect(typeof activeBody.items[0]?.started_at).toBe('string');

    const stopBySession = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(stopBySession.status).toBe(202);
    await stream.text();
  });

  it('returns 404 when listing streams for unknown session', async () => {
    const { baseUrl } = startServer();
    const res = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/chat_sess_unknown/streams',
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error_code: string; message: string };
    expect(body.error_code).toBe('RESOURCE_NOT_FOUND');
    expect(body.message).toBe('chat_session_not_found');
  });

  it('returns empty active stream list after stream completion', async () => {
    const { baseUrl } = startServer();
    const upstream = startOpenAICompatibleUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-key',
          type: 'api_key',
          value: 'sk-chat',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    const createUser = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello from user',
        }),
      },
    );
    expect(createUser.status).toBe(201);
    const userMessage = (await createUser.json()) as { id: string };

    const stream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessage.id,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(stream.status).toBe(200);
    await stream.text();

    const activeStreams = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/streams`,
    );
    expect(activeStreams.status).toBe(200);
    const activeBody = (await activeStreams.json()) as {
      items: Array<{ stream_id: string; status: string; started_at: string }>;
      total: number;
    };
    expect(activeBody.total).toBe(0);
    expect(activeBody.items).toHaveLength(0);
  });

  it('rejects starting a second active stream for the same session', async () => {
    const { baseUrl } = startServer();
    const upstream = startSlowOpenAICompatibleUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-key',
          type: 'api_key',
          value: 'sk-chat',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    const createUser = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello from user',
        }),
      },
    );
    expect(createUser.status).toBe(201);
    const userMessage = (await createUser.json()) as { id: string };

    const firstStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessage.id,
          input: { role: 'user', content: 'hello from user' },
        }),
      },
    );
    expect(firstStream.status).toBe(200);

    const secondStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          branch_leaf_message_id: userMessage.id,
          input: { role: 'user', content: 'hello from user again' },
        }),
      },
    );
    expect(secondStream.status).toBe(409);
    const secondBody = (await secondStream.json()) as { error_code: string; message: string };
    expect(secondBody.error_code).toBe('CHAT_SESSION_STREAM_CONFLICT');
    expect(secondBody.message).toBe('chat_session_stream_conflict');

    const stopBySession = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/stop`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(stopBySession.status).toBe(202);
    await firstStream.text();
  });

  it('applies chat pagination defaults and bounds consistently', async () => {
    const { baseUrl } = startServer();
    const upstream = startOpenAICompatibleUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-key',
          type: 'api_key',
          value: 'sk-chat',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
        }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    const createMessage = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'hello from user',
        }),
      },
    );
    expect(createMessage.status).toBe(201);

    const listSessionsInvalid = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions?page=abc&page_size=xyz',
    );
    expect(listSessionsInvalid.status).toBe(200);
    const sessionsInvalidBody = (await listSessionsInvalid.json()) as { page: number; page_size: number };
    expect(sessionsInvalidBody.page).toBe(1);
    expect(sessionsInvalidBody.page_size).toBe(100);

    const listSessionsBounded = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions?page=0&page_size=9999',
    );
    expect(listSessionsBounded.status).toBe(200);
    const sessionsBoundedBody = (await listSessionsBounded.json()) as { page: number; page_size: number };
    expect(sessionsBoundedBody.page).toBe(1);
    expect(sessionsBoundedBody.page_size).toBe(500);

    const listMessagesInvalid = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages?page=abc&page_size=xyz`,
    );
    expect(listMessagesInvalid.status).toBe(200);
    const messagesInvalidBody = (await listMessagesInvalid.json()) as { page: number; page_size: number };
    expect(messagesInvalidBody.page).toBe(1);
    expect(messagesInvalidBody.page_size).toBe(200);

    const listMessagesBounded = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages?page=0&page_size=9999`,
    );
    expect(listMessagesBounded.status).toBe(200);
    const messagesBoundedBody = (await listMessagesBounded.json()) as { page: number; page_size: number };
    expect(messagesBoundedBody.page).toBe(1);
    expect(messagesBoundedBody.page_size).toBe(500);
  });

  it('supports user revision and assistant variants for chat branching', async () => {
    const { baseUrl } = startServer();
    const upstream = startOpenAICompatibleUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'branch-key', type: 'api_key', value: 'sk-branch' }),
      },
    );
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'branch-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    const endpoint = (await endpointRes.json()) as { id: string };

    const sessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat' }),
      },
    );
    const session = (await sessionRes.json()) as { id: string };

    const userMsgRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'draft question' }),
      },
    );
    expect(userMsgRes.status).toBe(201);
    const userMessage = (await userMsgRes.json()) as {
      id: string;
      logical_id?: string;
      revision_index?: number;
    };
    expect(userMessage.logical_id).toBeTruthy();
    expect(userMessage.revision_index).toBe(0);

    const revisedRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/${userMessage.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'revised question' }),
      },
    );
    expect(revisedRes.status).toBe(200);
    const revised = (await revisedRes.json()) as {
      id: string;
      logical_id?: string;
      revision_of?: string | null;
      revision_index?: number;
    };
    expect(revised.id).not.toBe(userMessage.id);
    expect(revised.logical_id).toBe(userMessage.logical_id);
    expect(revised.revision_of).toBe(userMessage.id);
    expect(revised.revision_index).toBe(1);

    const firstStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          from_message_id: revised.id,
        }),
      },
    );
    expect(firstStream.status).toBe(200);
    const firstSse = await firstStream.text();
    const firstDone = parseSseEventPayload(firstSse, 'done');
    expect(firstDone).toBeTruthy();
    const firstAssistantId = String(firstDone?.message_id ?? '');
    expect(firstAssistantId).toContain('chat_msg_');

    const secondStream = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          endpoint_id: endpoint.id,
          model: 'deepseek-chat',
          from_message_id: firstAssistantId,
        }),
      },
    );
    expect(secondStream.status).toBe(200);
    const secondSse = await secondStream.text();
    const secondDone = parseSseEventPayload(secondSse, 'done');
    const secondAssistantId = String(secondDone?.message_id ?? '');
    expect(secondAssistantId).toContain('chat_msg_');
    expect(secondAssistantId).not.toBe(firstAssistantId);

    const history = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
    );
    expect(history.status).toBe(200);
    const messages = (await history.json()) as {
      items: Array<{
        id: string;
        role: 'user' | 'assistant';
        parent_id?: string | null;
        revision_index?: number;
        variant_group_id?: string;
        variant_index?: number;
      }>;
    };

    const userRevisions = messages.items.filter((item) => item.role === 'user');
    expect(userRevisions.length).toBe(2);

    const assistantVariants = messages.items.filter((item) => item.role === 'assistant');
    expect(assistantVariants.length).toBe(2);
    expect(assistantVariants[0].parent_id).toBe(revised.id);
    expect(assistantVariants[1].parent_id).toBe(revised.id);
    expect(assistantVariants[0].variant_group_id).toBe(assistantVariants[1].variant_group_id);
    expect(assistantVariants[0].variant_index).toBe(0);
    expect(assistantVariants[1].variant_index).toBe(1);
  });

  it('supports paginated chat messages list', async () => {
    const { baseUrl } = startServer();
    const upstream = startOpenAICompatibleUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-key',
          type: 'api_key',
          value: 'sk-chat',
        }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-endpoint',
          openai_model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createSession = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat' }),
      },
    );
    expect(createSession.status).toBe(201);
    const session = (await createSession.json()) as { id: string };

    for (const content of ['m1', 'm2', 'm3']) {
      const created = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ role: 'user', content }),
        },
      );
      expect(created.status).toBe(201);
    }

    const page1 = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages?page=1&page_size=2`,
    );
    expect(page1.status).toBe(200);
    const page1Body = (await page1.json()) as {
      items: Array<{ content: string }>;
      total: number;
      page: number;
      page_size: number;
      has_more: boolean;
    };
    expect(page1Body.total).toBe(3);
    expect(page1Body.page).toBe(1);
    expect(page1Body.page_size).toBe(2);
    expect(page1Body.has_more).toBe(true);
    expect(page1Body.items.map((item) => item.content)).toEqual(['m1', 'm2']);

    const page2 = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages?page=2&page_size=2`,
    );
    expect(page2.status).toBe(200);
    const page2Body = (await page2.json()) as {
      items: Array<{ content: string }>;
      total: number;
      page: number;
      page_size: number;
      has_more: boolean;
    };
    expect(page2Body.total).toBe(3);
    expect(page2Body.page).toBe(2);
    expect(page2Body.page_size).toBe(2);
    expect(page2Body.has_more).toBe(false);
    expect(page2Body.items.map((item) => item.content)).toEqual(['m3']);
  });
});
