import { afterEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { WebSocket } from 'ws';
import { createDefaultNodeApiDeps, createNodeApiServer } from './index.js';
import { recordAuditEvent, recordUsageFact } from './audit-usage-store.js';

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

type ParsedDefaultSseBlock = {
  id: string | null;
  payload: Record<string, unknown> | null;
};

function parseDefaultSseBlocks(text: string): ParsedDefaultSseBlock[] {
  const blocks = text.split('\n\n').map((item) => item.trim()).filter(Boolean);
  const parsed: ParsedDefaultSseBlock[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const dataLine = lines.find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const idLine = lines.find((line) => line.startsWith('id:'));
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>;
    } catch {
      payload = null;
    }
    parsed.push({
      id: idLine ? idLine.slice('id:'.length).trim() : null,
      payload,
    });
  }
  return parsed;
}

async function readSseBlocks(
  response: Response,
  minBlocks: number,
  timeoutMs = 1_000,
): Promise<string> {
  const reader = response.body?.getReader();
  expect(reader).toBeTruthy();
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + timeoutMs;

  const countBlocks = (): number =>
    text
      .split('\n\n')
      .map((item) => item.trim())
      .filter(Boolean).length;

  while (countBlocks() < minBlocks) {
    const remaining = Math.max(1, deadline - Date.now());
    const result = await Promise.race([
      reader!.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`timed_out_waiting_for_sse_blocks_${minBlocks}`)), remaining),
      ),
    ]);
    if (result.done) break;
    text += decoder.decode(result.value, { stream: true });
  }

  await reader!.cancel();
  return text;
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

  it('lists attached source details for a notebook task', async () => {
    const { baseUrl } = startServer();

    const createSourceRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'notebook-input.txt',
          library_id: 'lib_a',
          content_type: 'text/plain',
          content_base64: Buffer.from('hello', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(createSourceRes.status).toBe(201);
    const createdSource = (await createSourceRes.json()) as { id: string; name: string };

    const createCredentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'attached-sources-test-key',
          type: 'api_key',
          value: 'sk-test',
        }),
      },
    );
    expect(createCredentialRes.status).toBe(201);
    const credential = (await createCredentialRes.json()) as { id: string };

    const createEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'attached-sources-endpoint',
          openai_model: 'gpt-5-codex',
          type: 'openai',
          mode: 'openai',
          base_url: 'http://upstream.invalid/v1',
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpointRes.status).toBe(201);
    const endpoint = (await createEndpointRes.json()) as { id: string };

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'notebook-agent-for-attached-sources',
          mode: 'external',
          interaction_mode: 'notebook',
          runtime_preferences: {
            notebook: {
              endpoint_id: endpoint.id,
              wire_api: 'chat',
              model: 'gpt-5-codex',
            },
          },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Task with source',
          agent_id: agent.id,
          initial_inputs: [{ kind: 'source', source_id: createdSource.id }],
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const attachedDetailsRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/inputs`,
    );
    expect(attachedDetailsRes.status).toBe(200);
    const attachedDetails = (await attachedDetailsRes.json()) as Array<{ id: string; source_id?: string; filename?: string }>;
    expect(attachedDetails).toHaveLength(1);
    expect(attachedDetails[0]?.source_id).toBe(createdSource.id);
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

  it('ensures a default personal source library idempotently', async () => {
    const { baseUrl } = startServer();

    const firstRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/default-personal',
    );
    expect(firstRes.status).toBe(200);
    const first = (await firstRes.json()) as {
      id: string;
      name: string;
      created_by_user_id: string;
      workspace_id: string;
      project_id: string;
      system_managed_kind?: string;
    };
    expect(first.name).toBe('My Uploads');
    expect(first.created_by_user_id).toBeTruthy();
    expect(first.workspace_id).toBe('ws_default');
    expect(first.project_id).toBe('proj_1');
    expect(first.system_managed_kind).toBe('default_personal_uploads');

    const secondRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/default-personal',
    );
    expect(secondRes.status).toBe(200);
    const second = (await secondRes.json()) as { id: string };
    expect(second.id).toBe(first.id);

    const listRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries');
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(listed.items.filter((item) => item.id === first.id)).toHaveLength(1);

    const createReservedRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'My Uploads', visibility: 'shared' }),
      },
    );
    expect(createReservedRes.status).toBe(409);

    const createManagedMarkerRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Anything',
          visibility: 'shared',
          system_managed_kind: 'default_personal_uploads',
        }),
      },
    );
    expect(createManagedMarkerRes.status).toBe(422);

    const patchDefaultRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${first.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: 'should fail' }),
      },
    );
    expect(patchDefaultRes.status).toBe(409);

    const deleteDefaultRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${first.id}`,
      { method: 'DELETE' },
    );
    expect(deleteDefaultRes.status).toBe(409);
  });

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
    expect(members.items[0]?.permissions).toContain('project:member:view');

    const joinRequestsRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/join-requests');
    expect(joinRequestsRes.status).toBe(200);
    const joinRequests = (await joinRequestsRes.json()) as { items: unknown[]; total: number };
    expect(joinRequests).toEqual({ items: [], total: 0 });

    const permissionTemplatesRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/permission-templates',
    );
    expect(permissionTemplatesRes.status).toBe(200);
    expect(await permissionTemplatesRes.json()).toEqual({ items: [] });

    const quotaTemplatesRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/quota-templates');
    expect(quotaTemplatesRes.status).toBe(200);
    expect(await quotaTemplatesRes.json()).toEqual([]);

    const groupsRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/groups');
    expect(groupsRes.status).toBe(200);
    expect(await groupsRes.json()).toEqual({ items: [] });

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
    expect(membership.permissions).toContain('project:member:view');
  });

  it('supports minimal project members governance write endpoints', async () => {
    const { baseUrl } = startServer();

    const createGroupRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/groups', {
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
    expect(createdGroup.project_id).toBe('proj_1');
    expect(createdGroup.name).toBe('Core Team');
    expect(createdGroup.member_ids).toEqual(['user_test']);

    const listGroupsAfterCreateRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/groups');
    expect(listGroupsAfterCreateRes.status).toBe(200);
    const groupsAfterCreate = (await listGroupsAfterCreateRes.json()) as { items: Array<{ id: string; name: string }> };
    expect(groupsAfterCreate.items.map((g) => g.id)).toContain(createdGroup.id);

    const patchGroupRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/groups/${createdGroup.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
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

    const applyTemplateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/groups/${createdGroup.id}/apply-template`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

    const missingApproveRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/join-requests/jr_missing/approve',
      { method: 'POST' },
    );
    expect(missingApproveRes.status).toBe(404);

    const missingRejectRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/join-requests/jr_missing/reject',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'nope' }),
      },
    );
    expect(missingRejectRes.status).toBe(404);

    const deleteGroupRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/groups/${createdGroup.id}`,
      { method: 'DELETE' },
    );
    expect(deleteGroupRes.status).toBe(204);

    const listGroupsAfterDeleteRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/groups');
    expect(listGroupsAfterDeleteRes.status).toBe(200);
    const groupsAfterDelete = (await listGroupsAfterDeleteRes.json()) as { items: Array<{ id: string }> };
    expect(groupsAfterDelete.items.map((g) => g.id)).not.toContain(createdGroup.id);
  });

  it('supports minimal permission template CRUD endpoints', async () => {
    const { baseUrl } = startServer();

    const listBeforeRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/permission-templates',
    );
    expect(listBeforeRes.status).toBe(200);
    expect(await listBeforeRes.json()).toEqual({ items: [] });

    const createRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/permission-templates',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Analyst',
          description: 'Read and operate',
          permissions: ['project:read', 'project:member:view'],
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
    expect(created.project_id).toBe('proj_1');
    expect(created.name).toBe('Analyst');
    expect(created.permissions).toContain('project:member:view');
    expect(created.built_in).toBe(false);

    const patchRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/permission-templates/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Analyst v2',
          permissions: ['project:read'],
        }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { name: string; permissions: string[] };
    expect(patched.name).toBe('Analyst v2');
    expect(patched.permissions).toEqual(['project:read']);

    const listAfterRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/permission-templates',
    );
    expect(listAfterRes.status).toBe(200);
    const listAfter = (await listAfterRes.json()) as { items: Array<{ id: string }> };
    expect(listAfter.items.map((i) => i.id)).toContain(created.id);

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/permission-templates/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);

    const listFinalRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/permission-templates',
    );
    expect(listFinalRes.status).toBe(200);
    const listFinal = (await listFinalRes.json()) as { items: Array<{ id: string }> };
    expect(listFinal.items.map((i) => i.id)).not.toContain(created.id);
  });

  it('supports minimal quota template CRUD endpoints', async () => {
    const { baseUrl } = startServer();

    const listBeforeRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/quota-templates',
    );
    expect(listBeforeRes.status).toBe(200);
    expect(await listBeforeRes.json()).toEqual([]);

    const createRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/quota-templates',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Starter quota',
          description: 'Base limits',
          overrides_json: {
            endpoint: { max_qpm: 20 },
            chat: { daily_tokens: 10000 },
          },
        }),
      },
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      id: string;
      project_id: string;
      name: string;
      overrides_json: Record<string, unknown>;
    };
    expect(created.project_id).toBe('proj_1');
    expect(created.name).toBe('Starter quota');

    const getRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/quota-templates/${created.id}`,
    );
    expect(getRes.status).toBe(200);
    const fetched = (await getRes.json()) as { id: string };
    expect(fetched.id).toBe(created.id);

    const patchRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/quota-templates/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Starter quota v2',
          overrides_json: { notebook: { max_runs_per_hour: 5 } },
        }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { name: string; overrides_json: Record<string, unknown> };
    expect(patched.name).toBe('Starter quota v2');
    expect(patched.overrides_json).toEqual({ notebook: { max_runs_per_hour: 5 } });

    const applyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/quota-templates/${created.id}/apply`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ member_ids: ['u1', 'u2'] }),
      },
    );
    expect(applyRes.status).toBe(200);
    expect(await applyRes.json()).toEqual({ applied_count: 2 });

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/quota-templates/${created.id}`,
      { method: 'DELETE' },
    );
    expect(deleteRes.status).toBe(204);

    const listFinalRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/quota-templates',
    );
    expect(listFinalRes.status).toBe(200);
    const listFinal = (await listFinalRes.json()) as Array<{ id: string }>;
    expect(listFinal.map((i) => i.id)).not.toContain(created.id);
  });

  it('supports member governance overrides, history, and resource policy endpoints', async () => {
    const { baseUrl } = startServer();

    const getPermsRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/permissions',
    );
    expect(getPermsRes.status).toBe(200);
    expect(await getPermsRes.json()).toEqual({
      platform_permissions: [],
      resource_permissions: undefined,
    });

    const patchPermsRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/permissions',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'custom',
          permissions: ['project:member:view', 'project:member:manage'],
        }),
      },
    );
    expect(patchPermsRes.status).toBe(204);

    const getPermsAfterRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/permissions',
    );
    expect(getPermsAfterRes.status).toBe(200);
    expect(await getPermsAfterRes.json()).toEqual({
      platform_permissions: ['project:member:view', 'project:member:manage'],
      resource_permissions: undefined,
    });

    const getQuotaBeforeRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/quota-overrides',
    );
    expect(getQuotaBeforeRes.status).toBe(200);
    expect(await getQuotaBeforeRes.json()).toEqual({ overrides: {} });

    const patchQuotaRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/quota-overrides',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          overrides: {
            endpoint: { daily_token_limit: 5000 },
            agent: { max_concurrency: 2 },
          },
        }),
      },
    );
    expect(patchQuotaRes.status).toBe(200);
    const quotaBody = (await patchQuotaRes.json()) as { overrides: Record<string, unknown> };
    expect(quotaBody.overrides).toMatchObject({
      endpoint: { daily_token_limit: 5000 },
      agent: { max_concurrency: 2 },
    });

    const quotaHistoryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/quota-overrides/history?page=1&page_size=10',
    );
    expect(quotaHistoryRes.status).toBe(200);
    const quotaHistory = (await quotaHistoryRes.json()) as {
      items: Array<{ overrides_json: Record<string, unknown> }>;
      total: number;
      page: number;
      page_size: number;
    };
    expect(quotaHistory.total).toBe(1);
    expect(quotaHistory.page).toBe(1);
    expect(quotaHistory.page_size).toBe(10);
    expect(quotaHistory.items[0]?.overrides_json).toMatchObject({
      endpoint: { daily_token_limit: 5000 },
    });

    const changeHistoryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/change-history',
    );
    expect(changeHistoryRes.status).toBe(200);
    const changeHistory = (await changeHistoryRes.json()) as {
      items: Array<{ change_type: string }>;
    };
    expect(changeHistory.items.map((i) => i.change_type)).toEqual(['quota', 'permissions']);

    const getPolicyRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
    );
    expect(getPolicyRes.status).toBe(200);
    expect(await getPolicyRes.json()).toEqual({
      resource_type: 'endpoint',
      resource_id: 'ep_test',
      access_mode: 'allow_all_members',
      allowed_subjects: [],
    });

    const patchPolicyRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [
            {
              subject_type: 'group',
              subject_id: 'grp_1',
              quota_limits: { rules: [{ key: 'endpoint.daily_token_limit', value: 1234 }] },
            },
          ],
          quota_limits: { rules: [{ key: 'endpoint.daily_token_limit', value: 9999 }] },
        }),
      },
    );
    expect(patchPolicyRes.status).toBe(204);

    const getPolicyAfterRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
    );
    expect(getPolicyAfterRes.status).toBe(200);
    const policy = (await getPolicyAfterRes.json()) as {
      access_mode: string;
      allowed_subjects: Array<{ subject_id: string; updated_at?: string }>;
      quota_limits?: unknown;
    };
    expect(policy.access_mode).toBe('allow_list');
    expect(policy.allowed_subjects[0]).toMatchObject({ subject_id: 'grp_1' });
    expect(policy.allowed_subjects[0]?.updated_at).toBeTruthy();
    expect(policy.quota_limits).toEqual({ rules: [{ key: 'endpoint.daily_token_limit', value: 9999 }] });
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

    const usageStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const usageEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const usageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(usageStart)}&end_time=${encodeURIComponent(usageEnd)}&resource_type=endpoint&page=1&page_size=50`,
    );
    expect(usageRes.status).toBe(200);
    const usageBody = (await usageRes.json()) as {
      items: Array<{ resource_type: string; resource_id?: string; requests: number }>;
    };
    expect(
      usageBody.items.some(
        (item) => item.resource_type === 'endpoint' && item.resource_id === endpoint.id && item.requests >= 1,
      ),
    ).toBe(true);

    const denyPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'user', subject_id: 'someone_else' }],
        }),
      },
    );
    expect(denyPolicyRes.status).toBe(204);

    const deniedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'blocked' }],
        }),
      },
    );
    expect(deniedProxy.status).toBe(403);
    expect(await deniedProxy.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_DENIED',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
    });
  });

  it('streams chat via external agent websocket runtime', async () => {
    const { baseUrl } = startServer();

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'echo-agent',
          mode: 'external',
          interaction_mode: 'chat',
          capabilities: { streaming_completion: true, multimodal_completion: true },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const keyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { key: string };
    expect(keyPayload.key).toBeTruthy();

    const connInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { ws_url: string };
    const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'));

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${keyPayload.key}` },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string; payload?: { messages?: unknown[] } };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      ws.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: 'echo:' },
      }));
      ws.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: ' hello' },
      }));
      ws.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 6 },
      }));
    });

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: agent.id, model: 'external-echo' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello' },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    const text = await streamRes.text();
    expect(text).toContain('event: delta');
    expect(text).toContain('echo:');
    expect(text).toContain('event: done');
    ws.close();
  });

  it('returns AGENT_OFFLINE when external agent session streams without active runtime socket', async () => {
    const { baseUrl } = startServer();

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'offline-agent',
          mode: 'external',
          interaction_mode: 'chat',
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: agent.id, model: 'external-echo' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const streamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { role: 'user', content: 'hello' },
        }),
      },
    );
    expect(streamRes.status).toBe(502);
    const body = (await streamRes.json()) as { error_code?: string; message?: string };
    expect(body.error_code).toBe('AGENT_OFFLINE');
    expect(body.message).toBe('agent_offline');
  });

  it('validates notebook endpoint for notebook-capable external agent', async () => {
    const { baseUrl } = startServer();

    const createWithoutEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'nb-agent-invalid',
          mode: 'external',
          interaction_mode: 'notebook',
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createWithoutEndpointRes.status).toBe(422);

    const createChatAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'nb-agent-patch',
          mode: 'external',
          interaction_mode: 'chat',
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createChatAgentRes.status).toBe(201);
    const created = (await createChatAgentRes.json()) as { id: string };

    const patchInvalidRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interaction_mode: 'both',
          runtime_preferences: {
            notebook: {},
          },
        }),
      },
    );
    expect(patchInvalidRes.status).toBe(422);
  });

  it('runs notebook task message through external runtime and enforces single active run per task', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'task-runner-key',
          type: 'api_key',
          value: 'sk-task',
        }),
      },
    );
    expect(createCredentialRes.status).toBe(201);
    const credential = (await createCredentialRes.json()) as { id: string };

    const createEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'task-endpoint',
          openai_model: 'gpt-5-codex',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpointRes.status).toBe(201);
    const endpoint = (await createEndpointRes.json()) as { id: string };

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'notebook-runner',
          mode: 'external',
          interaction_mode: 'notebook',
          runtime_preferences: {
            notebook: {
              endpoint_id: endpoint.id,
              wire_api: 'chat',
              model: 'gpt-5-codex',
            },
          },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const keyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(keyRes.status).toBe(201);
    const keyPayload = (await keyRes.json()) as { key: string };

    const connInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { ws_url: string };
    const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'));

    const runtimeReceived = new Promise<{
      requestId: string;
      endpointProxyBase: string;
      apiBase: string;
      userToken: string;
      notebookMode: boolean | null;
      taskInputsCount: number | null;
      close: () => void;
    }>((resolve) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyPayload.key}` },
      });

      ws.on('open', () => undefined);
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          request_id?: string;
          payload?: {
            runtime_context?: {
              endpoint_proxy_base?: string;
              api_base?: string;
              user_bearer_token?: string;
              notebook_mode?: boolean;
              task_inputs?: unknown[];
            };
          };
        };
        if (msg.type !== 'server.request.start' || !msg.request_id) return;
        resolve({
          requestId: msg.request_id,
          endpointProxyBase: msg.payload?.runtime_context?.endpoint_proxy_base ?? '',
          apiBase: msg.payload?.runtime_context?.api_base ?? '',
          userToken: msg.payload?.runtime_context?.user_bearer_token ?? '',
          notebookMode: typeof msg.payload?.runtime_context?.notebook_mode === 'boolean'
            ? msg.payload.runtime_context.notebook_mode
            : null,
          taskInputsCount: Array.isArray(msg.payload?.runtime_context?.task_inputs)
            ? msg.payload.runtime_context.task_inputs.length
            : null,
          close: () => ws.close(),
        });
        ws.send(JSON.stringify({
          type: 'agent.response.event',
          request_id: msg.request_id,
          payload: {
            sequence: 1,
            at: new Date().toISOString(),
            category: 'progress',
            phase: 'start',
            status: 'running',
            name: 'codex.exec',
            summary: 'Starting Codex execution',
          },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.delta',
          request_id: msg.request_id,
          payload: { delta: 'task-output' },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.artifact',
          request_id: msg.request_id,
          payload: {
            filename: 'plot.png',
            task_relative_path: 'artifacts/plot.png',
            artifact_type: 'image',
            mime_type: 'image/png',
            file_size: 1234,
            title: 'plot.png',
            content: 'data:image/png;base64,AAAA',
            thumbnail_url: 'data:image/png;base64,AAAA',
          },
        }));
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'agent.response.done',
            request_id: msg.request_id,
            payload: { finish_reason: 'stop', usage_tokens: 8 },
          }));
        }, 20);
      });
    });

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task',
          agent_id: agent.id,
        }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'run this',
        }),
      },
    );
    expect(postMessageRes.status).toBe(200);

    const conflictRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'user',
          content: 'second request',
        }),
      },
    );
    expect(conflictRes.status).toBe(409);

    const runtime = await runtimeReceived;
    expect(runtime.requestId).toBeTruthy();
    expect(runtime.userToken).toBe('test-token');
    expect(runtime.apiBase).toBe(baseUrl);
    expect(runtime.notebookMode).toBe(true);
    expect(runtime.taskInputsCount).toBe(0);
    expect(runtime.endpointProxyBase).toBe(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy`,
    );

    let messagesBody: Array<{ role: string; content: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const messagesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      );
      expect(messagesRes.status).toBe(200);
      messagesBody = (await messagesRes.json()) as Array<{ role: string; content: string }>;
      if (messagesBody.some((item) => item.role === 'agent' && item.content.includes('task-output'))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(messagesBody.some((item) => item.role === 'agent' && item.content.includes('task-output'))).toBe(true);

    let tracesBody: {
      items: Array<{ message_id: string; category: string; summary: string }>;
      total: number;
      has_more?: boolean;
      next_after_id?: string | null;
    } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`,
      );
      expect(tracesRes.status).toBe(200);
      tracesBody = (await tracesRes.json()) as {
        items: Array<{ message_id: string; category: string; summary: string }>;
        total: number;
        has_more?: boolean;
        next_after_id?: string | null;
      };
      if (tracesBody.items.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(tracesBody).not.toBeNull();
    expect(tracesBody!.items.length).toBeGreaterThan(0);
    expect(tracesBody!.items.some((item) => item.category === 'progress')).toBe(true);
    expect(typeof tracesBody!.has_more).toBe('boolean');
    if (tracesBody!.has_more) {
      expect(typeof tracesBody!.next_after_id === 'string' || tracesBody!.next_after_id === null).toBe(true);
    }

    let artifactsBody: Array<{ type: string; title?: string }> = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const artifactsRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts`,
      );
      expect(artifactsRes.status).toBe(200);
      artifactsBody = (await artifactsRes.json()) as Array<{ type: string; title?: string }>;
      if (artifactsBody.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(artifactsBody.some((item) => item.type === 'image' && item.title === 'plot.png')).toBe(true);

    const taskAfterRunRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
    );
    expect(taskAfterRunRes.status).toBe(200);
    const taskAfterRun = (await taskAfterRunRes.json()) as { status: string };
    expect(taskAfterRun.status).toBe('active');

    let secondTurnStatus = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const secondTurnRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'user',
            content: 'follow-up request',
          }),
        },
      );
      secondTurnStatus = secondTurnRes.status;
      if (secondTurnStatus === 200) {
        break;
      }
      expect(secondTurnStatus).toBe(409);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(secondTurnStatus).toBe(200);
    runtime.close();
  });

  it('deduplicates notebook task artifacts by task_relative_path across repeated runtime artifact frames', async () => {
    const { baseUrl } = startServer();

    const credentialRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'task-runner-key', type: 'api_key', value: 'sk-task' }),
    });
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };
    const endpointRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'task-endpoint',
        openai_model: 'gpt-5-codex',
        type: 'openai',
        mode: 'openai',
        base_url: 'https://example.com/v1',
        credential_ref: credential.id,
      }),
    });
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };
    const agentRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'NotebookAgent',
        mode: 'external',
        interaction_mode: 'notebook',
        runtime_preferences: {
          notebook: {
            endpoint_id: endpoint.id,
            model: 'gpt-5-codex',
            wire_api: 'responses',
          },
        },
        capabilities: { streaming_completion: true, multimodal_completion: false },
      }),
    });
    expect(agentRes.status).toBe(201);
    const agent = (await agentRes.json()) as { id: string };
    const keyRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'runner' }),
    });
    const keyResp = (await keyRes.json()) as { key: string };
    const connInfoRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`);
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { ws_url: string };
    const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'));

    const wsReady = new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyResp.key}` },
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
        if (msg.type !== 'server.request.start' || !msg.request_id) return;
        ws.send(JSON.stringify({
          type: 'agent.response.artifact',
          request_id: msg.request_id,
          payload: {
            filename: 'plot.png',
            task_relative_path: 'artifacts/plot.png',
            artifact_type: 'image',
            mime_type: 'image/png',
            file_size: 1234,
            title: 'plot.png',
            content: 'data:image/png;base64,AAAA',
            thumbnail_url: 'data:image/png;base64,AAAA',
          },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.artifact',
          request_id: msg.request_id,
          payload: {
            filename: 'plot.png',
            task_relative_path: 'artifacts/plot.png',
            artifact_type: 'image',
            mime_type: 'image/png',
            file_size: 1234,
            title: 'plot.png',
            content: 'data:image/png;base64,AAAA',
            thumbnail_url: 'data:image/png;base64,AAAA',
          },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.done',
          request_id: msg.request_id,
          payload: { finish_reason: 'stop' },
        }));
        setTimeout(() => {
          ws.close();
          resolve();
        }, 10);
      });
    });

    const createTaskRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'artifact-dedupe', agent_id: agent.id }),
    });
    const task = (await createTaskRes.json()) as { id: string };

    await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'run' }),
    });

    await wsReady;

    const artifactsRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts`, {
      headers: {},
    });
    expect(artifactsRes.status).toBe(200);
    const artifacts = (await artifactsRes.json()) as Array<{ title?: string; task_relative_path?: string }>;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.title).toBe('plot.png');
    expect(artifacts[0]?.task_relative_path).toBe('artifacts/plot.png');
  });

  it('downloads notebook task artifact content in local backend when inline content is available', async () => {
    const { baseUrl } = startServer();

    const credentialRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'task-runner-key', type: 'api_key', value: 'sk-task' }),
    });
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };
    const endpointRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/endpoints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'task-endpoint',
        openai_model: 'gpt-5-codex',
        type: 'openai',
        mode: 'openai',
        base_url: 'https://example.com/v1',
        credential_ref: credential.id,
      }),
    });
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };
    const agentRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'NotebookAgent',
        mode: 'external',
        interaction_mode: 'notebook',
        runtime_preferences: {
          notebook: {
            endpoint_id: endpoint.id,
            model: 'gpt-5-codex',
            wire_api: 'responses',
          },
        },
        capabilities: { streaming_completion: true, multimodal_completion: false },
      }),
    });
    expect(agentRes.status).toBe(201);
    const agent = (await agentRes.json()) as { id: string };
    const keyRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'runner' }),
    });
    const keyResp = (await keyRes.json()) as { key: string };
    const connInfoRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`);
    expect(connInfoRes.status).toBe(200);
    const connInfo = (await connInfoRes.json()) as { ws_url: string };
    const wsUrl = connInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://'));

    const wsReady = new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyResp.key}` },
      });
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as { type?: string; request_id?: string };
        if (msg.type !== 'server.request.start' || !msg.request_id) return;
        ws.send(JSON.stringify({
          type: 'agent.response.artifact',
          request_id: msg.request_id,
          payload: {
            filename: 'hello.txt',
            task_relative_path: 'artifacts/hello.txt',
            artifact_type: 'text',
            mime_type: 'text/plain',
            file_size: 6,
            title: 'hello.txt',
            content: 'hello\n',
          },
        }));
        ws.send(JSON.stringify({
          type: 'agent.response.done',
          request_id: msg.request_id,
          payload: { finish_reason: 'stop' },
        }));
        setTimeout(() => {
          ws.close();
          resolve();
        }, 10);
      });
    });

    const createTaskRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'artifact-download', agent_id: agent.id }),
    });
    const task = (await createTaskRes.json()) as { id: string };

    await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: 'run' }),
    });
    await wsReady;

    const artifactsRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts`);
    expect(artifactsRes.status).toBe(200);
    const artifacts = (await artifactsRes.json()) as Array<{ id: string; title?: string }>;
    expect(artifacts).toHaveLength(1);
    const artifactId = artifacts[0]!.id;

    const downloadRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/artifacts/${artifactId}/download`,
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-type')).toContain('text/plain');
    expect(downloadRes.headers.get('content-disposition')).toContain('hello.txt');
    await expect(downloadRes.text()).resolves.toBe('hello\n');
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

  it('replays buffered task events after last_event_id for notebook task SSE', async () => {
    const { baseUrl } = startServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'openai_compatible',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          openai_model: 'glm-4.7',
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          runtime_preferences: {
            notebook: {
              endpoint_id: endpoint.id,
              wire_api: 'responses',
              model: 'glm-4.7',
            },
          },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const runtimeInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(runtimeInfoRes.status).toBe(200);
    const runtimeInfo = (await runtimeInfoRes.json()) as { ws_url: string };

    const runtime = new WebSocket(
      runtimeInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );

    const runtimeReady = new Promise<void>((resolve) => {
      runtime.on('open', () => {
        runtime.send(
          JSON.stringify({
            type: 'agent.ready',
            payload: {
              capabilities: { mode: 'external', wire_api: 'responses' },
            },
          }),
        );
        resolve();
      });
    });

    runtime.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      runtime.send(
        JSON.stringify({
          type: 'agent.response.event',
          request_id: msg.request_id,
          payload: {
            sequence: 1,
            at: new Date().toISOString(),
            category: 'progress',
            phase: 'start',
            status: 'running',
            name: 'codex.exec',
            summary: 'Starting Codex execution',
          },
        }),
      );
      runtime.send(
        JSON.stringify({
          type: 'agent.response.event',
          request_id: msg.request_id,
          payload: {
            sequence: 2,
            at: new Date().toISOString(),
            category: 'progress',
            phase: 'end',
            status: 'success',
            name: 'codex.exec',
            summary: 'Codex execution finished',
          },
        }),
      );
      runtime.send(
        JSON.stringify({
          type: 'agent.response.done',
          request_id: msg.request_id,
          payload: { finish_reason: 'stop', usage_tokens: 5 },
        }),
      );
    });

    await runtimeReady;

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Replay task', agent_id: agent.id }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'user', content: 'run' }),
      },
    );
    expect(postMessageRes.status).toBe(200);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`,
      );
      expect(tracesRes.status).toBe(200);
      const tracesBody = (await tracesRes.json()) as { items: Array<{ id: string }> };
      if (tracesBody.items.length >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const replayAllRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/events?last_event_id=missing`,
    );
    expect(replayAllRes.status).toBe(200);
    expect(replayAllRes.headers.get('content-type')).toContain('text/event-stream');
    const replayAllText = await readSseBlocks(replayAllRes, 4);
    const replayAllBlocks = parseDefaultSseBlocks(replayAllText).filter(
      (item) => item.payload && item.payload.type !== 'ping',
    );
    expect(replayAllBlocks.length).toBeGreaterThan(1);
    expect(replayAllBlocks.every((item) => typeof item.id === 'string' && item.id?.startsWith(`${task.id}:`))).toBe(true);
    expect(replayAllBlocks.some((item) => item.payload?.type === 'trace_event')).toBe(true);

    const firstReplayId = replayAllBlocks[0]?.id;
    expect(firstReplayId).toBeTruthy();
    const replayAfterFirstRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/events?last_event_id=${encodeURIComponent(firstReplayId!)}`,
    );
    expect(replayAfterFirstRes.status).toBe(200);
    const replayAfterFirstText = await readSseBlocks(replayAfterFirstRes, 1);
    const replayAfterFirstBlocks = parseDefaultSseBlocks(replayAfterFirstText).filter(
      (item) => item.payload && item.payload.type !== 'ping',
    );
    expect(replayAfterFirstBlocks.length).toBeGreaterThan(0);
    expect(replayAfterFirstBlocks.some((item) => item.id === firstReplayId)).toBe(false);

    runtime.close();
  });

  it('exposes authenticated notebook runtime metrics snapshot', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/internal/notebook-runtime-metrics');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      task_runs_started: number;
      task_runs_completed: number;
      task_runs_failed: number;
      trace_events_recorded: number;
      active_runs: number;
      task_sse_clients: number;
      in_memory: { tasks: number; messages: number; traces: number };
      limits: { max_trace_events_per_task: number; max_trace_details_bytes: number };
    };

    expect(typeof body.task_runs_started).toBe('number');
    expect(typeof body.task_runs_completed).toBe('number');
    expect(typeof body.task_runs_failed).toBe('number');
    expect(typeof body.trace_events_recorded).toBe('number');
    expect(typeof body.active_runs).toBe('number');
    expect(typeof body.task_sse_clients).toBe('number');
    expect(typeof body.in_memory.tasks).toBe('number');
    expect(typeof body.in_memory.messages).toBe('number');
    expect(typeof body.in_memory.traces).toBe('number');
    expect(body.limits.max_trace_events_per_task).toBeGreaterThan(0);
    expect(body.limits.max_trace_details_bytes).toBeGreaterThan(0);
  });

  it('exposes authenticated notebook runtime metrics in prometheus text format', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/internal/notebook-runtime-metrics/prometheus');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('# HELP notebook_task_runs_started_total');
    expect(text).toContain('# TYPE notebook_task_runs_started_total counter');
    expect(text).toContain('notebook_task_runs_started_total ');
    expect(text).toContain('notebook_active_runs ');
    expect(text).toContain('notebook_limit_trace_events_per_task ');
    expect(text).toContain('notebook_task_traces_query_duration_ms_bucket{scope="task",le="10"} ');
  });

  it('records task trace query metrics for message-scoped requests', async () => {
    const { baseUrl } = startServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'glm-key', type: 'api_key', value: 'sk-glm-test' }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'openai_compatible',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          openai_model: 'glm-4.7',
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgentRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Metrics notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          runtime_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgentRes.status).toBe(201);
    const agent = (await createAgentRes.json()) as { id: string };

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Trace metrics task', agent_id: agent.id }),
      },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const tracesRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces?message_id=msg_missing&page_size=50`,
    );
    expect(tracesRes.status).toBe(200);

    const metricsRes = await apiFetch(baseUrl, '/api/v1/internal/notebook-runtime-metrics');
    expect(metricsRes.status).toBe(200);
    const metrics = (await metricsRes.json()) as {
      task_traces_queries_total: number;
      task_traces_queries_message_scoped_total: number;
      trace_query_latency_by_scope?: Record<string, { count?: number }>;
    };
    expect(metrics.task_traces_queries_total).toBeGreaterThan(0);
    expect(metrics.task_traces_queries_message_scoped_total).toBeGreaterThan(0);
    expect(metrics.trace_query_latency_by_scope?.message?.count ?? 0).toBeGreaterThan(0);
  });

  it('truncates oversized notebook trace details payloads', async () => {
    const { baseUrl } = startServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'glm-key', type: 'api_key', value: 'sk-glm-test' }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'openai_compatible',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          openai_model: 'glm-4.7',
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          runtime_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const runtimeInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(runtimeInfoRes.status).toBe(200);
    const runtimeInfo = (await runtimeInfoRes.json()) as { ws_url: string };

    const runtime = new WebSocket(
      runtimeInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );

    const huge = 'x'.repeat(40_000);
    runtime.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      runtime.send(JSON.stringify({
        type: 'agent.response.event',
        request_id: msg.request_id,
        payload: {
          sequence: 1,
          at: new Date().toISOString(),
          category: 'debug',
          phase: 'update',
          name: 'runner.debug',
          summary: 'huge details payload',
          details: { stderr: huge },
        },
      }));
      runtime.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });
    await new Promise<void>((resolve) => runtime.on('open', () => {
      runtime.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
      resolve();
    }));

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Truncate trace details', agent_id: agent.id }) },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'run' }) },
    );
    expect(postMessageRes.status).toBe(200);

    let tracesBody: { items: Array<{ details?: Record<string, unknown> }> } | null = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const tracesRes = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`);
      expect(tracesRes.status).toBe(200);
      tracesBody = (await tracesRes.json()) as { items: Array<{ details?: Record<string, unknown> }> };
      if (tracesBody.items.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(tracesBody).not.toBeNull();
    const detailEvent = tracesBody!.items.find((item) => item.details && Object.keys(item.details).length > 0);
    expect(detailEvent).toBeTruthy();
    expect(detailEvent!.details?._truncated).toBe(true);
    expect(detailEvent!.details?._reason).toBe('trace_details_too_large');
    expect(typeof detailEvent!.details?._preview).toBe('string');

    runtime.close();
  });

  it('writes notebook task data to docStore (tasks/messages/traces)', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'glm-key', type: 'api_key', value: 'sk-glm-test' }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'openai_compatible',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          openai_model: 'glm-4.7',
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          runtime_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const runtimeInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(runtimeInfoRes.status).toBe(200);
    const runtimeInfo = (await runtimeInfoRes.json()) as { ws_url: string };

    const runtime = new WebSocket(
      runtimeInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );
    runtime.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      runtime.send(JSON.stringify({
        type: 'agent.response.event',
        request_id: msg.request_id,
        payload: {
          sequence: 1,
          at: new Date().toISOString(),
          category: 'progress',
          phase: 'start',
          status: 'running',
          name: 'codex.exec',
          summary: 'Starting Codex execution',
        },
      }));
      runtime.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: 'persisted-output' },
      }));
      runtime.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 3 },
      }));
    });
    await new Promise<void>((resolve) => runtime.on('open', () => {
      runtime.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
      resolve();
    }));

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Persist notebook docs', agent_id: agent.id }) },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'run' }) },
    );
    expect(postMessageRes.status).toBe(200);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const traces = await deps.docStore.list<{ task_id: string }>('notebook_task_trace_events', { task_id: task.id });
      const msgs = await deps.docStore.list<{ task_id: string; role: string; content: string }>('notebook_task_messages', { task_id: task.id });
      if (traces.length > 0 && msgs.some((m) => m.role === 'agent' && m.content.includes('persisted-output'))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const storedTasks = await deps.docStore.list<{ id: string }>('notebook_tasks', {});
    const storedMessages = await deps.docStore.list<{ task_id: string; role: string; content: string }>('notebook_task_messages', { task_id: task.id });
    const storedTraces = await deps.docStore.list<{ task_id: string; category: string }>('notebook_task_trace_events', { task_id: task.id });

    expect(storedTasks.some((t) => t.id === task.id)).toBe(true);
    expect(storedMessages.some((m) => m.role === 'user')).toBe(true);
    expect(storedMessages.some((m) => m.role === 'agent' && m.content.includes('persisted-output'))).toBe(true);
    expect(storedTraces.some((t) => t.category === 'progress')).toBe(true);

    runtime.close();
  });

  it('keeps docStore traces bounded when retention truncation is triggered', async () => {
    const deps = createDefaultNodeApiDeps();
    const { baseUrl } = startServerWithDeps(deps);

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'glm-key', type: 'api_key', value: 'sk-glm-test' }),
      },
    );
    expect(createCredential.status).toBe(201);
    const credential = (await createCredential.json()) as { id: string };

    const createEndpoint = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'glm-coding',
          type: 'openai_compatible',
          status: 'active',
          wire_api: 'responses',
          base_url: 'https://example.com',
          openai_model: 'glm-4.7',
          credential_ref: credential.id,
        }),
      },
    );
    expect(createEndpoint.status).toBe(201);
    const endpoint = (await createEndpoint.json()) as { id: string };

    const createAgent = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'External notebook agent',
          mode: 'external',
          interaction_mode: 'notebook',
          runtime_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
          capabilities: { streaming_completion: true, multimodal_completion: false },
        }),
      },
    );
    expect(createAgent.status).toBe(201);
    const agent = (await createAgent.json()) as { id: string };

    const createAgentKeyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/keys`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    );
    expect(createAgentKeyRes.status).toBe(201);
    const agentKey = (await createAgentKeyRes.json()) as { key: string };

    const runtimeInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(runtimeInfoRes.status).toBe(200);
    const runtimeInfo = (await runtimeInfoRes.json()) as { ws_url: string };

    const runtime = new WebSocket(
      runtimeInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );
    runtime.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      for (let i = 0; i < 1010; i += 1) {
        runtime.send(JSON.stringify({
          type: 'agent.response.event',
          request_id: msg.request_id,
          payload: {
            sequence: i + 1,
            at: new Date(Date.now() + i).toISOString(),
            category: 'debug',
            phase: 'update',
            name: 'runner.debug',
            summary: `evt-${i}`,
          },
        }));
      }
      runtime.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });
    await new Promise<void>((resolve) => runtime.on('open', () => {
      runtime.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
      resolve();
    }));

    const createTaskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Trace retention bound', agent_id: agent.id }) },
    );
    expect(createTaskRes.status).toBe(201);
    const task = (await createTaskRes.json()) as { id: string };

    const postMessageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'user', content: 'run' }) },
    );
    expect(postMessageRes.status).toBe(200);

    let storedTraces: Array<{ task_id: string; summary: string; name: string }> = [];
    for (let attempt = 0; attempt < 60; attempt += 1) {
      storedTraces = await deps.docStore.list<{ task_id: string; summary: string; name: string }>(
        'notebook_task_trace_events',
        { task_id: task.id },
      );
      if (storedTraces.some((t) => t.name === 'trace.buffer')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(storedTraces.length).toBeLessThanOrEqual(1000);
    expect(storedTraces.some((t) => t.name === 'trace.buffer')).toBe(true);
    expect(storedTraces.some((t) => t.summary === 'evt-0')).toBe(false);
    expect(storedTraces.some((t) => t.summary === 'evt-1009')).toBe(true);

    runtime.close();
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

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Chat Inputs' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const library = (await createLibraryRes.json()) as { id: string };

    const imageForm = buildMultipartBody(
      [{ name: 'prefix', value: 'chat/' }],
      {
        fieldName: 'file',
        filename: 'cat.png',
        contentType: 'image/png',
        content: new Uint8Array([1, 2, 3, 4]),
      },
    );
    const uploadImageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/upload`,
      {
        method: 'POST',
        headers: { 'content-type': imageForm.contentType },
        body: Buffer.from(imageForm.body),
      },
    );
    expect(uploadImageRes.status).toBe(201);
    const uploadedImage = (await uploadImageRes.json()) as { key: string };

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
          input_ref: {
            kind: 'library_object',
            library_id: library.id,
            key: uploadedImage.key,
          },
        }),
      },
    );
    expect(initAttachment.status).toBe(200);
    const attachmentBody = (await initAttachment.json()) as {
      attachment: {
        id: string;
        source_library_id?: string;
        source_object_key?: string;
        input_ref?: { kind?: 'library_object' | 'url'; library_id?: string; key?: string };
      };
    };
    const imageInputRef =
      attachmentBody.attachment.input_ref &&
      attachmentBody.attachment.input_ref.kind === 'library_object' &&
      attachmentBody.attachment.input_ref.library_id &&
      attachmentBody.attachment.input_ref.key
        ? {
            kind: 'library_object' as const,
            library_id: attachmentBody.attachment.input_ref.library_id,
            key: attachmentBody.attachment.input_ref.key,
          }
        : attachmentBody.attachment.source_library_id && attachmentBody.attachment.source_object_key
          ? {
              kind: 'library_object' as const,
              library_id: attachmentBody.attachment.source_library_id,
              key: attachmentBody.attachment.source_object_key,
            }
          : undefined;
    expect(imageInputRef).toBeTruthy();

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
            inputs: [imageInputRef],
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

  it('treats octet-stream webp attachments as image in preview and upstream payload', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'vision-key-infer',
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
          name: 'vision-endpoint-infer',
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
          file_name: 'cat.webp',
          file_type: 'application/octet-stream',
          file_size: 4,
          content_base64: 'AQIDBA==',
        }),
      },
    );
    expect(initAttachment.status).toBe(200);
    const attachmentBody = (await initAttachment.json()) as {
      attachment: { id: string; preview_url?: string };
    };
    expect(attachmentBody.attachment.preview_url?.startsWith('data:image/webp;base64,')).toBe(true);

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
    expect((imagePart?.image_url as { url?: string } | undefined)?.url?.startsWith('data:image/webp;base64,')).toBe(
      true,
    );
  });

  it('stores and returns chat attachment input_ref for library objects', async () => {
    const { baseUrl } = startServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-inputref-key',
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
          name: 'chat-inputref-endpoint',
          openai_model: 'gpt-4o-mini',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://api.example.com/v1',
          credential_ref: credential.id,
          provider_family: 'openai',
          protocol: 'openai_compatible',
          capabilities: [{ type: 'text_completion', enabled: true, default_model_id: 'gpt-4o-mini' }],
          models: [{ capability: 'text_completion', model_id: 'gpt-4o-mini' }],
          defaults: { text_model_id: 'gpt-4o-mini' },
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
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'gpt-4o-mini' }),
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
          file_name: 'doc.txt',
          file_type: 'text/plain',
          file_size: 3,
          content_base64: 'YWJj',
          input_ref: {
            kind: 'library_object',
            library_id: 'lib_123',
            key: 'chat/s1/uploads/doc.txt',
            name: 'doc.txt',
            content_type: 'text/plain',
            size_bytes: 3,
          },
        }),
      },
    );
    expect(initAttachment.status).toBe(200);
    const body = (await initAttachment.json()) as {
      attachment: {
        input_ref?: { kind?: string; library_id?: string; key?: string };
        source_type?: string;
        source_library_id?: string;
        source_object_key?: string;
      };
    };
    expect(body.attachment.input_ref).toMatchObject({
      kind: 'library_object',
      library_id: 'lib_123',
      key: 'chat/s1/uploads/doc.txt',
    });
    expect(body.attachment.source_type).toBe('library_import');
    expect(body.attachment.source_library_id).toBe('lib_123');
    expect(body.attachment.source_object_key).toBe('chat/s1/uploads/doc.txt');

    const auditStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const auditEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(auditStart)}&end_time=${encodeURIComponent(auditEnd)}&action=chat.attachment.created&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string }>;
    };
    expect(
      auditBody.items.some(
        (item) => item.action === 'chat.attachment.created' && item.resource_type === 'chat_attachment',
      ),
    ).toBe(true);
  });

  it('normalizes chat attachment metadata from library object input refs', async () => {
    const { baseUrl } = startServer();

    const createLibrary = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'chat-attach-meta-lib' }),
      },
    );
    expect(createLibrary.status).toBe(201);
    const library = (await createLibrary.json()) as { id: string };

    const form = buildMultipartBody(
      [{ name: 'prefix', value: 'chat/s1/uploads/' }],
      {
        fieldName: 'file',
        filename: 'real-name.txt',
        contentType: 'text/plain',
        content: new TextEncoder().encode('hello'),
      },
    );
    const uploadObject = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects/upload`,
      {
        method: 'POST',
        headers: { 'content-type': form.contentType },
        body: Buffer.from(form.body),
      },
    );
    expect(uploadObject.status).toBe(201);

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-inputref-meta-key',
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
          name: 'chat-inputref-meta-endpoint',
          openai_model: 'gpt-4o-mini',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://api.example.com/v1',
          credential_ref: credential.id,
          provider_family: 'openai',
          protocol: 'openai_compatible',
          capabilities: [{ type: 'text_completion', enabled: true, default_model_id: 'gpt-4o-mini' }],
          models: [{ capability: 'text_completion', model_id: 'gpt-4o-mini' }],
          defaults: { text_model_id: 'gpt-4o-mini' },
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
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'gpt-4o-mini' }),
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
          file_name: 'wrong.txt',
          file_type: 'application/octet-stream',
          file_size: 999,
          input_ref: {
            kind: 'library_object',
            library_id: library.id,
            key: 'chat/s1/uploads/real-name.txt',
          },
        }),
      },
    );
    expect(initAttachment.status).toBe(200);
    const body = (await initAttachment.json()) as {
      attachment: { file_name: string; file_type: string; file_size: number };
    };
    expect(body.attachment.file_name).toBe('real-name.txt');
    expect(body.attachment.file_type).toBe('text/plain');
    expect(body.attachment.file_size).toBe(5);
  });

  it('rejects attachment stream when endpoint is not multimodal', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

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
          name: 'chat-only-endpoint',
          openai_model: 'gpt-4o-mini',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'openai',
          protocol: 'openai_compatible',
          capabilities: [{ type: 'chat_completion', enabled: true, default_model_id: 'gpt-4o-mini' }],
          models: [{ capability: 'chat_completion', model_id: 'gpt-4o-mini' }],
          defaults: { chat_model_id: 'gpt-4o-mini' },
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
          model: 'gpt-4o-mini',
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
    expect(streamRes.status).toBe(422);
    const body = (await streamRes.json()) as { message?: string };
    expect(body.message).toBe('chat_endpoint_not_multimodal');
    expect(upstream.lastBody()).toBeNull();
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

  it('serves aggregated usage and usage kpi endpoints from persisted usage facts', async () => {
    const deps = createDefaultNodeApiDeps();
    await recordUsageFact(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      resource_type: 'notebook_task',
      resource_id: 'task_1',
      requests: 1,
      duration_ms: 1200,
      tokens_total: 42,
      result: 'ok',
      request_id: 'req_usage_1',
      timestamp: new Date().toISOString(),
    });
    await recordUsageFact(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      resource_type: 'chat',
      resource_id: 'sess_1',
      requests: 1,
      duration_ms: 800,
      tokens_total: 12,
      result: 'error',
      error_code: 'UPSTREAM_ERROR',
      request_id: 'req_usage_2',
      timestamp: new Date().toISOString(),
    });
    const { baseUrl } = startServerWithDeps(deps);
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const kpiRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage/kpi?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}`,
    );
    expect(kpiRes.status).toBe(200);
    const kpi = (await kpiRes.json()) as {
      requests_today: number;
      errors_today: number;
      tokens_today: number;
    };
    expect(typeof kpi.requests_today).toBe('number');
    expect(typeof kpi.errors_today).toBe('number');
    expect(kpi.requests_today).toBeGreaterThanOrEqual(2);
    expect(kpi.errors_today).toBeGreaterThanOrEqual(1);
    expect(kpi.tokens_today).toBeGreaterThanOrEqual(54);

    const usageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=25`,
    );
    expect(usageRes.status).toBe(200);
    const usage = (await usageRes.json()) as {
      items: Array<{ workspace_id: string; project_id: string; resource_type: string }>;
      total: number;
      page: number;
      page_size: number;
      has_more: boolean;
    };
    expect(Array.isArray(usage.items)).toBe(true);
    expect(usage.page).toBe(1);
    expect(usage.page_size).toBe(25);
    expect(usage.items.some((item) => item.resource_type === 'notebook_task')).toBe(true);
    expect(usage.items.some((item) => item.resource_type === 'chat')).toBe(true);
  });

  it('serves audit endpoint with persisted events and supports filtering', async () => {
    const deps = createDefaultNodeApiDeps();
    await recordAuditEvent(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      actor_type: 'user',
      actor_id: 'user_test',
      action: 'notebook.task.created',
      result: 'ok',
      request_id: 'req_audit_1',
      resource_type: 'notebook_task',
      resource_id: 'task_1',
      metadata_json: { title: 'Task 1' },
      timestamp: new Date().toISOString(),
    });
    await recordAuditEvent(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      actor_type: 'agent',
      actor_id: 'ag_1',
      action: 'notebook.task.run.failed',
      result: 'error',
      error_code: 'AGENT_TIMEOUT',
      error_message: 'timeout',
      request_id: 'req_audit_2',
      resource_type: 'notebook_task',
      resource_id: 'task_1',
      metadata_json: { duration_ms: 1000 },
      timestamp: new Date().toISOString(),
    });
    const { baseUrl } = startServerWithDeps(deps);
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=10`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ action: string; result: string; actor_type: string }>;
      total: number;
      page: number;
      page_size: number;
      has_more: boolean;
    };
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.page_size).toBe(10);
    expect(body.has_more).toBe(false);
    expect(body.items.some((item) => item.action === 'notebook.task.created')).toBe(true);

    const filtered = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&result=error&page=1&page_size=10`,
    );
    expect(filtered.status).toBe(200);
    const filteredBody = (await filtered.json()) as { total: number; items: Array<{ result: string; action: string }> };
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.items[0]?.action).toBe('notebook.task.run.failed');
    expect(filteredBody.items[0]?.result).toBe('error');
  });
});
