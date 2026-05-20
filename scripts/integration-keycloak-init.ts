import path from 'node:path';
import { fileURLToPath } from 'node:url';

type TokenResponse = {
  access_token: string;
};

type KeycloakUser = {
  id: string;
  username?: string;
};

type KeycloakClientSummary = {
  id: string;
  clientId?: string;
};

type KeycloakClientConfig = {
  id: string;
  clientId?: string;
  redirectUris?: string[];
  webOrigins?: string[];
  directAccessGrantsEnabled?: boolean;
  standardFlowEnabled?: boolean;
  publicClient?: boolean;
  serviceAccountsEnabled?: boolean;
  enabled?: boolean;
  protocol?: string;
  secret?: string;
};

type KeycloakRealmConfig = {
  realm?: string;
  attributes?: Record<string, string>;
  accessTokenLifespan?: number;
  accessTokenLifespanForImplicitFlow?: number;
  ssoSessionIdleTimeout?: number;
  ssoSessionMaxLifespan?: number;
  ssoSessionIdleTimeoutRememberMe?: number;
  ssoSessionMaxLifespanRememberMe?: number;
  clientSessionIdleTimeout?: number;
  clientSessionMaxLifespan?: number;
  clientOfflineSessionIdleTimeout?: number;
  clientOfflineSessionMaxLifespan?: number;
  offlineSessionIdleTimeout?: number;
  offlineSessionMaxLifespan?: number;
  actionTokenGeneratedByAdminLifespan?: number;
  actionTokenGeneratedByUserLifespan?: number;
  [key: string]: unknown;
};

interface SeedUser {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
}

const keycloakBaseUrl =
  process.env.INTERNAL_KEYCLOAK_BASE_URL
  ?? process.env.PUBLIC_KEYCLOAK_BASE_URL
  ?? 'http://localhost:18080';
const keycloakRealm = process.env.KEYCLOAK_REALM ?? 'mbos';
const keycloakAdminUser = process.env.KEYCLOAK_ADMIN ?? 'admin';
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
const keycloakDirectoryClientId = process.env.KEYCLOAK_DIRECTORY_CLIENT_ID ?? 'agentsmith-directory';
const keycloakDirectoryClientSecret = process.env.KEYCLOAK_DIRECTORY_CLIENT_SECRET ?? 'agentsmith-directory-secret';
const defaultIntegrationWebPorts = ['3001', '3011', '3021', '3041', '3051', '3061', '3066', '3069', '3070', '3071', '3081', '3091', '3101'];
const dynamicWebBaseEnvKeys = [
  'KEYCLOAK_REDIRECT_BASE_URL',
  'BASE_URL',
  'INTEGRATION_BASE_URL',
  'RUNTIME_BROWSER_WEB_BASE_URL',
  'RUNTIME_HOST_WEB_BASE_URL',
] as const;
const dynamicWebPortEnvKeys = [
  'INTEGRATION_WEB_PORT',
  'WEB_PORT',
  'PORT_WEB',
] as const;
const publicKeycloakBaseUrlRaw = process.env.PUBLIC_KEYCLOAK_BASE_URL ?? '';
const keycloakAccessTokenLifespanSec = Number(process.env.KEYCLOAK_ACCESS_TOKEN_LIFESPAN_SEC ?? '28800');
const keycloakSsoIdleSec = Number(process.env.KEYCLOAK_SSO_IDLE_TIMEOUT_SEC ?? '43200');
const keycloakSsoMaxSec = Number(process.env.KEYCLOAK_SSO_MAX_LIFESPAN_SEC ?? '604800');
const keycloakOfflineIdleSec = Number(process.env.KEYCLOAK_OFFLINE_IDLE_TIMEOUT_SEC ?? '2592000');

