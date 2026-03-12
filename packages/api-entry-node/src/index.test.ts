import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createDefaultNodeApiDeps, createNodeApiServer } from './index.js';
import { recordAuditEvent, recordUsageFact } from './audit-usage-store.js';
import type { GovernanceRunnerController } from './governance-runner.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';

const servers: Server[] = [];
const originalKeycloakIssuer = process.env.KEYCLOAK_ISSUER_URL;
const originalFeishuAppId = process.env.FEISHU_APP_ID;
const originalFeishuAppSecret = process.env.FEISHU_APP_SECRET;
const originalFeishuRedirectUri = process.env.FEISHU_OAUTH_REDIRECT_URI;
const originalFeishuAuthorizeUrl = process.env.FEISHU_OAUTH_AUTHORIZE_URL;
const originalFeishuTokenUrl = process.env.FEISHU_OAUTH_TOKEN_URL;

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
  if (originalFeishuAppId === undefined) delete process.env.FEISHU_APP_ID;
  else process.env.FEISHU_APP_ID = originalFeishuAppId;
  if (originalFeishuAppSecret === undefined) delete process.env.FEISHU_APP_SECRET;
  else process.env.FEISHU_APP_SECRET = originalFeishuAppSecret;
  if (originalFeishuRedirectUri === undefined) delete process.env.FEISHU_OAUTH_REDIRECT_URI;
  else process.env.FEISHU_OAUTH_REDIRECT_URI = originalFeishuRedirectUri;
  if (originalFeishuAuthorizeUrl === undefined) delete process.env.FEISHU_OAUTH_AUTHORIZE_URL;
  else process.env.FEISHU_OAUTH_AUTHORIZE_URL = originalFeishuAuthorizeUrl;
  if (originalFeishuTokenUrl === undefined) delete process.env.FEISHU_OAUTH_TOKEN_URL;
  else process.env.FEISHU_OAUTH_TOKEN_URL = originalFeishuTokenUrl;
});

function startMockKeycloakServer(): { server: Server; issuerUrl: string } {
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? '';
    let sub = 'user_test';
    let email = 'test@example.com';
    let username = 'test-user';
    let name = 'Test User';
    if (auth === 'Bearer owner-token') {
      sub = 'user_owner';
      email = 'owner@example.com';
      username = 'owner-user';
      name = 'Owner User';
    } else if (auth === 'Bearer alt-token') {
      sub = 'user_alt';
      email = 'alt@example.com';
      username = 'alt-user';
      name = 'Alt User';
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        sub,
        email,
        preferred_username: username,
        name,
      }),
    );
  });
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return { server, issuerUrl: `http://127.0.0.1:${address.port}` };
}

function startMockFeishuOAuthServer(): { server: Server; authorizeUrl: string; tokenUrl: string } {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/open-apis/authen/v2/oauth/token') {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
      const grantType = body.grant_type;
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      if (grantType === 'authorization_code') {
        res.end(JSON.stringify({
          code: 0,
          data: {
            access_token: 'feishu-access-1',
            refresh_token: 'feishu-refresh-1',
            expires_in: 3600,
            scope: 'offline_access docs:read',
            union_id: 'union_1',
          },
        }));
        return;
      }
      if (grantType === 'refresh_token') {
        res.end(JSON.stringify({
          code: 0,
          data: {
            access_token: 'feishu-access-2',
            refresh_token: 'feishu-refresh-2',
            expires_in: 7200,
            scope: 'offline_access docs:read',
            union_id: 'union_1',
          },
        }));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ code: 9999, msg: 'unsupported_grant_type' }));
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  server.listen(0);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return {
    server,
    authorizeUrl: `http://127.0.0.1:${address.port}/open-apis/authen/v1/authorize`,
    tokenUrl: `http://127.0.0.1:${address.port}/open-apis/authen/v2/oauth/token`,
  };
}

function startServer(): { server: Server; baseUrl: string; deps: ReturnType<typeof createDefaultNodeApiDeps> } {
  const keycloak = startMockKeycloakServer();
  process.env.KEYCLOAK_ISSUER_URL = keycloak.issuerUrl;
  const deps = createDefaultNodeApiDeps();
  const server = createNodeApiServer(0, deps);
  servers.push(server);

  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, deps };
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
  return apiFetchWithToken(baseUrl, path, 'test-token', init);
}

function apiFetchWithToken(baseUrl: string, path: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
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

function startProtocolBridgeUpstreamServer(): {
  server: Server;
  baseUrl: string;
  lastBody: () => unknown;
  lastPath: () => string;
  lastHeaders: () => http.IncomingHttpHeaders;
} {
  let body: unknown = null;
  let path = '';
  let headers: http.IncomingHttpHeaders = {};
  const server = http.createServer((req, res) => {
    void (async () => {
      path = req.url ?? '';
      headers = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const text = Buffer.concat(chunks).toString('utf-8');
      body = text ? JSON.parse(text) : {};

      if (req.url?.includes('/messages')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg_bridge_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'Hello from anthropic upstream.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 4, output_tokens: 6 },
          }),
        );
        return;
      }

      if (req.url?.includes('/chat/completions')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'chatcmpl_bridge_1',
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Hello from openai upstream.' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          }),
        );
        return;
      }

      if (req.url?.includes('/responses')) {
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'resp_bridge_1',
            object: 'response',
            status: 'completed',
            model: 'gpt-4o-mini',
            output: [
              {
                id: 'msg_resp_1',
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: 'Hello from responses upstream.' }],
              },
            ],
            output_text: 'Hello from responses upstream.',
            usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
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
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    lastBody: () => body,
    lastPath: () => path,
    lastHeaders: () => headers,
  };
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

describe('api-entry-node me routes', () => {
  it('returns unread notification count for authenticated user', async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(baseUrl, '/api/v1/me/notifications/unread-count');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ unread_count: 0 });
  });
});

