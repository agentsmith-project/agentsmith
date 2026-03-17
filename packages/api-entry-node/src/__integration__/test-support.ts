import { afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import http, { type Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultNodeApiDeps, createNodeApiServer } from '../index.js';

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

export function startMockKeycloakServer(): { server: Server; issuerUrl: string } {
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

export function startServer(): { server: Server; baseUrl: string; deps: ReturnType<typeof createDefaultNodeApiDeps> } {
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

export function startServerWithDeps(deps: ReturnType<typeof createDefaultNodeApiDeps>): { server: Server; baseUrl: string } {
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

export function apiFetch(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  return apiFetchWithToken(baseUrl, path, 'test-token', init);
}

export function apiFetchWithToken(baseUrl: string, path: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
}

export function startMockFeishuOAuthServer(): { server: Server; authorizeUrl: string; tokenUrl: string } {
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