const seedUsers: SeedUser[] = [
  {
    username: process.env.INTEGRATION_DEV_ADMIN_USERNAME ?? 'dev-admin',
    password: process.env.INTEGRATION_DEV_ADMIN_PASSWORD ?? 'dev-admin-123',
    firstName: 'Dev',
    lastName: 'Admin',
    email: 'dev-admin@example.com',
  },
  {
    username: process.env.INTEGRATION_USER_USERNAME ?? 'integration-user',
    password: process.env.INTEGRATION_USER_PASSWORD ?? 'integration-user-123',
    firstName: 'Integration',
    lastName: 'User',
    email: 'integration-user@example.com',
  },
  {
    username: process.env.INTEGRATION_MEMBER_USERNAME ?? 'integration-member',
    password: process.env.INTEGRATION_MEMBER_PASSWORD ?? 'integration-member-123',
    firstName: 'Integration',
    lastName: 'Member',
    email: 'integration-member@example.com',
  },
  {
    username: process.env.INTEGRATION_GUEST_USERNAME ?? 'integration-guest',
    password: process.env.INTEGRATION_GUEST_PASSWORD ?? 'integration-guest-123',
    firstName: 'Integration',
    lastName: 'Guest',
    email: 'integration-guest@example.com',
  },
  {
    username: process.env.INTEGRATION_INVITEE_USERNAME ?? 'integration-invitee',
    password: process.env.INTEGRATION_INVITEE_PASSWORD ?? 'integration-invitee-123',
    firstName: 'Integration',
    lastName: 'Invitee',
    email: 'integration-invitee@example.com',
  },
];

const defaultKeycloakInitAttempts = Number.parseInt(
  process.env.INTEGRATION_KEYCLOAK_INIT_ATTEMPTS
  ?? process.env.INTEGRATION_KEYCLOAK_INIT_MAX_ATTEMPTS
  ?? '5',
  10,
);
const defaultKeycloakInitDelayMs = Number.parseInt(
  process.env.INTEGRATION_KEYCLOAK_INIT_DELAY_MS
  ?? process.env.INTEGRATION_KEYCLOAK_INIT_RETRY_DELAY_MS
  ?? '1000',
  10,
);

type KeycloakInitRunner = () => Promise<void>;

type RunKeycloakInitWithRetryOptions = {
  run?: KeycloakInitRunner;
  attempts?: number;
  delayMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  isRetryableError?: (error: unknown) => boolean;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveAttempts(value: number | undefined): number {
  return Number.isInteger(value) && value > 0 ? value : 5;
}

function resolveDelayMs(value: number | undefined): number {
  return Number.isFinite(value) && value >= 0 ? value : 1_000;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function isRetryableKeycloakInitError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('keycloak_update_realm_failed:') && message.includes('Database operation failed');
}

export async function runKeycloakInitWithRetry(options: RunKeycloakInitWithRetryOptions = {}): Promise<void> {
  const run = options.run ?? runKeycloakInitOnce;
  const attempts = resolveAttempts(
    options.attempts
    ?? options.maxAttempts
    ?? defaultKeycloakInitAttempts,
  );
  const delayMs = resolveDelayMs(
    options.delayMs
    ?? options.retryDelayMs
    ?? defaultKeycloakInitDelayMs,
  );
  const sleep = options.sleep ?? sleepMs;
  const isRetryableError = options.isRetryableError ?? isRetryableKeycloakInitError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run();
      return;
    } catch (error) {
      if (!isRetryableError(error) || attempt === attempts) {
        throw error;
      }

      process.stdout.write(
        `[integration-keycloak-init] transient realm update failure; retrying ${attempt}/${attempts}\n`,
      );
      await sleep(delayMs * attempt);
    }
  }
}

async function getAdminToken(): Promise<string> {
  const url = `${keycloakBaseUrl}/realms/master/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: keycloakAdminUser,
    password: keycloakAdminPassword,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_admin_token_failed:${res.status}:${text}`);
  }

  const payload = (await res.json()) as TokenResponse;
  if (!payload.access_token) {
    throw new Error('keycloak_admin_token_missing');
  }
  return payload.access_token;
}

async function adminFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${keycloakBaseUrl}${path}`;
  const headers = new Headers(init?.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  return fetch(url, {
    ...init,
    headers,
  });
}

async function findUser(token: string, username: string): Promise<KeycloakUser | null> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users?username=${encodeURIComponent(username)}&exact=true`,
    { method: 'GET' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_find_user_failed:${username}:${res.status}:${text}`);
  }

  const users = (await res.json()) as KeycloakUser[];
  if (!Array.isArray(users) || users.length === 0) {
    return null;
  }
  return users[0] ?? null;
}

async function createUser(token: string, user: SeedUser): Promise<void> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users`,
    {
      method: 'POST',
      body: JSON.stringify({
        username: user.username,
        enabled: true,
        emailVerified: true,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      }),
    },
  );

  if (!(res.status === 201 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_create_user_failed:${user.username}:${res.status}:${text}`);
  }
}

async function updateUserProfile(token: string, userId: string, user: SeedUser): Promise<void> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users/${encodeURIComponent(userId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        id: userId,
        username: user.username,
        enabled: true,
        emailVerified: true,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      }),
    },
  );

  if (!(res.status === 200 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_update_user_failed:${user.username}:${res.status}:${text}`);
  }
}