describe('api-entry-node sse ticket routes', () => {
  it('returns an sse ticket for authenticated requests', async () => {
    const { baseUrl } = startServer();
    const response = await apiFetch(baseUrl, '/api/v1/sse-ticket', { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ticket: string;
      expires_at: string;
      max_connections: number;
      sso_url: string;
    };
    expect(body.ticket).toMatch(/^sse_/);
    expect(body.ticket).not.toBe('test-token');
    expect(body.max_connections).toBe(1);
    expect(body.sso_url).toContain(`/api/v1/events?ticket=${encodeURIComponent(body.ticket)}`);
    expect(typeof body.expires_at).toBe('string');
    expect(Number.isNaN(Date.parse(body.expires_at))).toBe(false);
  });
});

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
    expect(got.permissions).toContain('project:endpoint:use');
    expect(got.permissions).toContain('project:agent:manage');
    expect(got.permissions).not.toContain('project:manage');
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
    const defaultLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/default-personal',
    );
    expect(defaultLibraryRes.status).toBe(200);
    const defaultLibrary = (await defaultLibraryRes.json()) as { id: string };

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
          library_id: defaultLibrary.id,
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
          library_id: defaultLibrary.id,
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
      `/api/v1/workspaces/ws_default/projects/proj_1/sources?library_id=${defaultLibrary.id}`,
    );
    expect(listLibA.status).toBe(200);
    const listedLibA = (await listLibA.json()) as { items: Array<{ id: string; library_id?: string }> };
    expect(listedLibA.items).toHaveLength(2);
    expect(listedLibA.items.every((item) => item.library_id === defaultLibrary.id)).toBe(true);

    const detail = await apiFetch(baseUrl, `/api/v1/workspaces/ws_default/projects/proj_1/sources/${created.id}`);
    expect(detail.status).toBe(200);

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

  it('enforces source_library policy on source ai-ready routes', async () => {
    const { baseUrl } = startServer();

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'AIReady Policy Library', visibility: 'shared' }),
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
          name: 'ai-ready-policy.txt',
          library_id: library.id,
          content_type: 'text/plain',
          content_base64: Buffer.from('policy', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(createSourceRes.status).toBe(201);
    const source = (await createSourceRes.json()) as { id: string };

    const patchDenyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'user', subject_id: 'someone_else' }],
        }),
      },
    );
    expect(patchDenyRes.status).toBe(204);

    const deniedStartRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/sources/${source.id}/ai-ready/start`,
      { method: 'POST' },
    );
    expect(deniedStartRes.status).toBe(403);
    expect(await deniedStartRes.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_DENIED',
      resource_type: 'source_library',
      resource_id: library.id,
    });

    const evidenceStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const evidenceEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(evidenceStart)}&end_time=${encodeURIComponent(evidenceEnd)}&action=resource_policy.access_denied&resource_type=source_library&resource_id=${library.id}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; error_code?: string }>;
    };
    expect(
      auditBody.items.some(
        (item) =>
          item.action === 'resource_policy.access_denied'
          && item.resource_type === 'source_library'
          && item.resource_id === library.id
          && item.error_code === 'RESOURCE_POLICY_DENIED',
      ),
    ).toBe(true);

    const usageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(evidenceStart)}&end_time=${encodeURIComponent(evidenceEnd)}&resource_type=source_library&resource_id=${library.id}&end_user_id=user_test&group_by=hour&page=1&page_size=50`,
    );
    expect(usageRes.status).toBe(200);
    const usageBody = (await usageRes.json()) as {
      items: Array<{ resource_type: string; resource_id?: string; end_user_id?: string; requests: number }>;
    };
    expect(
      usageBody.items.some(
        (item) =>
          item.resource_type === 'source_library'
          && item.resource_id === library.id
          && item.end_user_id === 'user_test'
          && item.requests >= 1,
      ),
    ).toBe(true);

    const patchAllowRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'user', subject_id: 'user_test' }],
        }),
      },
    );
    expect(patchAllowRes.status).toBe(204);

    const allowedStartRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/sources/${source.id}/ai-ready/start`,
      { method: 'POST' },
    );
    expect(allowedStartRes.status).toBe(200);
  });

  it('lists attached source details for a notebook task', async () => {
    const { baseUrl } = startServer();
    const defaultLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/default-personal',
    );
    expect(defaultLibraryRes.status).toBe(200);
    const defaultLibrary = (await defaultLibraryRes.json()) as { id: string };

    const createSourceRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'notebook-input.txt',
          library_id: defaultLibrary.id,
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
          model: 'gpt-5-codex',
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
          execution_preferences: {
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
    const listBeforeBody = (await listBefore.json()) as { items: Array<{ name: string; system_managed_kind?: string }> };
    expect(listBeforeBody.items).toHaveLength(1);
    expect(listBeforeBody.items[0]?.name).toBe('My Uploads');
    expect(listBeforeBody.items[0]?.system_managed_kind).toBe('default_personal_uploads');

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
    expect(listed.items).toHaveLength(2);
    expect(listed.items.some((item) => item.id === created.id)).toBe(true);

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
    expect(members.items[0]?.permissions).toContain('project:manage');

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
    expect(membership.permissions).toContain('project:manage');
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

    const createJoinRequestRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/join-requests',
      'alt-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Need access for support' }),
      },
    );
    expect(createJoinRequestRes.status).toBe(201);
    const createdJoinRequest = (await createJoinRequestRes.json()) as {
      id: string;
      user_id: string;
      status: string;
      reason: string;
    };
    expect(createdJoinRequest.user_id).toBe('user_alt');
    expect(createdJoinRequest.status).toBe('pending');
    expect(createdJoinRequest.reason).toBe('Need access for support');

    const duplicateJoinRequestRes = await apiFetchWithToken(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/join-requests',
      'alt-token',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'duplicate' }),
      },
    );
    expect(duplicateJoinRequestRes.status).toBe(409);

    const approveJoinRequestRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/join-requests/${createdJoinRequest.id}/approve`,
      { method: 'POST' },
    );
    expect(approveJoinRequestRes.status).toBe(204);

    const membersAfterApproveRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members',
    );
    expect(membersAfterApproveRes.status).toBe(200);
    const membersAfterApprove = (await membersAfterApproveRes.json()) as {
      items: Array<{ id: string; role: string; status: string }>;
    };
    expect(membersAfterApprove.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'user_alt', role: 'developer', status: 'active' }),
      ]),
    );

    const approvedMembershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_alt',
    );
    expect(approvedMembershipRes.status).toBe(200);
    const approvedMembership = (await approvedMembershipRes.json()) as {
      user_id: string;
      role: string;
      status: string;
    };
    expect(approvedMembership).toMatchObject({
      user_id: 'user_alt',
      role: 'developer',
      status: 'active',
    });

    const patchAltPermissionsRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_alt/permissions',
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

    const permissionsAuditStart = new Date(Date.now() - 60_000).toISOString();
    const permissionsAuditEnd = new Date(Date.now() + 60_000).toISOString();
    const memberPermissionsAuditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(permissionsAuditStart)}&end_time=${encodeURIComponent(permissionsAuditEnd)}&action=member.permissions.updated&resource_type=member&resource_id=user_alt&page=1&page_size=20`,
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
          && item.resource_id === 'user_alt'
          && item.result === 'ok'
          && Array.isArray(item.metadata_json?.permissions_added)
          && (item.metadata_json?.permissions_added as unknown[]).includes('project:endpoint:use')),
    ).toBe(true);

    const invalidPermissionsPatchRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_alt/permissions',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          permissions: ['project:endpoint:use'],
        }),
      },
    );
    expect(invalidPermissionsPatchRes.status).toBe(422);

    const invalidPermissionsAuditStart = new Date(Date.now() - 60_000).toISOString();
    const invalidPermissionsAuditEnd = new Date(Date.now() + 60_000).toISOString();
    const invalidPermissionsAuditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(invalidPermissionsAuditStart)}&end_time=${encodeURIComponent(invalidPermissionsAuditEnd)}&action=member.permissions.updated&resource_type=member&resource_id=user_alt&page=1&page_size=20`,
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
          && item.resource_id === 'user_alt'
          && item.result === 'error'
          && item.error_code === 'VALIDATION_ERROR'
          && item.error_message === 'mode is required'),
    ).toBe(true);

    const patchGroupForAltRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/groups/${createdGroup.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          member_ids: ['user_test', 'user_alt'],
        }),
      },
    );
    expect(patchGroupForAltRes.status).toBe(200);

    const suspendAltMembershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_alt',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      },
    );
    expect(suspendAltMembershipRes.status).toBe(204);

    const suspendedAltPermissionsRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_alt/permissions',
    );
    expect(suspendedAltPermissionsRes.status).toBe(200);
    expect(await suspendedAltPermissionsRes.json()).toEqual({
      platform_permissions: ['project:endpoint:use'],
      resource_permissions: undefined,
    });

    const groupsWhileSuspendedRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/groups',
    );
    expect(groupsWhileSuspendedRes.status).toBe(200);
    const groupsWhileSuspended = (await groupsWhileSuspendedRes.json()) as {
      items: Array<{ id: string; member_ids: string[] }>;
    };
    expect(groupsWhileSuspended.items.find((item) => item.id === createdGroup.id)?.member_ids).toContain('user_alt');

    const restoreAltMembershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_alt',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      },
    );
    expect(restoreAltMembershipRes.status).toBe(204);

    const rejectJoinRequestRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/join-requests/${createdJoinRequest.id}/reject`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'late reject for state change coverage' }),
      },
    );
    expect(rejectJoinRequestRes.status).toBe(204);

    const listJoinRequestsAfterRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/join-requests',
    );
    expect(listJoinRequestsAfterRes.status).toBe(200);
    const joinRequestsAfter = (await listJoinRequestsAfterRes.json()) as {
      items: Array<{ id: string; status: string; reviewed_by?: string; reject_reason?: string }>;
    };
    const updatedJoinRequest = joinRequestsAfter.items.find((item) => item.id === createdJoinRequest.id);
    expect(updatedJoinRequest).toMatchObject({
      status: 'rejected',
      reviewed_by: 'user_test',
      reject_reason: 'late reject for state change coverage',
    });

    const auditAfterJoinRequestRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())}&end_time=${encodeURIComponent(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString())}&page=1&page_size=50`,
    );
    expect(auditAfterJoinRequestRes.status).toBe(200);
    const auditAfterJoinRequest = (await auditAfterJoinRequestRes.json()) as {
      items: Array<{ action: string; resource_id?: string }>;
    };
    const actions = auditAfterJoinRequest.items
      .filter((item) => item.resource_id === createdJoinRequest.id)
      .map((item) => item.action);
    expect(actions).toEqual(expect.arrayContaining([
      'member.join_request.created',
      'member.join_request.approved',
      'member.join_request.rejected',
    ]));

    const deleteMembershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_alt',
      { method: 'DELETE' },
    );
    expect(deleteMembershipRes.status).toBe(204);

    const deletedMembershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_alt',
    );
    expect(deletedMembershipRes.status).toBe(200);
    const deletedMembership = (await deletedMembershipRes.json()) as {
      user_id: string;
      status: string;
      permissions: string[];
    };
    expect(deletedMembership).toMatchObject({
      user_id: 'user_alt',
      status: 'active',
      permissions: [],
    });

    const altPermissionsRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_alt/permissions',
    );
    expect(altPermissionsRes.status).toBe(200);
    expect(await altPermissionsRes.json()).toEqual({
      platform_permissions: [],
      resource_permissions: undefined,
    });

    const groupsAfterDeleteRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/groups',
    );
    expect(groupsAfterDeleteRes.status).toBe(200);
    const groupsAfterDelete = (await groupsAfterDeleteRes.json()) as {
      items: Array<{ id: string; member_ids: string[] }>;
    };
    expect(groupsAfterDelete.items.find((item) => item.id === createdGroup.id)?.member_ids).toEqual(['user_test']);

    const deleteGroupRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/groups/${createdGroup.id}`,
      { method: 'DELETE' },
    );
    expect(deleteGroupRes.status).toBe(204);

    const listGroupsAfterDeleteRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects/proj_1/groups');
    expect(listGroupsAfterDeleteRes.status).toBe(200);
    const groupsAfterDeleteList = (await listGroupsAfterDeleteRes.json()) as { items: Array<{ id: string }> };
    expect(groupsAfterDeleteList.items.map((g) => g.id)).not.toContain(createdGroup.id);

    const suspendMissingMembershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_missing',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'suspended' }),
      },
    );
    expect(suspendMissingMembershipRes.status).toBe(404);

    const deleteMissingMembershipRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/memberships/user_missing',
      { method: 'DELETE' },
    );
    expect(deleteMissingMembershipRes.status).toBe(404);

    const failedMembershipAuditStart = new Date(Date.now() - 60_000).toISOString();
    const failedMembershipAuditEnd = new Date(Date.now() + 60_000).toISOString();
    const failedMembershipAuditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(failedMembershipAuditStart)}&end_time=${encodeURIComponent(failedMembershipAuditEnd)}&resource_type=membership&page=1&page_size=20`,
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
          permissions: ['project:endpoint:use', 'project:manage'],
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
    expect(created.permissions).toContain('project:manage');
    expect(created.built_in).toBe(false);

    const patchRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/permission-templates/${created.id}`,
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
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
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

    const deniedRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${project.id}/permission-templates`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Should Fail',
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
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

    const deniedRes = await apiFetch(
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
    expect(deniedRes.status).toBe(200);
    expect(await deniedRes.json()).toEqual({
      allowed: false,
      decision: {
        source: 'permission',
        rule_id: 'project:manage',
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
          permissions: ['project:manage'],
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

    const allowRes = await apiFetch(
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
    expect(allowRes.status).toBe(200);
    expect(await allowRes.json()).toEqual({
      allowed: true,
      decision: {
        source: 'permission',
        rule_id: 'project:manage',
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
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
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
        rule_id: 'project:manage',
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
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
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
          permissions: ['project:manage'],
        }),
      },
    );
    expect(restoredRouteRes.status).toBe(200);
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
          permissions: ['project:manage', 'project:manage'],
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
      platform_permissions: ['project:manage', 'project:manage'],
      resource_permissions: undefined,
    });

    const changeHistoryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/members/user_test/change-history',
    );
    expect(changeHistoryRes.status).toBe(200);
    const changeHistory = (await changeHistoryRes.json()) as {
      items: Array<{ change_type: string }>;
    };
    expect(changeHistory.items.map((i) => i.change_type)).toEqual(['permissions']);

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
    const policyAuditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(policyAuditStart)}&end_time=${encodeURIComponent(policyAuditEnd)}&action=resource_policy.updated&page=1&page_size=20`,
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

    const getPolicyAfterRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
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
    expect(policy.spending_limits).toEqual({ rules: [{ key: 'endpoint.spending_usd_per_day', value: 9999 }] });

    const patchInvalidRootRateKeyRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/ep_test/policy',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'source_library.requests_per_minute', value: 1 }] },
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

  it('enforces source_library resource policy allow-list and records governance evidence', async () => {
    const { baseUrl } = startServer();

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Policy Docs', visibility: 'shared' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const library = (await createLibraryRes.json()) as { id: string };

    const patchDenyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'user', subject_id: 'someone_else' }],
        }),
      },
    );
    expect(patchDenyRes.status).toBe(204);

    const deniedListRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=&delimiter=/`,
    );
    expect(deniedListRes.status).toBe(403);
    expect(await deniedListRes.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_DENIED',
      resource_type: 'source_library',
      resource_id: library.id,
    });

    const evidenceStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const evidenceEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(evidenceStart)}&end_time=${encodeURIComponent(evidenceEnd)}&action=resource_policy.access_denied&resource_type=source_library&resource_id=${library.id}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; error_code?: string }>;
    };
    expect(
      auditBody.items.some(
        (item) =>
          item.action === 'resource_policy.access_denied'
          && item.resource_type === 'source_library'
          && item.resource_id === library.id
          && item.error_code === 'RESOURCE_POLICY_DENIED',
      ),
    ).toBe(true);

    const usageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(evidenceStart)}&end_time=${encodeURIComponent(evidenceEnd)}&resource_type=source_library&resource_id=${library.id}&end_user_id=user_test&group_by=hour&page=1&page_size=50`,
    );
    expect(usageRes.status).toBe(200);
    const usageBody = (await usageRes.json()) as {
      items: Array<{ resource_type: string; resource_id?: string; end_user_id?: string; requests: number }>;
    };
    expect(
      usageBody.items.some(
        (item) =>
          item.resource_type === 'source_library'
          && item.resource_id === library.id
          && item.end_user_id === 'user_test'
          && item.requests >= 1,
      ),
    ).toBe(true);

    const patchAllowRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'user', subject_id: 'user_test' }],
        }),
      },
    );
    expect(patchAllowRes.status).toBe(204);

    const allowedListRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=&delimiter=/`,
    );
    expect(allowedListRes.status).toBe(200);

    const createGroupRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/groups',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'source-library-operators',
          permission_template_id: 'perm_tpl_default',
          member_ids: ['user_test'],
        }),
      },
    );
    expect(createGroupRes.status).toBe(200);
    const createdGroup = (await createGroupRes.json()) as { id: string };

    const patchGroupAllowRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'group', subject_id: createdGroup.id }],
        }),
      },
    );
    expect(patchGroupAllowRes.status).toBe(204);

    const groupAllowedListRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=&delimiter=/`,
    );
    expect(groupAllowedListRes.status).toBe(200);
  });

  it('enforces source_library resource policy rate limit and records governance evidence', async () => {
    const { baseUrl } = startServer();

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Source Library Rate Limited', visibility: 'shared' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const library = (await createLibraryRes.json()) as { id: string };

    const patchRatePolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'source_library.requests_per_minute', value: 1 }] },
        }),
      },
    );
    expect(patchRatePolicyRes.status).toBe(204);

    const firstListRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=&delimiter=/`,
    );
    expect(firstListRes.status).toBe(200);

    const secondListRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/source-libraries/${library.id}/objects?prefix=&delimiter=/`,
    );
    expect(secondListRes.status).toBe(429);
    const secondBody = (await secondListRes.json()) as {
      error_code?: string;
      message?: string;
      resource_type?: string;
      resource_id?: string;
      retry_after_seconds?: number;
    };
    expect(secondBody).toMatchObject({
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      resource_type: 'source_library',
      resource_id: library.id,
    });
    expect(typeof secondBody.retry_after_seconds).toBe('number');

    const evidenceStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const evidenceEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(evidenceStart)}&end_time=${encodeURIComponent(evidenceEnd)}&action=resource_policy.rate_limited&resource_type=source_library&resource_id=${library.id}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; error_code?: string }>;
    };
    expect(
      auditBody.items.some(
        (item) => item.action === 'resource_policy.rate_limited'
          && item.resource_type === 'source_library'
          && item.resource_id === library.id
          && item.error_code === 'RESOURCE_POLICY_RATE_LIMITED',
      ),
    ).toBe(true);

    const usageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(evidenceStart)}&end_time=${encodeURIComponent(evidenceEnd)}&resource_type=source_library&resource_id=${library.id}&end_user_id=user_test&group_by=hour&page=1&page_size=50`,
    );
    expect(usageRes.status).toBe(200);
    const usageBody = (await usageRes.json()) as {
      items: Array<{ resource_type: string; resource_id?: string; end_user_id?: string; requests: number }>;
    };
    expect(
      usageBody.items.some(
        (item) =>
          item.resource_type === 'source_library'
          && item.resource_id === library.id
          && item.end_user_id === 'user_test'
          && item.requests >= 1,
      ),
    ).toBe(true);
  });

  it('enforces source_library limit limits on source create and records governance evidence', async () => {
    const { baseUrl } = startServer();

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Limit Policy Library', visibility: 'shared' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const library = (await createLibraryRes.json()) as { id: string };

    const patchPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          spending_limits: {
            rules: [
              { key: 'source_library.max_total_files', value: 1 },
              { key: 'source_library.max_file_size_bytes', value: 4 },
            ],
          },
        }),
      },
    );
    expect(patchPolicyRes.status).toBe(204);

    const oversizedRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'too-large.txt',
          library_id: library.id,
          content_type: 'text/plain',
          content_base64: Buffer.from('hello', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(oversizedRes.status).toBe(429);
    expect(await oversizedRes.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      resource_type: 'source_library',
      resource_id: library.id,
      limit_key: 'source_library.max_file_size_bytes',
    });

    const allowedRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'fits.txt',
          library_id: library.id,
          content_type: 'text/plain',
          content_base64: Buffer.from('1234', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(allowedRes.status).toBe(201);

    const tooManyRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/sources',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'too-many.txt',
          library_id: library.id,
          content_type: 'text/plain',
          content_base64: Buffer.from('1', 'utf-8').toString('base64'),
        }),
      },
    );
    expect(tooManyRes.status).toBe(429);
    expect(await tooManyRes.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      resource_type: 'source_library',
      resource_id: library.id,
      limit_key: 'source_library.max_total_files',
    });

    const evidenceStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const evidenceEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(evidenceStart)}&end_time=${encodeURIComponent(evidenceEnd)}&action=resource_policy.limit_exceeded&resource_type=source_library&resource_id=${library.id}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const auditBody = (await auditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; error_code?: string; metadata_json?: Record<string, unknown> }>;
    };
    expect(
      auditBody.items.filter(
        (item) =>
          item.action === 'resource_policy.limit_exceeded'
          && item.resource_type === 'source_library'
          && item.resource_id === library.id
          && item.error_code === 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      ),
    ).toHaveLength(2);
  });

  it('enforces source_library max_file_size_bytes on multipart upload', async () => {
    const { baseUrl } = startServer();

    const createLibraryRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/source-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Upload Limit Library', visibility: 'shared' }),
      },
    );
    expect(createLibraryRes.status).toBe(201);
    const library = (await createLibraryRes.json()) as { id: string };

    const patchPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/source_library/${library.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          spending_limits: {
            rules: [{ key: 'source_library.max_file_size_bytes', value: 4 }],
          },
        }),
      },
    );
    expect(patchPolicyRes.status).toBe(204);

    const form = buildMultipartBody(
      [{ name: 'prefix', value: '' }],
      {
        fieldName: 'file',
        filename: 'oversized.txt',
        contentType: 'text/plain',
        content: new TextEncoder().encode('hello'),
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
    expect(uploadRes.status).toBe(429);
    expect(await uploadRes.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_SPENDING_LIMIT_EXCEEDED',
      resource_type: 'source_library',
      resource_id: library.id,
      limit_key: 'source_library.max_file_size_bytes',
    });
  });

  it('supports credentials and endpoints CRUD plus openai-compatible proxy', async () => {
    const { baseUrl, deps } = startServer();
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
          model: 'deepseek-chat',
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

    const createGroupRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/groups',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'endpoint-operators',
          permission_template_id: 'perm_tpl_default',
          member_ids: ['user_test'],
        }),
      },
    );
    expect(createGroupRes.status).toBe(200);
    const createdGroup = (await createGroupRes.json()) as { id: string };

    const allowGroupPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_list',
          allowed_subjects: [{ subject_type: 'group', subject_id: createdGroup.id }],
        }),
      },
    );
    expect(allowGroupPolicyRes.status).toBe(204);

    const groupAllowedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'allowed via group' }],
        }),
      },
    );
    expect(groupAllowedProxy.status).toBe(200);

    const rateLimitPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 2 }] },
        }),
      },
    );
    expect(rateLimitPolicyRes.status).toBe(204);

    const firstRateLimitedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'allowed first under rpm policy' }],
        }),
      },
    );
    expect(firstRateLimitedProxy.status).toBe(429);

    const secondRateLimitedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'blocked by rpm policy' }],
        }),
      },
    );
    expect(secondRateLimitedProxy.status).toBe(429);
    expect(await secondRateLimitedProxy.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
    });

    const auditStart = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const auditEnd = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const auditRateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(auditStart)}&end_time=${encodeURIComponent(auditEnd)}&action=resource_policy.rate_limited&page=1&page_size=20`,
    );
    expect(auditRateRes.status).toBe(200);
    const auditRateBody = (await auditRateRes.json()) as { items: Array<{ action: string; resource_type?: string }> };
    expect(
      auditRateBody.items.some((item) => item.action === 'resource_policy.rate_limited' && item.resource_type === 'endpoint'),
    ).toBe(true);

    const usageRateRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(usageStart)}&end_time=${encodeURIComponent(usageEnd)}&resource_type=endpoint&page=1&page_size=100`,
    );
    expect(usageRateRes.status).toBe(200);
    const usageRateBody = (await usageRateRes.json()) as {
      items: Array<{ resource_type: string; requests: number }>;
    };
    expect(usageRateBody.items.some((item) => item.resource_type === 'endpoint' && item.requests >= 1)).toBe(true);

    const resetPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1000 }] },
          spending_limits: { rules: [] },
        }),
      },
    );
    expect(resetPolicyRes.status).toBe(204);

    await recordUsageFact(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      end_user_id: 'user_test',
      requests: 3,
      result: 'ok',
    });
    const requestsLimitPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: {
            rules: [
              { key: 'endpoint.requests_per_minute', value: 1000 },
              { key: 'endpoint.requests_per_day', value: 3 },
            ],
          },
          spending_limits: { rules: [] },
        }),
      },
    );
    expect(requestsLimitPolicyRes.status).toBe(204);

    const requestLimitLimitedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'blocked by endpoint requests/day limit' }],
        }),
      },
    );
    expect(requestLimitLimitedProxy.status).toBe(429);
    expect(await requestLimitLimitedProxy.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
    });

    const requestLimitAuditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(auditStart)}&end_time=${encodeURIComponent(auditEnd)}&action=resource_policy.rate_limited&resource_type=endpoint&resource_id=${endpoint.id}&page=1&page_size=20`,
    );
    expect(requestLimitAuditRes.status).toBe(200);
    const requestLimitAuditBody = (await requestLimitAuditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; metadata_json?: Record<string, unknown> }>;
    };
    expect(
      requestLimitAuditBody.items.some(
        (item) =>
          item.action === 'resource_policy.rate_limited'
          && item.resource_type === 'endpoint'
          && item.resource_id === endpoint.id
          && item.metadata_json?.rate_key === 'endpoint.requests_per_day',
      ),
    ).toBe(true);

    await recordUsageFact(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      end_user_id: 'user_test',
      requests: 1,
      result: 'ok',
      metadata_json: { cost_usd: 2 },
    });
    const spendingLimitedPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1000 }] },
          spending_limits: { rules: [{ key: 'endpoint.spending_usd_per_day', value: 1.5 }] },
        }),
      },
    );
    expect(spendingLimitedPolicyRes.status).toBe(204);

    const spendingLimitedProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'blocked by endpoint spending/day policy' }],
        }),
      },
    );
    expect(spendingLimitedProxy.status).toBe(429);
    expect(await spendingLimitedProxy.json()).toMatchObject({
      error_code: 'RESOURCE_POLICY_SPENDING_LIMITED',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
      spending_key: 'endpoint.spending_usd_per_day',
    });

    const spendingAuditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(auditStart)}&end_time=${encodeURIComponent(auditEnd)}&action=resource_policy.spending_limited&resource_type=endpoint&resource_id=${endpoint.id}&page=1&page_size=20`,
    );
    expect(spendingAuditRes.status).toBe(200);
    const spendingAuditBody = (await spendingAuditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; metadata_json?: Record<string, unknown> }>;
    };
    expect(
      spendingAuditBody.items.some(
        (item) =>
          item.action === 'resource_policy.spending_limited'
          && item.resource_type === 'endpoint'
          && item.resource_id === endpoint.id
          && item.metadata_json?.spending_key === 'endpoint.spending_usd_per_day',
      ),
    ).toBe(true);

    const clearRequestsLimitPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1000 }] },
          spending_limits: { rules: [] },
        }),
      },
    );
    expect(clearRequestsLimitPolicyRes.status).toBe(204);

    const postResetProxy = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored',
          messages: [{ role: 'user', content: 'request should pass after rate/spending reset' }],
        }),
      },
    );
    expect(postResetProxy.status).toBe(200);
  });

  it('streams chat via external agent websocket execution channel', async () => {
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

  it('enforces endpoint requests_per_minute policy for chat stream preflight', async () => {
    const { baseUrl } = startServer();
    const upstream = startOpenAICompatibleUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'chat-rate-cred', value: 'sk-chat-rate' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'chat-rate-endpoint',
          model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const patchPolicyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/resources/endpoint/${endpoint.id}/policy`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          access_mode: 'allow_all_members',
          allowed_subjects: [],
          rate_limits: { rules: [{ key: 'endpoint.requests_per_minute', value: 1 }] },
        }),
      },
    );
    expect(patchPolicyRes.status).toBe(204);

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat' }),
      },
    );
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as { id: string };

    const firstStreamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat', input: { role: 'user', content: 'first' } }),
      },
    );
    expect(firstStreamRes.status).toBe(200);
    await firstStreamRes.text();

    const secondStreamRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions/${session.id}/messages/stream`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint_id: endpoint.id, model: 'deepseek-chat', input: { role: 'user', content: 'second' } }),
      },
    );
    expect(secondStreamRes.status).toBe(429);
    const secondBody = (await secondStreamRes.json()) as {
      error_code?: string;
      message?: string;
      resource_type?: string;
      resource_id?: string;
      retry_after_seconds?: number;
    };
    expect(secondBody).toMatchObject({
      error_code: 'RESOURCE_POLICY_RATE_LIMITED',
      message: 'resource_policy_rate_limited',
      resource_type: 'endpoint',
      resource_id: endpoint.id,
    });
    expect(typeof secondBody.retry_after_seconds).toBe('number');

  });

  it('returns AGENT_OFFLINE when external agent session streams without active execution socket', async () => {
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
          execution_preferences: {
            notebook: {},
          },
        }),
      },
    );
    expect(patchInvalidRes.status).toBe(422);
  });

  it('fails fast when creating internal agent without sandbox manager configured', async () => {
    const { baseUrl } = startServer();

    const createInternalRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'internal-no-sandbox',
          mode: 'internal',
          interaction_mode: 'chat',
          config: {
            image: 'runner:v1',
          },
        }),
      },
    );
    expect(createInternalRes.status).toBe(422);
    const body = (await createInternalRes.json()) as { error_code?: string };
    expect(body.error_code).toBe('AGENT_SANDBOX_NOT_CONFIGURED');
  });

  it('returns AGENT_SANDBOX_NOT_CONFIGURED for internal agent chat stream without pod manager', async () => {
    const { baseUrl, deps } = startServer();
    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-chat',
      mode: 'internal',
      interaction_mode: 'chat',
      status: 'enabled',
      config: {
        image: 'runner:v1',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
    });

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: internalAgent.id, model: 'gpt-5-codex' }),
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
          input: { role: 'user', content: 'hello internal' },
        }),
      },
    );
    expect(streamRes.status).toBe(422);
    const body = (await streamRes.json()) as { error_code?: string };
    expect(body.error_code).toBe('AGENT_SANDBOX_NOT_CONFIGURED');
  });

  it('starts and clears internal chat keepalive timer when streaming via internal agent', async () => {
    const deps = createDefaultNodeApiDeps();
    const ensureAgentReady = vi.fn(async () => undefined);
    const keepalive = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady,
      keepalive,
      releasePod: vi.fn(async () => undefined),
    };
    const dispatchStreamingRequest = vi.fn(async () => ({
      requestId: 'req_internal_chat_keepalive',
      stream: (async function* streamEvents() {
        yield { type: 'delta', delta: 'hello' };
        yield { type: 'done', finish_reason: 'stop', usage_tokens: 5 };
      })(),
      cancel: vi.fn(),
    }));
    deps.agentExecutionService.dispatchStreamingRequest = dispatchStreamingRequest as typeof deps.agentExecutionService.dispatchStreamingRequest;
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { baseUrl } = startServerWithDeps(deps);

    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-chat-keepalive',
      mode: 'internal',
      interaction_mode: 'chat',
      status: 'enabled',
      config: {
        image: 'runner:v1',
        _internal_raw_key: 'ask_test',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_internal',
        },
      },
    });

    const createSessionRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/chat/sessions',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ external_agent_id: internalAgent.id, model: 'gpt-5-codex' }),
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
          input: { role: 'user', content: 'hello internal keepalive' },
        }),
      },
    );
    expect(streamRes.status).toBe(200);
    expect(ensureAgentReady).toHaveBeenCalledTimes(1);
    expect(keepalive).toHaveBeenCalled();
    expect(dispatchStreamingRequest).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls.some((call) => call[1] === 60_000)).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalled();
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });

  it('releases internal workload pod when notebook task is archived', async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };
    const { baseUrl } = startServerWithDeps(deps);

    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook',
      mode: 'internal',
      interaction_mode: 'notebook',
      status: 'enabled',
      config: {
        image: 'runner:v1',
        _internal_raw_key: 'ask_test',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_internal',
        },
      },
    });

    const taskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Internal Task',
          agent_id: internalAgent.id,
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

    const archiveRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      },
    );
    expect(archiveRes.status).toBe(200);
    expect(releasePod).toHaveBeenCalledWith('ws_default', 'proj_1', sanitizeWorkloadId(task.id));
  });

  it('does not leak internal raw key in agent API responses', async () => {
    const deps = createDefaultNodeApiDeps();
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod: vi.fn(async () => undefined),
    };
    const { baseUrl } = startServerWithDeps(deps);

    const createRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'internal-sanitized',
          mode: 'internal',
          interaction_mode: 'chat',
          config: {
            image: 'runner:v1',
          },
        }),
      },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; config?: Record<string, unknown> };
    expect(created.config?._internal_raw_key).toBeUndefined();
    expect(created.config?._internal_key_id).toBeUndefined();

    const listRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/agents',
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { items: Array<{ id: string; config?: Record<string, unknown> }> };
    const listed = listBody.items.find((item) => item.id === created.id);
    expect(listed).toBeTruthy();
    expect(listed?.config?._internal_raw_key).toBeUndefined();
    expect(listed?.config?._internal_key_id).toBeUndefined();

    const itemRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${created.id}`,
    );
    expect(itemRes.status).toBe(200);
    const itemBody = (await itemRes.json()) as { config?: Record<string, unknown> };
    expect(itemBody.config?._internal_raw_key).toBeUndefined();
    expect(itemBody.config?._internal_key_id).toBeUndefined();

    const stored = await deps.agentResourceService.getAgent('ws_default', 'proj_1', created.id);
    expect(typeof (stored?.config as Record<string, unknown> | undefined)?._internal_raw_key).toBe('string');
    expect(typeof (stored?.config as Record<string, unknown> | undefined)?._internal_key_id).toBe('string');
  });

  it('releases internal workload pod when notebook task is deleted', async () => {
    const deps = createDefaultNodeApiDeps();
    const releasePod = vi.fn(async () => undefined);
    deps.internalAgentPodManager = {
      ensureAgentReady: vi.fn(async () => undefined),
      keepalive: vi.fn(async () => undefined),
      releasePod,
    };
    const { baseUrl } = startServerWithDeps(deps);

    const internalAgent = await deps.agentResourceService.createAgent('ws_default', 'proj_1', {
      name: 'internal-notebook-delete',
      mode: 'internal',
      interaction_mode: 'notebook',
      status: 'enabled',
      config: {
        image: 'runner:v1',
        _internal_raw_key: 'ask_test',
      } as never,
      owner_id: 'user_test',
      visibility: 'private',
      execution_preferences_json: {
        notebook: {
          endpoint_id: 'ep_internal',
        },
      },
    });

    const taskRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/tasks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: 'Internal Task Delete',
          agent_id: internalAgent.id,
          initial_inputs: [],
        }),
      },
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as { id: string };

    const deleteRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
      {
        method: 'DELETE',
      },
    );
    expect(deleteRes.status).toBe(200);
    expect(releasePod).toHaveBeenCalledWith('ws_default', 'proj_1', sanitizeWorkloadId(task.id));
  });

  it('runs notebook task message through external execution service and enforces single active run per task', async () => {
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
          model: 'gpt-5-codex',
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
          execution_preferences: {
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

    const executionReceived = new Promise<{
      requestId: string;
      helloProxyBase: string;
      endpointProxyBase: string | null;
      apiBase: string;
      userToken: string;
      notebookMode: boolean | null;
      taskInputsCount: number | null;
      credentialFilesCount: number | null;
      hasCredentialIndexFile: boolean;
      close: () => void;
    }>((resolve) => {
      let helloProxyBase = '';
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${keyPayload.key}` },
      });

      ws.on('open', () => undefined);
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString('utf-8')) as {
          type?: string;
          request_id?: string;
          payload?: {
            resource_proxy?: {
              base_url?: string;
            };
            execution_context?: {
              api_base?: string;
              user_bearer_token?: string;
              notebook_mode?: boolean;
              task_inputs?: unknown[];
              credential_files?: Array<{ relative_path?: string }>;
            };
          };
        };
        if (msg.type === 'server.hello') {
          helloProxyBase = msg.payload?.resource_proxy?.base_url ?? '';
          return;
        }
        if (msg.type !== 'server.request.start' || !msg.request_id) return;
        resolve({
          requestId: msg.request_id,
          helloProxyBase,
          endpointProxyBase: null,
          apiBase: msg.payload?.execution_context?.api_base ?? '',
          userToken: msg.payload?.execution_context?.user_bearer_token ?? '',
          notebookMode: typeof msg.payload?.execution_context?.notebook_mode === 'boolean'
            ? msg.payload.execution_context.notebook_mode
            : null,
          taskInputsCount: Array.isArray(msg.payload?.execution_context?.task_inputs)
            ? msg.payload.execution_context.task_inputs.length
            : null,
          credentialFilesCount: Array.isArray(msg.payload?.execution_context?.credential_files)
            ? msg.payload.execution_context.credential_files.length
            : null,
          hasCredentialIndexFile: Array.isArray(msg.payload?.execution_context?.credential_files)
            ? msg.payload.execution_context.credential_files.some((item) => item?.relative_path === '.codex/credential/index.json')
            : false,
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

    const createExternalConnectionRes = await apiFetch(
      baseUrl,
      '/api/v1/me/external-connections',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'jira',
          kind: 'secret_bundle',
          display_name: 'execution-jira',
          note: 'execution sync test',
          fields: [
            { key: 'base_url', value: 'https://jira.example.com', secret: false },
            { key: 'api_token', value: 'jira-test-token', secret: true },
          ],
        }),
      },
    );
    expect(createExternalConnectionRes.status).toBe(201);

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

    const execution = await executionReceived;
    expect(execution.requestId).toBeTruthy();
    expect(execution.userToken).toBe('test-token');
    expect(execution.apiBase).toBe(baseUrl);
    expect(execution.notebookMode).toBe(true);
    expect(execution.taskInputsCount).toBe(0);
    expect(execution.credentialFilesCount).toBeGreaterThan(0);
    expect(execution.hasCredentialIndexFile).toBe(true);
    expect(execution.helloProxyBase).toBe(
      `${baseUrl}/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy`,
    );
    expect(execution.endpointProxyBase).toBeNull();

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
    executionSocket.close();
  });

  it('synthesizes terminal trace and closes task when notebook execution dispatch fails', async () => {
    const { baseUrl } = startServer();

    const createCredentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'task-runner-key-offline',
          type: 'api_key',
          value: 'sk-task-offline',
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
          name: 'task-endpoint-offline',
          model: 'gpt-5-codex',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://example.com/v1',
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
          name: 'notebook-runner-offline',
          mode: 'external',
          interaction_mode: 'notebook',
          execution_preferences: {
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Notebook task offline execution',
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
          content: 'run this despite offline execution',
        }),
      },
    );
    expect(postMessageRes.status).toBe(200);

    let tracesBody: { items: Array<{ status?: string; name?: string; summary?: string; details?: Record<string, unknown> }> } | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const tracesRes = await apiFetch(
        baseUrl,
        `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}/traces`,
      );
      expect(tracesRes.status).toBe(200);
      tracesBody = (await tracesRes.json()) as {
        items: Array<{ status?: string; name?: string; summary?: string; details?: Record<string, unknown> }>;
      };
      if (tracesBody.items.some((item) => item.name === 'execution.terminal' && item.status === 'error')) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(tracesBody).not.toBeNull();
    const terminalTrace = tracesBody!.items.find((item) => item.name === 'execution.terminal');
    expect(terminalTrace?.status).toBe('error');
    expect(terminalTrace?.summary).toContain('AGENT_OFFLINE');
    expect((terminalTrace?.details as { synthesized?: boolean } | undefined)?.synthesized).toBe(true);

    const taskAfterRunRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/tasks/${task.id}`,
    );
    expect(taskAfterRunRes.status).toBe(200);
    const taskAfterRun = (await taskAfterRunRes.json()) as { status: string };
    expect(taskAfterRun.status).toBe('active');
  });

  it('deduplicates notebook task artifacts by task_relative_path across repeated execution artifact frames', async () => {
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
        model: 'gpt-5-codex',
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
        execution_preferences: {
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
        model: 'gpt-5-codex',
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
        execution_preferences: {
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
          model: 'glm-4-flash',
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
          model: 'glm-4.7',
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
          execution_preferences: {
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

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );

    const executionChannelReady = new Promise<void>((resolve) => {
      executionSocket.on('open', () => {
        executionSocket.send(
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

    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      executionSocket.send(
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
      executionSocket.send(
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
      executionSocket.send(
        JSON.stringify({
          type: 'agent.response.done',
          request_id: msg.request_id,
          payload: { finish_reason: 'stop', usage_tokens: 5 },
        }),
      );
    });

    await executionChannelReady;

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

    executionSocket.close();
  });

  it('exposes authenticated notebook task metrics snapshot', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/internal/notebook-task-metrics');
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

  it('exposes authenticated notebook task metrics in prometheus text format', async () => {
    const { baseUrl } = startServer();

    const res = await apiFetch(baseUrl, '/api/v1/internal/notebook-task-metrics/prometheus');
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
          model: 'glm-4.7',
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
          execution_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
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

    const metricsRes = await apiFetch(baseUrl, '/api/v1/internal/notebook-task-metrics');
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

  it('lists and reads internal governance report artifacts', async () => {
    const deps = createDefaultNodeApiDeps();
    const reportsDir = mkdtempSync(join(tmpdir(), 'agentsmith-governance-reports-'));
    const runsDir = mkdtempSync(join(tmpdir(), 'agentsmith-governance-runs-'));
    const escalationsDir = mkdtempSync(join(tmpdir(), 'agentsmith-governance-incidents-'));
    deps.governanceReportsDir = reportsDir;
    deps.governanceRunsDir = runsDir;
    deps.governanceIncidentsDir = escalationsDir;
    writeFileSync(join(reportsDir, 'sample-governance.json'), JSON.stringify({
      metadata: {
        timestamp: '2026-02-28T20:35:10.000Z',
        git: {
          branch: 'main',
          commit_short: 'abc1234',
        },
      },
      summary: {
        status: 'pass',
        governance_policy: {
          decision: 'blocked',
          blockers: [
            {
              id: 'execution_failures_present',
              severity: 'blocker',
              source: 'execution',
              message: 'Execution has 1 failed checks.',
              overridable: true,
            },
          ],
          warnings: [
            {
              severity: 'warning',
              source: 'usage',
              overridable: true,
            },
          ],
          summary: {
            total_issues: 2,
            blocker_count: 1,
            warning_count: 1,
            overridable_count: 2,
          },
        },
        execution_review_evidence: {
          checks: {
            review_status: 'ready',
          },
        },
      },
    }), 'utf-8');
    writeFileSync(join(reportsDir, 'sample-governance.md'), '# Sample Governance\n\nPASS\n', 'utf-8');
    writeFileSync(join(runsDir, 'sample-governance.json'), JSON.stringify({
      id: 'sample-governance',
      report_name: 'sample-governance',
      artifact_name: 'sample-governance',
      trigger: 'manual',
      started_at: '2026-02-28T20:34:50.000Z',
      completed_at: '2026-02-28T20:35:10.000Z',
      duration_ms: 20000,
      status: 'pass',
      branch: 'main',
      commit_short: 'abc1234',
      governance_decision: 'ready',
      execution_review_status: 'ready',
      total_checks: 6,
      passed_checks: 6,
      failed_checks: 0,
      failed_step_names: [],
      failure_categories: [],
    }), 'utf-8');
    writeFileSync(join(escalationsDir, 'sample-governance.json'), JSON.stringify({
      id: 'sample-governance',
      report_name: 'sample-governance',
      run_id: 'sample-governance',
      created_at: '2026-02-28T20:35:10.000Z',
      event_type: 'gate_warning',
      severity: 'warning',
      status: 'open',
      title: 'Governance run completed with warning state',
      body: 'Latest governance run completed with 1 warning issues.',
      artifact_name: 'sample-governance',
      trigger: 'manual',
      governance_decision: 'warning',
      execution_review_status: 'ready',
      failure_categories: [],
    }), 'utf-8');

    const { baseUrl } = startServerWithDeps(deps);

    const listRes = await apiFetch(baseUrl, '/api/v1/internal/governance-reports?workspace_id=ws_default&project_id=proj_1');
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as {
      items: Array<{
        name: string;
        status: string;
        markdown_available: boolean;
        policy_enforcement?: { decision?: string };
      }>;
    };
    expect(listPayload.items[0]).toEqual(expect.objectContaining({
      name: 'sample-governance',
      status: 'pass',
      markdown_available: true,
      policy_enforcement: expect.objectContaining({
        decision: 'blocked',
      }),
    }));

    const detailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-reports/sample-governance?workspace_id=ws_default&project_id=proj_1');
    expect(detailRes.status).toBe(200);
    const detailPayload = (await detailRes.json()) as {
      name: string;
      markdown?: string;
      report?: { summary?: { status?: string } };
      policy_enforcement?: { decision?: string };
    };
    expect(detailPayload.name).toBe('sample-governance');
    expect(detailPayload.markdown).toContain('# Sample Governance');
    expect(detailPayload.report?.summary?.status).toBe('pass');
    expect(detailPayload.policy_enforcement?.decision).toBe('blocked');

    const createOverrideRes = await apiFetch(baseUrl, '/api/v1/internal/governance-policy-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        report_name: 'sample-governance',
        incident_id: 'incident-sample-governance',
        issue_id: 'execution_failures_present',
        issue_source: 'execution',
        issue_message: 'Execution has 1 failed checks.',
        reason_category: 'governance_window',
        reason: 'Accepted during controlled governance window',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(createOverrideRes.status).toBe(201);
    const createdOverride = (await createOverrideRes.json()) as { id: string };
    const approveOverrideRes = await apiFetch(baseUrl, `/api/v1/internal/governance-policy-overrides/${createdOverride.id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(approveOverrideRes.status).toBe(409);
    const ownerApproveOverrideRes = await apiFetchWithToken(baseUrl, `/api/v1/internal/governance-policy-overrides/${createdOverride.id}/decision`, 'owner-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(ownerApproveOverrideRes.status).toBe(200);

    const runListRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runs?workspace_id=ws_default&project_id=proj_1');
    expect(runListRes.status).toBe(200);
    const runListPayload = (await runListRes.json()) as {
      items: Array<{
        id: string;
        trigger: string;
        artifact_name: string;
        policy_enforcement?: { decision?: string };
      }>;
    };
    expect(runListPayload.items[0]).toEqual(expect.objectContaining({
      id: 'sample-governance',
      trigger: 'manual',
      artifact_name: 'sample-governance',
      policy_enforcement: expect.objectContaining({
        decision: 'releasable_with_override',
      }),
    }));

    const runDetailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runs/sample-governance?workspace_id=ws_default&project_id=proj_1');
    expect(runDetailRes.status).toBe(200);
    const runDetailPayload = (await runDetailRes.json()) as {
      id: string;
      duration_ms: number;
      status: string;
      policy_enforcement?: { decision?: string };
    };
    expect(runDetailPayload.id).toBe('sample-governance');
    expect(runDetailPayload.duration_ms).toBe(20000);
    expect(runDetailPayload.status).toBe('pass');
    expect(runDetailPayload.policy_enforcement?.decision).toBe('releasable_with_override');

    const escalationListRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents');
    expect(escalationListRes.status).toBe(200);
    const escalationListPayload = (await escalationListRes.json()) as { items: Array<{ id: string; event_type: string }> };
    expect(escalationListPayload.items[0]).toEqual(expect.objectContaining({
      id: 'sample-governance',
      event_type: 'gate_warning',
    }));

    const escalationDetailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance');
    expect(escalationDetailRes.status).toBe(200);
    const escalationDetailPayload = (await escalationDetailRes.json()) as { title: string };
    expect(escalationDetailPayload.title).toContain('warning');

    const acknowledgeRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(acknowledgeRes.status).toBe(200);
    const acknowledged = (await acknowledgeRes.json()) as { acknowledged_by_user_id?: string };
    expect(acknowledged.acknowledged_by_user_id).toBeTruthy();

    const assignRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignee_user_id: 'user_oncall',
        assignee_name: 'Oncall Engineer',
        due_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    expect(assignRes.status).toBe(200);
    const assigned = (await assignRes.json()) as { assignee_user_id?: string; sla_status?: string };
    expect(assigned.assignee_user_id).toBe('user_oncall');
    expect(assigned.sla_status).toBe('due_soon');

    const reassignRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assignee_user_id: 'user_governance',
        assignee_name: 'Release Owner',
      }),
    });
    expect(reassignRes.status).toBe(200);

    const historyDetailRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance');
    expect(historyDetailRes.status).toBe(200);
    const historyDetail = (await historyDetailRes.json()) as {
      incident_history?: Array<{
        event_kind?: string;
        previous_assignee_user_id?: string;
        next_assignee_user_id?: string;
      }>;
    };
    const reassignment = historyDetail.incident_history?.find(
      (item) => item.next_assignee_user_id === 'user_governance',
    );
    expect(reassignment?.event_kind).toBe('escalation_assignment');
    expect(reassignment?.previous_assignee_user_id).toBe('user_oncall');
    expect(reassignment?.next_assignee_user_id).toBe('user_governance');

    const resolveRes = await apiFetch(baseUrl, '/api/v1/internal/governance-incidents/sample-governance/resolution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', reason: 'Mitigated by rerun', category: 'mitigated' }),
    });
    expect(resolveRes.status).toBe(200);
    const resolved = (await resolveRes.json()) as { status: string; resolution_reason?: string; resolution_category?: string; sla_status?: string };
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution_reason).toBe('Mitigated by rerun');
    expect(resolved.resolution_category).toBe('mitigated');
    expect(resolved.sla_status).toBe('resolved');

    const notificationsRes = await apiFetch(baseUrl, '/api/v1/me/notifications');
    expect(notificationsRes.status).toBe(200);
    const notificationsPayload = (await notificationsRes.json()) as { items: Array<{ id: string; title: string }> };
    expect(notificationsPayload.items.some((item) => item.id === 'governance_incident_sample-governance')).toBe(true);
  });

  it('creates and lists governance policy overrides', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/internal/governance-policy-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        report_name: 'sample-governance',
        incident_id: 'incident-sample-governance',
        issue_id: 'usage_warning',
        issue_source: 'usage',
        issue_message: 'usage_warning',
        reason_category: 'approved_exception',
        reason: 'Accepted exception for current governance review',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { issue_id: string; reason: string; effective_status?: string; incident_id?: string };
    expect(created.issue_id).toBe('usage_warning');
    expect(created.reason).toBe('Accepted exception for current governance review');
    expect(created.effective_status).toBe('pending');
    expect(created.incident_id).toBe('incident-sample-governance');

    const listRes = await apiFetch(
      baseUrl,
      '/api/v1/internal/governance-policy-overrides?workspace_id=ws_default&project_id=proj_1&report_name=sample-governance',
    );
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as { items: Array<{ issue_id: string }> };
    expect(listPayload.items[0]?.issue_id).toBe('usage_warning');
  });

  it('creates, lists, updates, and deletes user external connections', async () => {
    const { baseUrl } = startServer();
    const feishu = startMockFeishuOAuthServer();
    process.env.FEISHU_APP_ID = 'cli_test';
    process.env.FEISHU_APP_SECRET = 'secret_test';
    process.env.FEISHU_OAUTH_REDIRECT_URI = 'http://localhost:20000/api/v1/me/external-connections/providers/feishu/callback';
    process.env.FEISHU_OAUTH_AUTHORIZE_URL = feishu.authorizeUrl;
    process.env.FEISHU_OAUTH_TOKEN_URL = feishu.tokenUrl;

    const providerRes = await apiFetch(baseUrl, '/api/v1/me/external-connections/providers/feishu');
    expect(providerRes.status).toBe(200);
    const providerPayload = (await providerRes.json()) as {
      provider: string;
      interactive_login_required: boolean;
      callback_uri?: string | null;
      auth_configured?: boolean;
    };
    expect(providerPayload.provider).toBe('feishu');
    expect(providerPayload.interactive_login_required).toBe(true);
    expect(providerPayload.auth_configured).toBe(true);

    const startRes = await apiFetch(baseUrl, '/api/v1/me/external-connections/providers/feishu/auth/start', {
      method: 'POST',
    });
    expect(startRes.status).toBe(200);
    const startPayload = (await startRes.json()) as {
      authorization_url: string;
      state: string;
      redirect_uri: string;
    };
    expect(startPayload.authorization_url).toContain(feishu.authorizeUrl);
    expect(startPayload.redirect_uri).toBe('http://localhost:20000/api/v1/me/external-connections/providers/feishu/callback');

    const completeRes = await apiFetch(baseUrl, '/api/v1/me/external-connections/providers/feishu/auth/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_url: `http://localhost:20000/api/v1/me/external-connections/providers/feishu/callback?code=oauth_code_1&state=${encodeURIComponent(startPayload.state)}`,
      }),
    });
    expect(completeRes.status).toBe(200);
    const feishuConnection = (await completeRes.json()) as {
      id: string;
      provider: string;
      fields: Array<{ key: string; masked_value?: string | null }>;
    };
    expect(feishuConnection.provider).toBe('feishu');
    expect(feishuConnection.fields.find((field) => field.key === 'refresh_token')?.masked_value).toBeDefined();

    const createRes = await apiFetch(baseUrl, '/api/v1/me/external-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'jira',
        kind: 'secret_bundle',
        display_name: 'Team Jira',
        fields: [
          { key: 'base_url', value: 'https://jira.example.com', secret: false },
          { key: 'api_token', value: 'secret-token', secret: true },
        ],
        scopes: ['read:jira-work'],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      id: string;
      fields: Array<{ key: string; masked_value?: string | null }>;
      display_name: string;
    };
    expect(created.display_name).toBe('Team Jira');
    expect(created.fields.find((field) => field.key === 'api_token')?.masked_value).not.toBe('secret-token');

    const listRes = await apiFetch(baseUrl, '/api/v1/me/external-connections');
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as { items: Array<{ id: string; display_name: string }> };
    expect(listPayload.items).toHaveLength(2);
    expect(listPayload.items.some((item) => item.display_name === 'Team Jira')).toBe(true);

    const updateRes = await apiFetch(baseUrl, `/api/v1/me/external-connections/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'reauth_required',
        last_error: 'Token rotated',
      }),
    });
    expect(updateRes.status).toBe(200);
    const updated = (await updateRes.json()) as { status: string; last_error?: string | null };
    expect(updated.status).toBe('reauth_required');
    expect(updated.last_error).toBe('Token rotated');

    const refreshRes = await apiFetch(baseUrl, `/api/v1/me/external-connections/${feishuConnection.id}/refresh`, {
      method: 'POST',
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as {
      status: string;
      fields: Array<{ key: string; masked_value?: string | null }>;
    };
    expect(refreshed.status).toBe('active');
    expect(refreshed.fields.find((field) => field.key === 'access_token')?.masked_value).toBeDefined();

    const startCallbackRes = await apiFetch(baseUrl, '/api/v1/me/external-connections/providers/feishu/auth/start', {
      method: 'POST',
    });
    const startCallbackPayload = (await startCallbackRes.json()) as { state: string };
    const callbackRes = await fetch(
      `${baseUrl}/api/v1/me/external-connections/providers/feishu/callback?code=oauth_code_2&state=${encodeURIComponent(startCallbackPayload.state)}`,
      { redirect: 'manual' },
    );
    expect(callbackRes.status).toBe(302);
    expect(callbackRes.headers.get('location')).toBe('http://localhost:3001/zh-CN/user/third-party-accounts?provider=feishu&connected=1');

    const deleteRes = await apiFetch(baseUrl, `/api/v1/me/external-connections/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleteRes.status).toBe(204);

    const deleteFeishuRes = await apiFetch(baseUrl, `/api/v1/me/external-connections/${feishuConnection.id}`, {
      method: 'DELETE',
    });
    expect(deleteFeishuRes.status).toBe(204);

    const emptyRes = await apiFetch(baseUrl, '/api/v1/me/external-connections');
    const emptyPayload = (await emptyRes.json()) as { items: unknown[] };
    expect(emptyPayload.items).toHaveLength(0);
  });

  it('approves a governance policy override', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/internal/governance-policy-overrides', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'ws_default',
        project_id: 'proj_1',
        report_name: 'sample-governance',
        incident_id: 'incident-sample-governance',
        issue_id: 'usage_warning',
        issue_source: 'usage',
        issue_message: 'usage_warning',
        reason_category: 'approved_exception',
        reason: 'Accepted exception for current governance review',
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const decideRes = await apiFetch(baseUrl, `/api/v1/internal/governance-policy-overrides/${created.id}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(decideRes.status).toBe(409);

    const ownerApproveRes = await apiFetchWithToken(baseUrl, `/api/v1/internal/governance-policy-overrides/${created.id}/decision`, 'owner-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(ownerApproveRes.status).toBe(200);
    const decided = (await ownerApproveRes.json()) as { status: string; decided_by_user_id?: string; effective_status?: string };
    expect(decided.status).toBe('approved');
    expect(decided.decided_by_user_id).toBeTruthy();
    expect(decided.effective_status).toBe('approved');
  });

  it('persists organization action status updates and exposes audit archive history', async () => {
    const { baseUrl } = startServer();
    const actionId = 'action:ws_1:project:proj_1';

    const listBeforeRes = await apiFetch(baseUrl, `/api/v1/internal/organization-actions?action_ids=${encodeURIComponent(actionId)}`);
    expect(listBeforeRes.status).toBe(200);
    const listBefore = (await listBeforeRes.json()) as {
      items: Array<{ action_id: string; status: string; history_total?: number; history: unknown[] }>;
    };
    expect(listBefore.items[0]?.action_id).toBe(actionId);
    expect(listBefore.items[0]?.status).toBe('pending');
    expect(listBefore.items[0]?.history_total ?? 0).toBe(0);

    const firstUpdateRes = await apiFetch(baseUrl, `/api/v1/internal/organization-actions/${encodeURIComponent(actionId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'in_progress',
        actor_user_id: 'user_test',
        actor_name: 'Test User',
        note: 'first transition',
      }),
    });
    expect(firstUpdateRes.status).toBe(200);

    const secondUpdateRes = await apiFetch(baseUrl, `/api/v1/internal/organization-actions/${encodeURIComponent(actionId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'completed',
        actor_user_id: 'user_test',
        actor_name: 'Test User',
        note: 'final transition',
      }),
    });
    expect(secondUpdateRes.status).toBe(200);
    const secondUpdate = (await secondUpdateRes.json()) as {
      status: string;
      history_total?: number;
      history: Array<{ status: string; note?: string }>;
    };
    expect(secondUpdate.status).toBe('completed');
    expect(secondUpdate.history_total).toBe(2);
    expect(secondUpdate.history.length).toBe(2);
    expect(secondUpdate.history[1]?.note).toBe('final transition');

    const listAfterRes = await apiFetch(baseUrl, `/api/v1/internal/organization-actions?action_ids=${encodeURIComponent(actionId)}`);
    expect(listAfterRes.status).toBe(200);
    const listAfter = (await listAfterRes.json()) as {
      items: Array<{ status: string; history_total?: number; history: Array<{ status: string }> }>;
    };
    expect(listAfter.items[0]?.status).toBe('completed');
    expect(listAfter.items[0]?.history_total).toBe(2);
    expect(listAfter.items[0]?.history.length).toBe(2);

    const historyRes = await apiFetch(baseUrl, `/api/v1/internal/organization-actions/${encodeURIComponent(actionId)}/history?limit=1`);
    expect(historyRes.status).toBe(200);
    const historyPayload = (await historyRes.json()) as {
      action_id: string;
      total: number;
      items: Array<{ status: string }>;
    };
    expect(historyPayload.action_id).toBe(actionId);
    expect(historyPayload.total).toBe(1);
    expect(historyPayload.items[0]?.status).toBe('completed');
  });

  it('returns governance runner status and triggers a manual rerun request', async () => {
    const deps = createDefaultNodeApiDeps();
    const mockRunner: GovernanceRunnerController = {
      getStatus: () => ({
        running: false,
        recent_operations: [],
      }),
      triggerRun: async (params) => ({
        id: 'runner_1',
        status: 'running',
        mode: params.mode,
        started_at: '2026-03-01T00:00:00.000Z',
        report_name: 'governance-manual-20260301T000000Z',
        source_run_id: params.sourceRunId,
        notes: params.notes,
        actor_user_id: params.actorUserId,
        actor_name: params.actorName,
      }),
    };
    const { baseUrl } = startServerWithDeps(deps);
    deps.governanceRunner = mockRunner;

    const statusRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runner');
    expect(statusRes.status).toBe(200);
    const statusPayload = (await statusRes.json()) as { running: boolean };
    expect(statusPayload.running).toBe(false);

    const triggerRes = await apiFetch(baseUrl, '/api/v1/internal/governance-runner/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'failed_only',
        source_run_id: 'sample-governance',
        notes: 'rerun failing checks',
      }),
    });
    expect(triggerRes.status).toBe(202);
    const triggerPayload = (await triggerRes.json()) as { mode: string; source_run_id?: string };
    expect(triggerPayload.mode).toBe('failed_only');
    expect(triggerPayload.source_run_id).toBe('sample-governance');
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
          model: 'glm-4.7',
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
          execution_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
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

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );

    const huge = 'x'.repeat(40_000);
    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      executionSocket.send(JSON.stringify({
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
      executionSocket.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });
    await new Promise<void>((resolve) => executionSocket.on('open', () => {
      executionSocket.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
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

    executionSocket.close();
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
          model: 'glm-4.7',
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
          execution_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
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

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );
    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      executionSocket.send(JSON.stringify({
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
      executionSocket.send(JSON.stringify({
        type: 'agent.response.delta',
        request_id: msg.request_id,
        payload: { delta: 'persisted-output' },
      }));
      executionSocket.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 3 },
      }));
    });
    await new Promise<void>((resolve) => executionSocket.on('open', () => {
      executionSocket.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
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

    executionSocket.close();
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
          model: 'glm-4.7',
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
          execution_preferences: { notebook: { endpoint_id: endpoint.id, wire_api: 'responses', model: 'glm-4.7' } },
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

    const connectionInfoRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/agents/${agent.id}/connection-info`,
    );
    expect(connectionInfoRes.status).toBe(200);
    const connectionInfo = (await connectionInfoRes.json()) as { ws_url: string };

    const executionSocket = new WebSocket(
      connectionInfo.ws_url.replace('ws://localhost:20000', baseUrl.replace('http://', 'ws://')),
      { headers: { Authorization: `Bearer ${agentKey.key}` } },
    );
    executionSocket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString('utf-8')) as { type: string; request_id?: string };
      if (msg.type !== 'server.request.start' || !msg.request_id) return;
      for (let i = 0; i < 1010; i += 1) {
        executionSocket.send(JSON.stringify({
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
      executionSocket.send(JSON.stringify({
        type: 'agent.response.done',
        request_id: msg.request_id,
        payload: { finish_reason: 'stop', usage_tokens: 1 },
      }));
    });
    await new Promise<void>((resolve) => executionSocket.on('open', () => {
      executionSocket.send(JSON.stringify({ type: 'agent.ready', payload: { capabilities: { wire_api: 'responses' } } }));
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

    executionSocket.close();
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
          model: 'gpt-4o',
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
          model: 'gpt-4o',
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

  it('fails fast when image attachment cannot be converted to data URL', async () => {
    const { baseUrl } = startServer();
    const upstream = startUpstreamServer();

    const createCredential = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'vision-key-missing-dataurl',
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
          name: 'vision-endpoint-missing-dataurl',
          model: 'gpt-4o',
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
          file_name: 'missing.png',
          file_type: 'image/png',
          file_size: 4,
        }),
      },
    );
    expect(initAttachment.status).toBe(200);
    const attachmentBody = (await initAttachment.json()) as {
      attachment: { id: string };
    };

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
    expect(body.message).toBe('chat_attachment_image_data_url_unavailable');
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
          model: 'gpt-4o-mini',
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
          model: 'gpt-4o-mini',
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
          model: 'gpt-4o-mini',
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
          model: 'qwen-reranker',
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
          model: 'chat-model',
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
          model: 'gemini-rerank',
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
          model: 'gpt-4o-mini',
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
          model: 'deepseek-chat',
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
          model: 'deepseek-chat',
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
          model: 'deepseek-chat',
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
          model: 'deepseek-chat',
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
          model: 'deepseek-chat',
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
          model: 'deepseek-chat',
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
          model: 'deepseek-chat',
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
          model: 'deepseek-chat',
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

  it('serves aggregated usage endpoints from persisted usage facts', async () => {
    const deps = createDefaultNodeApiDeps();
    await recordUsageFact(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      resource_type: 'notebook_task',
      resource_id: 'task_1',
      end_user_id: 'user_test',
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
      end_user_id: 'user_test',
      requests: 1,
      duration_ms: 800,
      tokens_total: 12,
      result: 'error',
      error_code: 'UPSTREAM_ERROR',
      request_id: 'req_usage_2',
      timestamp: new Date().toISOString(),
    });
    await recordUsageFact(deps.docStore, {
      workspace_id: 'ws_default',
      project_id: 'proj_1',
      resource_type: 'agent',
      resource_id: 'agent_1',
      end_user_id: 'user_test',
      requests: 1,
      tokens_total: 999,
      result: 'ok',
      request_id: 'req_usage_3',
      timestamp: new Date().toISOString(),
    });
    const { baseUrl } = startServerWithDeps(deps);
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const usageRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/usage?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=25`,
    );
    expect(usageRes.status).toBe(200);
    const usage = (await usageRes.json()) as {
      items: Array<{ workspace_id: string; project_id: string; resource_type: string; resource_id?: string; tokens?: number }>;
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
    const agentUsage = usage.items.find((item) => item.resource_type === 'agent' && item.resource_id === 'agent_1');
    expect(agentUsage).toBeTruthy();
    expect(agentUsage?.tokens).toBeUndefined();
  });


  it('records credential and endpoint configuration changes in audit events', async () => {
    const { baseUrl } = startServer();
    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_cfg_1' },
        body: JSON.stringify({
          name: 'audit-credential',
          type: 'api_key',
          value: 'sk-audit',
        }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_cfg_2' },
        body: JSON.stringify({
          name: 'audit-endpoint',
          model: 'deepseek-chat',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://api.example.invalid',
          credential_ref: credential.id,
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=20`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{ action: string; resource_type?: string; resource_id?: string; request_id: string }>;
    };
    expect(audit.items.some((item) => item.action === 'credential.create' && item.resource_type === 'credential' && item.resource_id === credential.id && item.request_id === 'req_cfg_1')).toBe(true);
    expect(audit.items.some((item) => item.action === 'endpoint.create' && item.resource_type === 'endpoint' && item.resource_id === endpoint.id && item.request_id === 'req_cfg_2')).toBe(true);
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
        (item) => item.action === 'resource_policy.updated'
          && item.result === 'error'
          && item.resource_type === 'resource_policy'
          && item.resource_id === 'endpoint:ep_test'
          && item.request_id === 'req_policy_invalid'
          && item.error_code === 'VALIDATION_ERROR'
          && item.error_message === 'rate_limits_rule_key_invalid',
      ),
    ).toBe(true);
  });

  it('records failed endpoint creation attempts in audit events', async () => {
    const { baseUrl } = startServer();
    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'audit-fail-credential', type: 'api_key', value: 'sk-audit-fail' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const firstEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'audit-endpoint-conflict-a',
          model: 'duplicate-model',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://api.example.invalid',
          credential_ref: credential.id,
        }),
      },
    );
    expect(firstEndpointRes.status).toBe(201);

    const failedEndpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-request-id': 'req_cfg_conflict' },
        body: JSON.stringify({
          name: 'audit-endpoint-conflict-b',
          model: 'duplicate-model',
          type: 'openai',
          mode: 'openai',
          base_url: 'https://api.example.invalid',
          credential_ref: credential.id,
        }),
      },
    );
    expect(failedEndpointRes.status).toBe(409);

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&page=1&page_size=20&result=error`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{ action: string; request_id: string; result: string; error_code?: string }>;
    };
    expect(audit.items.some((item) => item.action === 'endpoint.create' && item.request_id === 'req_cfg_conflict' && item.result === 'error' && item.error_code === 'ENDPOINT_MODEL_CONFLICT')).toBe(true);
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

  it('bridges openai chat/completions requests to anthropic-compatible endpoint through unified proxy', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bridge-ant-key', type: 'api_key', value: 'sk-ant' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'bridge-anthropic-endpoint',
          model: 'claude-sonnet-4-5',
          type: 'anthropic',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'ignored-by-proxy',
          messages: [{ role: 'user', content: 'hello' }],
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    expect(proxyRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('openai_completion');
    expect(proxyRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('anthropic');
    expect(proxyRes.headers.get('x-agentsmith-proxy-converted')).toBe('1');
    const payload = (await proxyRes.json()) as {
      object?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    expect(payload.object).toBe('chat.completion');
    expect(payload.choices?.[0]?.message?.content).toBe('Hello from anthropic upstream.');
    expect(upstream.lastPath()).toBe('/v1/messages');
  });

  it('bridges anthropic messages requests to openai-compatible endpoint through unified proxy', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bridge-oa-key', type: 'api_key', value: 'sk-oa' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'bridge-openai-endpoint',
          model: 'gpt-4o-mini',
          type: 'openai',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'openai',
          protocol: 'openai_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello from anthropic client' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    expect(proxyRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('anthropic');
    expect(proxyRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('openai_completion');
    expect(proxyRes.headers.get('x-agentsmith-proxy-converted')).toBe('1');
    const payload = (await proxyRes.json()) as {
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    expect(payload.type).toBe('message');
    expect(payload.content?.[0]?.text).toBe('Hello from openai upstream.');
    expect(upstream.lastPath()).toBe('/v1/chat/completions');
  });

  it('bridges openai responses requests to anthropic-compatible endpoint through unified proxy', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bridge-ant-key-resp', type: 'api_key', value: 'sk-ant-resp' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'bridge-anthropic-responses-endpoint',
          model: 'claude-sonnet-4-5',
          type: 'anthropic',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    const proxyRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}/proxy/responses`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5',
          input: 'hello via responses',
        }),
      },
    );
    expect(proxyRes.status).toBe(200);
    expect(proxyRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('openai_responses');
    expect(proxyRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('anthropic');
    expect(proxyRes.headers.get('x-agentsmith-proxy-converted')).toBe('1');
    const payload = (await proxyRes.json()) as { object?: string; output_text?: string };
    expect(payload.object).toBe('response');
    expect(payload.output_text).toBe('Hello from anthropic upstream.');
    expect(upstream.lastPath()).toBe('/v1/messages');
  });

  it('routes llm-gateway requests by model while keeping endpoint governance chain', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gateway-ant-key', type: 'api_key', value: 'sk-gateway-ant' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'gateway-anthropic-endpoint',
          model: 'glm-5',
          type: 'anthropic',
          base_url: upstream.baseUrl,
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string; name: string };

    const gatewayRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'glm-5',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello via gateway' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(gatewayRes.status).toBe(200);
    expect(gatewayRes.headers.get('x-agentsmith-proxy-source-protocol')).toBe('anthropic');
    expect(gatewayRes.headers.get('x-agentsmith-proxy-target-protocol')).toBe('anthropic');
    expect(upstream.lastPath()).toBe('/v1/messages');
    expect((upstream.lastBody() as { model?: string }).model).toBe('glm-5');

    const gatewayResInternalModel = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: endpoint.id,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello via internal endpoint model id' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(gatewayResInternalModel.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/messages');
    // Project model name should be translated to the endpoint's provider model.
    expect((upstream.lastBody() as { model?: string }).model).toBe('glm-5');

    const gatewayResInternalName = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: endpoint.name,
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hello via internal endpoint model name' }] }],
          max_tokens: 128,
        }),
      },
    );
    expect(gatewayResInternalName.status).toBe(200);
    expect((upstream.lastBody() as { model?: string }).model).toBe('glm-5');
  });

  it('forwards anthropic protocol headers through llm-gateway and preserves messages/count_tokens path', async () => {
    const { baseUrl } = startServer();
    const upstream = startProtocolBridgeUpstreamServer();

    const credentialRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/credentials',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'gateway-ant-key-headers', type: 'api_key', value: 'sk-gateway-ant-headers' }),
      },
    );
    expect(credentialRes.status).toBe(201);
    const credential = (await credentialRes.json()) as { id: string };

    const endpointRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/endpoints',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'gateway-anthropic-endpoint-headers',
          model: 'glm-4.7',
          type: 'anthropic',
          base_url: 'http://127.0.0.1:0/unused',
          credential_ref: credential.id,
          provider_family: 'anthropic',
          protocol: 'anthropic_compatible',
        }),
      },
    );
    expect(endpointRes.status).toBe(201);
    const endpoint = (await endpointRes.json()) as { id: string };

    await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/proj_1/endpoints/${endpoint.id}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base_url: upstream.baseUrl }),
      },
    );

    const gatewayRes = await apiFetch(
      baseUrl,
      '/api/v1/workspaces/ws_default/projects/proj_1/llm-gateway/messages/count_tokens',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'prompt-caching-2024-07-31',
        },
        body: JSON.stringify({
          model: 'glm-4.7',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'tokenize me' }] }],
        }),
      },
    );
    expect(gatewayRes.status).toBe(200);
    expect(upstream.lastPath()).toBe('/v1/messages/count_tokens');
    expect(upstream.lastHeaders()['anthropic-version']).toBe('2023-06-01');
    expect(upstream.lastHeaders()['anthropic-beta']).toBe('prompt-caching-2024-07-31');
  });


});
