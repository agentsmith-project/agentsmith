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
};

type KeycloakRealmConfig = {
  realm?: string;
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

const keycloakBaseUrl = process.env.KEYCLOAK_BASE_URL ?? 'http://localhost:18080';
const keycloakRealm = process.env.KEYCLOAK_REALM ?? 'mbos';
const keycloakAdminUser = process.env.KEYCLOAK_ADMIN ?? 'admin';
const keycloakAdminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';
const keycloakClientId = process.env.KEYCLOAK_CLIENT_ID ?? 'agentsmith';
const integrationWebPort = process.env.INTEGRATION_WEB_PORT ?? '3001';
const integrationWebPortsRaw = process.env.INTEGRATION_WEB_PORTS ?? '3001,3011,3021';
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
];

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

function toOriginAndRedirect(base: string): { origin: string; redirect: string } {
  const origin = base.replace(/\/+$/, '');
  return { origin, redirect: `${origin}/*` };
}

async function ensureClientRedirects(token: string): Promise<void> {
  const client = await findClient(token, keycloakClientId);
  if (!client) {
    throw new Error(`keycloak_client_not_found:${keycloakClientId}`);
  }

  const getRes = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients/${encodeURIComponent(client.id)}`,
    { method: 'GET' },
  );
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`keycloak_get_client_failed:${keycloakClientId}:${getRes.status}:${text}`);
  }

  const config = (await getRes.json()) as KeycloakClientConfig;
  const extraWebPorts = integrationWebPortsRaw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const requiredBases = [
    `http://localhost:${integrationWebPort}`,
    `http://127.0.0.1:${integrationWebPort}`,
    'http://localhost:3000',
    'http://localhost:3001',
    ...extraWebPorts.flatMap((port) => [`http://localhost:${port}`, `http://127.0.0.1:${port}`]),
  ];

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

  const putRes = await adminFetch(
    token,
    `/admin/realms/${encodeURIComponent(keycloakRealm)}/clients/${encodeURIComponent(client.id)}`,
    {
      method: 'PUT',
      body: JSON.stringify(config),
    },
  );
  if (!(putRes.status === 200 || putRes.status === 204)) {
    const text = await putRes.text();
    throw new Error(`keycloak_update_client_failed:${keycloakClientId}:${putRes.status}:${text}`);
  }
  process.stdout.write(`[integration-keycloak-init] ensured redirects for ${keycloakClientId}\n`);
}

async function ensureRealmTokenLifespans(token: string): Promise<void> {
  const realmPath = `/admin/realms/${encodeURIComponent(keycloakRealm)}`;
  const getRes = await adminFetch(token, realmPath, { method: 'GET' });
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`keycloak_get_realm_failed:${keycloakRealm}:${getRes.status}:${text}`);
  }
  const config = (await getRes.json()) as KeycloakRealmConfig;

  const next: KeycloakRealmConfig = {
    ...config,
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

async function main(): Promise<void> {
  const token = await getAdminToken();
  await ensureRealmTokenLifespans(token);
  await ensureClientRedirects(token);
  for (const user of seedUsers) {
    await ensureUser(token, user);
  }
  process.stdout.write('[integration-keycloak-init] done\n');
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[integration-keycloak-init] failed: ${message}\n`);
  process.exit(1);
});