async function resetPassword(token: string, userId: string, password: string, username: string): Promise<void> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'PUT',
      body: JSON.stringify({
        type: 'password',
        value: password,
        temporary: false,
      }),
    },
  );

  if (!(res.status === 200 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_reset_password_failed:${username}:${res.status}:${text}`);
  }
}

async function ensureUser(token: string, user: SeedUser): Promise<void> {
  let found = await findUser(token, user.username);
  if (!found) {
    await createUser(token, user);
    found = await findUser(token, user.username);
  }
  if (!found) {
    throw new Error(`keycloak_user_missing_after_create:${user.username}`);
  }

  await updateUserProfile(token, found.id, user);
  await resetPassword(token, found.id, user.password, user.username);
  process.stdout.write(`[integration-keycloak-init] ensured ${user.username}\n`);
}

async function findClient(token: string, clientId: string): Promise<KeycloakClientSummary | null> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients?clientId=${encodeURIComponent(clientId)}`,
    { method: 'GET' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_find_client_failed:${clientId}:${res.status}:${text}`);
  }
  const items = (await res.json()) as KeycloakClientSummary[];
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[0] ?? null;
}

type KeycloakRoleRepresentation = {
  id: string;
  name: string;
  clientRole?: boolean;
  containerId?: string;
};

async function createClient(token: string, payload: Record<string, unknown>): Promise<void> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
  if (!(res.status === 201 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_create_client_failed:${String(payload.clientId ?? 'unknown')}:${res.status}:${text}`);
  }
}

async function getClientConfig(token: string, clientId: string): Promise<KeycloakClientConfig> {
  const client = await findClient(token, clientId);
  if (!client?.id) {
    throw new Error(`keycloak_client_not_found:${clientId}`);
  }
  const getRes = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients/${encodeURIComponent(client.id)}`,
    { method: 'GET' },
  );
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`keycloak_get_client_failed:${clientId}:${getRes.status}:${text}`);
  }
  return (await getRes.json()) as KeycloakClientConfig;
}

async function putClientConfig(token: string, config: KeycloakClientConfig): Promise<void> {
  const putRes = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients/${encodeURIComponent(config.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(config),
    },
  );
  if (!(putRes.status === 200 || putRes.status === 204)) {
    const text = await putRes.text();
    throw new Error(`keycloak_update_client_failed:${config.clientId ?? config.id}:${putRes.status}:${text}`);
  }
}

async function listClientRoles(token: string, clientUuid: string): Promise<KeycloakRoleRepresentation[]> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients/${encodeURIComponent(clientUuid)}/roles`,
    { method: 'GET' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_list_client_roles_failed:${clientUuid}:${res.status}:${text}`);
  }
  const payload = (await res.json()) as KeycloakRoleRepresentation[];
  return Array.isArray(payload) ? payload : [];
}

async function getServiceAccountUserId(token: string, clientUuid: string): Promise<string> {
  const res = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients/${encodeURIComponent(clientUuid)}/service-account-user`,
    { method: 'GET' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_service_account_lookup_failed:${clientUuid}:${res.status}:${text}`);
  }
  const payload = (await res.json()) as { id?: string };
  const userId = payload.id?.trim();
  if (!userId) {
    throw new Error(`keycloak_service_account_missing:${clientUuid}`);
  }
  return userId;
}

async function listClientRoleMappings(args: {
  token: string;
  userId: string;
  clientUuid: string;
}): Promise<KeycloakRoleRepresentation[]> {
  const res = await adminFetch(
    args.token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users/${encodeURIComponent(args.userId)}/role-mappings/clients/${encodeURIComponent(args.clientUuid)}`,
    { method: 'GET' },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`keycloak_list_role_mappings_failed:${args.clientUuid}:${res.status}:${text}`);
  }
  const payload = (await res.json()) as KeycloakRoleRepresentation[];
  return Array.isArray(payload) ? payload : [];
}

