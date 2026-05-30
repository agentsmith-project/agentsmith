import { afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createSign, generateKeyPairSync } from 'node:crypto';
import http, { type Server } from 'node:http';
import { createDefaultNodeApiDeps, createNodeApiServer } from '../index.js';
import {
  resetSystemWorkspaceRegistryPersistenceForTest,
  seedPersistedSystemWorkspacesForTest,
} from '../../../../src/lib/system-admin/workspace-registry/persistence.js';

const servers: Server[] = [];
const originalKeycloakIssuerUrl = process.env.KEYCLOAK_ISSUER_URL;
const originalKeycloakBaseUrl = process.env.KEYCLOAK_BASE_URL;
const originalPublicKeycloakBaseUrl = process.env.PUBLIC_KEYCLOAK_BASE_URL;
const originalInternalKeycloakBaseUrl = process.env.INTERNAL_KEYCLOAK_BASE_URL;
const originalKeycloakRealm = process.env.KEYCLOAK_REALM;
const originalKeycloakClientId = process.env.KEYCLOAK_CLIENT_ID;
const originalKeycloakUrl = process.env.KEYCLOAK_URL;
const originalKeycloakAdmin = process.env.KEYCLOAK_ADMIN;
const originalKeycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const originalKeycloakAdminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID;

const signingKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const signingJwk = {
  ...(signingKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>),
  kid: 'test-key-1',
  alg: 'RS256',
  use: 'sig',
};

let currentMockIssuer: string | null = null;
function allocateTestPort(): number {
  const raw = execFileSync('python3', ['-c', 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()'], {
    encoding: 'utf8',
  }).trim();
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`invalid_test_port:${raw}`);
  }
  return port;
}

async function listenLoopbackServer(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('test_server_address_unavailable');
  }
  return address.port;
}

function resolveListeningPort(server: Server): number | null {
  const address = server.address();
  if (!address || typeof address === 'string') {
    return null;
  }
  return address.port;
}

async function waitForServerListeningPort(server: Server): Promise<number> {
  const existingPort = resolveListeningPort(server);
  if (server.listening && existingPort) {
    return existingPort;
  }
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
  const port = resolveListeningPort(server);
  if (!port) {
    throw new Error('test_server_address_unavailable');
  }
  return port;
}

const testUsers = {
  'test-token': {
    sub: 'user_test',
    email: 'test@example.com',
    preferred_username: 'test-user',
    name: 'Test User',
  },
  'owner-token': {
    sub: 'user_owner',
    email: 'owner@example.com',
    preferred_username: 'owner-user',
    name: 'Owner User',
  },
  'alt-token': {
    sub: 'user_alt',
    email: 'alt@example.com',
    preferred_username: 'alt-user',
    name: 'Alt User',
  },
  'member-token': {
    sub: 'user_test',
    email: 'test@example.com',
    preferred_username: 'test-user',
    name: 'Test User',
  },
  'secret-token': {
    sub: 'user_secret',
    email: 'secret@example.com',
    preferred_username: 'secret-user',
    name: 'Secret User',
  },
  'owner-email-switch-token': {
    sub: 'user_owner_v2',
    email: 'owner@example.com',
    preferred_username: 'owner-user-v2',
    name: 'Owner User V2',
  },
  'creator-email-switch-token': {
    sub: 'user_alt_v2',
    email: 'alt@example.com',
    preferred_username: 'alt-user-v2',
    name: 'Alt User V2',
  },
} as const;

