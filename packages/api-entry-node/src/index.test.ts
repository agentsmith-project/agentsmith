import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createDefaultNodeApiDeps, createNodeApiServer } from './index.js';
import { setProjectAdminGroupMembers } from './project-groups-store.js';
import { recordAuditEvent, recordUsageFact } from './audit-usage-store.js';
import type { GovernanceRunnerController } from './governance-runner.js';
import { sanitizeWorkloadId } from './internal-agent-pod-manager.js';

const servers: Server[] = [];
const originalKeycloakIssuer = process.env.KEYCLOAK_ISSUER_URL;
const originalSystemWorkspaceRegistryPath = process.env.SYSTEM_WORKSPACE_REGISTRY_PATH;
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
          server.closeAllConnections?.();
          server.closeIdleConnections?.();
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
  if (originalSystemWorkspaceRegistryPath === undefined) {
    delete process.env.SYSTEM_WORKSPACE_REGISTRY_PATH;
  } else {
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = originalSystemWorkspaceRegistryPath;
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
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const directoryUsers = [
      {
        id: 'user_owner',
        email: 'owner@example.com',
        username: 'owner-user',
        firstName: 'Owner',
        lastName: 'User',
        name: 'Owner User',
      },
      {
        id: 'user_alt',
        email: 'alt@example.com',
        username: 'alt-user',
        firstName: 'Alt',
        lastName: 'User',
        name: 'Alt User',
      },
      {
        id: 'user_creator',
        email: 'creator@example.com',
        username: 'creator-user',
        firstName: 'Creator',
        lastName: 'User',
        name: 'Creator User',
      },
    ];
    if (req.method === 'POST' && requestUrl.pathname === '/realms/master/protocol/openid-connect/token') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'mock-admin-token' }));
      return;
    }
    if (req.headers.authorization === 'Bearer mock-admin-token' && requestUrl.pathname === '/admin/realms/mbos/users') {
      const search = requestUrl.searchParams.get('search')?.trim().toLowerCase() ?? '';
      const items = search
        ? directoryUsers.filter((item) => `${item.email} ${item.username} ${item.name}`.toLowerCase().includes(search))
        : directoryUsers;
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(items));
      return;
    }
    const userItemMatch = requestUrl.pathname.match(/^\/admin\/realms\/mbos\/users\/([^/]+)$/);
    if (req.headers.authorization === 'Bearer mock-admin-token' && userItemMatch) {
      const found = directoryUsers.find((item) => item.id === decodeURIComponent(userItemMatch[1]));
      if (!found) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(found));
      return;
    }
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
  const dir = mkdtempSync(join(tmpdir(), 'agentsmith-default-workspace-registry-'));
  process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
  writeFileSync(
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH,
    JSON.stringify([
      {
        id: 'ws_default',
        name: 'Default Workspace',
        workspace_admin: 'owner@example.com',
        project_creators: ['test@example.com'],
        idp: {
          kind: 'keycloak',
          url: keycloak.issuerUrl,
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
  const deps = createDefaultNodeApiDeps();
  const server = createNodeApiServer(0, deps);
  servers.push(server);

  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}`, deps };
}

function startServerWithDeps(deps: ReturnType<typeof createDefaultNodeApiDeps>): { server: Server; baseUrl: string } {
  const keycloak = startMockKeycloakServer();
  process.env.KEYCLOAK_ISSUER_URL = keycloak.issuerUrl;
  const dir = mkdtempSync(join(tmpdir(), 'agentsmith-default-workspace-registry-'));
  process.env.SYSTEM_WORKSPACE_REGISTRY_PATH = join(dir, 'system-workspaces.json');
  writeFileSync(
    process.env.SYSTEM_WORKSPACE_REGISTRY_PATH,
    JSON.stringify([
      {
        id: 'ws_default',
        name: 'Default Workspace',
        workspace_admin: 'owner@example.com',
        project_creators: ['test@example.com'],
        idp: {
          kind: 'keycloak',
          url: keycloak.issuerUrl,
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
    expect(membership.permissions).toContain('project:membership:update');
  });

  it('forbids non-owner project access when actor is not a project member', async () => {
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
    expect(getRes.status).toBe(403);
    const got = (await getRes.json()) as {
      error_code: string;
      missing_permissions?: string[];
    };
    expect(got.error_code).toBe('FORBIDDEN');
    expect(got.missing_permissions).toContain('project:endpoint:use');
  });

  it('allows plain workspace users to create join requests without member governance permission', async () => {
    const deps = createDefaultNodeApiDeps();
    const project = await deps.createProjectUseCase.execute({
      workspaceId: 'ws_default',
      actorId: 'user_owner',
      input: {
        name: 'Joinable Project',
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
    expect(restoredRouteRes.status).toBe(403);
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
          permissions: ['project:audit:read', 'project:membership:update'],
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
      platform_permissions: ['project:audit:read', 'project:membership:update'],
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
      const traces = await deps.docStore.list<{ task_id: string }>('ws_default_notebook_task_trace_events', { task_id: task.id });
      const msgs = await deps.docStore.list<{ task_id: string; role: string; content: string }>('ws_default_notebook_task_messages', { task_id: task.id });
      if (traces.length > 0 && msgs.some((m) => m.role === 'agent' && m.content.includes('persisted-output'))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const baseTasks = await deps.docStore.list<{ id: string }>('notebook_tasks', {});
    const baseMessages = await deps.docStore.list<{ task_id: string; role: string; content: string }>('notebook_task_messages', { task_id: task.id });
    const baseTraces = await deps.docStore.list<{ task_id: string; category: string }>('notebook_task_trace_events', { task_id: task.id });
    const storedTasks = await deps.docStore.list<{ id: string }>('ws_default_notebook_tasks', {});
    const storedMessages = await deps.docStore.list<{ task_id: string; role: string; content: string }>('ws_default_notebook_task_messages', { task_id: task.id });
    const storedTraces = await deps.docStore.list<{ task_id: string; category: string }>('ws_default_notebook_task_trace_events', { task_id: task.id });

    expect(baseTasks).toHaveLength(0);
    expect(baseMessages).toHaveLength(0);
    expect(baseTraces).toHaveLength(0);
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
      '/api/v1/workspaces/ws_default/projects/proj_1/file-libraries',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Chat Inputs', description: 'chat attachment inputs' }),
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
      `/api/v1/workspaces/ws_default/projects/proj_1/file-libraries/${library.id}/upload`,
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
        file_library_id?: string;
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
        : attachmentBody.attachment.file_library_id && attachmentBody.attachment.source_object_key
          ? {
              kind: 'library_object' as const,
              library_id: attachmentBody.attachment.file_library_id,
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
        file_library_id?: string;
        source_object_key?: string;
      };
    };
    expect(body.attachment.input_ref).toMatchObject({
      kind: 'library_object',
      library_id: 'lib_123',
      key: 'chat/s1/uploads/doc.txt',
    });
    expect(body.attachment.source_type).toBe('library_import');
    expect(body.attachment.file_library_id).toBe('lib_123');
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
    expect(audit.items.some((item) =>
      item.action === 'project.create'
      && item.request_id === 'req_project_create_audit'
      && item.result === 'ok'
      && item.metadata_json?.name === 'Audit Project')).toBe(true);
    expect(audit.items.some((item) =>
      item.action === 'project.update'
      && item.request_id === 'req_project_update_audit'
      && item.result === 'ok'
      && item.metadata_json?.name === 'Audit Project Renamed')).toBe(true);
    expect(audit.items.some((item) =>
      item.action === 'project.delete'
      && item.request_id === 'req_project_delete_audit'
      && item.result === 'ok')).toBe(true);
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
    expect(audit.items.some((item) =>
      item.action === 'project.update'
      && item.request_id === 'req_project_update_missing'
      && item.result === 'error'
      && item.error_code === 'RESOURCE_NOT_FOUND'
      && item.error_message === 'project_not_found')).toBe(true);
    expect(audit.items.some((item) =>
      item.action === 'project.delete'
      && item.request_id === 'req_project_delete_missing'
      && item.result === 'error'
      && item.error_code === 'RESOURCE_NOT_FOUND'
      && item.error_message === 'project_not_found')).toBe(true);
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
    const { baseUrl } = startServer();

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

    setProjectAdminGroupMembers({
      workspaceId: 'ws_default',
      projectId: created.id,
      projectOwnerId: 'user_test',
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

  it('rejects member permission updates from project admins and records audit errors', async () => {
    const { baseUrl } = startServer();

    const createRes = await apiFetch(baseUrl, '/api/v1/workspaces/ws_default/projects', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Owner Only Join Approval',
        visibility: 'private',
        join_policy: 'approval_required',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    setProjectAdminGroupMembers({
      workspaceId: 'ws_default',
      projectId: created.id,
      projectOwnerId: 'user_test',
      memberIds: ['user_alt'],
    });

    const forbiddenPermissionsRes = await apiFetchWithToken(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}/members/user_owner/permissions`,
      'alt-token',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req_project_admin_join_approve_forbidden',
        },
        body: JSON.stringify({
          template: 'admin',
          permissions: ['project:audit:read', 'project:membership:update'],
        }),
      },
    );
    expect(forbiddenPermissionsRes.status).toBe(403);
    await expect(forbiddenPermissionsRes.json()).resolves.toMatchObject({
      error_code: 'PERMISSION_DENIED',
      message: 'project_owner_required',
    });

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const auditRes = await apiFetch(
      baseUrl,
      `/api/v1/workspaces/ws_default/projects/${created.id}/audit?start_time=${encodeURIComponent(start)}&end_time=${encodeURIComponent(end)}&action=member.permissions.updated&page=1&page_size=20&result=error`,
    );
    expect(auditRes.status).toBe(200);
    const audit = (await auditRes.json()) as {
      items: Array<{
        action: string;
        request_id?: string;
        result: string;
        error_code?: string;
        error_message?: string;
        resource_id?: string;
      }>;
    };
    expect(audit.items.some((item) =>
      item.action === 'member.permissions.updated'
      && item.request_id === 'req_project_admin_join_approve_forbidden'
      && item.result === 'error'
      && item.error_code === 'PERMISSION_DENIED'
      && item.error_message === 'project_owner_required'
      && item.resource_id === 'user_owner')).toBe(true);
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
    expect(audit.items.some((item) =>
      item.action === 'project.owner.transferred'
      && item.request_id === 'req_project_owner_transfer'
      && item.result === 'ok'
      && item.metadata_json?.previous_owner_id === 'user_test'
      && item.metadata_json?.next_owner_id === 'user_alt'
      && item.metadata_json?.previous_owner_retained_admin === true)).toBe(true);
  });

  it('rejects forced ownership transfer when actor lacks the built-in workspace owner group', async () => {
    const { baseUrl } = startServer();

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

    setProjectAdminGroupMembers({
      workspaceId: 'ws_default',
      projectId: created.id,
      projectOwnerId: 'user_test',
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
        metadata_json?: {
          previous_owner_id?: string;
          next_owner_id?: string;
          previous_owner_retained_admin?: boolean;
        };
      }>;
    };
    expect(audit.items.some((item) =>
      item.action === 'project.owner.transferred'
      && item.request_id === 'req_project_owner_transfer_forbidden'
      && item.result === 'error')).toBe(true);
  });

  it('rejects project deletion from non-owners and records audit errors', async () => {
    const { baseUrl } = startServer();

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

    setProjectAdminGroupMembers({
      workspaceId: 'ws_default',
      projectId: created.id,
      projectOwnerId: 'user_test',
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
    expect(audit.items.some((item) =>
      item.action === 'project.delete'
      && item.request_id === 'req_project_delete_forbidden'
      && item.result === 'error'
      && item.error_code === 'PERMISSION_DENIED'
      && item.error_message === 'project_owner_required')).toBe(true);
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