async function addClientRoleMappings(args: {
  token: string;
  userId: string;
  clientUuid: string;
  roles: KeycloakRoleRepresentation[];
}): Promise<void> {
  if (args.roles.length === 0) {
    return;
  }
  const res = await adminFetch(
    args.token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/users/${encodeURIComponent(args.userId)}/role-mappings/clients/${encodeURIComponent(args.clientUuid)}`,
    {
      method: 'POST',
      body: JSON.stringify(args.roles),
    },
  );
  if (!(res.status === 200 || res.status === 204)) {
    const text = await res.text();
    throw new Error(`keycloak_add_role_mappings_failed:${args.clientUuid}:${res.status}:${text}`);
  }
}

function toOriginAndRedirect(base: string): { origin: string; redirect: string } {
  const origin = base.replace(/\/+$/, '');
  return { origin, redirect: `${origin}/*` };
}

function parseCsvValues(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function addWebBase(target: Set<string>, raw: string | undefined): void {
  const value = raw?.trim();
  if (!value) {
    return;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      target.add(parsed.origin);
    }
  } catch {
    // Ignore malformed optional env values; Keycloak init still validates through its API.
  }
}

function addLoopbackWebPort(target: Set<string>, raw: string | undefined): void {
  const port = raw?.trim();
  if (!port || !/^\d+$/.test(port)) {
    return;
  }
  target.add(`http://localhost:${port}`);
  target.add(`http://127.0.0.1:${port}`);
}

export function resolveIntegrationKeycloakRedirectBases(env: NodeJS.ProcessEnv = process.env): string[] {
  const bases = new Set<string>();

  for (const port of defaultIntegrationWebPorts) {
    addLoopbackWebPort(bases, port);
  }
  for (const port of parseCsvValues(env.INTEGRATION_WEB_PORTS)) {
    addLoopbackWebPort(bases, port);
  }
  for (const key of dynamicWebPortEnvKeys) {
    addLoopbackWebPort(bases, env[key]);
  }
  for (const key of dynamicWebBaseEnvKeys) {
    addWebBase(bases, env[key]);
  }
  for (const base of parseCsvValues(env.INTEGRATION_PUBLIC_WEB_BASES)) {
    addWebBase(bases, base);
  }

  return Array.from(bases);
}

async function ensureClientRedirects(token: string): Promise<void> {
  const config = await getClientConfig(token, keycloakClientId);
  const requiredBases = resolveIntegrationKeycloakRedirectBases();

  const nextRedirects = new Set<string>(Array.isArray(config.redirectUris) ? config.redirectUris : []);
  const nextOrigins = new Set<string>(Array.isArray(config.webOrigins) ? config.webOrigins : []);
  for (const base of requiredBases) {
    const item = toOriginAndRedirect(base);
    nextOrigins.add(item.origin);
    nextRedirects.add(item.redirect);
  }

  config.redirectUris = Array.from(nextRedirects);
  config.webOrigins = Array.from(nextOrigins);
  // Keep password grant fallback stable after deps reset.
  config.directAccessGrantsEnabled = true;
  config.standardFlowEnabled = true;
  config.publicClient = true;
  config.serviceAccountsEnabled = false;

  await putClientConfig(token, config);
  process.stdout.write(`[integration-keycloak-init] ensured redirects for ${keycloakClientId}\n`);
}

async function ensureDirectoryClient(token: string): Promise<void> {
  let client = await findClient(token, keycloakDirectoryClientId);
  if (!client?.id) {
    await createClient(token, {
      clientId: keycloakDirectoryClientId,
      protocol: 'openid-connect',
      enabled: true,
      publicClient: false,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: true,
      secret: keycloakDirectoryClientSecret,
    });
    client = await findClient(token, keycloakDirectoryClientId);
  }
  if (!client?.id) {
    throw new Error(`keycloak_directory_client_missing:${keycloakDirectoryClientId}`);
  }

  const config = await getClientConfig(token, keycloakDirectoryClientId);
  config.enabled = true;
  config.protocol = 'openid-connect';
  config.publicClient = false;
  config.standardFlowEnabled = false;
  config.directAccessGrantsEnabled = false;
  config.serviceAccountsEnabled = true;
  config.secret = keycloakDirectoryClientSecret;
  await putClientConfig(token, config);

  const realmManagement = await findClient(token, 'realm-management');
  if (!realmManagement?.id) {
    throw new Error('keycloak_realm_management_client_missing');
  }

  const serviceAccountUserId = await getServiceAccountUserId(token, client.id);
  const availableRoles = await listClientRoles(token, realmManagement.id);
  const requiredRoles = availableRoles.filter((role) => role.name === 'query-users' || role.name === 'view-users');
  const currentRoles = await listClientRoleMappings({
    token,
    userId: serviceAccountUserId,
    clientUuid: realmManagement.id,
  });
  const currentRoleNames = new Set(currentRoles.map((role) => role.name));
  const missingRoles = requiredRoles
    .filter((role) => !currentRoleNames.has(role.name))
    .map((role) => ({
      id: role.id,
      name: role.name,
      clientRole: true,
      containerId: realmManagement.id,
    }));
  await addClientRoleMappings({
    token,
    userId: serviceAccountUserId,
    clientUuid: realmManagement.id,
    roles: missingRoles,
  });
  process.stdout.write(`[integration-keycloak-init] ensured directory client ${keycloakDirectoryClientId}\n`);
}

async function ensureRealmTokenLifespans(token: string): Promise<void> {
  const realmPath = `/admin/realms/${encodeURIComponent(keycloakRealm)}`;
  const getRes = await adminFetch(token, realmPath, { method: 'GET' });
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`keycloak_get_realm_failed:${keycloakRealm}:${getRes.status}:${text}`);
  }
  const config = (await getRes.json()) as KeycloakRealmConfig;

  const publicKeycloakBaseUrl = publicKeycloakBaseUrlRaw.trim().replace(/\/+$/, '');
  const next: KeycloakRealmConfig = {
    ...config,
    attributes: {
      ...(config.attributes ?? {}),
      ...(publicKeycloakBaseUrl ? { frontendUrl: publicKeycloakBaseUrl } : {}),
    },
    accessTokenLifespan: keycloakAccessTokenLifespanSec,
    accessTokenLifespanForImplicitFlow: keycloakAccessTokenLifespanSec,
    ssoSessionIdleTimeout: keycloakSsoIdleSec,
    ssoSessionMaxLifespan: keycloakSsoMaxSec,
    ssoSessionIdleTimeoutRememberMe: keycloakSsoIdleSec,
    ssoSessionMaxLifespanRememberMe: keycloakSsoMaxSec,
    clientSessionIdleTimeout: keycloakSsoIdleSec,
    clientSessionMaxLifespan: keycloakSsoMaxSec,
    clientOfflineSessionIdleTimeout: keycloakOfflineIdleSec,
    clientOfflineSessionMaxLifespan: keycloakOfflineIdleSec,
    offlineSessionIdleTimeout: keycloakOfflineIdleSec,
    offlineSessionMaxLifespan: keycloakOfflineIdleSec,
    actionTokenGeneratedByAdminLifespan: Math.max(900, Math.min(keycloakSsoIdleSec, 86400)),
    actionTokenGeneratedByUserLifespan: Math.max(900, Math.min(keycloakSsoIdleSec, 86400)),
    sslRequired: 'NONE',
  };

  const putRes = await adminFetch(token, realmPath, {
    method: 'PUT',
    body: JSON.stringify(next),
  });
  if (!(putRes.status === 200 || putRes.status === 204)) {
    const text = await putRes.text();
    throw new Error(`keycloak_update_realm_failed:${keycloakRealm}:${putRes.status}:${text}`);
  }
  process.stdout.write(
    `[integration-keycloak-init] ensured realm token/session lifespans for ${keycloakRealm} `
    + `(access=${keycloakAccessTokenLifespanSec}s, sso_idle=${keycloakSsoIdleSec}s, sso_max=${keycloakSsoMaxSec}s)\n`,
  );
}

export async function runKeycloakInitOnce(): Promise<void> {
  const token = await getAdminToken();
  await ensureRealmTokenLifespans(token);
  await ensureClientRedirects(token);
  await ensureDirectoryClient(token);
  for (const user of seedUsers) {
    await ensureUser(token, user);
  }
  process.stdout.write('[integration-keycloak-init] done\n');
}

export async function runKeycloakRedirectsOnlyOnce(): Promise<void> {
  const token = await getAdminToken();
  await ensureClientRedirects(token);
  process.stdout.write('[integration-keycloak-init] redirects-only done\n');
}

export async function main(): Promise<void> {
  const redirectsOnly = process.argv.includes('--redirects-only')
    || process.env.INTEGRATION_KEYCLOAK_INIT_SCOPE === 'redirects-only';
  await runKeycloakInitWithRetry({
    run: redirectsOnly ? runKeycloakRedirectsOnlyOnce : runKeycloakInitOnce,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void main().catch((error) => {
    process.stderr.write(`[integration-keycloak-init] failed: ${getErrorMessage(error)}\n`);
    process.exit(1);
  });
}