async function issueTestAccessToken(token: string): Promise<string> {
  if (token.split('.').length === 3) {
    return token;
  }

  const claims = testUsers[token as keyof typeof testUsers];
  if (!claims) {
    return token;
  }

  if (!currentMockIssuer) {
    throw new Error(`mock_keycloak_not_started_for_token:${token}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({
    alg: 'RS256',
    kid: 'test-key-1',
    typ: 'JWT',
  })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: currentMockIssuer,
    sub: claims.sub,
    aud: 'agentsmith-web',
    iat: now,
    exp: now + 3600,
    jti: `${claims.sub}-${Date.now()}`,
    email: claims.email,
    preferred_username: claims.preferred_username,
    name: claims.name,
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(signingKeys.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

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
  // Keep api-entry-node integration auth hermetic: these tests own the full
  // Keycloak environment and must not inherit backend-real shell settings.
  if (originalKeycloakIssuerUrl === undefined) delete process.env.KEYCLOAK_ISSUER_URL;
  else process.env.KEYCLOAK_ISSUER_URL = originalKeycloakIssuerUrl;
  if (originalKeycloakBaseUrl === undefined) delete process.env.KEYCLOAK_BASE_URL;
  else process.env.KEYCLOAK_BASE_URL = originalKeycloakBaseUrl;
  if (originalPublicKeycloakBaseUrl === undefined) delete process.env.PUBLIC_KEYCLOAK_BASE_URL;
  else process.env.PUBLIC_KEYCLOAK_BASE_URL = originalPublicKeycloakBaseUrl;
  if (originalInternalKeycloakBaseUrl === undefined) delete process.env.INTERNAL_KEYCLOAK_BASE_URL;
  else process.env.INTERNAL_KEYCLOAK_BASE_URL = originalInternalKeycloakBaseUrl;
  if (originalKeycloakRealm === undefined) delete process.env.KEYCLOAK_REALM;
  else process.env.KEYCLOAK_REALM = originalKeycloakRealm;
  if (originalKeycloakClientId === undefined) delete process.env.KEYCLOAK_CLIENT_ID;
  else process.env.KEYCLOAK_CLIENT_ID = originalKeycloakClientId;
  if (originalKeycloakUrl === undefined) delete process.env.KEYCLOAK_URL;
  else process.env.KEYCLOAK_URL = originalKeycloakUrl;
  if (originalKeycloakAdmin === undefined) delete process.env.KEYCLOAK_ADMIN;
  else process.env.KEYCLOAK_ADMIN = originalKeycloakAdmin;
  if (originalKeycloakAdminPassword === undefined) delete process.env.KEYCLOAK_ADMIN_PASSWORD;
  else process.env.KEYCLOAK_ADMIN_PASSWORD = originalKeycloakAdminPassword;
  if (originalKeycloakAdminClientId === undefined) delete process.env.KEYCLOAK_ADMIN_CLIENT_ID;
  else process.env.KEYCLOAK_ADMIN_CLIENT_ID = originalKeycloakAdminClientId;
  resetSystemWorkspaceRegistryPersistenceForTest();
  currentMockIssuer = null;
});

function applyMockKeycloakEnv(baseUrl: string, issuerUrl: string): void {
  process.env.KEYCLOAK_BASE_URL = baseUrl;
  process.env.PUBLIC_KEYCLOAK_BASE_URL = baseUrl;
  process.env.INTERNAL_KEYCLOAK_BASE_URL = baseUrl;
  process.env.KEYCLOAK_ISSUER_URL = issuerUrl;
  process.env.KEYCLOAK_REALM = 'mbos';
  process.env.KEYCLOAK_CLIENT_ID = 'agentsmith-web';
  process.env.KEYCLOAK_URL = `${baseUrl}/realms`;
  process.env.KEYCLOAK_ADMIN = 'agentsmith-admin';
  process.env.KEYCLOAK_ADMIN_PASSWORD = 'admin-secret';
  process.env.KEYCLOAK_ADMIN_CLIENT_ID = 'admin-cli';
}

function createMockKeycloakServer(): Server {
  return http.createServer((req, res) => {
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
    if (req.method === 'GET' && requestUrl.pathname === '/realms/mbos/protocol/openid-connect/certs') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [signingJwk] }));
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/realms/mbos/protocol/openid-connect/token') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ access_token: 'mock-directory-token' }));
      return;
    }
    if (req.headers.authorization === 'Bearer mock-directory-token' && requestUrl.pathname === '/admin/realms/mbos/users') {
      const search = requestUrl.searchParams.get('search')?.trim().toLowerCase() ?? '';
      const email = requestUrl.searchParams.get('email')?.trim().toLowerCase() ?? '';
      const items = search
        ? directoryUsers.filter((item) => `${item.email} ${item.username} ${item.name}`.toLowerCase().includes(search))
        : email
          ? directoryUsers.filter((item) => item.email.toLowerCase() === email)
        : directoryUsers;
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(items));
      return;
    }
    const userItemMatch = requestUrl.pathname.match(/^\/admin\/realms\/mbos\/users\/([^/]+)$/);
    if (req.headers.authorization === 'Bearer mock-directory-token' && userItemMatch) {
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
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

function seedDefaultSystemWorkspace(issuerUrl: string): void {
  seedPersistedSystemWorkspacesForTest([
    {
      id: 'ws_default',
      name: 'Default Workspace',
      workspace_admin: 'owner@example.com',
      workspace_admin_user_id: 'user_owner',
      workspace_admin_name: 'Owner User',
      project_creators: [{ user_id: 'user_test', email: 'test@example.com', name: 'Test User' }],
      login_idp: {
        kind: 'keycloak',
        url: issuerUrl,
        realm: 'mbos',
        client_id: 'agentsmith-web',
      },
      directory_idp: {
        client_id: 'agentsmith-directory',
        client_secret: 'directory-secret',
      },
      tenant: {
        workspace_id: 'ws_default',
        workspace_name: 'Default Workspace',
        substrate_label: 'default',
        database_name: 'agentsmith_ws_default',
        collection_prefix: 'ws_default_',
        key_prefix: 'ws_default:',
      },
      provisioning_status: 'ready',
      last_initialized_at: null,
      last_init_error: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
}

export function startMockKeycloakServer(): { server: Server; issuerUrl: string; baseUrl: string } {
  const server = createMockKeycloakServer();
  const port = allocateTestPort();
  server.listen(port, '127.0.0.1');
  servers.push(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const issuerUrl = `${baseUrl}/realms/mbos`;
  currentMockIssuer = issuerUrl;
  applyMockKeycloakEnv(baseUrl, issuerUrl);
  return { server, issuerUrl, baseUrl };
}

export async function startMockKeycloakServerReady(): Promise<{ server: Server; issuerUrl: string; baseUrl: string }> {
  const server = createMockKeycloakServer();
  const port = await listenLoopbackServer(server);
  servers.push(server);
  const baseUrl = `http://127.0.0.1:${port}`;
  const issuerUrl = `${baseUrl}/realms/mbos`;
  currentMockIssuer = issuerUrl;
  applyMockKeycloakEnv(baseUrl, issuerUrl);
  return { server, issuerUrl, baseUrl };
}

export function startServer(): { server: Server; baseUrl: string; deps: ReturnType<typeof createDefaultNodeApiDeps> } {
  const keycloak = startMockKeycloakServer();
  seedDefaultSystemWorkspace(keycloak.issuerUrl);
  const deps = createDefaultNodeApiDeps();
  const port = allocateTestPort();
  const server = createNodeApiServer(port, deps, undefined, '127.0.0.1');
  servers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${port}`, deps };
}

export function startServerWithDeps(deps: ReturnType<typeof createDefaultNodeApiDeps>): { server: Server; baseUrl: string } {
  const keycloak = startMockKeycloakServer();
  seedDefaultSystemWorkspace(keycloak.issuerUrl);
  const port = allocateTestPort();
  const server = createNodeApiServer(port, deps, undefined, '127.0.0.1');
  servers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

// Reload-sensitive integration tests should prefer the ready helpers so the
// returned baseUrl always belongs to a fully bound listener.
export async function startServerReady(): Promise<{
  server: Server;
  baseUrl: string;
  deps: ReturnType<typeof createDefaultNodeApiDeps>;
}> {
  const keycloak = await startMockKeycloakServerReady();
  seedDefaultSystemWorkspace(keycloak.issuerUrl);
  const deps = createDefaultNodeApiDeps();
  const server = createNodeApiServer(0, deps, undefined, '127.0.0.1');
  const port = await waitForServerListeningPort(server);
  servers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${port}`, deps };
}

export async function startServerWithDepsReady(
  deps: ReturnType<typeof createDefaultNodeApiDeps>,
): Promise<{ server: Server; baseUrl: string }> {
  const keycloak = await startMockKeycloakServerReady();
  seedDefaultSystemWorkspace(keycloak.issuerUrl);
  const server = createNodeApiServer(0, deps, undefined, '127.0.0.1');
  const port = await waitForServerListeningPort(server);
  servers.push(server);
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

export function apiFetch(baseUrl: string, path: string, init?: RequestInit): Promise<Response> {
  return apiFetchWithToken(baseUrl, path, 'test-token', init);
}

export async function apiFetchWithToken(baseUrl: string, path: string, token: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${await issueTestAccessToken(token)}`);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
}
